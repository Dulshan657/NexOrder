// Home-bin health (NX-0032): every product home bin in a warehouse that putaway
// cannot actually use, from the home-bin-health Edge Function (GET, Admin/Manager).
//
// The judging happens on the server, in _shared/wie/homeBinHealth.ts, with facts
// from wie_home_bin_facts (mig 00142) and the slotting rules putaway itself reads.
// This only carries the answer to the Replenishment setup panel. The same check
// runs before a release as `npm run check:home-bins`.
//
// NX-0033 adds the other direction: which bins a Manager may give a homeless
// product as its home, from the home-bin-choices Edge Function.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { HomeBinChoice, HomeBinHealthReport } from '@/supabase/functions/_shared/wie/homeBinHealth'

export type {
  HomeBinChoice,
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

/**
 * The bins a Manager or Admin may give this product as its home (NX-0033), from
 * the home-bin-choices Edge Function. The server has already dropped every bin
 * putaway could not use, one that is full, and another product's home.
 */
export async function getHomeBinChoices(warehouseId: number, productId: number): Promise<HomeBinChoice[]> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    warehouseId: number
    productId: number
    bins: HomeBinChoice[]
  }>(
    `home-bin-choices?warehouseId=${warehouseId}&productId=${productId}`,
    { method: 'GET' },
  )
  if (error) {
    throw new Error(await extractFunctionErrorMessage(error, 'Could not list the bins for a home'))
  }
  if (!data) throw new Error('Could not list the bins for a home')
  return data.bins ?? []
}
