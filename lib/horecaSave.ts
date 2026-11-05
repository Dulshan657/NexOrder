// How a customer save reports back to the dialog that asked for it (NX-0018).
//
// The add and edit dialogs used to close the moment Save was pressed, without
// waiting to hear whether the save worked. A save the server refused therefore
// looked like a success that had lost the person's typing. A save now returns a
// RESULT, and the dialog stays open on a failure.
//
// A result, not a rejected promise, on purpose: `onUpdateHoReCa` is also called
// by the Settings screens, which fire it and move on. A rejection they never
// catch would be an unhandled rejection; a value they ignore is harmless.

export type HoReCaSaveResult = { ok: true } | { ok: false; message: string }

/** What a customer save handler may return: nothing (fire and forget), or the outcome. */
export type HoReCaSaveOutcome = void | HoReCaSaveResult | Promise<void | HoReCaSaveResult>

const UNKNOWN_FAILURE = 'The customer could not be saved. Please try again.'

/** The sentence to show for whatever a failed save threw. */
export function saveFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  if (typeof error === 'string' && error.trim().length > 0) return error
  return UNKNOWN_FAILURE
}

/**
 * Run a customer save and report how it went. Never rejects: a thrown error
 * becomes `{ ok: false, message }`.
 */
export async function settleHoReCaSave(save: () => Promise<unknown>): Promise<HoReCaSaveResult> {
  try {
    await save()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: saveFailureMessage(error) }
  }
}

/** True when a handler's return value says the save failed. Nothing returned is not a failure. */
export function isFailedSave(result: void | HoReCaSaveResult): result is { ok: false; message: string } {
  return typeof result === 'object' && result !== null && result.ok === false
}
