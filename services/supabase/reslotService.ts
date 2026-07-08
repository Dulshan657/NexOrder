// Client for the pre-publish stock re-slotting flow.
//
// planReslot()      → dry-run: compute the optimal re-allocation of a warehouse's
//                     stock into a DRAFT layout's bins (plan-reslot edge fn).
// commitReslotPlan() → after the layout is published, write the approved moves as
//                     a relocation worklist (commit-reslot-plan edge fn).

import { supabase } from '@/lib/supabase'

export interface ReslotFactor {
  factor: string
  detail: string
  weighted: number
}

export interface ReslotBreakdown {
  locationId: number
  locationCode: string
  totalScore: number
  factors: ReslotFactor[]
}

export interface ReslotMove {
  productId: number
  productCode: string
  productName: string
  fromLocationId: number
  toLocationId: number
  toLocationCode: string
  qty: number
  toDistanceM: number | null
  breakdown: ReslotBreakdown
}

export interface ReslotOverflow {
  productId: number
  productCode: string
  productName: string
  qty: number
}

export interface ReslotReserved {
  productId: number
  productCode: string
  productName: string
  qty: number
  locationId: number
}

export interface ReslotBin {
  locationId: number
  code: string
  capacitySlots: number | null
}

export interface ReslotCapacity {
  requiredSlots: number
  providedFreeSlots: number
  providedTotalSlots: number
  hasUncapped: boolean
  sufficient: boolean
}

export interface ReslotPlanResult {
  ok: boolean
  layoutId: number
  hasStock: boolean
  capacity: ReslotCapacity
  moves: ReslotMove[]
  overflow: ReslotOverflow[]
  reserved: ReslotReserved[]
  bins: ReslotBin[]
}

/** Compute the re-slot plan for a draft layout (persists nothing, moves nothing). */
export async function planReslot(layoutId: number): Promise<ReslotPlanResult> {
  const { data, error } = await supabase.functions.invoke<ReslotPlanResult>('plan-reslot', {
    body: { layout_id: layoutId },
  })
  if (error) throw error
  return data as ReslotPlanResult
}

export interface CommitMove {
  product_id: number
  from_location_id: number
  to_location_id: number
  qty: number
}

export interface CommitReslotResult {
  created: number
  skipped: number
  planBatch: string
}

/** Write the approved moves as a relocation worklist (call AFTER publish). */
export async function commitReslotPlan(layoutId: number, moves: CommitMove[]): Promise<CommitReslotResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; created: number; skipped: number; plan_batch: string }>(
    'commit-reslot-plan',
    { body: { layout_id: layoutId, moves } },
  )
  if (error) throw error
  return { created: (data as any).created ?? 0, skipped: (data as any).skipped ?? 0, planBatch: (data as any).plan_batch }
}
