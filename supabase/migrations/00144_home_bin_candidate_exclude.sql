-- =============================================================================
-- Candidate-bin facts give a line its own reservation back (NX-0033)
-- Migration: 00144_home_bin_candidate_exclude.sql
-- =============================================================================
-- 00143 added wie_home_bin_candidate_facts(warehouse, product, bin): every BIN
-- in a warehouse read as if it were the product's home, for "Give it a home"
-- (home-bin-choices) and complete-putaway's fitness check. It counted every
-- open putaway line against the bin, the line being placed included. A
-- homeless product's line is already 'assigned' to the bin the planner chose,
-- so a bin with room for exactly that line read as full: the chooser left it
-- out, and make_home onto it was refused as "full" although the stock was
-- already going there. wie_home_block (00142) does not make that mistake: it
-- gives the line's own promise back (v_own).
--
-- This adds an optional fourth argument, p_exclude_rec_ids BIGINT[], the
-- putaway line(s) being placed. Their space is left out of pending_slots and
-- pending_qty. NULL or an empty array changes nothing: the figures are those
-- of 00143.
--
-- The old three-argument form is dropped first, so the function keeps exactly
-- ONE overload (a default on the new argument would otherwise leave both, and
-- a call naming only three arguments would be ambiguous). Both statements
-- are idempotent: re-running this file converges.
--
-- Service-role only, as 00143 left it: DROP removes the old grants and they
-- are restated for the new signature below.
-- =============================================================================

BEGIN;

-- p_exclude_rec_ids: putaway lines to leave out of pending_slots and
-- pending_qty (the line(s) being placed). pending_slots is then rebuilt from
-- the open lines that are NOT excluded with the two arms of
-- v_bin_pending_putaway (00123) verbatim, minus its weight column; a test
-- pins the rebuilt figure to the view for every bin, so the two cannot drift.
-- NULL or an empty array reads the view itself.
--
-- The signature changed while 00143 was unreleased: the 3-argument form is
-- dropped first (idempotent), so the function keeps exactly ONE overload.
DROP FUNCTION IF EXISTS public.wie_home_bin_candidate_facts(INT,INT,INT);

CREATE OR REPLACE FUNCTION public.wie_home_bin_candidate_facts(
    p_warehouse_id    INT,
    p_product_id      INT,
    p_bin_id          INT      DEFAULT NULL,
    p_exclude_rec_ids BIGINT[] DEFAULT NULL
)
RETURNS TABLE(
    product_id               INT,
    sku                      TEXT,
    bin_id                   INT,
    bin_code                 TEXT,
    bin_warehouse_id         INT,
    is_active                BOOLEAN,
    is_hold                  BOOLEAN,
    level_role               TEXT,
    is_pick_zone             BOOLEAN,
    level_hu_types           TEXT[],
    allowed_level_roles      TEXT[],
    in_active_layout         BOOLEAN,
    has_dock_route           BOOLEAN,
    zone_allowed_categories  JSONB,
    category                 TEXT,
    capacity_slots           NUMERIC,
    used_slots               NUMERIC,
    pending_slots            NUMERIC,
    size_factor              NUMERIC,
    max_qty                  NUMERIC,
    on_hand_at_home          NUMERIC,
    pending_qty              NUMERIC,
    bin_name                 TEXT,
    other_home_skus          TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH pend_ex AS (
        -- v_bin_pending_putaway (00123) over the open lines that are not
        -- excluded. Empty unless lines were named.
        SELECT t.location_id, SUM(t.slots) AS pending_slots
        FROM (
            SELECT COALESCE(r.assigned_location_id, r.recommended_location_id) AS location_id,
                   COUNT(DISTINCT r.handling_unit_id)::NUMERIC                 AS slots
            FROM public.wie_putaway_recommendations r
            JOIN public.handling_units h
              ON h.id = r.handling_unit_id
            JOIN public.locations l
              ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
            WHERE p_exclude_rec_ids IS NOT NULL
              AND r.id <> ALL (p_exclude_rec_ids)
              AND r.status IN ('suggested', 'assigned')
              AND l.slot_kind = 'pallet'
            GROUP BY 1

            UNION ALL

            SELECT COALESCE(r.assigned_location_id, r.recommended_location_id) AS location_id,
                   SUM(r.quantity * COALESCE(pr2.size_factor, 1))              AS slots
            FROM public.wie_putaway_recommendations r
            JOIN public.products  pr2 ON pr2.id = r.product_id
            JOIN public.locations l
              ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
            LEFT JOIN public.handling_units h ON h.id = r.handling_unit_id
            WHERE p_exclude_rec_ids IS NOT NULL
              AND r.id <> ALL (p_exclude_rec_ids)
              AND r.status IN ('suggested', 'assigned')
              AND NOT (h.id IS NOT NULL AND COALESCE(l.slot_kind, '') = 'pallet')
            GROUP BY 1
        ) t
        GROUP BY t.location_id
    )
    SELECT
        pr.id,
        pr.sku::TEXT,
        b.id,
        b.code::TEXT,
        bw.id,
        b.is_active,
        COALESCE(zp.is_hold, false),
        b.level_role::TEXT,
        COALESCE(lr.is_active AND lr.is_pick_zone, false),
        CASE WHEN lr.is_active THEN lr.hu_types ELSE ARRAY[]::TEXT[] END,
        COALESCE(wa.allowed_level_roles, ARRAY[]::TEXT[]),
        EXISTS (SELECT 1
                  FROM public.layout_placements pl
                 WHERE pl.layout_id = w.active_layout_id
                   AND pl.location_id = b.id),
        EXISTS (SELECT 1
                  FROM public.layout_placements pl
                  JOIN public.layout_travel_distances d
                    ON d.layout_id = pl.layout_id
                   AND d.to_node_id = pl.graph_node_id
                  JOIN public.layout_graph_nodes dn
                    ON dn.id = d.from_node_id
                   AND dn.layout_id = pl.layout_id
                   AND dn.node_type = 'dock'
                 WHERE pl.layout_id = w.active_layout_id
                   AND pl.location_id = b.id),
        zp.allowed_categories,
        pr.category::TEXT,
        b.capacity_slots,
        COALESCE(bf.used_slots, 0),
        CASE WHEN p_exclude_rec_ids IS NULL
             THEN COALESCE(pend.pending_slots, 0)
             ELSE COALESCE(pend_ex.pending_slots, 0)
        END,
        pr.size_factor,
        NULL::NUMERIC,
        COALESCE((SELECT SUM(ib.on_hand)
                    FROM public.inventory_balances ib
                   WHERE ib.product_id = pr.id
                     AND ib.location_id = b.id), 0),
        COALESCE((SELECT SUM(r.quantity)
                    FROM public.wie_putaway_recommendations r
                   WHERE r.product_id = pr.id
                     AND r.status IN ('suggested', 'assigned')
                     AND (p_exclude_rec_ids IS NULL OR r.id <> ALL (p_exclude_rec_ids))
                     AND COALESCE(r.assigned_location_id, r.recommended_location_id)
                         = b.id), 0),
        b.name::TEXT,
        ARRAY(SELECT op.sku::TEXT
                FROM public.product_home_bins oh
                JOIN public.products op ON op.id = oh.product_id
               WHERE oh.bin_id = b.id
                 AND oh.purpose = 'primary'
                 AND oh.product_id <> pr.id
               ORDER BY oh.product_id)
    FROM public.locations w
    JOIN public.products pr ON pr.id = p_product_id
    JOIN public.locations b
      ON b.kind = 'BIN'
     AND b.materialized_path LIKE w.materialized_path || '/%'
    LEFT JOIN LATERAL (
        SELECT wh.id FROM public.locations wh
         WHERE wh.kind = 'WAREHOUSE'
           AND b.materialized_path LIKE wh.materialized_path || '/%'
         ORDER BY length(wh.materialized_path) DESC
         LIMIT 1
    ) bw ON true
    LEFT JOIN LATERAL (
        SELECT z.zone_profile_id FROM public.locations z
         WHERE z.kind = 'ZONE'
           AND b.materialized_path LIKE z.materialized_path || '/%'
         ORDER BY length(z.materialized_path) DESC
         LIMIT 1
    ) zone ON true
    LEFT JOIN public.zone_profiles zp ON zp.id = zone.zone_profile_id
    LEFT JOIN public.level_roles lr ON lr.key = b.level_role
    LEFT JOIN public.product_wms_attributes wa ON wa.product_id = pr.id
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = b.id
    LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = b.id
    LEFT JOIN pend_ex ON pend_ex.location_id = b.id
    WHERE w.id = p_warehouse_id
      AND w.materialized_path IS NOT NULL
      AND (p_bin_id IS NULL OR b.id = p_bin_id)
    ORDER BY b.code, b.id;
$$;

-- ── Grants: service_role only ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT,BIGINT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT,BIGINT[])
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload, service_role only:
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_home_bin_candidate_facts';
--                                                         -- ONE row, 4 arguments
--
--   -- b. The bins of a warehouse for a product, a line's own space given back:
--   SELECT bin_code, pending_slots, pending_qty
--     FROM public.wie_home_bin_candidate_facts(<warehouse>, <product>, NULL, ARRAY[<rec id>]::BIGINT[]);
--
-- Rollback: DROP FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT,BIGINT[]);
--   then re-create the three-argument form from 00143 section 2 and restate its
--   grants. complete-putaway and home-bin-choices call it with
--   p_exclude_rec_ids, so roll them back first.
-- =============================================================================
