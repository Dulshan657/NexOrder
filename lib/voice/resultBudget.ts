// Keeping a tool result small enough to be spoken from.
//
// Everything a tool returns is sent to the model as one JSON string and sits in
// the conversation for the rest of the session, so a long list costs money every
// turn and tempts the assistant to read it out. Each tool already caps its own
// rows (5 to 15); this is the backstop for the case where those rows are still
// too wide, for instance very long customer names.
//
// Over the cap, every array is halved (keeping the head, which is the ranked
// best) until it fits, and the data is flagged `truncated: true` so the model
// can say there is more. `basis` and `asOf` are never touched.

import type { VoiceToolResult } from './context'

export const MAX_RESULT_CHARS = 4000

type Json = unknown

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every array in `value`, at any depth, cut to `keep(length)` leading items. */
function shrink(value: Json, keep: (length: number) => number): Json {
  if (Array.isArray(value)) return value.slice(0, keep(value.length)).map((item) => shrink(item, keep))
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shrink(child, keep)]))
  }
  return value
}

function longestArray(value: Json): number {
  if (Array.isArray(value)) return value.reduce<number>((most, item) => Math.max(most, longestArray(item)), value.length)
  if (isPlainObject(value)) return Object.values(value).reduce<number>((most, child) => Math.max(most, longestArray(child)), 0)
  return 0
}

const halve = (length: number): number => Math.ceil(length / 2)
const empty = (): number => 0

function flagged(data: Json, truncated: boolean): Json {
  return truncated && isPlainObject(data) ? { ...data, truncated: true } : data
}

/**
 * `result` unchanged if it fits `maxChars` once serialised, otherwise a copy with
 * its arrays halved until it does. Halving stops at one item per array; only if
 * that is still too big are the arrays emptied, and if even that is too big
 * (a single enormous string) the result becomes an error rather than overshoot.
 */
export function fitToBudget(result: VoiceToolResult, maxChars: number = MAX_RESULT_CHARS): VoiceToolResult {
  if (result.ok === false) return result
  const sizeWith = (data: Json, truncated: boolean): number =>
    JSON.stringify({ ...result, data: flagged(data, truncated) }).length
  if (sizeWith(result.data, false) <= maxChars) return result

  let data: Json = result.data
  while (longestArray(data) > 1 && sizeWith(data, true) > maxChars) data = shrink(data, halve)
  if (sizeWith(data, true) > maxChars) data = shrink(data, empty)
  if (sizeWith(data, true) > maxChars) return { ok: false, error: 'Result too large' }
  return { ...result, data: flagged(data, true) }
}
