// Unit tests for the `bulk-create` action's pure helper, extracted to
// supabase/functions/_shared/productBulk.ts (`bulkCreateProducts`) precisely
// so it can be imported here without dragging Deno-only specifiers into the
// vitest/tsc graph.
//
// mutate-product/index.ts (the caller) is a Deno Edge Function: it imports
// `serve` from deno.land, `createClient` and `zod` from esm.sh, and reads
// `Deno.env` at module scope — none of that resolves under Node/vitest.
// Every other edge-fn test in this repo instead imports its pure helper from
// a Deno-free `_shared/*` module (see __tests__/wie/*.test.ts ->
// _shared/wie/*, __tests__/poInbox.*.test.ts -> _shared/poInbox/*), and this
// file follows that convention: it imports `bulkCreateProducts` directly
// from `_shared/productBulk.ts`, which has zero `https://...` imports and
// never references `Deno`. We only need a hand-rolled fake `admin` client
// below, in the same spirit as __tests__/support/fakeSupabase.ts (that fake
// models the PO-inbox `SupabaseLike` surface — eq/order/limit/maybeSingle/
// insert/update — which doesn't cover `.ilike()` / `.in()` / `.single()`, so
// this file rolls its own minimal fake for the products/suppliers surface
// instead of extending the shared one).

import { describe, it, expect } from 'vitest'
import { bulkCreateProducts, remapBulkResults, type BulkCreateResult, type RawBulkRow } from '../supabase/functions/_shared/productBulk.ts'

// ---- SQL LIKE pattern -> RegExp, so the fake `ilike()` below behaves like
// the real thing (see its usage for why this matters) ----

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function likePatternToRegex(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) {
      out += escapeRegExpChar(pattern[i + 1])
      i++
    } else if (ch === '%') {
      out += '.*'
    } else if (ch === '_') {
      out += '.'
    } else {
      out += escapeRegExpChar(ch)
    }
  }
  return new RegExp(`^${out}$`, 'i')
}

// ---- Minimal fake `admin` client for the products/suppliers surface ----

interface FakeRow extends Record<string, unknown> {}

interface SimulatedDbError {
  message: string
  code?: string
}

type TableName = 'products' | 'suppliers'

class FakeAdmin {
  products: FakeRow[]
  suppliers: FakeRow[]
  private readonly productInsertErrors: Map<string, SimulatedDbError>
  readonly insertedProducts: FakeRow[] = []
  readonly insertedSuppliers: FakeRow[] = []
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  private nextProductId = 1000
  private nextSupplierId = 500

  constructor(options: {
    products?: FakeRow[]
    suppliers?: FakeRow[]
    productInsertErrors?: Record<string, SimulatedDbError>
  } = {}) {
    this.products = (options.products ?? []).map(row => ({ ...row }))
    this.suppliers = (options.suppliers ?? []).map(row => ({ ...row }))
    this.productInsertErrors = new Map(Object.entries(options.productInsertErrors ?? {}))
  }

  from(table: TableName) {
    return {
      select: (_cols: string) => this.makeSelectBuilder(table),
      insert: (row: FakeRow) => ({
        select: (_cols?: string) => ({
          single: async () => this.doInsert(table, row),
        }),
      }),
    }
  }

  async rpc(fn: string, args: Record<string, unknown>): Promise<{ error: SimulatedDbError | null }> {
    this.rpcCalls.push({ fn, args })
    return { error: null }
  }

  private rowsFor(table: TableName): FakeRow[] {
    return table === 'products' ? this.products : this.suppliers
  }

  private makeSelectBuilder(table: TableName) {
    const predicates: Array<(row: FakeRow) => boolean> = []
    let limitN: number | null = null

    const resolve = (): { data: FakeRow[]; error: null } => {
      let rows = this.rowsFor(table).filter(row => predicates.every(p => p(row)))
      if (limitN !== null) rows = rows.slice(0, limitN)
      return { data: rows, error: null }
    }

    const builder = {
      eq(col: string, val: unknown) {
        predicates.push(row => row[col] === val)
        return builder
      },
      ilike(col: string, val: string) {
        // Simulate real Postgres ILIKE semantics (not just an exact
        // case-insensitive match): an unescaped `%` matches any run of
        // characters and `_` matches any single character; `\%`/`\_`/`\\`
        // match the literal char. This is what makes the productBulk.ts
        // escaping fix (S-injection) actually observable in a test — a
        // naive "exact string equals" fake would pass whether or not the
        // production code escaped the pattern.
        const regex = likePatternToRegex(val)
        predicates.push(row => {
          const cell = row[col]
          return typeof cell === 'string' && regex.test(cell)
        })
        return builder
      },
      in(col: string, vals: unknown[]) {
        const set = new Set(vals)
        predicates.push(row => set.has(row[col]))
        return builder
      },
      limit(n: number) {
        limitN = n
        return builder
      },
      maybeSingle: async () => {
        const { data } = resolve()
        return { data: data[0] ?? null, error: null }
      },
      single: async () => {
        const { data } = resolve()
        return { data: data[0] ?? null, error: null }
      },
      // Thenable so a bare `await builder` (no terminal .single()) also works.
      then: (onFulfilled: (v: { data: FakeRow[]; error: null }) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    }
    return builder
  }

  private async doInsert(table: TableName, row: FakeRow): Promise<{ data: FakeRow | null; error: SimulatedDbError | null }> {
    if (table === 'products') {
      const sku = row.sku as string
      const simulated = this.productInsertErrors.get(sku)
      if (simulated) return { data: null, error: simulated }
      const stored: FakeRow = { id: this.nextProductId++, ...row }
      this.products.push(stored)
      this.insertedProducts.push(stored)
      return { data: stored, error: null }
    }
    const stored: FakeRow = { id: this.nextSupplierId++, ...row }
    this.suppliers.push(stored)
    this.insertedSuppliers.push(stored)
    return { data: stored, error: null }
  }
}

// ---- Row builder matching the bulk-create row shape ----

function makeRow(overrides: Record<string, unknown> & { sku: string }): FakeRow {
  return {
    name: 'Test Product',
    price: 10,
    category: 'Other',
    unit: 'unit',
    carton_size: 1,
    ...overrides,
  }
}

describe('mutate-product bulk-create: bulkCreateProducts', () => {
  it('resolves a repeated new supplier_name once for the whole batch (C1)', async () => {
    const fake = new FakeAdmin()
    const rows = [
      makeRow({ sku: 'SKU-A', supplier_name: 'Acme Foods' }),
      makeRow({ sku: 'SKU-B', supplier_name: 'Acme Foods' }),
    ]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(fake.insertedSuppliers).toHaveLength(1)
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(true)
    const supplierId = fake.insertedSuppliers[0].id
    expect(fake.insertedProducts[0].supplier_id).toBe(supplierId)
    expect(fake.insertedProducts[1].supplier_id).toBe(supplierId)
  })

  it('seeds derived base+carton UOMs for each created product (mig 00067)', async () => {
    const fake = new FakeAdmin()
    const rows = [makeRow({ sku: 'SKU-U', supplier_id: 1, unit: 'can', carton_size: 12, price: 10 })]

    const results = await bulkCreateProducts(fake as any, rows as any, 5)

    expect(results[0].ok).toBe(true)
    const call = fake.rpcCalls.find(c => c.fn === 'set_product_uoms')
    expect(call).toBeTruthy()
    expect(call!.args.p_product_id).toBe(results[0].id)
    const uoms = call!.args.p_uoms as Array<Record<string, unknown>>
    expect(uoms).toHaveLength(2)
    expect(uoms[0]).toMatchObject({ code: 'can', factor_to_base: 1, is_base: true, price: 10 })
    // 10 * 12 * 0.95 = 114
    expect(uoms[1]).toMatchObject({ code: 'carton', factor_to_base: 12, is_base: false, price: 114 })
  })

  // `is_active` is a real `products` column (mig 00027) that stripNonColumns
  // deliberately leaves alone, so it rides the `...rest` spread onto the insert.
  // This is how a catalogued-but-not-sellable line (e.g. one whose price the
  // operator doesn't know yet) is loaded without being orderable at $0.00.
  it('passes is_active through to the insert when a row sends it', async () => {
    const fake = new FakeAdmin()
    const rows = [
      makeRow({ sku: 'SKU-INACTIVE', supplier_id: 1, price: 0, is_active: false }),
      makeRow({ sku: 'SKU-NORMAL', supplier_id: 1 }),
    ]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(true)
    expect(fake.insertedProducts[0].is_active).toBe(false)
    // Omitting it must not write `false` — the column defaults to true, and an
    // undefined here would silently hide every ordinary imported product.
    expect(fake.insertedProducts[1].is_active).toBeUndefined()
    // Still never accepts stock, whatever else the row carries.
    expect(fake.insertedProducts[0].inventory).toBe(0)
  })

  it('marks a later occurrence of an intra-batch duplicate SKU as failed (S5)', async () => {
    const fake = new FakeAdmin()
    const rows = [
      makeRow({ sku: 'DUP', supplier_id: 1 }),
      makeRow({ sku: 'DUP', supplier_id: 1 }),
    ]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].error).toBe('duplicate of row 0')
    expect(results[1].code).toBe('CONFLICT')
  })

  it('fails a row whose SKU already exists in the database (pre-check)', async () => {
    const fake = new FakeAdmin({ products: [{ id: 1, sku: 'EXIST' }] })
    const rows = [makeRow({ sku: 'EXIST', supplier_id: 1 })]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results[0].ok).toBe(false)
    expect(results[0].code).toBe('CONFLICT')
    expect(fake.insertedProducts).toHaveLength(0)
  })

  it('maps a 23505 unique-violation at insert time to CONFLICT (TOCTOU, S3)', async () => {
    const fake = new FakeAdmin({
      productInsertErrors: {
        RACE: { message: 'duplicate key value violates unique constraint "products_sku_key"', code: '23505' },
      },
    })
    const rows = [makeRow({ sku: 'RACE', supplier_id: 1 })]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results[0].ok).toBe(false)
    expect(results[0].code).toBe('CONFLICT')
  })

  it('still returns a full results array when every row fails', async () => {
    const fake = new FakeAdmin({ products: [{ id: 1, sku: 'EXIST' }] })
    const rows = [
      makeRow({ sku: 'EXIST', supplier_id: 1 }),
      makeRow({ sku: 'EXIST', supplier_id: 1 }), // duplicate of row 0
    ]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(2)
    expect(results.every(r => !r.ok)).toBe(true)
  })

  it('returns an index-aligned mix of ok/fail results for a mixed batch', async () => {
    const fake = new FakeAdmin({
      products: [{ id: 1, sku: 'EXIST' }],
      productInsertErrors: {
        RACE: { message: 'duplicate key value violates unique constraint "products_sku_key"', code: '23505' },
      },
    })
    const rows = [
      makeRow({ sku: 'OK1', supplier_id: 1 }), // index 0 — succeeds
      makeRow({ sku: 'EXIST', supplier_id: 1 }), // index 1 — pre-existing SKU
      makeRow({ sku: 'OK1', supplier_id: 1 }), // index 2 — duplicate of row 0
      makeRow({ sku: 'RACE', supplier_id: 1 }), // index 3 — 23505 at insert
    ]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results).toHaveLength(4)
    expect(results[0]).toMatchObject({ index: 0, ok: true, sku: 'OK1' })
    expect(results[1]).toMatchObject({ index: 1, ok: false, sku: 'EXIST', code: 'CONFLICT' })
    expect(results[2]).toMatchObject({ index: 2, ok: false, sku: 'OK1', error: 'duplicate of row 0', code: 'CONFLICT' })
    expect(results[3]).toMatchObject({ index: 3, ok: false, sku: 'RACE', code: 'CONFLICT' })
  })

  it('escapes LIKE metacharacters in supplier_name so "%" resolves literally, not as a wildcard (FIX 3)', async () => {
    const fake = new FakeAdmin({
      suppliers: [
        // Would be a false-positive match for pattern "Acme%Foods" if `%`
        // were passed straight through as a live SQL wildcard (and — being
        // first in the array — would win the `.limit(1)` race).
        { id: 11, name: 'AcmeXFoods' },
        // The actual literal target.
        { id: 10, name: 'Acme%Foods' },
      ],
    })
    const rows = [makeRow({ sku: 'SKU-P', supplier_name: 'Acme%Foods' })]

    const results = await bulkCreateProducts(fake as any, rows as any)

    expect(results[0].ok).toBe(true)
    expect(fake.insertedProducts[0].supplier_id).toBe(10)
    // No new supplier should have been created — the literal name matched.
    expect(fake.insertedSuppliers).toHaveLength(0)
  })
})

describe('mutate-product bulk-create: remapBulkResults (FIX 1)', () => {
  it('merges per-row validation failures with bulkCreateProducts results, remapped to original indices', () => {
    // Original request: 4 rows, where index 1 fails per-row zod validation
    // before ever reaching bulkCreateProducts (so validRows only has 3
    // entries: original indices 0, 2, 3 — local positions 0, 1, 2).
    const invalidResults: BulkCreateResult[] = [
      { index: 1, ok: false, sku: 'BAD', error: 'price must be non-negative', code: 'INVALID_INPUT' },
    ]
    const validRows: RawBulkRow[] = [
      { originalIndex: 0, data: { sku: 'OK0' } as any },
      { originalIndex: 2, data: { sku: 'OK2' } as any },
      { originalIndex: 3, data: { sku: 'OK3' } as any },
    ]
    const validResults: BulkCreateResult[] = [
      { index: 0, ok: true, id: 100, sku: 'OK0' },
      { index: 1, ok: true, id: 101, sku: 'OK2' },
      { index: 2, ok: false, sku: 'OK3', error: 'duplicate of row 0', code: 'CONFLICT' },
    ]

    const results = remapBulkResults(invalidResults, validRows, validResults)

    expect(results).toHaveLength(4)
    expect(results.map(r => r.index)).toEqual([0, 1, 2, 3])
    expect(results[0]).toMatchObject({ index: 0, ok: true, sku: 'OK0', id: 100 })
    expect(results[1]).toMatchObject({ index: 1, ok: false, sku: 'BAD', code: 'INVALID_INPUT' })
    expect(results[2]).toMatchObject({ index: 2, ok: true, sku: 'OK2', id: 101 })
    expect(results[3]).toMatchObject({ index: 3, ok: false, sku: 'OK3', code: 'CONFLICT' })
  })

  it('returns a complete, index-aligned array when every row failed per-row validation', () => {
    const invalidResults: BulkCreateResult[] = [
      { index: 0, ok: false, sku: 'A', error: 'bad', code: 'INVALID_INPUT' },
      { index: 1, ok: false, sku: 'B', error: 'bad', code: 'INVALID_INPUT' },
    ]

    const results = remapBulkResults(invalidResults, [], [])

    expect(results).toHaveLength(2)
    expect(results.every(r => !r.ok)).toBe(true)
  })
})
