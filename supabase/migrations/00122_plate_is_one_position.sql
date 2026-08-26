-- =============================================================================
-- A plate is one position, whatever kind of plate it is
-- Migration: 00122_plate_is_one_position.sql
-- =============================================================================
-- One view. No new column, no new table. This is the SQL half of a rule whose
-- other half lives in `_shared/wie/capacity.ts`; the two MUST move together, and
-- `00078` says so in the view's own COMMENT. This file is that second half.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- 00078 made a pallet cost ONE position instead of `on_hand × size_factor`, and
-- gated it on BOTH ends: the bin must be `slot_kind = 'pallet'` AND the plate
-- must be `hu_type = 'pallet'`. The plate-side gate was justified like this:
--
--   "Carton plates are explicitly NOT one-position objects: the 00076 backfill
--    lumped ~46 cartons onto a single 'carton' plate, so counting them as 1
--    would read MAIN as 1% full."
--
-- True — and an argument about a CARTON-DENOMINATED bin, every one of which the
-- BIN-side gate already excludes. MAIN is entirely carton. The plate-side gate
-- was therefore protecting nothing, and it cost this:
--
-- Amadiya's bulk floor is `AMD_BULK` — one marked slab cell, `slot_kind =
-- 'pallet'`, `capacity_slots = 1` (00103). A receipt of twelve packets on ONE
-- carton plate was charged `12 × size_factor` against a ceiling of 1, so the
-- planner fitted a single packet per cell and split that one plate across twelve
-- separate bulk bays (recommendations 417-428 on dev, verified before writing
-- this). A plate is a physical object. It is carried to one marked spot, and
-- nobody can leave a twelfth of it in each of twelve.
--
-- ── THE RULE NOW ────────────────────────────────────────────────────────────
--
--   positions = 1 per DISTINCT plate      when the bin is plate-denominated
--             = Σ(on_hand × size_factor)  otherwise, and for loose stock
--
-- The BIN gate is untouched and is still the load-bearing one: a pallet decanted
-- onto a carton shelf is counted in cartons, which is what keeps MAIN and every
-- other carton-denominated site bit-for-bit unchanged.
--
-- LOOSE STOCK IS STILL COUNTED BY UNITS, and the reason is unchanged from 00078:
-- without a `handling_unit_id` two rows cannot be proven to be the same physical
-- object, so counting them as one position would be a guess. That is why the
-- first arm JOINs (not LEFT JOINs) `handling_units` — a NULL plate id must fall
-- through to the second arm, not vanish.
--
-- ── WHO MOVES, AND BY HOW MUCH ──────────────────────────────────────────────
--
-- Only bins with `slot_kind = 'pallet'` holding stock on a NON-pallet plate can
-- change at all, and every such bin's fill can only go DOWN (from a per-unit sum
-- to a count of plates). Nothing is pushed over capacity by this migration, so
-- no bin becomes newly illegal and no stock has to move. Verify below counts the
-- affected rows before and after.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box -- see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_bin_fill;

CREATE VIEW public.v_bin_fill
WITH (security_invoker = true) AS
    SELECT location_id, SUM(slots) AS used_slots
    FROM (
        -- Unit loads: one position per DISTINCT plate in a plate-denominated
        -- bin. The JOIN (not LEFT JOIN) is what confines this arm to rows that
        -- actually carry a plate id.
        SELECT b.location_id, COUNT(DISTINCT b.handling_unit_id)::NUMERIC AS slots
        FROM public.inventory_balances b
        JOIN public.handling_units    h ON h.id = b.handling_unit_id
        JOIN public.locations         l ON l.id = b.location_id
        WHERE b.on_hand > 0
          AND l.slot_kind  = 'pallet'
        GROUP BY b.location_id

        UNION ALL

        -- Everything else: the pre-00078 arithmetic, unchanged.
        -- COALESCE on BOTH sides of the negation is load-bearing: a bare
        -- NOT (NULL AND ...) evaluates to NULL, not TRUE, which would silently
        -- drop every loose (handling_unit_id IS NULL) row from the fill.
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pr.size_factor, 1)) AS slots
        FROM public.inventory_balances b
        JOIN public.products  pr ON pr.id = b.product_id
        JOIN public.locations l  ON l.id  = b.location_id
        LEFT JOIN public.handling_units h ON h.id = b.handling_unit_id
        WHERE b.on_hand > 0
          AND NOT (h.id IS NOT NULL AND COALESCE(l.slot_kind, '') = 'pallet')
        GROUP BY b.location_id
    ) t
    GROUP BY location_id;

COMMENT ON VIEW public.v_bin_fill IS
    'Occupancy per location in the unit its capacity_slots is denominated in: '
    'one position per PLATE in a pallet-slot bin (any hu_type -- mig 00122), '
    'Sum(on_hand x size_factor) for loose stock and for every carton-denominated '
    'bin. The single SQL definition of the rule -- mirrored in TypeScript by '
    '_shared/wie/capacity.ts. Do not re-inline it.';

GRANT SELECT ON public.v_bin_fill TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. The rows this migration can possibly move: stock on a non-pallet plate
--   --    in a pallet-denominated bin. Expect the ONLY differences to be here.
--   SELECT b.location_id, l.code, count(*) AS rows_on_carton_plates
--     FROM public.inventory_balances b
--     JOIN public.handling_units h ON h.id = b.handling_unit_id
--     JOIN public.locations      l ON l.id = b.location_id
--    WHERE b.on_hand > 0 AND l.slot_kind = 'pallet' AND h.hu_type <> 'pallet'
--    GROUP BY 1, 2;
--
--   -- b. No bin may be over its ceiling as a result. Expect ZERO rows.
--   SELECT f.location_id, l.code, f.used_slots, l.capacity_slots
--     FROM public.v_bin_fill f
--     JOIN public.locations l ON l.id = f.location_id
--    WHERE l.capacity_slots IS NOT NULL AND f.used_slots > l.capacity_slots;
--
--   -- c. Carton-denominated bins must be untouched. Compare against a saved
--   --    pre-migration snapshot of:
--   SELECT f.location_id, f.used_slots FROM public.v_bin_fill f
--     JOIN public.locations l ON l.id = f.location_id
--    WHERE l.slot_kind IS DISTINCT FROM 'pallet' ORDER BY 1;
--
-- Rollback: re-apply 00078's section 1 verbatim.
-- =============================================================================
