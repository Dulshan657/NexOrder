// What receive-stock says about putaway (NX-0032).
//
// The receipt is committed before putaway runs, and putaway is advice, so a
// putaway failure never fails the receipt. One failure is different: when a
// product's home bin could not be read, putaway stops (nothing is created, on
// purpose: a guessed bin would break the home-bin rule) and the dock has to be
// told, or the stock sits at the dock with no task and no word why. That one
// failure is returned as `putaway_error`, with the exact lines that were tried
// as `putaway_lines`, for the receive screen's Retry. The screen cannot rebuild
// them itself: it holds quantities in the unit the operator chose, not the base
// units putaway needs, and it never sees the plate ids. Everything else stays
// as it was: swallowed, `putaway: null`.
//
// Pure of I/O so it can be tested without the edge runtime: the caller hands in
// the lines and the call to make with them.

import type { GeneratePutawayResult, PutawayLineInput } from './putawayTasks.ts'
import { HOME_UNAVAILABLE, isHomeUnavailable } from './putawayHomeBlock.ts'

export interface ReceivePutawayOutcome {
  putaway: GeneratePutawayResult | null
  /** Set only when the home bin could not be read. */
  putaway_error?: string
  /** Set with `putaway_error`: the lines to send to recommend-putaway again. */
  putaway_lines?: PutawayLineInput[]
}

export async function putawayForReceipt(
  lines: PutawayLineInput[],
  generate: (lines: PutawayLineInput[]) => Promise<GeneratePutawayResult>,
): Promise<ReceivePutawayOutcome> {
  try {
    return { putaway: await generate(lines) }
  } catch (e) {
    if (isHomeUnavailable(e)) {
      return { putaway: null, putaway_error: HOME_UNAVAILABLE, putaway_lines: lines }
    }
    return { putaway: null }
  }
}

/** The receive-stock response body. The two retry fields are absent unless set. */
export function receiveStockBody(result: unknown, outcome: ReceivePutawayOutcome) {
  return {
    ok: true as const,
    result,
    putaway: outcome.putaway,
    ...(outcome.putaway_error
      ? { putaway_error: outcome.putaway_error, putaway_lines: outcome.putaway_lines ?? [] }
      : {}),
  }
}
