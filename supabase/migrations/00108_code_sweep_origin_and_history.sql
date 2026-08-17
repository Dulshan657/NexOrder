-- 00108 — where a block's numbering starts, and how to take a sweep back.
--
-- Two additions, both driven by the first real use of 00107 on Amadiya's bulk
-- storage. Neither changes an existing code; both are inert until the Edge Function
-- and the frontend that use them are deployed.
--
-- ── 1. `origin` on the pattern store ─────────────────────────────────────────
--
-- 00107 let the operator state a PATTERN. It did not let them state where the
-- numbering starts, because `{x}`/`{y}` are absolute grid coordinates and a grid has
-- only one origin. `{row}`/`{col}` count within the painted block instead, and a
-- block genuinely has four candidate corners — which one is 1-1 depends on where the
-- dock is and which way the pickers walk, and the operator is the only one who knows.
--
-- A CLOSED CHECK, on the same terms `fill_order` already has one: there are exactly
-- four corners of a rectangle and there can never be a fifth. Contrast `template`,
-- which is deliberately unconstrained here because its grammar lives in TypeScript
-- (`templateIssue`) and a regex in SQL would be a second definition of it.
--
-- DEFAULT 'nw' is ascending on both axes — the historical walk — so the column is a
-- no-op on every row that exists, and "no row = the built-in default" still holds.
--
-- ── 2. `location_code_sweeps` ────────────────────────────────────────────────
--
-- A sweep can be wrong in a way that is only obvious once the codes are on screen:
-- the origin corner was the other one, the block name had a typo. Re-sweeping fixes
-- it, but only if you can still describe what you did — and the operator asked for
-- the undo to survive a reload, which means the before-codes cannot live in a React
-- ref.
--
-- WHY NOT `audit_events`. It records the first and last from→to and a count, which
-- is a summary, not a restore. It is also Admin-only SELECT while this action is
-- Admin AND Manager (`mutate-warehouse-location`'s gate), so a Manager could perform
-- a sweep they were then unable to see, let alone undo.
--
-- ONLY THE MOST RECENT UN-REVERTED ROW PER WAREHOUSE IS EVER OFFERED. This is not a
-- version history: reverting an older sweep whose codes a newer one has since taken
-- would collide, and resolving that is a worse tool than saying "re-sweep it".
-- Everything older is kept purely as a record.
--
-- The revert itself needs NO new machinery: it is `wie_recode_locations_tx` again
-- with the before-codes as targets, so it inherits the two-phase park (an A→B, B→A
-- swap is exactly what an undo is) and all three scope guards for free.

BEGIN;

-- ─────────────────────────────────────────────────── 1. numbering origin ──

ALTER TABLE public.warehouse_code_patterns
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'nw'
        CHECK (origin IN ('nw','ne','sw','se'));

COMMENT ON COLUMN public.warehouse_code_patterns.origin IS
    'Which corner of a painted block is row 1, column 1, and therefore which way '
    '{row}/{col} and the {n} counter both run. A SITE DEFAULT only — the wizard '
    'arms it and the operator may override it per sweep. Deliberately NOT stored '
    'per block: a block''s own framing is recovered from the codes it already '
    'carries (solveBlockFraming), because a remembered decision can disagree with '
    'the floor and a derived one cannot.';

-- ────────────────────────────────────────────────────── 2. sweep history ──

CREATE TABLE IF NOT EXISTS public.location_code_sweeps (
    id           BIGSERIAL   PRIMARY KEY,
    warehouse_id INT         NOT NULL
                     REFERENCES public.locations(id) ON DELETE CASCADE,
    block        TEXT        NOT NULL,
    template     TEXT        NOT NULL,
    origin       TEXT        NOT NULL CHECK (origin IN ('nw','ne','sw','se')),
    fill_order   TEXT        NOT NULL
                     CHECK (fill_order IN ('row','column','serpentine-row','serpentine-column')),
    -- [{ id, from, to, code_block, code_seq }] — everything needed to put it back,
    -- including the provenance, or an undo would restore the codes and leave the
    -- block/seq claiming the sweep still happened.
    rows         JSONB       NOT NULL,
    swept_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    swept_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    reverted_at  TIMESTAMPTZ,
    reverted_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.location_code_sweeps IS
    'One row per applied code sweep, holding the before/after mapping so the most '
    'recent one can be reverted after a reload. Not a version history: only the '
    'newest un-reverted row per warehouse is offered, because reverting an older '
    'sweep would collide with every newer one.';

-- The only query this table serves: newest un-reverted sweep for a site.
CREATE INDEX IF NOT EXISTS idx_location_code_sweeps_recent
    ON public.location_code_sweeps (warehouse_id, swept_at DESC)
    WHERE reverted_at IS NULL;

-- RLS: ops read, service_role writes. Same shape as 00107's pattern store — with
-- RLS on and no permissive write policy, every write from `authenticated` is denied
-- and only the Edge Function's service_role client gets through.
ALTER TABLE public.location_code_sweeps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_code_sweeps_select_ops" ON public.location_code_sweeps;
CREATE POLICY "location_code_sweeps_select_ops"
    ON public.location_code_sweeps FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

GRANT SELECT ON public.location_code_sweeps TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────── verification ──
--
--   -- the column is inert: every existing row reads as the historical walk
--   SELECT warehouse_id, origin FROM public.warehouse_code_patterns;   -- all 'nw'
--
--   -- the closed vocabulary holds
--   INSERT INTO public.warehouse_code_patterns (warehouse_id, template, origin)
--   VALUES (1, '{wh}-{block}-{row}-{col}', 'up');                      -- expect 23514
--
--   -- ops can read the history, and nobody but service_role can write it
--   SELECT count(*) FROM public.location_code_sweeps;                  -- expect 0
--   INSERT INTO public.location_code_sweeps (warehouse_id, block, template, origin,
--       fill_order, rows) VALUES (1,'X','{block}','nw','row','[]'::jsonb);
--                                                                      -- expect 42501
