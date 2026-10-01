import { describe, it, expect, vi } from 'vitest'

import { setOrderStatus, statusesUpTo } from '../supabase/functions/_shared/orderStatus'
import { recomputeOrderStatus } from '../supabase/functions/_shared/fulfillment'

// order_set_status_tx (mig 00128) takes the row lock and is the only writer of
// orders.status besides order_cancel_tx. These tests pin the Edge Function side:
// what it passes, and how it reads the verdict.

describe('statusesUpTo', () => {
  const ladder = ['processing', 'processed', 'picked', 'packed'] as const

  it('returns every rung up to and including the target (forward-only)', () => {
    expect(statusesUpTo(ladder, 'picked')).toEqual(['processing', 'processed', 'picked'])
  })

  it('returns an empty list for a status off the ladder', () => {
    expect(statusesUpTo(ladder, 'cancelled' as never)).toEqual([])
  })
})

describe('setOrderStatus', () => {
  it('passes the transition to order_set_status_tx and returns its verdict', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, code: 'CANCELLED' }, error: null })
    const entry = { status: 'picked', timestamp: 't', actor: 'u' }

    const verdict = await setOrderStatus({ rpc } as any, {
      orderId: 'ORD-1', from: ['processed'], to: 'picked', entry,
    })

    expect(rpc).toHaveBeenCalledWith('order_set_status_tx', {
      p_order_id: 'ORD-1', p_from: ['processed'], p_to: 'picked', p_entry: entry,
    })
    expect(verdict).toEqual({ ok: false, code: 'CANCELLED' })
  })

  it('sends a null p_from when the caller accepts any live status', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, changed: true, order: {} }, error: null })
    await setOrderStatus({ rpc } as any, { orderId: 'ORD-1', from: null, to: 'packed', entry: {} })
    expect(rpc.mock.calls[0][1].p_from).toBeNull()
  })

  it('throws when the RPC itself fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(
      setOrderStatus({ rpc } as any, { orderId: 'ORD-1', from: null, to: 'packed', entry: {} }),
    ).rejects.toThrow(/boom/)
  })
})

function fakeAdminWithFulfilments(statuses: string[], verdict: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: verdict, error: null })
  const eq = vi.fn().mockResolvedValue({ data: statuses.map((status) => ({ status })), error: null })
  const from = vi.fn(() => ({ select: () => ({ eq }) }))
  return { admin: { rpc, from } as any, rpc, from }
}

describe('recomputeOrderStatus', () => {
  it('writes the rolled-up status through order_set_status_tx, never a direct UPDATE', async () => {
    const { admin, rpc, from } = fakeAdminWithFulfilments(['picked', 'packed'], { ok: true, changed: true, order: {} })

    const result = await recomputeOrderStatus(admin, 'ORD-1', 'actor', '2026-10-01T00:00:00.000Z')

    expect(result).toBe('picked')
    expect(from).toHaveBeenCalledTimes(1) // only the fulfilments read
    expect(from).toHaveBeenCalledWith('order_fulfillments')
    expect(rpc).toHaveBeenCalledWith('order_set_status_tx', expect.objectContaining({
      p_order_id: 'ORD-1',
      // forward-only: a stale rollup must not move the order backwards
      p_from: ['processing', 'processed', 'picked'],
      p_to: 'picked',
      p_entry: expect.objectContaining({ status: 'picked', actor: 'actor' }),
    }))
  })

  it("reports 'cancelled' and leaves the order alone when it was cancelled", async () => {
    const { admin } = fakeAdminWithFulfilments(['processed'], { ok: false, code: 'CANCELLED' })
    expect(await recomputeOrderStatus(admin, 'ORD-1', 'actor', 't')).toBe('cancelled')
  })

  it('returns null for a legacy order with no fulfilments, without calling the RPC', async () => {
    const { admin, rpc } = fakeAdminWithFulfilments([], null)
    expect(await recomputeOrderStatus(admin, 'ORD-1', 'actor', 't')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})
