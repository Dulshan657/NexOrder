import { describe, expect, it, vi } from 'vitest'

import { retirePendingNotifications } from '@/supabase/functions/_shared/qrNotify'

/**
 * A request that leaves the queue (approved, declined, cancelled, or cancelled
 * because its sender was removed) must also leave the approvers' bell. This is the
 * one query that does it; the test pins WHICH rows it may touch.
 */

interface Call {
  table: string
  patch?: unknown
  filters: Array<[string, string, unknown]>
}

/** The slice of supabase-js `retirePendingNotifications` uses: from().update().eq().eq().in().select(). */
function fakeService(result: { data: unknown; error: { message: string } | null } | 'throw') {
  const calls: Call[] = []
  const service = {
    from(table: string) {
      const call: Call = { table, filters: [] }
      calls.push(call)
      const builder = {
        update(patch: unknown) {
          call.patch = patch
          return builder
        },
        eq(col: string, val: unknown) {
          call.filters.push(['eq', col, val])
          return builder
        },
        in(col: string, val: unknown) {
          call.filters.push(['in', col, val])
          return builder
        },
        select() {
          if (result === 'throw') throw new Error('network down')
          return Promise.resolve(result)
        },
      }
      return builder
    },
  }
  return { service: service as never, calls }
}

describe('retirePendingNotifications', () => {
  it('marks only UNREAD qr_order_pending rows for the given requests as read', async () => {
    const { service, calls } = fakeService({ data: [{ id: 'n1' }, { id: 'n2' }], error: null })

    const n = await retirePendingNotifications(service, ['req-1', 'req-2'])

    expect(n).toBe(2)
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('notifications')
    expect(calls[0].patch).toEqual({ read: true })
    expect(calls[0].filters).toEqual([
      ['eq', 'type', 'qr_order_pending'],
      ['eq', 'read', false],
      ['in', 'metadata->>requestId', ['req-1', 'req-2']],
    ])
  })

  it('does not touch other notification types (the requester\'s own approved / declined bell entry stays)', async () => {
    const { service, calls } = fakeService({ data: [], error: null })
    await retirePendingNotifications(service, ['req-1'])
    const typeFilter = calls[0].filters.find(([, col]) => col === 'type')
    expect(typeFilter).toEqual(['eq', 'type', 'qr_order_pending'])
  })

  it('does nothing -- not even a query -- when there is nothing to retire', async () => {
    const { service, calls } = fakeService({ data: [], error: null })
    expect(await retirePendingNotifications(service, [])).toBe(0)
    expect(await retirePendingNotifications(service, ['', ''])).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('de-duplicates the ids it sends', async () => {
    const { service, calls } = fakeService({ data: [], error: null })
    await retirePendingNotifications(service, ['req-1', 'req-1', 'req-2'])
    expect(calls[0].filters).toContainEqual(['in', 'metadata->>requestId', ['req-1', 'req-2']])
  })

  it('never throws: a database error is logged and counts as zero', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = fakeService({ data: null, error: { message: 'permission denied' } })
    await expect(retirePendingNotifications(service, ['req-1'])).resolves.toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never throws: a thrown client is logged and counts as zero', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = fakeService('throw')
    await expect(retirePendingNotifications(service, ['req-1'])).resolves.toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
