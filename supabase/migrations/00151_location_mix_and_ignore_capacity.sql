-- =============================================================================
-- One product per location at putaway, and a switch to ignore capacity (NX-0049)
-- Migration: 00151_location_mix_and_ignore_capacity.sql
-- =============================================================================
-- The owner (2026-11-27), for Amadiya: one product per location for now. The
-- exception is a shared home, where every product is the same brand and homed
-- there (the McCurrie rack levels). Space is to be treated as unlimited, so a
-- homed product always goes home and nothing overflows.
--
-- 1. app_settings.putaway_ignore_capacity BOOLEAN NOT NULL DEFAULT false.
--    OFF by default, so every site keeps the NX-0032/NX-0033 behaviour until an
--    Admin switches it on (mutate-app-settings, Replenishment setup). When ON,
--    the home rule never treats a home as full, by capacity or by max_qty.
--    Weight limits are not affected. app_settings has no client write grant
--    (00013); the only write path is mutate-app-settings (Admin).
--
-- 2. wie_location_occupants(warehouse): what is in each location of a
--    warehouse, for the planner (_shared/locationContents.ts). It returns the
--    stock on hand in each location under the warehouse, and each open putaway
--    line (suggested / assigned) with the location it is headed for. One read
--    per receipt, made before the first task is inserted.
--
-- 3. wie_location_mix_block(rec, target) -> NULL (allowed) | the refusal text.
--    It is the SQL copy of _shared/wie/locationMix.ts, judged in this order:
--      a. A target in a hold zone is allowed: held stock of many products
--         waits there.
--      b. "Others" are the stock on hand in the target, plus the OTHER open
--         putaway lines headed there. A product other than this line's counts,
--         unless it sits on this line's own plate (the same mixed pallet).
--         With no others, the target is allowed.
--      c. When the target is this product's home, an other is fine if it is
--         homed there too and has the same non-blank brand (case and spaces
--         ignored).
--      d. Anything left refuses:
--           '{code} already holds {sku} ({name}). Put this in an empty location
--            or its home {home}.'
--         The lowest product id is named, so the words are stable.
--
-- 4. wie_home_rule(rec, target): the home rule as it is live today. It is the
--    body of 00146 with the 00147 wording, plus two changes:
--      * step 5 gains "a home holding another product's stock is one putaway
--        cannot use". So a stray product in the home never strands the line:
--        it then goes anywhere the location rule allows.
--      * step 6 is skipped when putaway_ignore_capacity is on. The home always
--        has room, so a putaway anywhere else is refused with
--        'Put this in its home location {code}.'
--
-- 5. wie_home_block(rec, target) keeps its signature and every caller, i.e.
--    every putaway transaction (complete, complete many, assign, redirect,
--    decide, confirm overflow) and refuseIfHomeBlocked. It now asks
--    wie_home_rule first, whose words win (scenario: "its home location is
--    ..."), then wie_location_mix_block.
--
-- All four functions are SECURITY DEFINER and service_role only. None is
-- STABLE: the pooled completion calls wie_home_block between writes of its own
-- and must read them (00146).
--
-- No BEGIN or COMMIT here: supabase/migrate.mjs wraps this file.
-- Idempotent: re-running converges.
-- =============================================================================

-- ── 1. The switch ────────────────────────────────────────────────────────────
ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS putaway_ignore_capacity BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.putaway_ignore_capacity IS
    'Putaway treats space as unlimited: no home is full (capacity or max_qty) and '
    'nothing overflows. Weight limits still apply. Off by default (mig 00151, NX-0049).';

-- ── 2. What is in each location of a warehouse ───────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_location_occupants(p_warehouse_id INT)
RETURNS TABLE (
    location_id      INT,
    product_id       INT,
    sku              TEXT,
    name             TEXT,
    brand            TEXT,
    handling_unit_id BIGINT,
    rec_id           BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH wh AS (
        SELECT materialized_path FROM public.locations
        WHERE id = p_warehouse_id AND kind = 'WAREHOUSE'
    )
    SELECT b.location_id, b.product_id, pr.sku::TEXT, pr.name::TEXT, pr.brand::TEXT,
           b.handling_unit_id::BIGINT, NULL::BIGINT
    FROM public.inventory_balances b
    JOIN public.locations l ON l.id = b.location_id
    JOIN public.products pr ON pr.id = b.product_id
    CROSS JOIN wh
    WHERE b.on_hand > 0
      AND wh.materialized_path IS NOT NULL
      AND l.materialized_path LIKE wh.materialized_path || '/%'
    UNION ALL
    SELECT COALESCE(r.assigned_location_id, r.recommended_location_id), r.product_id,
           pr.sku::TEXT, pr.name::TEXT, pr.brand::TEXT, r.handling_unit_id::BIGINT, r.id
    FROM public.wie_putaway_recommendations r
    JOIN public.products pr ON pr.id = r.product_id
    WHERE r.warehouse_id = p_warehouse_id
      AND r.status IN ('suggested', 'assigned')
      AND COALESCE(r.assigned_location_id, r.recommended_location_id) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.wie_location_occupants(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_location_occupants(INT) TO service_role;

-- ── 3. The location rule ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_location_mix_block(
    p_rec_id         BIGINT,
    p_to_location_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_to_loc     public.locations%ROWTYPE;
    v_to_hold    BOOLEAN;
    v_brand      TEXT;
    v_home_bin   INT;
    v_home_code  TEXT;
    v_sku        TEXT;
    v_name       TEXT;
BEGIN
    IF p_to_location_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations WHERE id = p_rec_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_to_loc FROM public.locations WHERE id = p_to_location_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- a. A hold location is never refused (same test as wie_home_block step 0).
    IF v_to_loc.materialized_path IS NOT NULL THEN
        SELECT COALESCE(zp.is_hold, false) INTO v_to_hold
        FROM public.locations z
        LEFT JOIN public.zone_profiles zp ON zp.id = z.zone_profile_id
        WHERE z.kind = 'ZONE'
          AND v_to_loc.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1;
        IF COALESCE(v_to_hold, false) THEN
            RETURN NULL;
        END IF;
    END IF;

    SELECT brand INTO v_brand FROM public.products WHERE id = v_rec.product_id;
    SELECT h.bin_id INTO v_home_bin
    FROM public.product_home_bins h
    WHERE h.product_id = v_rec.product_id
      AND h.warehouse_id = v_rec.warehouse_id
      AND h.purpose = 'primary';
    IF v_home_bin IS NOT NULL THEN
        SELECT code INTO v_home_code FROM public.locations WHERE id = v_home_bin;
    END IF;

    -- b-d. The first other product that blocks, lowest id first.
    SELECT o.sku, o.name INTO v_sku, v_name
    FROM (
        SELECT b.product_id, b.handling_unit_id
        FROM public.inventory_balances b
        WHERE b.location_id = p_to_location_id AND b.on_hand > 0
        UNION ALL
        SELECT r.product_id, r.handling_unit_id
        FROM public.wie_putaway_recommendations r
        WHERE r.id <> v_rec.id
          AND r.status IN ('suggested', 'assigned')
          AND COALESCE(r.assigned_location_id, r.recommended_location_id) = p_to_location_id
    ) occ
    JOIN public.products o ON o.id = occ.product_id
    WHERE occ.product_id <> v_rec.product_id
      AND NOT (v_rec.handling_unit_id IS NOT NULL
               AND occ.handling_unit_id IS NOT DISTINCT FROM v_rec.handling_unit_id)
      AND NOT (
            v_home_bin = p_to_location_id
        AND EXISTS (SELECT 1 FROM public.product_home_bins oh
                     WHERE oh.product_id = occ.product_id
                       AND oh.bin_id = p_to_location_id
                       AND oh.purpose = 'primary')
        AND length(btrim(COALESCE(v_brand, ''))) > 0
        AND lower(btrim(COALESCE(o.brand, ''))) = lower(btrim(v_brand))
      )
    ORDER BY occ.product_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_home_code IS NOT NULL AND v_home_bin <> p_to_location_id THEN
        RETURN format('%s already holds %s (%s). Put this in an empty location or its home %s.',
                      v_to_loc.code, v_sku, v_name, v_home_code);
    END IF;
    RETURN format('%s already holds %s (%s). Put this in an empty location.',
                  v_to_loc.code, v_sku, v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_location_mix_block(BIGINT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_location_mix_block(BIGINT,INT) TO service_role;

-- ── 4. The home rule (00146 body, 00147 wording, two changes marked NX-0049) ──
CREATE OR REPLACE FUNCTION public.wie_home_rule(
    p_rec_id         BIGINT,
    p_to_location_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_home       public.product_home_bins%ROWTYPE;
    v_home_loc   public.locations%ROWTYPE;
    v_to_loc     public.locations%ROWTYPE;
    v_to_hold    BOOLEAN;
    v_wh         public.locations%ROWTYPE;
    v_other_sku  TEXT;
    v_to_code    TEXT;
    v_plate_type TEXT;
    v_is_hold    BOOLEAN;
    v_allowed    TEXT[];
    v_sf         NUMERIC;
    v_used       NUMERIC;
    v_pending    NUMERIC;
    v_own        NUMERIC;
    v_on_hand    NUMERIC;
    v_others     NUMERIC;
    v_by_cap     NUMERIC;   -- NULL = unlimited
    v_by_max     NUMERIC;   -- NULL = unlimited
    v_room       BIGINT;
    v_ignore_cap BOOLEAN;
BEGIN
    IF p_to_location_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations WHERE id = p_rec_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- 0. A hold location is never held to the home (00146).
    SELECT * INTO v_to_loc FROM public.locations WHERE id = p_to_location_id;
    IF FOUND AND v_to_loc.materialized_path IS NOT NULL THEN
        SELECT COALESCE(zp.is_hold, false) INTO v_to_hold
        FROM public.locations z
        LEFT JOIN public.zone_profiles zp ON zp.id = z.zone_profile_id
        WHERE z.kind = 'ZONE'
          AND v_to_loc.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1;
        IF COALESCE(v_to_hold, false) THEN
            RETURN NULL;
        END IF;
    END IF;

    SELECT * INTO v_home
    FROM public.product_home_bins
    WHERE product_id = v_rec.product_id
      AND warehouse_id = v_rec.warehouse_id
      AND purpose = 'primary';

    -- 1. Its own home.
    IF FOUND AND v_home.bin_id = p_to_location_id THEN
        RETURN NULL;
    END IF;

    -- 2. Another product's home (a bin this product is also homed in is not).
    SELECT pr.sku INTO v_other_sku
    FROM public.product_home_bins h
    JOIN public.products pr ON pr.id = h.product_id
    WHERE h.bin_id = p_to_location_id
      AND h.purpose = 'primary'
      AND h.product_id <> v_rec.product_id
      AND NOT EXISTS (SELECT 1 FROM public.product_home_bins own
                       WHERE own.bin_id = p_to_location_id
                         AND own.purpose = 'primary'
                         AND own.product_id = v_rec.product_id)
    ORDER BY h.product_id
    LIMIT 1;
    IF FOUND THEN
        SELECT code INTO v_to_code FROM public.locations WHERE id = p_to_location_id;
        RETURN format('%s is the home location of %s; choose another location.', v_to_code, v_other_sku);
    END IF;

    -- 3. No home: not held to one.
    IF v_home.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- 4. A unit load never goes to a pick face.
    IF v_rec.handling_unit_id IS NOT NULL AND v_rec.unit_load THEN
        SELECT hu_type INTO v_plate_type
        FROM public.handling_units WHERE id = v_rec.handling_unit_id;
        IF v_plate_type = 'pallet' AND (
               SELECT count(DISTINCT b.product_id)
               FROM public.inventory_balances b
               WHERE b.handling_unit_id = v_rec.handling_unit_id
                 AND b.on_hand > 0) = 1 THEN
            RETURN NULL;
        END IF;
    END IF;

    -- 5. A home putaway could not use does not block.
    SELECT * INTO v_home_loc FROM public.locations WHERE id = v_home.bin_id;
    IF NOT FOUND OR NOT v_home_loc.is_active THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_wh FROM public.locations WHERE id = v_rec.warehouse_id;
    IF NOT FOUND
       OR v_wh.active_layout_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.layout_placements pl
                       WHERE pl.layout_id = v_wh.active_layout_id
                         AND pl.location_id = v_home.bin_id)
       OR v_wh.materialized_path IS NULL
       OR v_home_loc.materialized_path IS NULL
       OR v_home_loc.materialized_path NOT LIKE v_wh.materialized_path || '/%' THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(zp.is_hold, false) INTO v_is_hold
    FROM public.locations z
    LEFT JOIN public.zone_profiles zp ON zp.id = z.zone_profile_id
    WHERE z.kind = 'ZONE'
      AND v_home_loc.materialized_path LIKE z.materialized_path || '/%'
    ORDER BY length(z.materialized_path) DESC
    LIMIT 1;
    IF COALESCE(v_is_hold, false) THEN
        RETURN NULL;
    END IF;

    SELECT allowed_level_roles INTO v_allowed
    FROM public.product_wms_attributes WHERE product_id = v_rec.product_id;
    IF COALESCE(cardinality(v_allowed), 0) > 0
       AND v_home_loc.level_role IS NOT NULL
       AND NOT (v_home_loc.level_role = ANY (v_allowed)) THEN
        RETURN NULL;
    END IF;

    -- 5b. NX-0049: a home holding another product's stock (one the location
    --     rule refuses there) is one putaway cannot use, so the line is not
    --     held to it.
    IF public.wie_location_mix_block(p_rec_id, v_home.bin_id) IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- 6. Room, in base units. NX-0049: with capacity ignored, always room.
    SELECT COALESCE(s.putaway_ignore_capacity, false) INTO v_ignore_cap
    FROM public.app_settings s WHERE s.id = 1;
    IF COALESCE(v_ignore_cap, false) THEN
        RETURN format('Put this in its home location %s.', v_home_loc.code);
    END IF;

    SELECT size_factor INTO v_sf FROM public.products WHERE id = v_rec.product_id;
    IF v_sf IS NULL OR v_sf <= 0 THEN
        v_sf := 1;
    END IF;

    IF v_home_loc.capacity_slots IS NOT NULL THEN
        SELECT f.used_slots INTO v_used
        FROM public.v_bin_fill f WHERE f.location_id = v_home.bin_id;
        SELECT pp.pending_slots INTO v_pending
        FROM public.v_bin_pending_putaway pp WHERE pp.location_id = v_home.bin_id;
        v_own := CASE
                    WHEN v_rec.status IN ('suggested', 'assigned')
                     AND COALESCE(v_rec.assigned_location_id, v_rec.recommended_location_id)
                         = v_home.bin_id
                    THEN v_rec.quantity * v_sf
                    ELSE 0
                 END;
        v_by_cap := (v_home_loc.capacity_slots - COALESCE(v_used, 0)
                     - COALESCE(v_pending, 0) + v_own) / v_sf;
    END IF;

    IF v_home.max_qty IS NOT NULL THEN
        SELECT COALESCE(SUM(b.on_hand), 0) INTO v_on_hand
        FROM public.inventory_balances b
        WHERE b.product_id = v_rec.product_id AND b.location_id = v_home.bin_id;
        SELECT COALESCE(SUM(r.quantity), 0) INTO v_others
        FROM public.wie_putaway_recommendations r
        WHERE r.product_id = v_rec.product_id
          AND r.id <> v_rec.id
          AND r.status IN ('suggested', 'assigned')
          AND COALESCE(r.assigned_location_id, r.recommended_location_id) = v_home.bin_id;
        v_by_max := v_home.max_qty - v_on_hand - v_others;
    END IF;

    IF v_by_cap IS NULL AND v_by_max IS NULL THEN
        v_room := GREATEST(floor(v_rec.quantity), 1)::BIGINT;
    ELSE
        v_room := floor(GREATEST(0, LEAST(v_by_cap, v_by_max)))::BIGINT;
    END IF;

    IF v_room <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN format(
        'Put this in its home location %s; it still has room for %s. If it is full, ask a manager to set its maximum.',
        v_home_loc.code, v_room);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_home_rule(BIGINT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_rule(BIGINT,INT) TO service_role;

-- ── 5. What every putaway transaction asks ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_home_block(
    p_rec_id         BIGINT,
    p_to_location_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_refusal TEXT;
BEGIN
    -- The home rule first: "its home is X" is the more useful thing to read.
    v_refusal := public.wie_home_rule(p_rec_id, p_to_location_id);
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;
    RETURN public.wie_location_mix_block(p_rec_id, p_to_location_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_home_block(BIGINT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_block(BIGINT,INT) TO service_role;

-- =============================================================================
-- Verify with:
--   SELECT putaway_ignore_capacity FROM public.app_settings;            -- false
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('wie_home_block','wie_home_rule','wie_location_mix_block','wie_location_occupants');
--   -- four rows, prosecdef true, service_role only
--   SELECT public.wie_home_block(<rec>, <bin holding another product>);  -- '... already holds ...'
--
-- Rollback: re-create wie_home_block from 00146 section 1 with the 00147
-- wording, then DROP FUNCTION wie_home_rule(BIGINT,INT),
-- wie_location_mix_block(BIGINT,INT) and wie_location_occupants(INT), and
-- ALTER TABLE public.app_settings DROP COLUMN putaway_ignore_capacity.
-- =============================================================================
