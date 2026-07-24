-- =============================================================================
-- Handling-unit codes are minted by the database
-- Migration: 00077_handling_unit_code_default.sql
-- =============================================================================
-- 00075 created handling_units.code as NOT NULL with no default, so every
-- inserter had to call hu_next_code() itself. That is both a round trip per
-- plate for the receiving path (which mints one plate per carton, so a
-- 40-carton delivery would be 40 extra round trips) and a correctness hazard:
-- anything that can supply a code can supply a duplicate or a code outside the
-- reserved HU- namespace that 00074 asserted nothing else occupies.
--
-- Making it a column DEFAULT closes both: plates are created by inserting rows
-- WITHOUT a code, in one statement, and the code is unforgeable.
--
-- Also relaxes hu_type's NOT NULL default so the common case (a pallet) needs
-- no ceremony, and adds the composite index the "unlabelled plates for this
-- warehouse" label query runs.
-- =============================================================================

BEGIN;

ALTER TABLE public.handling_units
    ALTER COLUMN code SET DEFAULT public.hu_next_code();

ALTER TABLE public.handling_units
    ALTER COLUMN hu_type SET DEFAULT 'pallet';

COMMENT ON COLUMN public.handling_units.code IS
    'License-plate code, e.g. HU-000123. Minted by the hu_next_code() DEFAULT — '
    'never supplied by a caller, so it cannot collide or escape the HU- '
    'namespace reserved in 00074.';

-- The Labels screen prints "every plate in this warehouse still awaiting a
-- physical sticker", which is this exact predicate.
CREATE INDEX IF NOT EXISTS idx_handling_units_label_queue
    ON public.handling_units (warehouse_id, created_at)
    WHERE label_printed = false AND status IN ('open', 'stored');

COMMIT;

-- =============================================================================
-- Verify with:
--   INSERT INTO public.handling_units (hu_type) VALUES ('carton') RETURNING code;
--   -- expect HU-0000NN, then ROLLBACK
-- =============================================================================
