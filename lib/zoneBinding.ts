// Client-side entry point for zone binding (mig 00096).
//
// The rule — which zone a bin belongs to, and therefore what its parent and
// materialized_path must be — lives in the pure shared module so the Edge
// Function and the browser run the very same code.
//
// Mirrors lib/locationNaming.ts ↔ _shared/wie/locationNaming.ts and
// lib/binCount.ts ↔ _shared/binCount.ts. Import from here in components; never
// reach into supabase/functions directly from a view.

export {
  zoneTargets,
  requiredProfileIds,
  resolveProfileId,
  planZoneBinding,
  categoryConflicts,
} from '@/supabase/functions/_shared/wie/zoneBinding'

export type {
  BindingUnit,
  BindingLevel,
  ZoneTarget,
  ZoneRow,
  WarehouseRoot,
  ReparentMove,
  AreaBindingSummary,
  ZoneBindingPlan,
} from '@/supabase/functions/_shared/wie/zoneBinding'
