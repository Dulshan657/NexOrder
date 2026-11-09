import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { importedForwardRefusal } from '../supabase/functions/_shared/fulfillment'
import { updateOrderStatus } from '../services/supabase/orderService'

// ---------------------------------------------------------------------------
// NX-0029: an imported order must not move forward to `packed`, `dispatched` or
// `delivered` with a line open. From `packed` no way out remains: dispatch is refused,
// closing short refuses it, cancelling refuses it and going backwards is refused.
//
// update-order-status/index.ts is a Deno Edge Function that imports from esm.sh and
// reads Deno.env at load, so it cannot run under vitest. As in
// updateOrderStatus.releaseOnDispatch.test.ts, the decision lives in a helper tested
// here with a fake client. The handler's wiring is only read as source below: that
// proves the calls are present and ahead of the writes, not that the handler runs.
// ---------------------------------------------------------------------------

type Line = { quantity: number; pick_progress: Array<{ picked_qty: number }>; pick_differences: Array<{ kind: string }> }

function fakeAdmin(o: { complete?: boolean; rpcError?: boolean; lines?: Line[]; linesError?: boolean } = {}) {
  const rpc = vi.fn(async () =>
    o.rpcError ? { data: null, error: { message: 'boom' } } : { data: o.complete ?? false, error: null })
  const eq = vi.fn(async () =>
    o.linesError ? { data: null, error: { message: 'boom' } } : { data: o.lines ?? [], error: null })
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { admin: { rpc, from } as any, rpc, from, select, eq }
}

const line = (quantity: number, picked: number[], kinds: string[] = []): Line => ({
  quantity,
  pick_progress: picked.map((picked_qty) => ({ picked_qty })),
  pick_differences: kinds.map((kind) => ({ kind })),
})

const IMPORTED = { orderId: 'QB-1', qbInvoiceNumber: 'INV-1' }

describe('importedForwardRefusal', () => {
  describe('a fulfilment moving to packed', () => {
    it('refuses an imported order with an open line, in plain words', async () => {
      const { admin, rpc } = fakeAdmin({ complete: false })

      const refusal = await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: 705 })

      expect(refusal).toMatch(/still has lines to pick/i)
      expect(rpc).toHaveBeenCalledWith('inv_warehouse_pick_complete', { p_order_id: 'QB-1', p_warehouse_id: 705 })
    })

    it('allows an imported order with every line picked or closed', async () => {
      const { admin } = fakeAdmin({ complete: true })

      expect(await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: 705 })).toBeNull()
    })

    it('refuses if the completion check fails', async () => {
      const { admin } = fakeAdmin({ rpcError: true })

      expect(await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: 705 })).not.toBeNull()
    })
  })

  describe('an order-level move, with no fulfilment', () => {
    it('refuses an open line', async () => {
      const { admin, rpc, from } = fakeAdmin({ lines: [line(10, [10]), line(10, [4])] })

      const refusal = await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: null })

      expect(refusal).toMatch(/still has lines to pick/i)
      expect(from).toHaveBeenCalledWith('order_items')
      expect(rpc).not.toHaveBeenCalled()
    })

    it('allows every line picked or closed short, whatever else the line recorded', async () => {
      const { admin } = fakeAdmin({
        lines: [line(10, [6, 4]), line(10, [4], ['short']), line(5, [], ['unrecorded_stock', 'short'])],
      })

      expect(await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: null })).toBeNull()
    })

    it('does not count an unrecorded-stock row as closing a line', async () => {
      const { admin } = fakeAdmin({ lines: [line(10, [4], ['unrecorded_stock'])] })

      expect(await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: null })).not.toBeNull()
    })

    it('refuses if the lines cannot be read', async () => {
      const { admin } = fakeAdmin({ linesError: true })

      expect(await importedForwardRefusal(admin, { ...IMPORTED, status: 'packed', warehouseId: null })).not.toBeNull()
    })
  })

  it('leaves an ordinary order with an open line as today, asking nothing', async () => {
    for (const warehouseId of [705, null]) {
      const { admin, rpc, from } = fakeAdmin({ complete: false, lines: [line(10, [4])] })

      expect(await importedForwardRefusal(admin, {
        orderId: 'ORD-1', qbInvoiceNumber: null, status: 'packed', warehouseId,
      })).toBeNull()

      expect(rpc).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
    }
  })

  it.each(['processed', 'picked'])('does not gate a move to %s', async (status) => {
    const { admin, rpc } = fakeAdmin({ complete: false })

    expect(await importedForwardRefusal(admin, { ...IMPORTED, status, warehouseId: 705 })).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  describe.each(['dispatched', 'delivered'])('a move to %s runs the same gate', (status) => {
    it('on a fulfilment: refused with a line open, allowed with none', async () => {
      expect(await importedForwardRefusal(fakeAdmin({ complete: false }).admin, { ...IMPORTED, status, warehouseId: 705 }))
        .toMatch(/still has lines to pick/i)
      expect(await importedForwardRefusal(fakeAdmin({ complete: true }).admin, { ...IMPORTED, status, warehouseId: 705 }))
        .toBeNull()
    })

    it('at order level: a closed line does not count as short, an open one does', async () => {
      const closed = fakeAdmin({ lines: [line(10, [10]), line(10, [4], ['short'])] })
      expect(await importedForwardRefusal(closed.admin, { ...IMPORTED, status, warehouseId: null })).toBeNull()
      const open = fakeAdmin({ lines: [line(10, [4])] })
      expect(await importedForwardRefusal(open.admin, { ...IMPORTED, status, warehouseId: null }))
        .toMatch(/still has lines to pick/i)
    })

    it('leaves an ordinary order alone, asking nothing', async () => {
      const { admin, rpc, from } = fakeAdmin({ complete: false, lines: [line(10, [4])] })
      for (const warehouseId of [705, null]) {
        expect(await importedForwardRefusal(admin, {
          orderId: 'ORD-1', qbInvoiceNumber: null, status, warehouseId,
        })).toBeNull()
      }
      expect(rpc).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
    })
  })
})

describe('update-order-status wiring (source only: the handler cannot run here)', () => {
  const text = readFileSync(join(process.cwd(), 'supabase', 'functions', 'update-order-status', 'index.ts'), 'utf-8')
    .replace(/\r\n/g, '\n')
  const guardCalls = [...text.matchAll(/importedForwardRefusal\(serviceClient, \{/g)].map((m) => m.index)

  it('reads the invoice number from the order', () => {
    expect(text).toMatch(/\.select\('id, status, horeca_id, qb_invoice_number'\)/)
  })

  it('guards both paths that can write packed, each ahead of its write, and answers NOT_FULLY_PICKED', () => {
    expect(guardCalls).toHaveLength(2)
    const fulfilmentWrite = text.indexOf(".from('order_fulfillments')\n      .update({\n        status: body.status,")
    const legacyMarker = text.indexOf('// ── Legacy path')
    const legacyWrite = text.indexOf('legacyVerdict = await setOrderStatus')
    expect(fulfilmentWrite).toBeGreaterThan(0)
    expect(legacyWrite).toBeGreaterThan(0)
    expect(guardCalls[0]!).toBeLessThan(fulfilmentWrite)
    expect(guardCalls[1]!).toBeGreaterThan(legacyMarker)
    expect(guardCalls[1]!).toBeLessThan(legacyWrite)
    expect(text.match(/errorResponse\('NOT_FULLY_PICKED', forwardRefusal, 422\)/g)).toHaveLength(2)
  })

  it('passes the fulfilment warehouse on one path, and none on the order-level path', () => {
    expect(text.slice(guardCalls[0]!, guardCalls[0]! + 220)).toMatch(/warehouseId: locationId as number/)
    expect(text.slice(guardCalls[1]!, guardCalls[1]! + 220)).toMatch(/warehouseId: null/)
  })

  it('lets a retry at the same status through, on both paths', () => {
    expect(text).toMatch(/if \(ful\.status !== body\.status\) \{\s*const forwardRefusal/)
    expect(text).toMatch(/if \(currentOrderStatus !== body\.status\) \{\s*const forwardRefusal/)
  })

  it('keeps the order-level dispatch check for ordinary orders only', () => {
    const legacy = text.slice(text.indexOf('// ── Legacy path'))
    expect(legacy).toMatch(/if \(body\.status === 'dispatched' && qbInvoiceNumber == null\) \{\s*const \{ data: lines \}/)
    expect(legacy).toContain("'Cannot dispatch — one or more lines are not fully picked'")
  })

  it('keeps the fulfilment dispatch check for every order', () => {
    expect(text).toMatch(/if \(body\.status === 'dispatched'\) \{\s*const done = await isLocationFullyPicked/)
  })
})

describe('updateOrderStatus refusal text', () => {
  beforeEach(() => invoke.mockReset())

  it('shows the operator the server’s words, not the generic failure', async () => {
    const err = new Error('Edge Function returned a non-2xx status code')
    ;(err as Error & { context: Response }).context = new Response(
      JSON.stringify({ error: { code: 'NOT_FULLY_PICKED', message: 'This order still has lines to pick.' } }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    )
    invoke.mockResolvedValue({ data: null, error: err })

    await expect(updateOrderStatus('QB-1', 'packed', undefined, { locationId: 705 }))
      .rejects.toThrow('This order still has lines to pick.')
  })
})
