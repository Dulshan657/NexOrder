-- Pre-publish stock re-slotting — worklist support.
--
-- The re-slot planner (plan-reslot) proposes moving a warehouse's existing stock
-- into a freshly-drawn layout's bins; on approval (commit-reslot-plan, after the
-- layout is published) each proposed move is written as a wie_slotting_suggestions
-- row that staff execute in the existing Slotting queue (Accept →
-- decide-slotting-suggestion → inv_transfer_stock moves the stock old-bin → new-bin).
--
-- These are the SAME shape as the travel-only batch-reoptimize suggestions, so we
-- reuse the table. Two columns distinguish and group them:
--   • origin      — 'reoptimize' (existing) vs 'reslot' (this feature).
--   • plan_batch  — groups every move from one publish so the UI can track a
--                   single relocation ("N of M moves done").
-- Both are additive with safe defaults so existing inserts keep working.

ALTER TABLE public.wie_slotting_suggestions
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'reoptimize'
        CHECK (origin IN ('reoptimize','reslot')),
    ADD COLUMN IF NOT EXISTS plan_batch UUID;

CREATE INDEX IF NOT EXISTS idx_wie_slotting_plan_batch
    ON public.wie_slotting_suggestions(plan_batch) WHERE plan_batch IS NOT NULL;
