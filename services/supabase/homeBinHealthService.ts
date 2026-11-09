// Home-bin health (NX-0032): every product home bin in a warehouse that putaway
// cannot actually use, from the home-bin-health Edge Function (GET, Admin/Manager).
//
// The judging happens on the server, in _shared/wie/homeBinHealth.ts, with facts
// from wie_home_bin_facts (mig 00142) and the slotting rules putaway itself reads.
// This only carries the answer to the Replenishment setup panel. The same check
// runs before a release as `npm run check:home-bins`.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { HomeBinHealthReport } from '@/supabase/functions/_shared/wie/homeBinHealth'

export type {
  HomeBinHealthReport,
  HomeBinProblem,
  HomeBinProblemCode,
  HomeBinProblemRow,
} from '@/supabase/functions/_shared/wie/homeBinHealth'

/** The homes in this warehouse that have problems, and how many it checked. */
export async function getHomeBinHealth(warehouseId: number): Promise<HomeBinHealthReport> {
  // A GET carries no body, so the warehouse rides in the query string; supabase-js
  // appends the function name to its URL as it stands.
  const { data, error } = await supabase.functions.invoke<HomeBinHealthReport & { ok: true }>(
    `home-bin-health?warehouseId=${warehouseId}`,
    { method: 'GET' },
  )
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Could not check the home bins'))
  }
  if (!data) throw new Error('Could not check the home bins')
  return {
    warehouseId: data.warehouseId,
    checked: data.checked ?? 0,
    rows: data.rows ?? [],
  }
}
