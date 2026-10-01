import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QueryKey } from '@tanstack/react-query'
import { createInvalidationBatcher } from '@/lib/invalidationBatcher'

let invalidate: ReturnType<typeof vi.fn<(key: QueryKey) => void>>

beforeEach(() => {
    vi.useFakeTimers()
    invalidate = vi.fn<(key: QueryKey) => void>()
})
afterEach(() => vi.useRealTimers())

const calls = () => invalidate.mock.calls.map((c) => JSON.stringify(c[0]))

describe('createInvalidationBatcher', () => {
    it('collapses a burst of events into one invalidation per key', () => {
        const b = createInvalidationBatcher(invalidate, { delayMs: 250, maxWaitMs: 1000 })
        // One order with 20 lines: 21 postgres_changes events.
        for (let i = 0; i < 21; i++) b.schedule([['orders'], ['pick_queue']])

        expect(invalidate).not.toHaveBeenCalled()
        vi.advanceTimersByTime(250)
        expect(calls()).toEqual(['["orders"]', '["pick_queue"]'])
    })

    it('dedupes the same key arriving from different tables', () => {
        const b = createInvalidationBatcher(invalidate, { delayMs: 250, maxWaitMs: 1000 })
        b.schedule([['inventory_balances'], ['products']])
        b.schedule([['products']])
        vi.advanceTimersByTime(250)
        expect(calls()).toEqual(['["inventory_balances"]', '["products"]'])
    })

    it('keeps waiting while events keep arriving, but never past maxWait', () => {
        const b = createInvalidationBatcher(invalidate, { delayMs: 250, maxWaitMs: 1000 })
        for (let t = 0; t < 900; t += 100) {
            b.schedule([['orders']])
            vi.advanceTimersByTime(100)
        }
        expect(invalidate).not.toHaveBeenCalled()
        b.schedule([['orders']])
        vi.advanceTimersByTime(100)
        expect(invalidate).toHaveBeenCalledTimes(1)
    })

    it('starts a fresh batch after flushing', () => {
        const b = createInvalidationBatcher(invalidate, { delayMs: 250, maxWaitMs: 1000 })
        b.schedule([['orders']])
        vi.advanceTimersByTime(250)
        b.schedule([['orders']])
        vi.advanceTimersByTime(250)
        expect(invalidate).toHaveBeenCalledTimes(2)
    })

    it('cancel drops pending work and leaves the batcher usable', () => {
        const b = createInvalidationBatcher(invalidate, { delayMs: 250, maxWaitMs: 1000 })
        b.schedule([['orders']])
        b.cancel()
        vi.advanceTimersByTime(2000)
        expect(invalidate).not.toHaveBeenCalled()

        b.schedule([['products']])
        vi.advanceTimersByTime(250)
        expect(calls()).toEqual(['["products"]'])
    })
})
