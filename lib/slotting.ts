/**
 * Slotting Rules — the browser's view of the engine's decision.
 *
 * A thin re-export of `supabase/functions/_shared/wie/slotting.ts`, which is
 * pure and runs in both runtimes. The point is that the map panel's preview and
 * the settings table's verdicts ARE the server's answer, evaluated early —
 * never a second implementation of the specificity ladder that can drift from
 * it. Same shape as lib/levelRoles.ts, lib/areaPaint.ts and lib/binCount.ts.
 *
 * Import from here in frontend code; never reach into supabase/functions
 * directly, so the one place this crosses the runtime boundary stays greppable.
 */
export {
  foldMatch,
  ruleMatchesProduct,
  resolveSlotting,
  planSlotting,
  tierOf,
  isOffHome,
  describeBin,
} from '@/supabase/functions/_shared/wie/slotting'

export type {
  SlottingEnforcement,
  SlottingRuleSpec,
  SlottingProduct,
  SlottingResolution,
  SlottingStatus,
  SlottingExclusion,
  SlottingPlan,
  SlottingInput,
  SlottingCandidate,
  BinVerdict,
} from '@/supabase/functions/_shared/wie/slotting'
