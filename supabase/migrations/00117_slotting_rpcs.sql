-- =============================================================================
-- Slotting Rules — the read RPC and the two write transactions
-- Migration: 00117_slotting_rpcs.sql
-- =============================================================================
-- THREE FUNCTIONS, AND ONE THING THEY ALL DELIBERATELY DO NOT DO: resolve
-- precedence. The specificity ladder has exactly one implementation, in
-- _shared/wie/slotting.ts `resolveSlotting`, and it stays there. A SQL copy is
-- how plan-reslot ended up zone-blind for months (three places answered one
-- question, two were wrong) and how the recode sweep produced -1-1 on the client
-- and -3-3 on the server, each half correct in isolation.
--
-- wie_slotting_rule_rows therefore reports a rule's MATCH COUNT -- how many
-- products satisfy its ANDed conditions -- and not which rule governs any of
-- them. Counting is not ranking. The count exists because match_category has no
-- FK (categories are free text since 00069), so renaming a category silently
-- stops a rule matching and there is otherwise nothing on screen that would ever
-- show it. A zero next to a rule is the only way an operator finds out.
--
-- THE TWO WRITES ARE TRANSACTIONS BECAUSE TWO supabase-js STATEMENTS ARE NOT.
-- Both are delete-then-insert rather than upsert, and that is forced, not
-- preferred: uq_slotting_rule_rank is DEFERRABLE (00115), because a drag-reorder
-- rewrites every rank at once and a non-deferrable UNIQUE trips 23505
-- mid-statement -- and a deferrable constraint CANNOT be an ON CONFLICT arbiter.
-- Postgres rejects the inference outright. There is no ordering of a separate
-- DELETE and INSERT over PostgREST that is safe: delete-first leaves a live
-- warehouse with a rule that has no homes if the insert fails.
-- =============================================================================

BEGIN;

-- ── 1. Read: everything the settings table and the map panel need ────────────

CREATE OR REPLACE FUNCTION public.wie_slotting_rule_rows(p_warehouse_id INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role   TEXT;
    v_result JSONB;
BEGIN
    -- Admin/Manager, matching mutate-slotting-rule's allowed roles. A NULL role
    -- is the service_role path (auth.uid() is null there), trusted by definition.
    v_role := public.user_role();
    IF v_role IS NOT NULL AND v_role NOT IN ('Admin', 'Manager') THEN
        RAISE EXCEPTION 'FORBIDDEN: slotting rules are Admin/Manager only'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT jsonb_build_object(
        'blocks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', b.id,
                'name', b.name,
                'sourceKind', b.source_kind,
                'sourceAreaName', b.source_area_name,
                'unitCount', (SELECT count(*) FROM public.slotting_block_members m
                               WHERE m.block_id = b.id),
                'binCount',  (SELECT count(*) FROM public.v_slotting_block_bins vb
                               WHERE vb.block_id = b.id),
                'ruleCount', (SELECT count(*) FROM public.slotting_rule_blocks rb
                               WHERE rb.block_id = b.id)
            ) ORDER BY lower(btrim(b.name)))
            FROM public.slotting_blocks b
            WHERE b.warehouse_id = p_warehouse_id
        ), '[]'::jsonb),
        'rules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', r.id,
                'name', r.name,
                'specificity', r.specificity,
                'matchProductId', r.match_product_id,
                'matchProductSku', (SELECT p.sku FROM public.products p WHERE p.id = r.match_product_id),
                'matchBrand', r.match_brand,
                'matchCategory', r.match_category,
                'matchSupplierId', r.match_supplier_id,
                'matchSupplierName', (SELECT s.name FROM public.suppliers s WHERE s.id = r.match_supplier_id),
                'enforcement', r.enforcement,
                'reserveEmpty', r.reserve_empty,
                'isActive', r.is_active,
                -- COUNTING, NOT RANKING. See the header: this says how many
                -- products this rule's conditions match, never which rule wins
                -- for any of them. Folded on both sides to agree with
                -- slotting.ts foldMatch.
                'matchCount', (
                    SELECT count(*) FROM public.products p
                     WHERE (r.match_product_id IS NULL OR p.id = r.match_product_id)
                       AND (r.match_brand IS NULL
                            OR lower(btrim(p.brand)) = lower(btrim(r.match_brand)))
                       AND (r.match_category IS NULL
                            OR lower(btrim(p.category)) = lower(btrim(r.match_category)))
                       AND (r.match_supplier_id IS NULL OR EXISTS (
                             SELECT 1 FROM public.product_suppliers ps
                              WHERE ps.product_id = p.id
                                AND ps.supplier_id = r.match_supplier_id))
                       AND p.is_active
                ),
                -- Rank order is the array order downstream; `rank` exists only
                -- to survive this round trip.
                'blocks', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('id', rb.block_id, 'rank', rb.rank,
                                                        'name', bb.name)
                                     ORDER BY rb.rank)
                      FROM public.slotting_rule_blocks rb
                      JOIN public.slotting_blocks bb ON bb.id = rb.block_id
                     WHERE rb.rule_id = r.id
                ), '[]'::jsonb)
            ) ORDER BY r.specificity DESC, r.id)
            FROM public.slotting_rules r
            WHERE r.warehouse_id = p_warehouse_id
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_slotting_rule_rows(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wie_slotting_rule_rows(INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.wie_slotting_rule_rows(INT) IS
    'Slotting rules and blocks for one warehouse. Facts only -- it reports how '
    'many products each rule MATCHES and never which rule GOVERNS a product; '
    'the specificity ladder has one implementation, in _shared/wie/slotting.ts.';

-- ── 2. Write: a block and its members ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wie_set_slotting_block_tx(
    p_warehouse_id     INT,
    p_block_id         INT,
    p_name             TEXT,
    p_source_kind      TEXT,
    p_source_area_name TEXT,
    p_members          JSONB   -- [{location_id, unit_kind}]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id      INT;
    v_wh_path TEXT;
    v_bad     INT;
BEGIN
    SELECT materialized_path INTO v_wh_path
      FROM public.locations WHERE id = p_warehouse_id AND kind = 'WAREHOUSE';
    IF v_wh_path IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: warehouse % does not exist', p_warehouse_id
            USING ERRCODE = 'P0001';
    END IF;

    IF p_block_id IS NULL THEN
        INSERT INTO public.slotting_blocks
            (warehouse_id, name, source_kind, source_area_name, created_by, updated_by)
        VALUES (p_warehouse_id, p_name, p_source_kind, p_source_area_name, auth.uid(), auth.uid())
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.slotting_blocks
           SET name = p_name, source_kind = p_source_kind,
               source_area_name = p_source_area_name,
               updated_by = auth.uid(), updated_at = now()
         WHERE id = p_block_id AND warehouse_id = p_warehouse_id
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'NOT_FOUND: block % is not in warehouse %', p_block_id, p_warehouse_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    DELETE FROM public.slotting_block_members WHERE block_id = v_id;

    INSERT INTO public.slotting_block_members (block_id, location_id, unit_kind)
    SELECT v_id, (m->>'location_id')::INT, m->>'unit_kind'
      FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb)) m
    ON CONFLICT DO NOTHING;

    -- Scope guard. A well-formed id is not proof of belonging: without this a
    -- caller could quietly assemble a block out of another site's racks, and
    -- every downstream refusal would then be about bins nobody at this
    -- warehouse can see.
    SELECT count(*) INTO v_bad
      FROM public.slotting_block_members m
      JOIN public.locations l ON l.id = m.location_id
     WHERE m.block_id = v_id
       AND l.materialized_path NOT LIKE v_wh_path || '/%'
       AND l.id <> p_warehouse_id;
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'CONFLICT: % member location(s) are outside this warehouse', v_bad
            USING ERRCODE = 'P0001';
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_set_slotting_block_tx(INT,INT,TEXT,TEXT,TEXT,JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_set_slotting_block_tx(INT,INT,TEXT,TEXT,TEXT,JSONB)
    TO service_role;

-- ── 3. Write: a rule and its ranked blocks ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.wie_set_slotting_rule_tx(
    p_warehouse_id     INT,
    p_rule_id          INT,
    p_name             TEXT,
    p_match_product_id INT,
    p_match_brand      TEXT,
    p_match_category   TEXT,
    p_match_supplier_id INT,
    p_enforcement      TEXT,
    p_reserve_empty    BOOLEAN,
    p_is_active        BOOLEAN,
    p_block_ids        INT[]   -- ARRAY ORDER IS THE RANK
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id  INT;
    v_bad INT;
BEGIN
    IF p_rule_id IS NULL THEN
        INSERT INTO public.slotting_rules
            (warehouse_id, name, match_product_id, match_brand, match_category,
             match_supplier_id, enforcement, reserve_empty, is_active, created_by, updated_by)
        VALUES (p_warehouse_id, p_name, p_match_product_id, p_match_brand, p_match_category,
                p_match_supplier_id, p_enforcement, p_reserve_empty, p_is_active,
                auth.uid(), auth.uid())
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.slotting_rules
           SET name = p_name, match_product_id = p_match_product_id,
               match_brand = p_match_brand, match_category = p_match_category,
               match_supplier_id = p_match_supplier_id, enforcement = p_enforcement,
               reserve_empty = p_reserve_empty, is_active = p_is_active,
               updated_by = auth.uid(), updated_at = now()
         WHERE id = p_rule_id AND warehouse_id = p_warehouse_id
        RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RAISE EXCEPTION 'NOT_FOUND: rule % is not in warehouse %', p_rule_id, p_warehouse_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Every block must belong to this warehouse. Same argument as the member
    -- scope guard above: a rule homing a product in another site's rack would
    -- be enforced by the engine and invisible on this site's map.
    SELECT count(*) INTO v_bad
      FROM unnest(COALESCE(p_block_ids, ARRAY[]::INT[])) AS bid
     WHERE NOT EXISTS (
        SELECT 1 FROM public.slotting_blocks b
         WHERE b.id = bid AND b.warehouse_id = p_warehouse_id);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'CONFLICT: % block(s) are not in this warehouse', v_bad
            USING ERRCODE = 'P0001';
    END IF;

    -- Delete-then-insert, NOT upsert: uq_slotting_rule_rank is DEFERRABLE and
    -- Postgres refuses to infer a deferrable constraint as an ON CONFLICT
    -- arbiter. The deferral is what lets the ranks below be rewritten wholesale
    -- without tripping 23505 halfway through.
    DELETE FROM public.slotting_rule_blocks WHERE rule_id = v_id;

    INSERT INTO public.slotting_rule_blocks (rule_id, block_id, rank)
    SELECT v_id, bid, ord
      FROM unnest(COALESCE(p_block_ids, ARRAY[]::INT[])) WITH ORDINALITY AS t(bid, ord);

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_set_slotting_rule_tx(INT,INT,TEXT,INT,TEXT,TEXT,INT,TEXT,BOOLEAN,BOOLEAN,INT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_set_slotting_rule_tx(INT,INT,TEXT,INT,TEXT,TEXT,INT,TEXT,BOOLEAN,BOOLEAN,INT[])
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT public.wie_slotting_rule_rows(
--     (SELECT id FROM public.locations WHERE code = 'MAIN'));
--     -- expect {"blocks": [], "rules": []} on a site with none
--
--   -- A reorder must not trip the unique constraint (this is what DEFERRABLE
--   -- buys, and the reason the write is delete-then-insert):
--   BEGIN;
--     SELECT public.wie_set_slotting_rule_tx(1, <rule>, 'r', NULL, 'X', NULL, NULL,
--                                            'soft', false, true, ARRAY[2,1]);
--     SELECT block_id, rank FROM public.slotting_rule_blocks WHERE rule_id = <rule>
--      ORDER BY rank;   -- expect 2 then 1
--   ROLLBACK;
--
--   -- Scope guards must refuse a foreign location / block outright:
--   SELECT public.wie_set_slotting_block_tx(1, NULL, 'x', 'manual', NULL,
--            '[{"location_id": <a bin in another warehouse>, "unit_kind": "bin"}]');
--     -- expect: CONFLICT: 1 member location(s) are outside this warehouse
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_slotting_rule_rows(INT);
--   DROP FUNCTION IF EXISTS public.wie_set_slotting_block_tx(INT,INT,TEXT,TEXT,TEXT,JSONB);
--   DROP FUNCTION IF EXISTS public.wie_set_slotting_rule_tx(INT,INT,TEXT,INT,TEXT,TEXT,INT,TEXT,BOOLEAN,BOOLEAN,INT[]);
-- =============================================================================
