// What receive-stock says about putaway (NX-0032).
//
// The receipt is committed before putaway runs, and putaway is advice, so a
// putaway failure never fails the receipt. One failure is different: when a
// product's home bin could not be read, putaway stops (nothing is created, on
// purpose: a guessed bin would break the home-bin rule) and the dock has to be
// told, or the stock sits at the dock with no task and no word why. That one
// failure is returned as `putaway_error` for the receive screen's Retry.
// Everything else stays as it was: swallowed, `putaway: null`.
//
// Pure of I/O so it can be tested without the edge runtime: the caller hands in
// the call to make.

import type { GeneratePutawayResult } from './putawayTasks.ts'
import { HOME_UNAVAILABLE, isHomeUnavailable } from './putawayHomeBlock.ts'

export interface ReceivePutawayOutcome {
  putaway: GeneratePutawayResult | null
  /** Set only when the home bin could not be read. */
  putaway_error?: string
}

export async function putawayForReceipt(
  generate: () => Promise<GeneratePutawayResult>,
): Promise<ReceivePutawayOutcome> {
  try {
    return { putaway: await generate() }
  } catch (e) {
    if (isHomeUnavailable(e)) return { putaway: null, putaway_error: HOME_UNAVAILABLE }
    return { putaway: null }
  }
}

/** The receive-stock response body. `putaway_error` is absent unless set. */
export function receiveStockBody(result: unknown, outcome: ReceivePutawayOutcome) {
  return {
    ok: true as const,
    result,
    putaway: outcome.putaway,
    ...(outcome.putaway_error ? { putaway_error: outcome.putaway_error } : {}),
  }
}
