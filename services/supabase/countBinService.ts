// Posts a counted location to the `count-bin` Edge Function.
//
// One call carries a whole location's variances; the function fans each line out
// across its lots and hands each to `inv_adjust_stock`. See
// _shared/binCount.ts for why the fan-out cannot happen here.

import { supabase } from '@/lib/supabase'
import {
  describeValidationIssues,
  extractFunctionErrorDetails,
  extractFunctionErrorMessage,
} from '@/lib/functionError'
import type { CountPostResult } from '@/lib/binCount'

export interface CountBinPayload {
  locationId: number
  lines: Array<{ productId: number; countedQty: number }>
  note?: string
}

/**
 * `functions.invoke` rejects with a bare `FunctionsHttpError` whose message is
 * always "Edge Function returned a non-2xx status code" — the real reason is in
 * the response body. Every service in this codebase that skipped this step
 * ended up showing operators that sentence instead of the fault.
 */
async function rethrowWithServerMessage(error: unknown, fallback: string): Promise<never> {
  const message = await extractFunctionErrorMessage(error, fallback)
  const issues = describeValidationIssues(await extractFunctionErrorDetails(error))
  throw new Error(issues ? `${message} — ${issues}` : message)
}

/**
 * Post a location's count.
 *
 * A 2xx response does NOT mean every line landed: individual lines can come
 * back `ok: false` (stock reserved for an open order, most often). Callers must
 * read `results`, not just the absence of a throw.
 */
export async function postCountBin(payload: CountBinPayload): Promise<CountPostResult> {
  const { data, error } = await supabase.functions.invoke<CountPostResult & { ok: true }>('count-bin', {
    body: payload,
  })
  if (error) await rethrowWithServerMessage(error, 'Count could not be posted')
  if (!data) throw new Error('Count returned no data')
  return {
    locationId: data.locationId,
    locationCode: data.locationCode,
    posted: data.posted,
    refused: data.refused,
    results: data.results ?? [],
  }
}
