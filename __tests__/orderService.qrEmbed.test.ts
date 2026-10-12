import { describe, it, expect, vi, beforeEach } from 'vitest'

// The order select is a string PostgREST resolves at RUNTIME: tsc cannot tell
// whether the foreign-key hint in it names a real constraint, and a wrong one
// fails every order query with a 400. Pin the spelling here.
const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (...args: unknown[]) => {
        select(...args)
        const chain: Record<string, unknown> = {}
        chain.eq = () => chain
        chain.single = () => Promise.resolve({ data: { id: 'ORD-1' }, error: null })
        return chain
      },
    }),
  },
}))

import { getOrderById } from '../services/supabase/orderService'

describe('order select', () => {
  beforeEach(() => select.mockReset())

  it('embeds the QR request through its unique approved_order_id foreign key (mig 00129)', async () => {
    await getOrderById('ORD-1')
    const sel = select.mock.calls[0][0] as string
    // `qr_order_requests_approved_order_id_fkey` is the constraint name 00129 gives
    // the inline `approved_order_id ... REFERENCES orders(id)`; staff_name is the
    // snapshot column added by 00130.
    expect(sel).toContain('qr_order_requests!qr_order_requests_approved_order_id_fkey(staff_name)')
  })

  it('keeps the PO-Inbox embed and the fulfilments beside it', async () => {
    await getOrderById('ORD-1')
    const sel = select.mock.calls[0][0] as string
    expect(sel).toContain('pending_pos!pending_pos_approved_order_id_fkey(inbound_message_id, status)')
    expect(sel).toContain('order_fulfillments(*, locations(name))')
    expect(sel.startsWith('*, horecas(name), order_items(*)')).toBe(true)
  })
})
