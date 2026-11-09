-- =============================================================================
-- The home rule does not hold a putaway INTO a hold bin (NX-0033, final review I1)
-- Migration: 00146_home_rule_hold_exempt.sql
-- =============================================================================
-- wie_home_block (00142) asked whether the product's HOME was in a hold zone,
-- never whether the TARGET was. A quarantined line may only go to a hold bin
-- (receive-stock's quarantine flag -> wie_putaway_candidates p_hold_only), and
-- a hold bin is never a home. So for a product whose home had room, every path
-- refused to put its quarantined stock where it belongs:
--   * the walk's confirm (wie_confirm_overflow_tx, 00143/00145),
--   * the desk's Assign / Choose bin (wie_assign_putaway_tx,
--     wie_redirect_putaway_tx), Place now (wie_decide_putaway_tx),
--   * the walk's complete (wie_complete_putaway_tx, _many_tx),
-- each with "Put this in its home bin ...", which sends held stock to a pick
-- face.
--
-- Fix: step 0. A target in a hold zone (its nearest ZONE ancestor's profile
-- is_hold, the test step 5 applies to the home) returns NULL: the home rule has
-- nothing to say about it. Every other target is judged exactly as in 00142.
-- The hold rules themselves are not loosened: an ordinary line still cannot be
-- placed in a hold bin by the candidates or a redirect, which check that apart.
--
-- Redefined with its signature unchanged (BIGINT, INT), so every caller picks it
-- up. 00142 is left as it was (it is applied). Service-role only, one overload.
-- Idempotent: re-running converges.
-- =============================================================================

BEGIN;

-- ── 1. The rule (from 00142 §1, plus step 0) ─────────────────────────────────
-- Not STABLE on purpose: the pooled completion calls it between writes of its
-- own, and it must read them.
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
BEGIN
    -- A missing task or bin is the caller's error to raise (NOT_FOUND /
    -- INVALID_INPUT); the rule has nothing to say about it.
    IF p_to_location_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations WHERE id = p_rec_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- 0. A hold bin is never held to the home (00146, NX-0033 I1). Quarantined
    --    stock may only go to a hold bin (wie_putaway_candidates p_hold_only),
    --    and a hold bin is never a home (step 5 below; home-bin health
    --    'hold_zone'), so the home having room says nothing about it. Same test
    --    as step 5 applies to the home: the nearest ZONE ancestor's is_hold.
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

    -- 2. Another product's home. Two products may share one home, so a bin
    --    this product is also homed in is not "another product's". Lowest
    --    product id names it, so the text is stable.
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
        RETURN format('%s is the home bin of %s; choose another bin.', v_to_code, v_other_sku);
    END IF;

    -- 3. No home: not held to one.
    IF v_home.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- 4. A unit load never goes to a pick face. Only the planner knows a line
    --    was one, and it records that as unit_load. A task it did not plan as
    --    a unit load is held to the home whatever the plate is now and
    --    whatever the desk did since: the last product left on a mixed
    --    pallet, or a root plate minted as 'pallet', is not a unit load.
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

    -- 5. A home putaway could not use does not block. Same tests as
    --    wie_putaway_candidates: is_active, placed on the task warehouse's
    --    active layout and inside that warehouse, the nearest ZONE ancestor's
    --    is_hold, and a level role outside the product's allowed roles (a bin
    --    with no level role is legacy and allowed, as there).
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

    -- 6. Room, in base units.
    SELECT size_factor INTO v_sf FROM public.products WHERE id = v_rec.product_id;
    IF v_sf IS NULL OR v_sf <= 0 THEN
        v_sf := 1;
    END IF;

    IF v_home_loc.capacity_slots IS NOT NULL THEN
        SELECT f.used_slots INTO v_used
        FROM public.v_bin_fill f WHERE f.location_id = v_home.bin_id;
        SELECT pp.pending_slots INTO v_pending
        FROM public.v_bin_pending_putaway pp WHERE pp.location_id = v_home.bin_id;
        -- This task's own promise to the home is in v_bin_pending_putaway;
        -- give it back so the task does not crowd itself out (A3).
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
        -- Unlimited by both: the home takes the whole task. The copy needs a
        -- number, and this task's quantity is the true, actionable lower bound.
        v_room := GREATEST(floor(v_rec.quantity), 1)::BIGINT;
    ELSE
        -- LEAST ignores NULL, which is exactly "unlimited".
        v_room := floor(GREATEST(0, LEAST(v_by_cap, v_by_max)))::BIGINT;
    END IF;

    IF v_room <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN format(
        'Put this in its home bin %s; it still has room for %s. If it is full, ask a manager to set its maximum.',
        v_home_loc.code, v_room);
END;
$$;

-- ── 2. Grants: service_role only, restated so a re-run converges ─────────────
REVOKE ALL ON FUNCTION public.wie_home_block(BIGINT,INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_block(BIGINT,INT)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload, SECURITY DEFINER, service_role only:
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_home_block';   -- ONE row
--
--   -- b. A line headed for a hold bin is not held to its home:
--   SELECT public.wie_home_block(<rec>, <hold bin>);               -- NULL
--
-- Rollback: re-apply 00142 section 1 (wie_home_block) and restate its grants.
-- Quarantined stock of a homed product is then refused its hold bin again.
-- =============================================================================
