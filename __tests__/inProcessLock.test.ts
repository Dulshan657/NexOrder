import { describe, it, expect, beforeEach } from 'vitest'
import { inProcessLock, resetInProcessLocks } from '@/lib/auth/inProcessLock'

// This lock is what lets `persistSession` stay on. supabase-js's default
// navigatorLock hung during _initialize() and cost the app its sessions for
// months, so the replacement's contract is pinned here: it must serialise, it
// must never wait on anything external, and one failure must not wedge it.

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('inProcessLock', () => {
    beforeEach(() => {
        resetInProcessLocks()
    })

    it('runs same-name operations one at a time, in call order', async () => {
        const events: string[] = []
        const job = (id: string) => async () => {
            events.push(`start:${id}`)
            await tick()
            events.push(`end:${id}`)
            return id
        }

        const results = await Promise.all([
            inProcessLock('auth', 0, job('a')),
            inProcessLock('auth', 0, job('b')),
            inProcessLock('auth', 0, job('c')),
        ])

        expect(results).toEqual(['a', 'b', 'c'])
        // No interleaving: every start is immediately followed by its own end.
        expect(events).toEqual([
            'start:a', 'end:a',
            'start:b', 'end:b',
            'start:c', 'end:c',
        ])
    })

    it('does not serialise across different lock names', async () => {
        const events: string[] = []
        const slow = async () => { await tick(); await tick(); events.push('slow') }
        const fast = async () => { events.push('fast') }

        await Promise.all([inProcessLock('one', 0, slow), inProcessLock('two', 0, fast)])

        // 'two' never waited on 'one'.
        expect(events).toEqual(['fast', 'slow'])
    })

    it('surfaces a failure to its own caller', async () => {
        const boom = () => Promise.reject(new Error('refresh failed'))
        await expect(inProcessLock('auth', 0, boom)).rejects.toThrow('refresh failed')
    })

    it('keeps working after a failure — one bad refresh must not wedge the queue', async () => {
        const boom = () => Promise.reject(new Error('refresh failed'))
        await expect(inProcessLock('auth', 0, boom)).rejects.toThrow('refresh failed')

        await expect(inProcessLock('auth', 0, async () => 'ok')).resolves.toBe('ok')
    })

    it('ignores acquireTimeout rather than rejecting on it', async () => {
        // A zero timeout would be an instant failure under a timeout-honouring
        // lock. Timing out is the exact behaviour this replacement removes.
        const held = inProcessLock('auth', 0, async () => { await tick(); return 'first' })
        const queued = inProcessLock('auth', 0, async () => 'second')

        expect(await held).toBe('first')
        expect(await queued).toBe('second')
    })
})
