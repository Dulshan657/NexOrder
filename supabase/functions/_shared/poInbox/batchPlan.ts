// Decide which listed messages one poll tick processes, and whether the
// provider watermark may move forward.
//
// The watermark (Gmail historyId / Graph deltaLink) points past EVERY message
// the provider listed. If a tick only processes the first `max` of a larger
// backlog and still saves that watermark, the rest are never listed again and
// silently lost. So: skip messages we already stored, process at most `max`,
// and only advance the watermark when nothing listed is left behind. A held
// watermark re-lists the same set next tick; the stored-id filter guarantees
// each tick makes progress through it.

export interface PollBatchPlan<T> {
  toProcess: T[]
  advanceWatermark: boolean
}

export function planPollBatch<T extends { id: string }>(
  listed: readonly T[],
  alreadyStored: ReadonlySet<string>,
  max: number,
): PollBatchPlan<T> {
  const pending = listed.filter((ref) => !alreadyStored.has(ref.id))
  return {
    toProcess: pending.slice(0, max),
    advanceWatermark: pending.length <= max,
  }
}
