import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type {
  ClassifyContext,
  InvoiceVerdict,
  ProductMapRow,
  StoredImport,
} from '@/supabase/functions/_shared/qbImport/classifyInvoices'
import type { QbLine } from '@/supabase/functions/_shared/qbImport/types'

// NX-0025: the rules that decide what happens to each QuickBooks invoice in an upload.
//
// The module is loaded INSIDE each test, not imported at the top. On the base
// commit it does not exist, and a top-level import would stop this whole file
// loading, so no test could ever fail by assertion. The type imports above are
// erased at build time and load nothing.
//
// Every name, price and id here is made up. The "own product" rule is a plain
// prefix check, standing in for whatever rule the caller supplies.

type Verdict<K extends InvoiceVerdict['kind']> = Extract<InvoiceVerdict, { kind: K }>

async function classify(lines: QbLine[], ctx: ClassifyContext): Promise<InvoiceVerdict[]> {
  const { classifyInvoices } = await import('@/supabase/functions/_shared/qbImport/classifyInvoices')
  return classifyInvoices(lines, ctx)
}

async function classifyOne(lines: QbLine[], ctx: ClassifyContext): Promise<InvoiceVerdict> {
  const verdicts = await classify(lines, ctx)
  expect(verdicts).toHaveLength(1)
  return verdicts[0]
}

function expectKind<K extends InvoiceVerdict['kind']>(verdict: InvoiceVerdict, kind: K): Verdict<K> {
  expect(verdict.kind).toBe(kind)
  return verdict as Verdict<K>
}

function expectRejected(verdict: InvoiceVerdict): string[] {
  return expectKind(verdict, 'rejected').reasons
}

function mentions(reasons: string[], text: string): boolean {
  return reasons.some((reason) => reason.includes(text))
}

// The two customer-match failures read differently, and a test about one must not pass on the other.
const NO_MATCH_WORDING = 'is not in the customer list'
const TWO_MATCHES_WORDING = 'matches more than one customer'

function reasonsMentioning(reasons: string[], ...texts: string[]): string[] {
  return reasons.filter((reason) => texts.every((text) => reason.includes(text)))
}

const BASE = { invoiceNumber: 'INV-1001', invoiceDate: '2026-10-01', customerName: 'Harbour Cafe' }

function ln(
  rowNumber: number,
  qbProductName: string,
  quantity: number,
  unitPrice: number,
  over: Partial<QbLine> = {},
): QbLine {
  return { ...BASE, rowNumber, qbProductName, quantity, unitPrice, ...over }
}

const SAUCE = 'Acme Sauce 500g'
const MUSTARD = 'Acme Mustard 250g'
const RELISH = 'Acme Relish 300g'
const PICKLE = 'Acme Pickle 1kg'
const PASTA = 'Zenith Pasta 1kg'
const FEE = 'Delivery Fee'

const PRODUCT_MAP: ProductMapRow[] = [
  { qbName: SAUCE, productId: 101, packSize: 12 },
  { qbName: MUSTARD, productId: 102, packSize: null },
  { qbName: RELISH, productId: 103, packSize: 6 },
  { qbName: PICKLE, productId: 104, packSize: null },
]

const CUSTOMERS = [
  { id: 1, name: 'Harbour Cafe' },
  { id: 2, name: 'Corner Deli' },
  { id: 3, name: 'Pier Bistro' },
]

const isOwn = (name: string): boolean => name.trim().toLowerCase().startsWith('acme ')

function makeCtx(over: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    customers: CUSTOMERS,
    productMap: PRODUCT_MAP,
    storedImports: [],
    isOwnProductName: isOwn,
    ...over,
  }
}

function stored(over: Partial<StoredImport> = {}): StoredImport {
  return {
    invoiceNumber: 'INV-1001',
    orderId: 'QB-INV-1001',
    horecaId: 1,
    lines: [
      { productId: 101, quantity: 5, unitPrice: 4.5 },
      { productId: 102, quantity: 2, unitPrice: 3 },
    ],
    pickingStarted: false,
    orderStatus: 'processing',
    ...over,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

describe('classifyInvoices', () => {
  it('keeps mapped lines and names the skipped ones', async () => {
    const verdict = await classifyOne(
      [ln(2, SAUCE, 5, 4.5), ln(3, PASTA, 3, 9), ln(4, MUSTARD, 2, 3), ln(5, FEE, 1, 10)],
      makeCtx(),
    )
    expect(verdict).toEqual({
      kind: 'add',
      invoiceNumber: 'INV-1001',
      invoiceDate: '2026-10-01',
      horecaId: 1,
      lines: [
        { productId: 101, quantity: 5, packSize: 12, unitPrice: 4.5, qbProductName: SAUCE },
        { productId: 102, quantity: 2, packSize: null, unitPrice: 3, qbProductName: MUSTARD },
      ],
      skippedLines: [PASTA, FEE],
      rowNumbers: [2, 3, 4, 5],
    })
  })

  it('rejects an unmapped line the tenant rule marks as its own', async () => {
    const verdict = await classifyOne(
      [ln(2, SAUCE, 5, 4.5), ln(3, 'Acme Chutney 200g', 1, 6)],
      makeCtx(),
    )
    const reasons = expectRejected(verdict)
    expect(mentions(reasons, 'Acme Chutney 200g')).toBe(true)
    expect(verdict.rowNumbers).toEqual([2, 3])
  })

  it('matches a customer despite spacing and case', async () => {
    const verdict = await classifyOne(
      [
        ln(2, SAUCE, 5, 4.5, { customerName: '  harbour   CAFE ' }),
        ln(3, MUSTARD, 2, 3, { customerName: 'HARBOUR\tcafe' }),
      ],
      makeCtx(),
    )
    expect(expectKind(verdict, 'add').horecaId).toBe(1)
  })

  it('rejects an unknown customer and a name close to a real one', async () => {
    const names = ['Unknown Bistro', "Harbour Cafe'", 'Harbour Cafes', 'Harbour']
    const verdicts = await classify(
      names.map((customerName, i) =>
        ln(i + 2, SAUCE, 1, 4.5, { customerName, invoiceNumber: `INV-${2000 + i}` }),
      ),
      makeCtx(),
    )
    expect(verdicts).toHaveLength(names.length)
    verdicts.forEach((verdict, i) => {
      const reasons = expectRejected(verdict)
      expect(reasonsMentioning(reasons, names[i], NO_MATCH_WORDING)).toHaveLength(1)
      expect(mentions(reasons, TWO_MATCHES_WORDING)).toBe(false)
    })
  })

  it('rejects when two customers match', async () => {
    const verdict = await classifyOne(
      [ln(2, SAUCE, 1, 4.5, { customerName: 'Corner Deli' })],
      makeCtx({
        customers: [
          { id: 7, name: 'Corner Deli' },
          { id: 8, name: ' corner   deli ' },
        ],
      }),
    )
    const reasons = expectRejected(verdict)
    expect(reasonsMentioning(reasons, 'Corner Deli', TWO_MATCHES_WORDING)).toHaveLength(1)
    expect(mentions(reasons, NO_MATCH_WORDING)).toBe(false)
  })

  it('skips an invoice with no mapped lines even for an unknown customer', async () => {
    const verdict = await classifyOne(
      [
        ln(2, PASTA, 3, 9, { customerName: 'Unknown Bistro' }),
        ln(3, FEE, 1, 10, { customerName: 'Unknown Bistro' }),
      ],
      makeCtx(),
    )
    expect(verdict).toEqual({
      kind: 'no_mapped_lines',
      invoiceNumber: 'INV-1001',
      skippedLines: [PASTA, FEE],
      rowNumbers: [2, 3],
    })
  })

  it('adds quantities for one product at one price', async () => {
    const verdict = await classifyOne(
      [ln(2, SAUCE, 5, 4.5), ln(3, MUSTARD, 1, 3), ln(4, SAUCE, 3, 4.5)],
      makeCtx(),
    )
    expect(expectKind(verdict, 'add').lines).toEqual([
      { productId: 101, quantity: 8, packSize: 12, unitPrice: 4.5, qbProductName: SAUCE },
      { productId: 102, quantity: 1, packSize: null, unitPrice: 3, qbProductName: MUSTARD },
    ])
  })

  it('rejects one product at two prices', async () => {
    const verdict = await classifyOne([ln(2, SAUCE, 5, 4.5), ln(3, SAUCE, 3, 4.75)], makeCtx())
    expect(mentions(expectRejected(verdict), SAUCE)).toBe(true)
  })

  it('rejects mixed customers, mixed dates, bad quantities, negative prices and bad invoice numbers', async () => {
    const mixedCustomers = [
      ln(2, SAUCE, 1, 4.5, { invoiceNumber: 'INV-3001', customerName: 'Harbour Cafe' }),
      ln(3, MUSTARD, 1, 3, { invoiceNumber: 'INV-3001', customerName: 'Corner Deli' }),
    ]
    const mixedDates = [
      ln(4, SAUCE, 1, 4.5, { invoiceNumber: 'INV-3002', invoiceDate: '2026-10-01' }),
      ln(5, MUSTARD, 1, 3, { invoiceNumber: 'INV-3002', invoiceDate: '2026-10-02' }),
    ]
    const badQuantities = [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((quantity, i) =>
      ln(10 + i, SAUCE, quantity, 4.5, { invoiceNumber: `INV-31${i}` }),
    )
    const badPrices = [-1, Number.NaN, Number.POSITIVE_INFINITY].map((price, i) =>
      ln(20 + i, SAUCE, 1, price, { invoiceNumber: `INV-32${i}` }),
    )
    const badNumbers = ['INV 1001', 'INV_1001', 'INV-', '-INV', 'INV--1', 'INV/1', 'INV-1001\n', ''].map(
      (invoiceNumber, i) => ln(30 + i, SAUCE, 1, 4.5, { invoiceNumber }),
    )

    const verdicts = await classify(
      [...mixedCustomers, ...mixedDates, ...badQuantities, ...badPrices, ...badNumbers],
      makeCtx(),
    )

    const [customers, dates, ...rest] = verdicts
    const customerReasons = expectRejected(customers)
    expect(mentions(customerReasons, 'Harbour Cafe')).toBe(true)
    expect(mentions(customerReasons, 'Corner Deli')).toBe(true)
    const dateReasons = expectRejected(dates)
    expect(mentions(dateReasons, '2026-10-01')).toBe(true)
    expect(mentions(dateReasons, '2026-10-02')).toBe(true)
    expect(rest).toHaveLength(badQuantities.length + badPrices.length + badNumbers.length)
    const valueVerdicts = rest.slice(0, badQuantities.length + badPrices.length)
    const numberVerdicts = rest.slice(badQuantities.length + badPrices.length)
    valueVerdicts.forEach((verdict) => {
      expect(mentions(expectRejected(verdict), SAUCE)).toBe(true)
    })
    numberVerdicts.forEach((verdict) => {
      expect(mentions(expectRejected(verdict), 'Invoice number')).toBe(true)
    })
  })

  it('marks an identical re-upload unchanged in any line order', async () => {
    const ctx = makeCtx({ storedImports: [stored()] })
    const forward = await classifyOne([ln(2, SAUCE, 5, 4.5), ln(3, MUSTARD, 2, 3)], ctx)
    const reversed = await classifyOne([ln(2, MUSTARD, 2, 3), ln(3, PASTA, 1, 9), ln(4, SAUCE, 5, 4.5)], ctx)
    expect(forward).toEqual({ kind: 'unchanged', invoiceNumber: 'INV-1001', skippedLines: [], rowNumbers: [2, 3] })
    expect(reversed).toEqual({
      kind: 'unchanged',
      invoiceNumber: 'INV-1001',
      skippedLines: [PASTA],
      rowNumbers: [2, 3, 4],
    })
  })

  it('reports added, removed and altered lines and a changed customer', async () => {
    const ctx = makeCtx({
      storedImports: [
        stored({
          lines: [
            { productId: 101, quantity: 5, unitPrice: 4.5 },
            { productId: 102, quantity: 2, unitPrice: 3 },
            { productId: 103, quantity: 1, unitPrice: 7 },
          ],
        }),
      ],
    })
    const verdict = await classifyOne(
      [
        ln(2, SAUCE, 6, 4.5, { customerName: 'Corner Deli' }),
        ln(3, MUSTARD, 2, 3.25, { customerName: 'Corner Deli' }),
        ln(4, PICKLE, 4, 8, { customerName: 'Corner Deli' }),
      ],
      ctx,
    )
    const changed = expectKind(verdict, 'changed')
    expect(changed.orderId).toBe('QB-INV-1001')
    expect(changed.horecaId).toBe(2)
    expect(changed.editable).toBe(true)
    expect(changed.lines.map((l) => l.productId)).toEqual([101, 102, 104])
    expect(changed.differences).toHaveLength(5)
    expect(changed.differences).toEqual(
      expect.arrayContaining([
        {
          kind: 'altered',
          productId: 101,
          qbProductName: SAUCE,
          from: { quantity: 5, unitPrice: 4.5 },
          to: { quantity: 6, unitPrice: 4.5 },
        },
        {
          kind: 'altered',
          productId: 102,
          qbProductName: MUSTARD,
          from: { quantity: 2, unitPrice: 3 },
          to: { quantity: 2, unitPrice: 3.25 },
        },
        { kind: 'added', productId: 104, qbProductName: PICKLE, quantity: 4, unitPrice: 8 },
        { kind: 'removed', productId: 103, quantity: 1, unitPrice: 7 },
        { kind: 'customer', fromHorecaId: 1, toHorecaId: 2 },
      ]),
    )
    expect(changed.rowNumbers).toEqual([2, 3, 4])
  })

  it('makes a changed invoice uneditable once picked or closed', async () => {
    const upload = [ln(2, SAUCE, 6, 4.5), ln(3, MUSTARD, 2, 3)]
    const cases: Array<[Partial<StoredImport>, boolean]> = [
      [{ pickingStarted: false, orderStatus: 'processing' }, true],
      [{ pickingStarted: false, orderStatus: 'processed' }, true],
      [{ pickingStarted: true, orderStatus: 'processing' }, false],
      [{ pickingStarted: true, orderStatus: 'processed' }, false],
      [{ pickingStarted: false, orderStatus: 'pending' }, false],
      [{ pickingStarted: false, orderStatus: 'shipped' }, false],
      [{ pickingStarted: false, orderStatus: 'delivered' }, false],
      [{ pickingStarted: false, orderStatus: 'cancelled' }, false],
    ]
    for (const [over, editable] of cases) {
      const verdict = await classifyOne(upload, makeCtx({ storedImports: [stored(over)] }))
      expect(expectKind(verdict, 'changed').editable, JSON.stringify(over)).toBe(editable)
    }
  })

  it('accounts for every line exactly once', async () => {
    const ctx = makeCtx({
      storedImports: [
        stored({ invoiceNumber: 'INV-5002', orderId: 'QB-INV-5002' }),
        stored({ invoiceNumber: 'INV-5003', orderId: 'QB-INV-5003' }),
        stored({ invoiceNumber: 'INV-5005', orderId: 'QB-INV-5005' }),
      ],
    })
    // Rows from different invoices are interleaved on purpose.
    const input = [
      ln(2, SAUCE, 5, 4.5, { invoiceNumber: 'INV-5001' }), // add
      ln(3, SAUCE, 5, 4.5, { invoiceNumber: 'INV-5002' }), // unchanged
      ln(4, PASTA, 1, 9, { invoiceNumber: 'INV-5004' }), // no_mapped_lines
      ln(5, SAUCE, 5, 4.5, { invoiceNumber: 'INV-5003' }), // changed
      ln(6, FEE, 1, 10, { invoiceNumber: 'INV-5005' }), // changed: mapped lines all gone
      ln(7, SAUCE, 0, 4.5, { invoiceNumber: 'INV-5006' }), // rejected
      ln(8, MUSTARD, 2, 3, { invoiceNumber: 'INV-5001' }),
      ln(9, MUSTARD, 2, 3, { invoiceNumber: 'INV-5002' }),
      ln(10, PASTA, 1, 9, { invoiceNumber: 'INV-5001' }),
      ln(11, 'Acme Chutney 200g', 1, 6, { invoiceNumber: 'INV-5007' }), // rejected
      ln(12, FEE, 1, 10, { invoiceNumber: 'INV-5004' }),
      ln(13, MUSTARD, 1, 3, { invoiceNumber: 'INV-5003' }),
      ln(14, SAUCE, 5, 4.5, { invoiceNumber: 'INV-5006' }),
      ln(15, SAUCE, 1, 4.5, { invoiceNumber: 'bad number' }), // rejected
    ]
    const verdicts = await classify(input, ctx)

    expect(verdicts.map((v) => v.invoiceNumber)).toEqual([
      'INV-5001',
      'INV-5002',
      'INV-5004',
      'INV-5003',
      'INV-5005',
      'INV-5006',
      'INV-5007',
      'bad number',
    ])
    expect(verdicts.map((v) => v.kind)).toEqual([
      'add',
      'unchanged',
      'no_mapped_lines',
      'changed',
      'changed',
      'rejected',
      'rejected',
      'rejected',
    ])
    verdicts.forEach((v) => expect(v.rowNumbers.length).toBeGreaterThan(0))
    const accounted = verdicts.flatMap((v) => v.rowNumbers)
    expect([...accounted].sort((a, b) => a - b)).toEqual(input.map((l) => l.rowNumber))
    expect(new Set(accounted).size).toBe(accounted.length)
    // Within one verdict the rows keep their input order.
    expect(verdicts[0].rowNumbers).toEqual([2, 8, 10])
  })

  describe('rules beyond the named cases', () => {
    it('still rejects an own unmapped line on an invoice that was imported before', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5), ln(3, MUSTARD, 2, 3), ln(4, 'Acme Chutney 200g', 1, 6)],
        makeCtx({ storedImports: [stored()] }),
      )
      expect(mentions(expectRejected(verdict), 'Acme Chutney 200g')).toBe(true)
    })

    it('still rejects an own unmapped line when nothing else on the invoice is mapped', async () => {
      const verdict = await classifyOne([ln(2, 'Acme Chutney 200g', 1, 6), ln(3, PASTA, 1, 9)], makeCtx())
      expect(mentions(expectRejected(verdict), 'Acme Chutney 200g')).toBe(true)
    })

    it('treats an invoice whose mapped lines have all gone as changed, not as nothing', async () => {
      const verdict = await classifyOne(
        [ln(2, PASTA, 3, 9, { customerName: 'Unknown Bistro' }), ln(3, FEE, 1, 10, { customerName: 'Unknown Bistro' })],
        makeCtx({ storedImports: [stored({ horecaId: 3 })] }),
      )
      const changed = expectKind(verdict, 'changed')
      expect(changed).toEqual({
        kind: 'changed',
        invoiceNumber: 'INV-1001',
        orderId: 'QB-INV-1001',
        horecaId: 3,
        lines: [],
        differences: [
          { kind: 'removed', productId: 101, quantity: 5, unitPrice: 4.5 },
          { kind: 'removed', productId: 102, quantity: 2, unitPrice: 3 },
        ],
        editable: false,
        skippedLines: [PASTA, FEE],
        rowNumbers: [2, 3],
      })
    })

    it('does not check customer, date, number or values on an invoice with no mapped lines', async () => {
      const verdict = await classifyOne(
        [
          ln(2, PASTA, -4, -9.5, { invoiceNumber: 'not a valid number!', customerName: 'Unknown Bistro', invoiceDate: '2026-10-01' }),
          ln(3, FEE, 0.5, Number.NaN, { invoiceNumber: 'not a valid number!', customerName: 'Other Place', invoiceDate: '2026-10-09' }),
        ],
        makeCtx(),
      )
      expect(verdict).toEqual({
        kind: 'no_mapped_lines',
        invoiceNumber: 'not a valid number!',
        skippedLines: [PASTA, FEE],
        rowNumbers: [2, 3],
      })
    })

    it('ignores quantity and price on lines it skips', async () => {
      const verdict = await classifyOne([ln(2, SAUCE, 5, 4.5), ln(3, PASTA, 0, -3)], makeCtx())
      expect(expectKind(verdict, 'add').skippedLines).toEqual([PASTA])
    })

    it('accepts a zero price', async () => {
      const verdict = await classifyOne([ln(2, SAUCE, 5, 0), ln(3, MUSTARD, 1, 0)], makeCtx())
      expect(expectKind(verdict, 'add').lines.map((l) => l.unitPrice)).toEqual([0, 0])
    })

    it('compares prices in cents, so float noise is not a second price', async () => {
      const verdict = await classifyOne([ln(2, SAUCE, 5, 0.1 + 0.2), ln(3, SAUCE, 3, 0.3)], makeCtx())
      expect(expectKind(verdict, 'add').lines).toHaveLength(1)
      const storedCtx = makeCtx({
        storedImports: [stored({ lines: [{ productId: 101, quantity: 8, unitPrice: 0.3 }] })],
      })
      const same = await classifyOne([ln(2, SAUCE, 5, 0.1 + 0.2), ln(3, SAUCE, 3, 0.3)], storedCtx)
      expect(same.kind).toBe('unchanged')
    })

    it('treats two prices a cent apart as two prices', async () => {
      const verdict = await classifyOne([ln(2, SAUCE, 5, 4.5), ln(3, SAUCE, 3, 4.51)], makeCtx())
      expect(mentions(expectRejected(verdict), SAUCE)).toBe(true)
    })

    it('returns nothing for no lines', async () => {
      expect(await classify([], makeCtx())).toEqual([])
    })

    it('gives one verdict per invoice even when its rows are not together', async () => {
      const verdicts = await classify(
        [
          ln(2, SAUCE, 1, 4.5, { invoiceNumber: 'INV-6002' }),
          ln(3, SAUCE, 1, 4.5, { invoiceNumber: 'INV-6001' }),
          ln(4, MUSTARD, 1, 3, { invoiceNumber: 'INV-6002' }),
        ],
        makeCtx(),
      )
      expect(verdicts.map((v) => [v.invoiceNumber, v.rowNumbers])).toEqual([
        ['INV-6002', [2, 4]],
        ['INV-6001', [3]],
      ])
    })

    it('collects every rejection reason, not just the first', async () => {
      const verdict = await classifyOne(
        [
          ln(2, SAUCE, 0, 4.5, { invoiceNumber: 'INV 7', customerName: 'Unknown Bistro', invoiceDate: '2026-10-01' }),
          ln(3, MUSTARD, 1.5, -1, { invoiceNumber: 'INV 7', customerName: 'Corner Deli', invoiceDate: '2026-10-02' }),
          ln(4, 'Acme Chutney 200g', 1, 6, { invoiceNumber: 'INV 7' }),
        ],
        makeCtx(),
      )
      const reasons = expectRejected(verdict)
      expect(mentions(reasons, 'INV 7')).toBe(true)
      expect(mentions(reasons, 'Unknown Bistro')).toBe(true)
      expect(mentions(reasons, 'more than one customer')).toBe(true)
      expect(mentions(reasons, '2026-10-02')).toBe(true)
      expect(mentions(reasons, 'Acme Chutney 200g')).toBe(true)
      expect(mentions(reasons, SAUCE)).toBe(true)
      expect(mentions(reasons, MUSTARD)).toBe(true)
      expect(reasons.length).toBeGreaterThanOrEqual(7)
    })

    it('rejects a bad line even when the invoice was imported before', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, -5, 4.5), ln(3, MUSTARD, 2, 3)],
        makeCtx({ storedImports: [stored()] }),
      )
      expect(mentions(expectRejected(verdict), SAUCE)).toBe(true)
    })

    it('rejects a blank customer name and never matches it to a blank customer', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 1, 4.5, { customerName: '   ' })],
        makeCtx({ customers: [...CUSTOMERS, { id: 9, name: '' }] }),
      )
      expect(mentions(expectRejected(verdict), 'blank')).toBe(true)
    })

    it('rejects a product name that two map rows share, rather than choosing one', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5)],
        makeCtx({
          productMap: [...PRODUCT_MAP, { qbName: ' acme  SAUCE 500g', productId: 999, packSize: null }],
        }),
      )
      expect(mentions(expectRejected(verdict), SAUCE)).toBe(true)
    })

    it('does not let an ambiguous map row slip an invoice into no_mapped_lines', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5, { customerName: 'Unknown Bistro' })],
        makeCtx({
          productMap: [
            { qbName: SAUCE, productId: 101, packSize: 12 },
            { qbName: SAUCE.toUpperCase(), productId: 102, packSize: 12 },
          ],
        }),
      )
      expect(verdict.kind).toBe('rejected')
    })

    it('adds two QuickBooks names for one product at one price', async () => {
      const productMap: ProductMapRow[] = [
        { qbName: SAUCE, productId: 101, packSize: 12 },
        { qbName: 'Acme Sauce 500g Case', productId: 101, packSize: 12 },
      ]
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5), ln(3, 'Acme Sauce 500g Case', 2, 4.5)],
        makeCtx({ productMap }),
      )
      expect(expectKind(verdict, 'add').lines).toEqual([
        { productId: 101, quantity: 7, packSize: 12, unitPrice: 4.5, qbProductName: SAUCE },
      ])
    })

    it('rejects two QuickBooks names for one product with different pack sizes', async () => {
      const productMap: ProductMapRow[] = [
        { qbName: SAUCE, productId: 101, packSize: 12 },
        { qbName: 'Acme Sauce 500g Single', productId: 101, packSize: null },
      ]
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5), ln(3, 'Acme Sauce 500g Single', 2, 4.5)],
        makeCtx({ productMap }),
      )
      const reasons = expectRejected(verdict)
      expect(mentions(reasons, SAUCE)).toBe(true)
      expect(mentions(reasons, 'Acme Sauce 500g Single')).toBe(true)
    })

    it('rejects two QuickBooks names for one product at two prices', async () => {
      const productMap: ProductMapRow[] = [
        { qbName: SAUCE, productId: 101, packSize: 12 },
        { qbName: 'Acme Sauce 500g Case', productId: 101, packSize: 12 },
      ]
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5), ln(3, 'Acme Sauce 500g Case', 2, 5)],
        makeCtx({ productMap }),
      )
      expect(expectRejected(verdict).length).toBeGreaterThan(0)
    })

    it('matches a product name despite spacing and case, but not past punctuation', async () => {
      const matched = await classifyOne([ln(2, '  acme   SAUCE 500G ', 5, 4.5)], makeCtx())
      expect(expectKind(matched, 'add').lines[0].productId).toBe(101)
      const near = await classifyOne([ln(2, 'Acme Sauce 500g.', 5, 4.5)], makeCtx())
      expect(mentions(expectRejected(near), 'Acme Sauce 500g.')).toBe(true)
    })

    it('reports a customer change alone when the lines are identical', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5, { customerName: 'Pier Bistro' }), ln(3, MUSTARD, 2, 3, { customerName: 'Pier Bistro' })],
        makeCtx({ storedImports: [stored()] }),
      )
      const changed = expectKind(verdict, 'changed')
      expect(changed.differences).toEqual([{ kind: 'customer', fromHorecaId: 1, toHorecaId: 3 }])
      expect(changed.horecaId).toBe(3)
    })

    it('carries skipped lines on changed and unchanged verdicts', async () => {
      const upload = [ln(2, SAUCE, 5, 4.5), ln(3, MUSTARD, 2, 3), ln(4, PASTA, 1, 9)]
      const unchanged = await classifyOne(upload, makeCtx({ storedImports: [stored()] }))
      expect(expectKind(unchanged, 'unchanged').skippedLines).toEqual([PASTA])
      const changed = await classifyOne(
        upload,
        makeCtx({ storedImports: [stored({ lines: [{ productId: 101, quantity: 1, unitPrice: 4.5 }] })] }),
      )
      expect(expectKind(changed, 'changed').skippedLines).toEqual([PASTA])
    })

    it('only looks up a stored import by the invoice number', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5), ln(3, MUSTARD, 2, 3)],
        makeCtx({ storedImports: [stored({ invoiceNumber: 'INV-9999' })] }),
      )
      expect(verdict.kind).toBe('add')
    })

    it('does not change its inputs', async () => {
      const lines = [
        ln(2, SAUCE, 5, 4.5),
        ln(3, SAUCE, 3, 4.5),
        ln(4, PASTA, 1, 9),
        ln(5, MUSTARD, 2, 3, { invoiceNumber: 'INV-8002', customerName: 'Corner Deli' }),
        ln(6, SAUCE, 0, 4.5, { invoiceNumber: 'INV-8003' }),
      ]
      const ctx = makeCtx({ storedImports: [stored({ invoiceNumber: 'INV-8002', orderId: 'QB-INV-8002' })] })
      const before = JSON.stringify({ lines, ctx })
      deepFreeze(lines)
      deepFreeze(ctx)
      const verdicts = await classify(lines, ctx)
      expect(verdicts).toHaveLength(3)
      expect(JSON.stringify({ lines, ctx })).toBe(before)
    })

    it('leaves the decision about what is "own" to isOwnProductName alone', async () => {
      const upload = [ln(2, SAUCE, 5, 4.5), ln(3, 'Acme Chutney 200g', 1, 6), ln(4, PASTA, 1, 9)]

      const never = vi.fn(() => false)
      const skipsEverything = await classifyOne(upload, makeCtx({ isOwnProductName: never }))
      expect(expectKind(skipsEverything, 'add').skippedLines).toEqual(['Acme Chutney 200g', PASTA])

      const onlyZenith = vi.fn((name: string) => name.startsWith('Zenith'))
      const rejectsZenith = await classifyOne(upload, makeCtx({ isOwnProductName: onlyZenith }))
      const reasons = expectRejected(rejectsZenith)
      expect(mentions(reasons, PASTA)).toBe(true)
      expect(mentions(reasons, 'Acme Chutney 200g')).toBe(false)

      // The rule sees each unmapped name as written, and is never asked about a mapped one.
      expect(onlyZenith.mock.calls.map(([name]) => name)).toEqual(['Acme Chutney 200g', PASTA])
    })

    it('is a pure module with no brand, platform or clock in it', () => {
      const source = readFileSync(
        join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'qbImport', 'classifyInvoices.ts'),
        'utf8',
      )
      const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line))
      expect(importLines.every((line) => line.startsWith('import type '))).toBe(true)
      expect(source).not.toMatch(/\bDeno\b|\bfetch\s*\(|Date\.now|new Date|Math\.random/)
      // The only brand-like string in these tests is the stand-in below; the rule must come from the caller.
      expect(source.toLowerCase()).not.toContain('acme')
    })
  })

  describe('stored prices, invoice numbers and dates', () => {
    const TWO_PRICES = [
      { productId: 101, quantity: 2, unitPrice: 1 },
      { productId: 101, quantity: 3, unitPrice: 2 },
    ]

    it('never calls a stored product held at two prices unchanged, whichever price is uploaded', async () => {
      const ctx = makeCtx({ storedImports: [stored({ lines: TWO_PRICES })] })
      for (const price of [1, 2]) {
        const verdict = await classifyOne([ln(2, SAUCE, 5, price)], ctx)
        const changed = expectKind(verdict, 'changed')
        expect(changed.lines).toEqual([
          { productId: 101, quantity: 5, packSize: 12, unitPrice: price, qbProductName: SAUCE },
        ])
        expect(changed.differences).toHaveLength(3)
        expect(changed.differences).toEqual(
          expect.arrayContaining([
            { kind: 'removed', productId: 101, quantity: 2, unitPrice: 1 },
            { kind: 'removed', productId: 101, quantity: 3, unitPrice: 2 },
            { kind: 'added', productId: 101, qbProductName: SAUCE, quantity: 5, unitPrice: price },
          ]),
        )
      }
    })

    it('reports each stored price when the file drops a product held at two prices', async () => {
      const ctx = makeCtx({
        storedImports: [stored({ lines: [...TWO_PRICES, { productId: 102, quantity: 2, unitPrice: 3 }] })],
      })
      const verdict = await classifyOne([ln(2, MUSTARD, 2, 3)], ctx)
      const changed = expectKind(verdict, 'changed')
      expect(changed.differences).toHaveLength(2)
      expect(changed.differences).toEqual(
        expect.arrayContaining([
          { kind: 'removed', productId: 101, quantity: 2, unitPrice: 1 },
          { kind: 'removed', productId: 101, quantity: 3, unitPrice: 2 },
        ]),
      )
    })

    it('still adds up stored lines of one product that share a price in cents', async () => {
      const ctx = makeCtx({
        storedImports: [
          stored({
            lines: [
              { productId: 101, quantity: 2, unitPrice: 0.3 },
              { productId: 101, quantity: 3, unitPrice: 0.1 + 0.2 },
            ],
          }),
        ],
      })
      const verdict = await classifyOne([ln(2, SAUCE, 5, 0.3)], ctx)
      expect(verdict.kind).toBe('unchanged')
    })

    it('quotes the invoice number exactly as written when it rejects it', async () => {
      for (const invoiceNumber of ['INV-1001\n', 'INV-1001 ', ' INV-1001', 'INV-1001\t']) {
        const verdict = await classifyOne([ln(2, SAUCE, 1, 4.5, { invoiceNumber })], makeCtx())
        const reasons = expectRejected(verdict)
        expect(mentions(reasons, `Invoice number "${invoiceNumber}"`), JSON.stringify(invoiceNumber)).toBe(true)
      }
    })

    it('rejects a date that is not a real YYYY-MM-DD on an invoice with mapped lines', async () => {
      const bad = [
        '',
        '   ',
        '2026-13-01',
        '2026-00-10',
        '2026-10-00',
        '2026-02-30',
        '2025-02-29',
        '1900-02-29',
        '2100-02-29',
        '2026-04-31',
        '2026-2-3',
        '01/10/2026',
        '2026-10-01T00:00:00',
        '20261001',
        '0000-01-01',
        'yesterday',
      ]
      const verdicts = await classify(
        bad.map((invoiceDate, i) =>
          ln(i + 2, SAUCE, 1, 4.5, { invoiceNumber: `INV-4${String(i).padStart(3, '0')}`, invoiceDate }),
        ),
        makeCtx(),
      )
      expect(verdicts).toHaveLength(bad.length)
      verdicts.forEach((verdict, i) => {
        expect(mentions(expectRejected(verdict), 'Invoice date'), JSON.stringify(bad[i])).toBe(true)
      })
    })

    it('accepts real dates, including 29 February in a leap year, and keeps the date trimmed', async () => {
      const good = ['2026-10-01', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01']
      const verdicts = await classify(
        [
          ...good.map((invoiceDate, i) =>
            ln(i + 2, SAUCE, 1, 4.5, { invoiceNumber: `INV-5${i}`, invoiceDate }),
          ),
          ln(20, SAUCE, 1, 4.5, { invoiceNumber: 'INV-59', invoiceDate: ' 2026-10-01 ' }),
        ],
        makeCtx(),
      )
      expect(verdicts.map((v) => expectKind(v, 'add').invoiceDate)).toEqual([...good, '2026-10-01'])
    })

    it('rejects a bad date on an invoice that was imported before, when it has mapped lines', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5, { invoiceDate: '' }), ln(3, MUSTARD, 2, 3, { invoiceDate: '' })],
        makeCtx({ storedImports: [stored()] }),
      )
      expect(mentions(expectRejected(verdict), 'Invoice date')).toBe(true)
    })

    it('reports a bad date alongside mixed dates', async () => {
      const verdict = await classifyOne(
        [ln(2, SAUCE, 5, 4.5, { invoiceDate: '' }), ln(3, MUSTARD, 2, 3, { invoiceDate: '2026-10-01' })],
        makeCtx(),
      )
      const reasons = expectRejected(verdict)
      expect(mentions(reasons, 'more than one invoice date')).toBe(true)
      expect(mentions(reasons, 'Invoice date ""')).toBe(true)
    })

    it('does not check the date of an invoice with no mapped lines', async () => {
      const upload = [ln(2, PASTA, 3, 9, { invoiceDate: '' }), ln(3, FEE, 1, 10, { invoiceDate: 'yesterday' })]
      const unknown = await classifyOne(upload, makeCtx())
      expect(unknown.kind).toBe('no_mapped_lines')
      const imported = await classifyOne(upload, makeCtx({ storedImports: [stored()] }))
      expect(imported.kind).toBe('changed')
    })

    it('calls a stored import with no lines unchanged when the file has no mapped lines', async () => {
      const verdict = await classifyOne([ln(2, PASTA, 3, 9)], makeCtx({ storedImports: [stored({ lines: [] })] }))
      expect(verdict).toEqual({
        kind: 'unchanged',
        invoiceNumber: 'INV-1001',
        skippedLines: [PASTA],
        rowNumbers: [2],
      })
    })

    it('reports added lines for a stored import with no lines when the file has mapped lines', async () => {
      const verdict = await classifyOne([ln(2, SAUCE, 5, 4.5)], makeCtx({ storedImports: [stored({ lines: [] })] }))
      const changed = expectKind(verdict, 'changed')
      expect(changed.differences).toEqual([
        { kind: 'added', productId: 101, qbProductName: SAUCE, quantity: 5, unitPrice: 4.5 },
      ])
    })
  })
})
