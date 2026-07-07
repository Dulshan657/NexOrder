import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { SimulationResult } from '@/types'

/**
 * Replay the last `days` of real order picks through a target layout and diff
 * the resulting KPIs against the warehouse's active layout. The edge function
 * returns baselineKpis/diff = null when the target IS the active layout (or
 * there's no active layout to compare against).
 */
export async function runSimulation(layoutId: number, days?: number): Promise<SimulationResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & SimulationResult>('wie-simulate', {
    body: { layout_id: layoutId, days },
  })
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Simulation failed'))
  if (!data) throw new Error('Simulation returned no result')
  return data as SimulationResult
}
