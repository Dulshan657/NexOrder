import { supabase } from '@/lib/supabase'
import { toWieScoringProfile } from '@/lib/adapters'
import type { WieScoringProfile, WieScoringWeights } from '@/types'

/** Engine defaults for the six scoring factors (relative weights). Mirrors the
 * server-side WIE optimizer defaults; used when a warehouse has no saved profile. */
export const DEFAULT_WEIGHTS_UI: WieScoringWeights = {
  travelDistance: 0.3,
  capacityFit: 0.2,
  grouping: 0.1,
  zonePreference: 0.15,
  congestion: 0.1,
  velocityMatch: 0.15,
}

/** The saved scoring profile for a warehouse, or null if none exists yet. */
export async function getScoringProfile(warehouseId: number): Promise<WieScoringProfile | null> {
  const { data, error } = await supabase
    .from('wie_scoring_profiles')
    .select('*')
    .eq('warehouse_id', warehouseId)
    .maybeSingle()
  if (error) throw error
  return data ? toWieScoringProfile(data) : null
}

export async function saveScoringProfile(warehouseId: number, weights: WieScoringWeights): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: true; profile: unknown }>('mutate-scoring-profile', {
    body: { warehouse_id: warehouseId, weights },
  })
  if (error) throw error
}
