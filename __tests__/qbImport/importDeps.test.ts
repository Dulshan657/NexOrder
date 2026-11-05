import { describe, expect, it, vi } from 'vitest'

import { buildImportDeps } from '../../supabase/functions/_shared/qbImport/importDeps'
import { ensureProcessedFulfilments, writeProcessedStatus } from '../../supabase/functions/_shared/fulfillment'

// A small stand-in for the supabase-js builder: enough to prove paging, chunking
// and the shapes written, without a database.

type Row = Record<string, unknown>

interface Call {
  table: string
  op: string
  payload?: unknown
  filters: Array<[string, string, unknown]>
}

function fakeAdmin(tables: Record<string, Row[]>, rpc: (name: string, args: Row) => { data?: unknown; error?: unknown } = () => ({ data: null })) {
  const calls: Call[] = []
  const pagesRead: Record<string, number> = {}

  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    calls.push(call)
    let range: [number, number] | null = null
    let head = false

    const rows = (): Row[] =>
      call.filters.reduce<Row[]>(
        (acc, [kind, column, value]) => {
          if (kind === 'eq') return acc.filter((row) => row[column] === value)
          if (kind === 'in') return acc.filter((row) => (value as unknown[]).includes(row[column]))
          return acc
        },
        tables[table] ?? [],
      )

    const finish = () => {
      if (call.op === 'update') {
        const matched = rows()
        return { data: matched, error: null }
      }
      if (call.op === 'upsert') return { data: null, error: null }
      const all = rows()
      if (head) return { data: null, count: all.length, error: null }
      if (range) {
        pagesRead[table] = (pagesRead[table] ?? 0) + 1
        return { data: all.slice(range[0], range[1] + 1), error: null }
      }
      // PostgREST's silent cap, which is the bug paging exists to avoid.
      return { data: all.slice(0, 1000), error: null }
    }

    const builder: Row & PromiseLike<unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        head = options?.head === true
        return builder
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(['eq', column, value])
        return builder
      },
      in: (column: string, value: unknown) => {
        call.filters.push(['in', column, value])
        return builder
      },
      order: () => builder,
      limit: () => builder,
      range: (start: number, end: number) => {
        range = [start, end]
        return builder
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (payload: unknown) => {
        call.op = 'update'
        call.payload = payload
        return builder
      },
      upsert: (payload: unknown) => {
        call.op = 'upsert'
        call.payload = payload
        return builder
      },
      then: (resolve, reject) => Promise.resolve(finish()).then(resolve, reject),
    }
    return builder
  }

  const rpcFn = vi.fn(async (name: string, args: Row) => {
    const out = rpc(name, args)
    return { data: out.data ?? null, error: out.error ?? null }
  })

  return { client: { from, rpc: rpcFn } as never, calls, pagesRead, rpc: rpcFn }
}

const SETTINGS = { id: 1, qb_own_product_prefixes: ['ACME'], qb_own_product_terms: [] }
const ACTOR = '00000000-0000-0000-0000-000000000001'

describe('buildImportDeps', () => {
  it('pages customers and map rows fully rather than stopping at 1000', async () => {
    const horecas = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, name: `Customer ${i + 1}` }))
    const map = Array.from({ length: 1001 }, (_, i) => ({ qb_name: `Name ${i}`, product_id: i + 1, pack_size: null }))
    const fake = fakeAdmin({ horecas, qb_product_map: map, app_settings: [SETTINGS], qb_invoice_imports: [] })

    const facts = await buildImportDeps(fake.client, ACTOR).loadFacts(['INV-1'])

    expect(facts.customers).toHaveLength(2500)
    expect(facts.productMap).toHaveLength(1001)
    expect(facts.productMap[0]).toEqual({ qbName: 'Name 0', productId: 1, packSize: null })
    expect(facts.ownProductPrefixes).toEqual(['ACME'])
    expect(facts.ownProductTerms).toEqual([])
  })

  it('reads what an earlier import stored, with its order status and whether picking started', async () => {
    const fake = fakeAdmin({
      horecas: [],
      qb_product_map: [],
      app_settings: [SETTINGS],
      qb_invoice_imports: [
        { invoice_number: 'INV-1', order_id: 'QB-INV-1', lines: [{ product_id: 11, quantity: 3, pack_size: 12, unit_price: 2.5 }] },
        { invoice_number: 'INV-2', order_id: 'QB-INV-2', lines: [] },
        { invoice_number: 'INV-OTHER', order_id: 'QB-INV-OTHER', lines: [] },
      ],
      orders: [
        { id: 'QB-INV-1', status: 'processed', horeca_id: 7 },
        { id: 'QB-INV-2', status: 'processing', horeca_id: 8 },
      ],
      pick_progress: [{ id: 1, order_id: 'QB-INV-2' }],
    })

    const facts = await buildImportDeps(fake.client, ACTOR).loadFacts(['INV-1', 'INV-2', 'INV-NEW'])

    expect(facts.storedImports).toEqual([
      {
        invoiceNumber: 'INV-1',
        orderId: 'QB-INV-1',
        horecaId: 7,
        lines: [{ productId: 11, quantity: 3, unitPrice: 2.5 }],
        pickingStarted: false,
        orderStatus: 'processed',
      },
      { invoiceNumber: 'INV-2', orderId: 'QB-INV-2', horecaId: 8, lines: [], pickingStarted: true, orderStatus: 'processing' },
    ])
  })

  it('looks up a very long list of invoices in chunks, so no request URL overflows', async () => {
    const fake = fakeAdmin({ horecas: [], qb_product_map: [], app_settings: [SETTINGS], qb_invoice_imports: [] })
    const numbers = Array.from({ length: 450 }, (_, i) => `INV-${i}`)

    await buildImportDeps(fake.client, ACTOR).loadFacts(numbers)

    const lookups = fake.calls.filter((call) => call.table === 'qb_invoice_imports')
    expect(lookups.length).toBeGreaterThan(1)
    for (const call of lookups) {
      const inFilter = call.filters.find(([kind]) => kind === 'in')
      expect((inFilter?.[2] as unknown[]).length).toBeLessThanOrEqual(200)
    }
  })

  it('calls the import transaction with the migration names, in snake case, with no location preference', async () => {
    const fake = fakeAdmin({}, () => ({ data: { status: 'created', order_id: 'QB-INV-1' } }))
    const out = await buildImportDeps(fake.client, ACTOR).importInvoice({
      invoiceNumber: 'INV-1',
      horecaId: 7,
      invoiceDate: '2026-03-05',
      lines: [{ productId: 11, quantity: 3, packSize: 12, unitPrice: 2.5, qbProductName: 'Widget' }],
    })

    expect(out).toEqual({ status: 'created', orderId: 'QB-INV-1' })
    expect(fake.rpc).toHaveBeenCalledWith('qb_import_invoice_tx', {
      p_invoice_number: 'INV-1',
      p_horeca_id: 7,
      p_invoice_date: '2026-03-05',
      p_lines: [{ product_id: 11, quantity: 3, pack_size: 12, unit_price: 2.5 }],
      p_actor: ACTOR,
      p_location_pref: null,
    })
  })

  it('surfaces a transaction error for the per-invoice report', async () => {
    const fake = fakeAdmin({}, () => ({ error: { message: 'QB_ORDER_ID_TAKEN: order QB-INV-1' } }))
    await expect(
      buildImportDeps(fake.client, ACTOR).updateInvoice({ invoiceNumber: 'INV-1', horecaId: 7, invoiceDate: '2026-03-05', lines: [] }),
    ).rejects.toThrow('QB_ORDER_ID_TAKEN')
  })

  it('passes a refusal from the update transaction through', async () => {
    const fake = fakeAdmin({}, () => ({ data: { status: 'refused', reason: 'order_closed' } }))
    const out = await buildImportDeps(fake.client, ACTOR).updateInvoice({ invoiceNumber: 'INV-1', horecaId: 7, invoiceDate: '2026-03-05', lines: [] })
    expect(out).toEqual({ status: 'refused', reason: 'order_closed' })
  })

  it('replaces flagged_change rather than adding to it, and reopens the flag', async () => {
    const fake = fakeAdmin({ qb_invoice_imports: [{ invoice_number: 'INV-1', flagged_change: [{ old: true }] }] })
    const differences = [{ kind: 'customer' as const, fromHorecaId: 1, toHorecaId: 2 }]

    await buildImportDeps(fake.client, ACTOR).flagChange('INV-1', differences)

    const update = fake.calls.find((call) => call.op === 'update')
    expect(update?.table).toBe('qb_invoice_imports')
    expect(update?.payload).toEqual({ flagged_change: differences, flag_resolved_at: null })
    expect(update?.filters).toEqual([['eq', 'invoice_number', 'INV-1']])
  })

  it('throws when a flag finds no import row to land on', async () => {
    const fake = fakeAdmin({ qb_invoice_imports: [] })
    await expect(buildImportDeps(fake.client, ACTOR).flagChange('INV-1', [])).rejects.toThrow(/INV-1/)
  })

  it('advances through a fulfilment and the status transaction', async () => {
    const fake = fakeAdmin({ order_fulfillments: [{ order_id: 'QB-INV-1', location_id: 3 }] }, (name) => {
      if (name === 'inv_order_fulfilment_warehouses') return { data: [{ warehouse_id: 3 }] }
      if (name === 'order_set_status_tx') return { data: { ok: true, changed: true, order: {} } }
      return {}
    })

    expect(await buildImportDeps(fake.client, ACTOR).advanceToProcessed('QB-INV-1')).toEqual({ ok: true })

    const upsert = fake.calls.find((call) => call.op === 'upsert')
    expect(upsert?.table).toBe('order_fulfillments')
    const statusCall = fake.rpc.mock.calls.find(([name]) => name === 'order_set_status_tx')
    expect(statusCall?.[1]).toMatchObject({
      p_order_id: 'QB-INV-1',
      p_from: ['processing', 'processed'],
      p_to: 'processed',
      p_entry: { status: 'processed', actor: ACTOR },
    })
  })

  it('refuses to mark an order processed when no fulfilment exists, so the next upload retries it', async () => {
    const fake = fakeAdmin({ order_fulfillments: [], locations: [] }, (name) =>
      name === 'inv_order_fulfilment_warehouses' ? { data: [] } : {},
    )

    expect(await buildImportDeps(fake.client, ACTOR).advanceToProcessed('QB-INV-1')).toEqual({ ok: false, code: 'NO_FULFILMENT' })
    expect(fake.rpc.mock.calls.some(([name]) => name === 'order_set_status_tx')).toBe(false)
  })

  it('reports the status transaction refusing a cancelled order', async () => {
    const fake = fakeAdmin({ order_fulfillments: [{ order_id: 'QB-INV-1', location_id: 3 }] }, (name) => {
      if (name === 'inv_order_fulfilment_warehouses') return { data: [{ warehouse_id: 3 }] }
      if (name === 'order_set_status_tx') return { data: { ok: false, code: 'CANCELLED' } }
      return {}
    })
    expect(await buildImportDeps(fake.client, ACTOR).advanceToProcessed('QB-INV-1')).toEqual({ ok: false, code: 'CANCELLED' })
  })
})

describe('the helpers update-order-status and the import share', () => {
  const STAMP = '2026-03-05T00:00:00.000Z'

  it('falls back to the first active warehouse when nothing is reserved', async () => {
    const fake = fakeAdmin({ locations: [{ id: 5, kind: 'WAREHOUSE', is_active: true }] }, (name) =>
      name === 'inv_order_fulfilment_warehouses' ? { data: [] } : {},
    )
    const out = await ensureProcessedFulfilments(fake.client, 'ORD-1', ACTOR, STAMP)
    expect(out).toEqual({ reservedLocs: [], locs: [5] })
    const upsert = fake.calls.find((call) => call.op === 'upsert')
    expect(upsert?.payload).toEqual([
      {
        order_id: 'ORD-1',
        location_id: 5,
        status: 'processed',
        status_history: [{ status: 'processed', timestamp: STAMP, actor: ACTOR }],
      },
    ])
  })

  it('uses the reserved warehouses when there are some', async () => {
    const fake = fakeAdmin({}, (name) =>
      name === 'inv_order_fulfilment_warehouses' ? { data: [{ warehouse_id: 2 }, { warehouse_id: 4 }] } : {},
    )
    expect(await ensureProcessedFulfilments(fake.client, 'ORD-1', ACTOR, STAMP)).toEqual({ reservedLocs: [2, 4], locs: [2, 4] })
  })

  it('writes the status entry with a note only when there is one', async () => {
    const fake = fakeAdmin({}, () => ({ data: { ok: true, changed: true, order: {} } }))
    await writeProcessedStatus(fake.client, { orderId: 'ORD-1', actorId: ACTOR, stampIso: STAMP })
    await writeProcessedStatus(fake.client, { orderId: 'ORD-1', actorId: ACTOR, stampIso: STAMP, note: 'why' })

    expect(fake.rpc.mock.calls[0]).toEqual([
      'order_set_status_tx',
      {
        p_order_id: 'ORD-1',
        p_from: ['processing', 'processed'],
        p_to: 'processed',
        p_entry: { status: 'processed', timestamp: STAMP, actor: ACTOR },
      },
    ])
    expect((fake.rpc.mock.calls[1][1] as { p_entry: unknown }).p_entry).toEqual({
      status: 'processed',
      timestamp: STAMP,
      actor: ACTOR,
      note: 'why',
    })
  })
})
