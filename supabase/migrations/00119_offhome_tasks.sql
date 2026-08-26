-- =============================================================================
-- Off-home tasks — stock sitting outside its product's assigned blocks
-- Migration: 00119_offhome_tasks.sql
-- =============================================================================
-- Slotting rules steer NEW stock (00115/00116). This is the other half: a rule
-- written today finds forty pallets already scattered, and the operator needs a
-- list they can walk rather than a report they cannot act on.
--
-- ── ITS OWN TABLE, NOT ROWS IN wie_slotting_suggestions ─────────────────────
--
-- That table's dedupe index `uq_wie_slotting_open` is keyed
-- (warehouse, product, from, to) and partial on status='suggested'. An off-home
-- row and a travel-saving reslot row for the SAME pair would collide there,
-- which forces widening the index AND restating the arbiter's predicate in
-- every ON CONFLICT that touches it -- the exact runtime failure
-- `uq_wie_replen_open` is documented for. The audiences differ too: Warehouse
-- staff walk this, Admin/Manager review reslot suggestions.
--
-- ── ONE STAGE, NOT TWO ──────────────────────────────────────────────────────
--
-- Putaway and replenishment are two-stage (suggest -> assign -> complete)
-- because there is a real gap between deciding and doing: the goods are on a
-- dock and the walker is somewhere else. Here the stock is already IN a bin and
-- the walker is standing at it. An assign stage would add a state to abandon
-- for no work it makes safer.
--
-- ── SIZED FROM `available`, NEVER `on_hand` ─────────────────────────────────
--
-- inv_transfer_stock moves AVAILABLE stock only, so a task sized from on_hand
-- would be accepted, walked, and then refused at the rack with the pallet in
-- the operator's hands. Stock allocated to an open order is not movable and the
-- queue must not pretend otherwise.
--
-- DETECTION IS NOT HERE. It lives in the mutate-offhome-task Edge Function, in
-- TypeScript, because deciding whether a bin is off-home needs the WINNING rule
-- and the specificity ladder has exactly one implementation
-- (_shared/wie/slotting.ts resolveSlotting). A SQL detector would be a second
-- one, and it would disagree with the engine the moment a SKU rule and a brand
-- rule both matched a product -- which is precisely the case a SKU rule exists
-- for. 00118's v_slotting_product_bins is a UNION and deliberately cannot
-- answer this question.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.wie_offhome_tasks (
    id            BIGSERIAL PRIMARY KEY,
    warehouse_id  INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    layout_id     INT REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL,
    product_id    INT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    from_location_id INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    -- AVAILABLE base units at detection time. Re-checked at accept: the walker
    -- may be hours behind the detector and an order may have reserved it since.
    quantity      NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    handling_unit_id BIGINT REFERENCES public.handling_units(id) ON DELETE SET NULL,
    -- The rule that says this is misplaced. SET NULL rather than CASCADE: a
    -- task already walked and accepted is history, and deleting the rule that
    -- prompted it must not erase the record that stock was moved.
    rule_id       INT REFERENCES public.slotting_rules(id) ON DELETE SET NULL,
    /** Where the engine would put it now. Advisory and re-derived at accept --
     *  the block may have filled since. */
    suggested_to_location_id INT REFERENCES public.locations(id) ON DELETE SET NULL,
    explanation   JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'suggested'
                      CHECK (status IN ('suggested','accepted','dismissed','expired')),
    dismissed_reason TEXT CHECK (dismissed_reason IS NULL OR length(dismissed_reason) <= 300),
    actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at    TIMESTAMPTZ
);

-- One open task per (warehouse, product, source bin). Partial on 'suggested',
-- and every ON CONFLICT against it MUST restate that predicate or Postgres
-- cannot infer the arbiter and errors at runtime.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wie_offhome_open
    ON public.wie_offhome_tasks (warehouse_id, product_id, from_location_id)
    WHERE status = 'suggested';

CREATE INDEX IF NOT EXISTS idx_wie_offhome_open
    ON public.wie_offhome_tasks (warehouse_id, status, created_at DESC);

COMMENT ON TABLE public.wie_offhome_tasks IS
    'Stock sitting outside its product''s assigned slotting blocks (mig 00115). '
    'One stage: the walker is already at the bin. Sized from AVAILABLE, because '
    'inv_transfer_stock moves available stock only. Written by '
    'mutate-offhome-task, which is also where detection lives -- the ladder has '
    'one implementation and it is in TypeScript.';

-- ── Accept: claim the row, move the stock, stamp the ledger ─────────────────

CREATE OR REPLACE FUNCTION public.wie_accept_offhome_tx(
    p_task_id BIGINT,
    p_to_location_id INT,
    p_qty     NUMERIC,
    p_actor   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task RECORD;
    v_qty  NUMERIC;
BEGIN
    -- The conditional UPDATE is what SERIALISES two walkers pressing Accept on
    -- the same pallet: the loser sees zero rows and is told, rather than both
    -- transferring and the second failing deep inside inv_transfer_stock with a
    -- message about stock levels.
    UPDATE public.wie_offhome_tasks
       SET status = 'accepted', decided_at = now(), actor_id = p_actor
     WHERE id = p_task_id AND status = 'suggested'
    RETURNING * INTO v_task;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONFLICT: that task has already been decided'
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := LEAST(COALESCE(p_qty, v_task.quantity), v_task.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: quantity must be greater than zero'
            USING ERRCODE = 'P0001';
    END IF;

    -- Moves AVAILABLE stock only and raises INSUFFICIENT_STOCK otherwise, which
    -- the caller turns into a CONFLICT the walker can act on. Inside this
    -- transaction, so a refusal rolls the status back to 'suggested' and the
    -- task stays on the queue rather than vanishing as accepted-but-not-moved.
    PERFORM public.inv_transfer_stock(
        p_product_id       => v_task.product_id,
        p_from_loc         => v_task.from_location_id,
        p_to_loc           => p_to_location_id,
        p_qty              => v_qty,
        p_actor            => p_actor,
        p_reason           => 'Off-home: moved to an assigned block',
        p_handling_unit_id => v_task.handling_unit_id,
        -- 00109's hook: name the task on BOTH ledger legs, so a movement can be
        -- traced back to the rule that asked for it. The defaults reproduce the
        -- pre-00109 ('transfer', NULL) values, so passing these is additive.
        -- p_ref_id is TEXT here, not the task's own bigint -- cast, do not
        -- assume, because the column it lands in is shared with ref types whose
        -- ids are not integers at all.
        p_ref_type         => 'offhome_task',
        p_ref_id           => v_task.id::TEXT
    );

    RETURN jsonb_build_object(
        'task_id', v_task.id,
        'moved', v_qty,
        'from_location_id', v_task.from_location_id,
        'to_location_id', p_to_location_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_accept_offhome_tx(BIGINT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_accept_offhome_tx(BIGINT,INT,NUMERIC,UUID)
    TO service_role;

-- ── RLS and grants — new tables are NOT born locked here (see 00102) ────────

ALTER TABLE public.wie_offhome_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wie_offhome_tasks_select_staff ON public.wie_offhome_tasks;
CREATE POLICY wie_offhome_tasks_select_staff ON public.wie_offhome_tasks
    FOR SELECT TO authenticated USING ((SELECT public.user_is_staff()));

REVOKE ALL ON public.wie_offhome_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wie_offhome_tasks TO authenticated;
REVOKE ALL ON SEQUENCE public.wie_offhome_tasks_id_seq FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'wie_offhome_tasks' AND grantee IN ('anon','authenticated','PUBLIC')
--    GROUP BY grantee;    -- expect: authenticated | SELECT   (and nothing else)
--
--   -- The partial index must be exactly the arbiter every ON CONFLICT restates:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_wie_offhome_open';
--
--   -- Accepting twice must refuse the second, not double-move the stock:
--   BEGIN;
--     SELECT public.wie_accept_offhome_tx(<id>, <bin>, NULL, NULL);
--     SELECT public.wie_accept_offhome_tx(<id>, <bin>, NULL, NULL);  -- expect CONFLICT
--   ROLLBACK;
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_accept_offhome_tx(BIGINT,INT,NUMERIC,UUID);
--   DROP TABLE IF EXISTS public.wie_offhome_tasks;
-- =============================================================================
