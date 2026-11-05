import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { advanceCompletedFulfilments } from '../../supabase/functions/_shared/fulfillment'

// NX-0029: closing a line or picking the last of one can leave another warehouse with
// nothing to pick and no event to advance it. The helper checks every 'processed' site.
// record-pick and record-short-pick are Deno entrypoints that cannot be imported here, so
// their wiring is read from source, as moduleOwnership.test.ts does.

type Site = { id: number; location_id: number; status: string; status_history: unknown }

function fakeAdmin(sites: Site[], complete: Record<number, boolean>) {
  const updates: Array<{ id: unknown; status: unknown; body: any }> = []
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'inv_warehouse_pick_complete') return { data: complete[args.p_warehouse_id] === true, error: null }
    // recomputeOrderStatus -> setOrderStatus
    return { data: { ok: true }, error: null }
  })
  const from = vi.fn(() => ({
    select: () => ({ eq: async () => ({ data: sites, error: null }) }),
    update: (body: any) => {
      const entry = { id: undefined as unknown, status: undefined as unknown, body }
      updates.push(entry)
      return {
        eq: (_c: string, id: unknown) => {
          entry.id = id
          return {
            eq: async (_s: string, status: unknown) => {
              entry.status = status
              return { error: null }
            },
          }
        },
      }
    },
  }))
  return { admin: { rpc, from } as any, updates, rpc }
}

const site = (id: number, location_id: number, status = 'processed'): Site => ({
  id, location_id, status, status_history: [{ status: 'processed' }],
})

describe('advanceCompletedFulfilments', () => {
  it('advances every processed site that is complete, and only those', async () => {
    const { admin, updates } = fakeAdmin(
      [site(1, 10), site(2, 20), site(3, 30), site(4, 40, 'packed')],
      { 10: true, 20: false, 30: true, 40: true },
    )

    const found = await advanceCompletedFulfilments(admin, 'ORD-1', 'actor', '2026-11-06T00:00:00.000Z', 'Test note')

    expect(found).toBe(4)
    expect(updates.map((u) => u.id)).toEqual([1, 3])
    for (const u of updates) {
      // Guarded, so a concurrent advance is not overwritten.
      expect(u.status).toBe('processed')
      expect(u.body.status).toBe('picked')
      expect(u.body.status_history).toEqual([
        { status: 'processed' },
        { status: 'picked', timestamp: '2026-11-06T00:00:00.000Z', actor: 'actor', note: 'Test note' },
      ])
    }
  })

  it('returns 0 and writes nothing for an order with no fulfilments', async () => {
    const { admin, updates, rpc } = fakeAdmin([], {})

    expect(await advanceCompletedFulfilments(admin, 'ORD-1', 'actor', 'now', 'Test note')).toBe(0)

    expect(updates).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves a site that errors on the completion check where it is', async () => {
    const { admin, updates, rpc } = fakeAdmin([site(1, 10)], {})
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as any)

    await advanceCompletedFulfilments(admin, 'ORD-1', 'actor', 'now', 'Test note')

    expect(updates).toEqual([])
  })
})

describe('who advances which sites', () => {
  const source = (fn: string): string =>
    readFileSync(join(process.cwd(), 'supabase', 'functions', fn, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

  it('record-pick uses it for imported orders only, leaving the other orders\' branch as it was', () => {
    const text = source('record-pick')
    expect(text).toMatch(/\.select\('order_id, product_id, orders\(qb_invoice_number\)'\)/)
    expect(text).toMatch(/if \(isImported\) \{[\s\S]*advanceCompletedFulfilments\(\s*admin, orderId,/)
    // Every other order still advances the one warehouse it picked at.
    expect(text).toContain(
      "if ((ful as any).status === 'processed' && (await isLocationFullyPicked(admin, orderId, warehouseId))) {",
    )
    expect(text).toMatch(/\} else \{\s*\n\s*\/\/ Fulfilment model: advance this warehouse's fulfilment/)
  })

  it('record-short-pick uses it', () => {
    expect(source('record-short-pick')).toMatch(/advanceCompletedFulfilments\(\s*admin, orderId,/)
  })
})
