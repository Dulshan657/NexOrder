-- =============================================================================
-- Quarantine — stock that is in the building but must not be sold
-- Migration: 00101_quarantine_hold_zones.sql
-- =============================================================================
-- One column on `zone_profiles`, one view, and three function bodies. Plus a
-- privilege repair that has nothing to do with quarantine — see §5.
--
-- ── THE DECISION IS MANUAL. THE ENFORCEMENT CANNOT BE. ──────────────────────
--
-- The operator flags a delivery at receiving and releases it by moving it out.
-- Both are deliberate acts and neither is automated here. What IS automatic is
-- the consequence: while the stock sits in a hold zone, nothing may allocate it.
-- Left to discipline, "not sellable" means "not sellable until someone places an
-- order for that SKU", which is exactly when it matters and exactly when nobody
-- is looking.
--
-- ── WHY A ZONE, AND NOT A FLAG ON THE STOCK ─────────────────────────────────
--
-- Because release must be free. If the hold lived on the balance row, releasing
-- would mean finding and clearing every flag, and a flag left behind is stock
-- that silently never sells again. Attach it to the PLACE instead and moving the
-- pallet out IS the release — there is no second thing to remember.
--
-- It also reuses machinery that already exists and that the operator has already
-- driven: painting a Quarantine area binds every bin standing on it to that
-- profile's ZONE (00096), and zone membership is read by prefix-matching
-- `materialized_path`, which 00096 indexed (text_pattern_ops). Erase or re-tint
-- the area and the hold follows, by the same rule's third branch.
--
-- ── `is_hold`, NOT `zone_type = 'quarantine'` ───────────────────────────────
--
-- 00057 dropped the CHECK on `zone_type`, so it is free text an operator can
-- invent. Keying behaviour off a magic string is what 00081 stopped doing for
-- level roles ("never compare a role to a literal to decide behaviour — read the
-- flags"), and the same argument applies here. A flag also generalises to the
-- other hold areas a warehouse grows — damaged, awaiting-QA, customer-return —
-- without any of them having to be called quarantine.
-- =============================================================================

-- ── 1. The flag ──────────────────────────────────────────────────────────────
ALTER TABLE public.zone_profiles
    ADD COLUMN IF NOT EXISTS is_hold BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.zone_profiles.is_hold IS
    'Stock in a zone of this profile is HELD: it is on hand, but it cannot be '
    'allocated to an order, and putaway will not route ordinary receipts into '
    'it. Moving the stock out is the release. Read by inv_reserve_order, '
    'inv_recompute_product_cache and wie_putaway_candidates via v_held_locations.';

-- The one seeded profile that already means this. Deliberately narrow: a
-- profile called Returns holds stock that is often perfectly sellable, and
-- turning it into a hold would strand it.
UPDATE public.zone_profiles SET is_hold = true WHERE zone_type = 'quarantine';

-- ── 2. v_held_locations — the single definition of "this bin is held" ────────
-- One place, three consumers, exactly as v_bin_fill is the single definition of
-- bin fill. The ancestry test is the same one 00096's LATERAL uses; note it
-- matches the ZONE row itself as well as its descendants, so a balance parked
-- directly on a ZONE (which nothing creates today) cannot slip through.
CREATE OR REPLACE VIEW public.v_held_locations AS
SELECT DISTINCT
    l.id  AS location_id,
    z.id  AS zone_id,
    zp.id AS zone_profile_id
FROM public.locations l
JOIN public.locations z
  ON z.kind = 'ZONE'
 AND (l.materialized_path = z.materialized_path
      OR l.materialized_path LIKE z.materialized_path || '/%')
JOIN public.zone_profiles zp
  ON zp.id = z.zone_profile_id
 AND zp.is_hold;

COMMENT ON VIEW public.v_held_locations IS
    'Locations sitting under a zone whose profile is_hold (mig 00101). Not '
    'granted to authenticated: its only consumers are SECURITY DEFINER '
    'functions, which read it as the owner.';

-- ── 3. inv_reserve_order — the load-bearing change ──────────────────────────
-- Without this every other line here is decoration. Same signature as 00083, so
-- CREATE OR REPLACE genuinely replaces rather than overloading.
--
-- Note what is NOT changed: the balance row keeps its `available`, so
-- inv_transfer_stock can still move the stock OUT. That is what makes release
-- an ordinary transfer rather than a special case.
CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_location_pref INT[] DEFAULT NULL,
    p_actor         UUID DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pref      INT[];
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_loc       INT;
    v_row       RECORD;
BEGIN
    v_pref := NULLIF(p_location_pref, '{}');
    IF v_pref IS NULL THEN
        v_pref := ARRAY[public.inv_default_location()];
    END IF;
    IF v_pref IS NULL OR array_length(v_pref, 1) IS NULL OR v_pref[1] IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

        FOREACH v_loc IN ARRAY v_pref
        LOOP
            EXIT WHEN v_remaining <= 0;
            FOR v_row IN
                SELECT b.id, b.location_id, b.batch_id, b.handling_unit_id, b.available
                FROM public.inventory_balances b
                LEFT JOIN public.batches     bt ON bt.id  = b.batch_id
                -- 00083: the bin's level role, so a pick zone can be preferred.
                -- LEFT JOINs, both: a legacy bin has no level_role and must stay
                -- eligible.
                LEFT JOIN public.locations   l  ON l.id   = b.location_id
                LEFT JOIN public.level_roles lr ON lr.key = l.level_role
                WHERE b.product_id = v_pid
                  AND b.location_id IN (SELECT location_id FROM public.inv_warehouse_draw_locations(v_loc))
                  AND b.available > 0
                  -- NEW in 00101. Held stock is on hand and is not for sale.
                  -- NOT EXISTS rather than a LEFT JOIN + IS NULL: this must not
                  -- be able to duplicate a balance row and allocate it twice.
                  AND NOT EXISTS (
                      SELECT 1 FROM public.v_held_locations h
                      WHERE h.location_id = b.location_id
                  )
                ORDER BY
                    -- FEFO FIRST, exactly as before.
                    bt.expiry_date NULLS LAST,
                    -- Pick zone as the TIEBREAK inside an expiry date. COALESCE,
                    -- not a bare boolean: lr is NULL for every legacy bin, and a
                    -- NULL here is not FALSE.
                    (CASE WHEN COALESCE(lr.is_pick_zone, false) THEN 0 ELSE 1 END),
                    bt.received_at NULLS FIRST,
                    b.id
                FOR UPDATE OF b
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.available);
                PERFORM public.inv_apply_leg(
                    v_pid, v_row.location_id, v_row.batch_id, 0, v_take,
                    'allocate', p_actor, 'order', p_order_id, NULL,
                    NULL, v_row.handling_unit_id);
                v_remaining := v_remaining - v_take;
            END LOOP;
        END LOOP;

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

-- ── 4. inv_recompute_product_cache — or the catalogue lies ──────────────────
-- `products.available` is a CACHE of what can be sold, and the shop reads it. If
-- allocation refuses held stock but the cache still counts it, the customer is
-- offered units no order can ever take — a worse failure than either behaviour
-- alone, because it only surfaces at checkout.
--
-- `inventory` is deliberately NOT filtered. It answers "what is in the
-- building", and held pallets are very much in the building; a stocktake that
-- could not see them would be wrong.
CREATE OR REPLACE FUNCTION public.inv_recompute_product_cache(p_product_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.products p
    SET inventory = COALESCE((
            SELECT SUM(b.on_hand)
            FROM public.inventory_balances b
            WHERE b.product_id = p_product_id
        ), 0),
        available = FLOOR(COALESCE((
            SELECT SUM(b.available)
            FROM public.inventory_balances b
            WHERE b.product_id = p_product_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.v_held_locations h
                  WHERE h.location_id = b.location_id
              )
        ), 0))
    WHERE p.id = p_product_id;
END;
$$;

-- One-time reconcile: the definition of `available` just changed, and nothing
-- else will recompute a product until its stock next moves.
UPDATE public.products p
SET available = FLOOR(COALESCE((
        SELECT SUM(b.available)
        FROM public.inventory_balances b
        WHERE b.product_id = p.id
          AND NOT EXISTS (
              SELECT 1 FROM public.v_held_locations h
              WHERE h.location_id = b.location_id
          )
    ), 0));

-- ── 5. wie_putaway_candidates — and a privilege repair ──────────────────────
--
-- DROP before CREATE because the signature gains a parameter, and CREATE OR
-- REPLACE with a changed signature makes a SECOND overload rather than
-- replacing (the trap that has already bitten inv_transfer_stock and
-- inv_receive_stock). Both callers pass named arguments, so an overload would
-- fail at runtime as an ambiguous call, not at deploy.
--
-- `p_hold_only` is deliberately a switch and not an "include" flag:
--   false (default) — hold zones are EXCLUDED. An ordinary receipt must never be
--                     routed into quarantine; nobody asked for it to be held.
--   true            — ONLY hold zones. A quarantined receipt must not be able to
--                     land anywhere else, which "include" would allow.
--
-- SEPARATELY, AND NOT ABOUT QUARANTINE: this function lost its REVOKE. 00045
-- through 00072 each re-granted it service_role-only after every rebuild, and
-- 00078 dropped both signatures and created the new one WITHOUT re-granting —
-- so Postgres' default applied and EXECUTE went to PUBLIC. Verified on dev
-- before writing this: the ACL reads `=X/postgres | anon=X | authenticated=X`,
-- where every sibling function reads `service_role=X` alone. Any holder of the
-- anon key could enumerate every bin, its capacity, its fill and whether a given
-- product sits in it. Restored below, and the restoration is why the REVOKE
-- appears here rather than being left to a follow-up.
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT, TEXT[]);

CREATE FUNCTION public.wie_putaway_candidates(
    p_layout_id  INT,
    p_product_id INT,
    p_limit      INT DEFAULT 2000,
    p_roles      TEXT[] DEFAULT NULL,
    p_hold_only  BOOLEAN DEFAULT false
)
RETURNS TABLE(
    location_id              INT,
    code                     TEXT,
    zone_id                  INT,
    zone_tag                 TEXT,
    capacity_slots           NUMERIC,
    used_slots               NUMERIC,
    graph_node_id            INT,
    access_offset_m          NUMERIC,
    has_same_product         BOOLEAN,
    distance_from_dock_m     NUMERIC,
    zone_type                TEXT,
    zone_priority_weight     NUMERIC,
    zone_allowed_categories  JSONB,
    zone_max_utilization_pct NUMERIC,
    bin_categories           JSONB,
    weight_capacity_kg       NUMERIC,
    used_weight_kg           NUMERIC,
    level_role               TEXT,
    level_index              INT,
    slot_kind                TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH dock_nodes AS (
        SELECT id FROM public.layout_graph_nodes
        WHERE layout_id = p_layout_id AND node_type = 'dock'
    ),
    node_dock_dist AS (
        SELECT to_node_id AS node_id, MIN(distance_m) AS dist
        FROM public.layout_travel_distances
        WHERE layout_id = p_layout_id AND from_node_id IN (SELECT id FROM dock_nodes)
        GROUP BY to_node_id
    ),
    bin_weight AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pw.weight_kg, 0)) AS used_weight
        FROM public.inventory_balances b
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    bin_cats AS (
        SELECT b.location_id, jsonb_agg(DISTINCT pr.category) AS cats
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    same_prod AS (
        SELECT DISTINCT location_id FROM public.inventory_balances
        WHERE product_id = p_product_id AND on_hand > 0
    )
    SELECT
        p.location_id,
        l.code,
        zone.id,
        lower(zone.name),
        l.capacity_slots,
        COALESCE(bf.used_slots, 0),
        p.graph_node_id,
        COALESCE(p.access_offset_m, 0),
        (sp.location_id IS NOT NULL),
        ndd.dist,
        zp.zone_type,
        zp.priority_weight,
        zp.allowed_categories,
        zp.max_utilization_pct,
        COALESCE(bc.cats, '[]'::jsonb),
        l.weight_capacity_kg,
        COALESCE(bw.used_weight, 0),
        l.level_role,
        l.level_index,
        l.slot_kind
    FROM public.layout_placements p
    JOIN public.locations l ON l.id = p.location_id
    LEFT JOIN LATERAL (
        SELECT z.id, z.name, z.zone_profile_id FROM public.locations z
        WHERE z.kind = 'ZONE' AND l.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1
    ) zone ON true
    LEFT JOIN public.zone_profiles zp ON zp.id = zone.zone_profile_id
    LEFT JOIN node_dock_dist ndd ON ndd.node_id = p.graph_node_id
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = p.location_id
    LEFT JOIN bin_weight     bw  ON bw.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    WHERE p.layout_id = p_layout_id
      AND l.is_active
      -- A RACK-kind parent has no placement row anyway (belt-and-braces guard).
      AND l.kind <> 'RACK'
      -- NULL level_role (every legacy bin) always stays eligible — the hard
      -- never-mix role rule only ever narrows LEVELLED locations.
      AND (p_roles IS NULL OR l.level_role IS NULL OR l.level_role = ANY(p_roles))
      -- NEW in 00101. COALESCE, because zp is NULL for every unbound bin and a
      -- NULL here is not FALSE: an unbound bin is not held, and must stay
      -- eligible for an ordinary receipt and ineligible for a held one.
      AND COALESCE(zp.is_hold, false) = p_hold_only
    ORDER BY ndd.dist NULLS LAST, p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN) TO service_role;

-- =============================================================================
-- Verify:
--
--   1. Exactly one candidate function, and it is service_role-only again:
--      SELECT pg_get_function_identity_arguments(p.oid), p.proacl
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'wie_putaway_candidates';
--        -- expect ONE row, acl WITHOUT `=X/` (PUBLIC), anon or authenticated
--
--   2. The hold is real. Put a product in a quarantine bin, then:
--      SELECT available FROM public.products WHERE id = <pid>;   -- excludes it
--      SELECT public.inv_reserve_order('test', '[{"product_id":<pid>,
--             "quantity":1}]'::jsonb);                           -- INSUFFICIENT_STOCK
--
--   3. And reverses. inv_transfer_stock it out of quarantine, recompute, and
--      both answers flip back — no flag to clear, because there is no flag.
--
--   4. Ordinary putaway still never sees the hold zone:
--      SELECT count(*) FROM public.wie_putaway_candidates(<layout>, <pid>);
--      SELECT count(*) FROM public.wie_putaway_candidates(<layout>, <pid>,
--             p_hold_only => true);
--        -- disjoint sets; the second is the quarantine bins alone
-- =============================================================================
