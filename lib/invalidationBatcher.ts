// Coalesces bursts of realtime events into one invalidation per query key.
//
// postgres_changes fires once per ROW: placing one 20-line order emits ~21
// events, and every inventory leg updates products' stock cache too. Each
// event used to invalidate the full orders / products query on the spot, so
// a single action restarted the same unbounded fetch dozens of times on every
// connected client. This trails the burst (delayMs after the last event) and
// caps the wait (maxWaitMs) so a steady stream still refreshes.

import type { QueryKey } from '@tanstack/react-query'

export interface InvalidationBatcher {
  schedule: (keys: readonly QueryKey[]) => void
  /** Drop pending work. The batcher stays usable. */
  cancel: () => void
}

export interface BatcherOptions {
  delayMs?: number
  maxWaitMs?: number
}

export const REALTIME_BATCH_DELAY_MS = 250
export const REALTIME_BATCH_MAX_WAIT_MS = 1000

export function createInvalidationBatcher(
  invalidate: (key: QueryKey) => void,
  { delayMs = REALTIME_BATCH_DELAY_MS, maxWaitMs = REALTIME_BATCH_MAX_WAIT_MS }: BatcherOptions = {},
): InvalidationBatcher {
  let pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstScheduledAt = 0

  const flush = () => {
    const keys = [...pending.values()]
    pending = new Map()
    timer = null
    for (const key of keys) invalidate(key)
  }

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = new Map()
  }

  const schedule = (keys: readonly QueryKey[]) => {
    const now = Date.now()
    if (pending.size === 0) firstScheduledAt = now
    for (const key of keys) pending.set(JSON.stringify(key), key)
    if (timer) clearTimeout(timer)
    const wait = Math.max(0, Math.min(delayMs, firstScheduledAt + maxWaitMs - now))
    timer = setTimeout(flush, wait)
  }

  return { schedule, cancel }
}
