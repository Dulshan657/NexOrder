import { describe, expect, it, vi } from 'vitest'

import type { StoredImport } from '../../supabase/functions/_shared/qbImport/classifyInvoices'
import {
  buildOwnProductRule,
  runImport,
  type ImportDeps,
  type ImportFacts,
  type ImportOk,
  type ImportResponse,
  type InvoiceWrite,
} from '../../supabase/functions/_shared/qbImport/runImport'

const HEADER = 'Invoice Number,Invoice Date,Customer,Product,Quantity,Unit Price'
const csv = (...rows: string[]): string => [HEADER, ...rows].join('\n')

const WIDGET_A = 'INV-1,05/03/2026,Harbour Bistro,Widget,3,2.50'
const WIDGET_A_CHANGED = 'INV-1,05/03/2026,Harbour Bistro,Widget,9,2.50'
const WIDGET_B = 'INV-2,06/03/2026,Harbour Bistro,Widget,4,2.50'

const FACTS: ImportFacts = {
  customers: [{ id: 7, name: 'Harbour Bistro' }],
  productMap: [{ qbName: 'Widget', productId: 11, packSize: 12 }],
  storedImports: [],
  storedFlags: [],
  ownProductPrefixes: [],
  ownProductTerms: [],
}

function storedFor(partial: Partial<StoredImport> = {}): StoredImport {
  return {
    invoiceNumber: 'INV-1',
    orderId: 'QB-INV-1',
    horecaId: 7,
    lines: [{ productId: 11, quantity: 3, unitPrice: 2.5 }],
    pickingStarted: false,
    orderStatus: 'processed',
    ...partial,
  }
}

function makeDeps(facts: Partial<ImportFacts> = {}, overrides: Partial<ImportDeps> = {}) {
  return {
    loadFacts: vi.fn(async () => ({ ...FACTS, ...facts })),
    importInvoice: vi.fn(async ({ invoiceNumber }: InvoiceWrite) => ({
      status: 'created' as const,
      orderId: `QB-${invoiceNumber}`,
    })),
    updateInvoice: vi.fn(async ({ invoiceNumber }: InvoiceWrite) => ({
      status: 'updated' as const,
      orderId: `QB-${invoiceNumber}`,
    })),
    flagChange: vi.fn(async () => undefined),
    clearFlag: vi.fn(async () => undefined),
    advanceToProcessed: vi.fn(async () => ({ ok: true as const })),
    logError: vi.fn(),
    ...overrides,
  } as unknown as { [K in keyof ImportDeps]-?: ReturnType<typeof vi.fn> } & ImportDeps
}

const WRITES = ['importInvoice', 'updateInvoice', 'flagChange', 'clearFlag', 'advanceToProcessed'] as const

const ALTERED_TO_9 = {
  kind: 'altered',
  productId: 11,
  qbProductName: 'Widget',
  from: { quantity: 3, unitPrice: 2.5 },
  to: { quantity: 9, unitPrice: 2.5 },
}

function okResponse(response: ImportResponse): ImportOk {
  if (response.status !== 'ok') throw new Error('expected ok')
  return response
}

const commit = async (deps: ImportDeps, csvText: string, applyChanges?: string[]) =>
  okResponse(await runImport({ action: 'commit', csvText, applyChanges, actorRole: 'Admin' }, deps))

const preview = async (deps: ImportDeps, csvText: string) =>
  okResponse(await runImport({ action: 'preview', csvText, actorRole: 'Manager' }, deps))

const resultOf = (response: ImportOk, invoiceNumber: string) =>
  response.results?.find((result) => result.invoiceNumber === invoiceNumber)

describe('runImport', () => {
  it('rejects a whole invoice that has a bad row', async () => {
    const deps = makeDeps()
    const text = csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,Widget,lots,2.50', WIDGET_B)

    const seen = await preview(deps, text)
    expect(seen.counts).toMatchObject({ added: 1, rejected: 1 })
    const rejected = seen.verdicts.find((verdict) => verdict.invoiceNumber === 'INV-1')
    expect(rejected).toMatchObject({ kind: 'rejected', rowNumbers: [2, 3] })
    expect(rejected?.kind === 'rejected' && rejected.reasons.join(' ')).toContain('Row 3')

    const done = await commit(deps, text)
    expect(deps.importInvoice).toHaveBeenCalledTimes(1)
    expect(deps.importInvoice.mock.calls[0][0]).toMatchObject({ invoiceNumber: 'INV-2' })
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'rejected' })
  })

  it('refuses any role but Admin and Manager', async () => {
    for (const role of ['Warehouse', 'Field Sales Rep', 'Office Sales Rep', 'Restaurant/Hotel Customer', 'QR Staff', '']) {
      const deps = makeDeps()
      const response = await runImport({ action: 'commit', csvText: csv(WIDGET_A), actorRole: role }, deps)
      expect(response.status, role).toBe('forbidden')
      expect(deps.loadFacts).not.toHaveBeenCalled()
      expect(deps.importInvoice).not.toHaveBeenCalled()
    }
    for (const role of ['Admin', 'Manager']) {
      const response = await runImport({ action: 'preview', csvText: csv(WIDGET_A), actorRole: role }, makeDeps())
      expect(response.status, role).toBe('ok')
    }
  })

  it('commit classifies again rather than trusting the preview', async () => {
    const empty = makeDeps()
    const seen = await preview(empty, csv(WIDGET_A))
    expect(seen.counts.added).toBe(1)
    for (const write of WRITES) expect(empty[write], write).not.toHaveBeenCalled()

    // Between preview and confirm, another upload imported the invoice.
    const later = makeDeps({ storedImports: [storedFor()] })
    const done = await commit(later, csv(WIDGET_A))
    expect(later.loadFacts).toHaveBeenCalledTimes(1)
    expect(later.importInvoice).not.toHaveBeenCalled()
    expect(done.counts).toMatchObject({ added: 0, unchanged: 1 })
  })

  it('a failure on one invoice leaves the others committed and reports it', async () => {
    const deps = makeDeps(
      {},
      {
        importInvoice: vi.fn(async ({ invoiceNumber }: InvoiceWrite) => {
          if (invoiceNumber === 'INV-1') throw new Error('QB_PRODUCT_NOT_FOUND: product 11 does not exist')
          return { status: 'created' as const, orderId: `QB-${invoiceNumber}` }
        }),
      },
    )
    const done = await commit(deps, csv(WIDGET_A, WIDGET_B))

    expect(deps.importInvoice).toHaveBeenCalledTimes(2)
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'failed' })
    expect(resultOf(done, 'INV-1')?.message).not.toContain('QB_')
    expect(resultOf(done, 'INV-2')).toMatchObject({ outcome: 'added', orderId: 'QB-INV-2' })
  })

  it('uploading the same file twice adds nothing', async () => {
    const stored: StoredImport[] = []
    const deps = makeDeps(
      {},
      {
        loadFacts: vi.fn(async () => ({ ...FACTS, storedImports: [...stored] })),
        importInvoice: vi.fn(async ({ invoiceNumber }: InvoiceWrite) => {
          stored.push(storedFor({ invoiceNumber, orderId: `QB-${invoiceNumber}` }))
          return { status: 'created' as const, orderId: `QB-${invoiceNumber}` }
        }),
      },
    )

    await commit(deps, csv(WIDGET_A))
    expect(deps.importInvoice).toHaveBeenCalledTimes(1)
    const second = await commit(deps, csv(WIDGET_A))
    expect(deps.importInvoice).toHaveBeenCalledTimes(1)
    expect(deps.advanceToProcessed).toHaveBeenCalledTimes(1)
    expect(resultOf(second, 'INV-1')).toMatchObject({ outcome: 'unchanged' })
  })

  it('does not count a race the transaction caught as an added order', async () => {
    const deps = makeDeps(
      {},
      { importInvoice: vi.fn(async () => ({ status: 'already_imported' as const, orderId: 'QB-INV-1' })) },
    )
    const done = await commit(deps, csv(WIDGET_A))
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'unchanged', orderId: 'QB-INV-1' })
    expect(deps.advanceToProcessed).not.toHaveBeenCalled()
  })

  it('moves a new order to processed with a fulfilment', async () => {
    const deps = makeDeps()
    const done = await commit(deps, csv(WIDGET_A))

    expect(deps.importInvoice).toHaveBeenCalledWith({
      invoiceNumber: 'INV-1',
      horecaId: 7,
      invoiceDate: '2026-03-05',
      lines: [{ productId: 11, quantity: 3, packSize: 12, unitPrice: 2.5, qbProductName: 'Widget' }],
    })
    expect(deps.advanceToProcessed).toHaveBeenCalledWith('QB-INV-1')
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'added', orderId: 'QB-INV-1' })
  })

  it('reports an order it created but could not advance, and says the next upload finishes it', async () => {
    const deps = makeDeps({}, { advanceToProcessed: vi.fn(async () => ({ ok: false as const, code: 'NO_FULFILMENT' })) })
    const done = await commit(deps, csv(WIDGET_A))
    const result = resultOf(done, 'INV-1')
    expect(result).toMatchObject({ outcome: 'failed', orderId: 'QB-INV-1' })
    expect(result?.message).toMatch(/upload/i)
    expect(done.resultCounts?.failed).toBe(1)
  })

  it('reports an advance that threw exactly like one that was refused', async () => {
    const deps = makeDeps(
      {},
      {
        advanceToProcessed: vi.fn(async () => {
          throw new Error('order_set_status_tx failed: connection reset')
        }),
      },
    )
    const done = await commit(deps, csv(WIDGET_A, WIDGET_B))
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'failed', orderId: 'QB-INV-1' })
    expect(resultOf(done, 'INV-1')?.message).not.toContain('connection reset')
    expect(deps.importInvoice).toHaveBeenCalledTimes(2)
  })

  it('the next upload finishes an order stuck in processing', async () => {
    const deps = makeDeps({ storedImports: [storedFor({ orderStatus: 'processing' })] })

    const seen = await preview(deps, csv(WIDGET_A))
    expect(seen.unfinishedInvoices).toEqual(['INV-1'])
    expect(deps.advanceToProcessed).not.toHaveBeenCalled()

    const done = await commit(deps, csv(WIDGET_A))
    expect(deps.importInvoice).not.toHaveBeenCalled()
    expect(deps.advanceToProcessed).toHaveBeenCalledWith('QB-INV-1')
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'finished', orderId: 'QB-INV-1' })
  })

  it('leaves an unchanged order alone once it has moved on', async () => {
    for (const orderStatus of ['processed', 'picked', 'cancelled']) {
      const deps = makeDeps({ storedImports: [storedFor({ orderStatus })] })
      await commit(deps, csv(WIDGET_A))
      expect(deps.advanceToProcessed, orderStatus).not.toHaveBeenCalled()
    }
  })

  it('updates a changed invoice only when selected and editable', async () => {
    const changed = csv(WIDGET_A_CHANGED)
    const facts = { storedImports: [storedFor()] }

    const unselected = makeDeps(facts)
    await commit(unselected, changed)
    expect(unselected.updateInvoice).not.toHaveBeenCalled()
    expect(unselected.flagChange).toHaveBeenCalledTimes(1)

    const selected = makeDeps(facts)
    const done = await commit(selected, changed, ['INV-1'])
    expect(selected.updateInvoice).toHaveBeenCalledWith({
      invoiceNumber: 'INV-1',
      horecaId: 7,
      invoiceDate: '2026-03-05',
      lines: [{ productId: 11, quantity: 9, packSize: 12, unitPrice: 2.5, qbProductName: 'Widget' }],
    })
    expect(selected.flagChange).not.toHaveBeenCalled()
    expect(selected.advanceToProcessed).not.toHaveBeenCalled()
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'updated' })
  })

  it('finishes a stuck order once its selected change is applied', async () => {
    const deps = makeDeps({ storedImports: [storedFor({ orderStatus: 'processing' })] })
    const done = await commit(deps, csv(WIDGET_A_CHANGED), ['INV-1'])
    expect(deps.updateInvoice).toHaveBeenCalledTimes(1)
    expect(deps.advanceToProcessed).toHaveBeenCalledWith('QB-INV-1')
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'updated' })
  })

  it('flags a changed invoice it may not update and never edits the order', async () => {
    const deps = makeDeps({ storedImports: [storedFor({ pickingStarted: true })] })
    const done = await commit(deps, csv(WIDGET_A_CHANGED), ['INV-1'])

    expect(deps.updateInvoice).not.toHaveBeenCalled()
    expect(deps.advanceToProcessed).not.toHaveBeenCalled()
    expect(deps.flagChange).toHaveBeenCalledWith('INV-1', [
      {
        kind: 'altered',
        productId: 11,
        qbProductName: 'Widget',
        from: { quantity: 3, unitPrice: 2.5 },
        to: { quantity: 9, unitPrice: 2.5 },
      },
    ])
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'flagged' })
  })

  it('does not advance a stuck order whose change was only flagged, and says what would', async () => {
    const deps = makeDeps({ storedImports: [storedFor({ orderStatus: 'processing' })] })
    const done = await commit(deps, csv(WIDGET_A_CHANGED))
    expect(deps.advanceToProcessed).not.toHaveBeenCalled()
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'flagged' })
    expect(resultOf(done, 'INV-1')?.message).toMatch(/pick queue/i)
  })

  it('reports a failure to store a flag per invoice and carries on', async () => {
    const deps = makeDeps(
      { storedImports: [storedFor()] },
      {
        flagChange: vi.fn(async () => {
          throw new Error('update failed')
        }),
      },
    )
    const done = await commit(deps, csv(WIDGET_A_CHANGED, WIDGET_B))
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'failed' })
    expect(resultOf(done, 'INV-2')).toMatchObject({ outcome: 'added' })
  })

  it('reports a refusal from the transaction per invoice, stores the differences and carries on', async () => {
    const deps = makeDeps(
      { storedImports: [storedFor()] },
      { updateInvoice: vi.fn(async () => ({ status: 'refused' as const, reason: 'picking_started' })) },
    )
    const done = await commit(deps, csv(WIDGET_A_CHANGED, WIDGET_B), ['INV-1'])

    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'refused' })
    expect(resultOf(done, 'INV-1')?.message).toMatch(/pick/i)
    expect(deps.flagChange).toHaveBeenCalledTimes(1)
    expect(resultOf(done, 'INV-2')).toMatchObject({ outcome: 'added' })
  })

  it('gives the office a plain message for a coded error', async () => {
    const deps = makeDeps(
      { storedImports: [storedFor()] },
      {
        updateInvoice: vi.fn(async () => {
          throw new Error('QB_ALLOCATION_MISMATCH: order QB-INV-1 nets 3 of product 11 at location 2 but the bin holds 1 with 0 held by other orders')
        }),
      },
    )
    const done = await commit(deps, csv(WIDGET_A_CHANGED), ['INV-1'])
    const result = resultOf(done, 'INV-1')
    expect(result).toMatchObject({ outcome: 'failed' })
    expect(result?.message).toMatch(/warehouse/i)
    expect(result?.message).not.toMatch(/QB_|location 2/)
    expect(deps.logError).toHaveBeenCalled()
  })

  it('does not pass a database error through to the screen', async () => {
    const deps = makeDeps(
      {},
      {
        importInvoice: vi.fn(async () => {
          throw new Error('permission denied for table secret_stuff')
        }),
      },
    )
    const done = await commit(deps, csv(WIDGET_A))
    expect(resultOf(done, 'INV-1')?.message).not.toContain('secret_stuff')
  })

  it('applies the stored own-product rule, and skips and names a line with no rule', async () => {
    const text = csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,Acme Sprocket,1,9.00')

    const noRule = await preview(makeDeps(), text)
    expect(noRule.counts).toMatchObject({ added: 1, rejected: 0, skipped: 1 })
    expect(noRule.skippedLines).toEqual([{ invoiceNumber: 'INV-1', name: 'Acme Sprocket' }])

    const byPrefix = await preview(makeDeps({ ownProductPrefixes: ['  ACME '] }), text)
    expect(byPrefix.counts).toMatchObject({ added: 0, rejected: 1 })
    const verdict = byPrefix.verdicts[0]
    expect(verdict.kind === 'rejected' && verdict.reasons.join(' ')).toContain('Acme Sprocket')

    const byTerm = await preview(makeDeps({ ownProductTerms: ['sprock'] }), text)
    expect(byTerm.counts).toMatchObject({ added: 0, rejected: 1 })
  })

  it('builds the own-product rule trimmed and case-insensitive, and blank entries match nothing', () => {
    const rule = buildOwnProductRule(['  ACME '], [' Sprock'])
    expect(rule('acme thing')).toBe(true)
    expect(rule('  Acme Thing')).toBe(true)
    expect(rule('A Big SPROCKET')).toBe(true)
    expect(rule('Other Brand')).toBe(false)
    expect(rule('thing acme')).toBe(false)

    expect(buildOwnProductRule([], [])('anything')).toBe(false)
    expect(buildOwnProductRule(['', '  '], ['', ' '])('anything')).toBe(false)
  })

  it('gives one result for a row written the way Excel text is and the way a CSV is', async () => {
    const asExcel = await preview(makeDeps(), csv('INV-1,2026-03-05,Harbour Bistro,Widget,3,2.5'))
    const asCsv = await preview(makeDeps(), csv('"INV-1",05/03/2026,"Harbour Bistro",Widget,3,$2.50'))
    expect(asExcel.verdicts).toEqual(asCsv.verdicts)
  })

  it('a stored flagged_change is replaced, not stacked', async () => {
    const store = new Map<string, unknown>()
    const deps = makeDeps(
      { storedImports: [storedFor({ pickingStarted: true })] },
      {
        flagChange: vi.fn(async (invoiceNumber: string, differences: unknown) => {
          store.set(invoiceNumber, differences)
        }),
      },
    )
    await commit(deps, csv(WIDGET_A_CHANGED))
    await commit(deps, csv('INV-1,05/03/2026,Harbour Bistro,Widget,5,2.50'))

    expect(deps.flagChange.mock.calls[1][1]).toHaveLength(1)
    expect(store.get('INV-1')).toEqual([
      {
        kind: 'altered',
        productId: 11,
        qbProductName: 'Widget',
        from: { quantity: 3, unitPrice: 2.5 },
        to: { quantity: 5, unitPrice: 2.5 },
      },
    ])
  })

  it('applyChanges naming a non-editable or unknown invoice is ignored and reported', async () => {
    const deps = makeDeps({
      storedImports: [storedFor({ pickingStarted: true }), storedFor({ invoiceNumber: 'INV-3', orderId: 'QB-INV-3' })],
    })
    const done = await commit(
      deps,
      csv(WIDGET_A_CHANGED, 'INV-3,05/03/2026,Harbour Bistro,Widget,3,2.50', WIDGET_B),
      ['INV-1', 'NOPE-9', 'INV-3', 'INV-2'],
    )

    expect(deps.updateInvoice).not.toHaveBeenCalled()
    expect(deps.flagChange).toHaveBeenCalledTimes(1)
    expect(done.ignoredApplyChanges?.map((entry) => entry.invoiceNumber).sort()).toEqual(['INV-1', 'INV-2', 'INV-3', 'NOPE-9'])
    expect(deps.importInvoice).toHaveBeenCalledTimes(1)
  })

  it('reads a file of only other-brand invoices as nothing to do, naming every line', async () => {
    const deps = makeDeps()
    const text = csv('INV-8,05/03/2026,Harbour Bistro,Other Brand Cola,5,1.00', 'INV-9,05/03/2026,,Other Brand Lime,-5,1.00')

    const seen = await preview(deps, text)
    expect(seen.counts).toEqual({ added: 0, unchanged: 0, changed: 0, skipped: 2, rejected: 0 })
    expect(seen.skippedLines.map((line) => line.name)).toEqual(['Other Brand Cola', 'Other Brand Lime'])

    const done = await commit(deps, text)
    for (const write of WRITES) expect(deps[write], write).not.toHaveBeenCalled()
    expect(resultOf(done, 'INV-8')).toMatchObject({ outcome: 'skipped' })
  })

  it('refuses an empty file without loading anything or writing', async () => {
    const deps = makeDeps()
    const done = await commit(deps, '')
    expect(done.fileErrors.join(' ')).toMatch(/empty/i)
    expect(done.verdicts).toEqual([])
    expect(deps.loadFacts).not.toHaveBeenCalled()
    for (const write of WRITES) expect(deps[write], write).not.toHaveBeenCalled()
  })

  it('refuses a missing column without writing', async () => {
    const deps = makeDeps()
    const done = await commit(deps, 'Invoice Number,Customer\nINV-1,Cafe')
    expect(done.fileErrors.join(' ')).toContain('Unit Price')
    expect(deps.importInvoice).not.toHaveBeenCalled()
  })

  it('a date like 13/13/2026 rejects its invoice and names the row', async () => {
    const seen = await preview(makeDeps(), csv('INV-1,13/13/2026,Harbour Bistro,Widget,3,2.50'))
    expect(seen.counts).toMatchObject({ added: 0, rejected: 1 })
    const verdict = seen.verdicts[0]
    expect(verdict).toMatchObject({ kind: 'rejected', invoiceNumber: 'INV-1', rowNumbers: [2] })
    expect(verdict.kind === 'rejected' && verdict.reasons.join(' ')).toContain('13/13/2026')
  })

  it('an invoice whose rows have a parse error alongside good rows is never partly imported', async () => {
    const deps = makeDeps({ storedImports: [storedFor()] })
    const text = csv(WIDGET_A_CHANGED, 'INV-1,05/03/2026,Harbour Bistro,Widget,x,2.50')
    const done = await commit(deps, text, ['INV-1'])

    expect(deps.updateInvoice).not.toHaveBeenCalled()
    expect(deps.flagChange).not.toHaveBeenCalled()
    expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'rejected' })
  })

  it('reports both the parse error and the classifier reason on one invoice', async () => {
    const seen = await preview(
      makeDeps(),
      csv('INV-1,05/03/2026,Nobody Known,Widget,3,2.50', 'INV-1,05/03/2026,Nobody Known,Widget,x,2.50'),
    )
    const verdict = seen.verdicts[0]
    expect(verdict.kind).toBe('rejected')
    const reasons = verdict.kind === 'rejected' ? verdict.reasons.join(' ') : ''
    expect(reasons).toContain('Row 3')
    expect(reasons).toContain('Nobody Known')
  })

  it('reports a row with no invoice number on its own and counts it', async () => {
    const seen = await preview(makeDeps(), csv(WIDGET_A, ',05/03/2026,Harbour Bistro,Widget,3,2.50'))
    expect(seen.counts).toMatchObject({ added: 1, rejected: 1 })
    expect(seen.unattachedRowErrors).toEqual([expect.objectContaining({ rowNumber: 3 })])
  })

  it('keeps invoices in file order when one is rejected by a row error alone', async () => {
    const seen = await preview(makeDeps(), csv('INV-5,bad,Harbour Bistro,Widget,3,2.50', WIDGET_A))
    expect(seen.verdicts.map((verdict) => verdict.invoiceNumber)).toEqual(['INV-5', 'INV-1'])
  })

  it('accounts for every row of the file', async () => {
    const seen = await preview(
      makeDeps(),
      csv(
        WIDGET_A,
        'INV-1,05/03/2026,Harbour Bistro,Other Brand Cola,5,1.00',
        ',x,x,x,x,x',
        'INV-9,05/03/2026,Harbour Bistro,Other Brand Lime,5,1.00',
        'INV-5,bad,Harbour Bistro,Widget,3,2.50',
        // Skipped despite a bad value, on a good invoice and on one with nothing else.
        'INV-1,05/03/2026,Harbour Bistro,Freight,,',
        'INV-1,05/03/2026,Harbour Bistro,,1,1.00',
        'INV-7,05/03/2026,Harbour Bistro,Freight,x,x',
        // Rejected, with a skipped line beside the bad one.
        'INV-6,05/03/2026,Harbour Bistro,Widget,x,2.50',
        'INV-6,05/03/2026,Harbour Bistro,Freight,,',
      ),
    )
    const rows = [
      ...seen.verdicts.flatMap((verdict) => verdict.rowNumbers),
      ...seen.unattachedRowErrors.map((error) => Number(error.rowNumber)),
    ].sort((a, b) => a - b)
    expect(rows).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  describe('a bad value on a line that is not ours', () => {
    const FREIGHT_BLANK = 'INV-1,05/03/2026,Harbour Bistro,Freight,,'

    it('skips and names a freight line with a blank quantity on an otherwise good invoice', async () => {
      const deps = makeDeps()
      const text = csv(WIDGET_A, FREIGHT_BLANK)

      const seen = await preview(deps, text)
      expect(seen.verdicts).toEqual([
        {
          kind: 'add',
          invoiceNumber: 'INV-1',
          invoiceDate: '2026-03-05',
          horecaId: 7,
          lines: [{ productId: 11, quantity: 3, packSize: 12, unitPrice: 2.5, qbProductName: 'Widget' }],
          skippedLines: ['Freight'],
          rowNumbers: [2, 3],
        },
      ])
      expect(seen.counts).toMatchObject({ added: 1, skipped: 1, rejected: 0 })
      expect(seen.skippedLines).toEqual([{ invoiceNumber: 'INV-1', name: 'Freight' }])

      await commit(deps, text)
      expect(deps.importInvoice).toHaveBeenCalledTimes(1)
    })

    it('still rejects a bad quantity on a mapped line', async () => {
      const seen = await preview(makeDeps(), csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,Widget,lots,2.50', FREIGHT_BLANK))
      const verdict = seen.verdicts[0]
      expect(verdict).toMatchObject({ kind: 'rejected', rowNumbers: [2, 3, 4] })
      expect(verdict.kind === 'rejected' && verdict.reasons).toEqual([expect.stringContaining('Row 3')])
    })

    it('matches a mapped line the way the classifier does, ignoring case and spacing', async () => {
      const seen = await preview(makeDeps(), csv('INV-1,05/03/2026,Harbour Bistro,  WIDGET ,x,2.50'))
      expect(seen.verdicts[0].kind).toBe('rejected')
    })

    it('still rejects a bad price on one of the own products, even with no map row', async () => {
      const seen = await preview(
        makeDeps({ ownProductPrefixes: ['Acme'] }),
        csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,Acme Sprocket,1,x'),
      )
      expect(seen.verdicts[0].kind).toBe('rejected')
    })

    it('still rejects a bad date, a column shift or extra cells on a line that is not ours', async () => {
      for (const row of [
        'INV-1,bad,Harbour Bistro,Freight,,',
        'INV-1,05/03/2026,Harbour Bistro,Freight,1,2,3',
      ]) {
        const seen = await preview(makeDeps(), csv(WIDGET_A, row))
        expect(seen.verdicts[0].kind, row).toBe('rejected')
      }
    })

    it('skips a row with a blank product, named by its row, unless the date is bad', async () => {
      const seen = await preview(makeDeps(), csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,,x,'))
      expect(seen.verdicts[0]).toMatchObject({ kind: 'add', skippedLines: ['row 3 (no product)'], rowNumbers: [2, 3] })

      const badDate = await preview(makeDeps(), csv(WIDGET_A, 'INV-1,bad,Harbour Bistro,,1,1'))
      expect(badDate.verdicts[0].kind).toBe('rejected')
    })

    it('does not let an own-product term catch the name given to a row with no product', async () => {
      const seen = await preview(
        makeDeps({ ownProductTerms: ['product', 'row'] }),
        csv(WIDGET_A, 'INV-1,05/03/2026,Harbour Bistro,,1,1'),
      )
      expect(seen.verdicts[0]).toMatchObject({ kind: 'add', skippedLines: ['row 3 (no product)'] })
    })

    it('does not let a blank customer on the skipped row block the invoice', async () => {
      const seen = await preview(makeDeps(), csv(WIDGET_A, 'INV-1,05/03/2026,,Freight,,'))
      expect(seen.verdicts[0].kind).toBe('add')
    })

    it('reads an invoice holding only such lines as nothing to import', async () => {
      const seen = await preview(makeDeps(), csv('INV-1,05/03/2026,,Freight,,', 'INV-1,05/03/2026,,,,'))
      expect(seen.verdicts).toEqual([
        { kind: 'no_mapped_lines', invoiceNumber: 'INV-1', skippedLines: ['Freight', 'row 3 (no product)'], rowNumbers: [2, 3] },
      ])
    })

    it('reads an imported invoice left holding only such lines as having lost its mapped lines', async () => {
      const seen = await preview(makeDeps({ storedImports: [storedFor()] }), csv(FREIGHT_BLANK))
      expect(seen.verdicts[0]).toMatchObject({ kind: 'changed', editable: false })
    })
  })

  it('reads (12.50) as a negative, so the usual rule for a negative applies', async () => {
    const mapped = await preview(makeDeps(), csv('CN-1,05/03/2026,Harbour Bistro,Widget,3,(12.50)'))
    expect(mapped.verdicts[0].kind === 'rejected' && mapped.verdicts[0].reasons.join(' ')).toContain('unit price -12.5')

    const other = await preview(makeDeps(), csv('CN-2,05/03/2026,Harbour Bistro,Other Brand Cola,3,(12.50)'))
    expect(other.verdicts[0].kind).toBe('no_mapped_lines')
  })

  describe('stored flags', () => {
    const facts = (flaggedChange: unknown, flagResolvedAt: string | null = null) => ({
      storedImports: [storedFor()],
      storedFlags: [{ invoiceNumber: 'INV-1', flaggedChange, flagResolvedAt }],
    })

    it('leaves the flag alone when the differences are the same, whatever their key or array order', async () => {
      const reordered = {
        to: { unitPrice: 2.5, quantity: 9 },
        from: { unitPrice: 2.5, quantity: 3 },
        qbProductName: 'Widget',
        productId: 11,
        kind: 'altered',
      }
      const deps = makeDeps(facts([reordered], '2026-03-01T00:00:00Z'))
      const done = await commit(deps, csv(WIDGET_A_CHANGED))
      expect(deps.flagChange).not.toHaveBeenCalled()
      expect(deps.clearFlag).not.toHaveBeenCalled()
      expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'flagged' })

      const twoLines = {
        customers: FACTS.customers,
        productMap: [...FACTS.productMap, { qbName: 'Gadget', productId: 12, packSize: null }],
        storedImports: [storedFor({ lines: [{ productId: 11, quantity: 3, unitPrice: 2.5 }, { productId: 12, quantity: 1, unitPrice: 4 }] })],
      }
      const text = csv(WIDGET_A_CHANGED, 'INV-1,05/03/2026,Harbour Bistro,Gadget,2,4')
      const seen = await preview(makeDeps(twoLines), text)
      const differences = seen.verdicts[0].kind === 'changed' ? seen.verdicts[0].differences : []
      expect(differences).toHaveLength(2)

      const swapped = makeDeps({ ...twoLines, storedFlags: [{ invoiceNumber: 'INV-1', flaggedChange: [...differences].reverse(), flagResolvedAt: null }] })
      await commit(swapped, text)
      expect(swapped.flagChange).not.toHaveBeenCalled()
    })

    it('replaces the flag when the differences are different', async () => {
      const deps = makeDeps(facts([{ ...ALTERED_TO_9, to: { quantity: 5, unitPrice: 2.5 } }], '2026-03-01T00:00:00Z'))
      await commit(deps, csv(WIDGET_A_CHANGED))
      expect(deps.flagChange).toHaveBeenCalledWith('INV-1', [ALTERED_TO_9])
    })

    it('clears the flag when a later file matches the order again', async () => {
      for (const stored of [facts([ALTERED_TO_9]), facts(null, '2026-03-01T00:00:00Z')]) {
        const deps = makeDeps(stored)
        const done = await commit(deps, csv(WIDGET_A))
        expect(deps.clearFlag).toHaveBeenCalledWith('INV-1')
        expect(deps.flagChange).not.toHaveBeenCalled()
        expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'unchanged' })
      }
    })

    it('does not clear anything for an unchanged invoice with no flag, or on a preview', async () => {
      const none = makeDeps({ storedImports: [storedFor()] })
      await commit(none, csv(WIDGET_A))
      expect(none.clearFlag).not.toHaveBeenCalled()

      const previewed = makeDeps(facts([ALTERED_TO_9]))
      const seen = await preview(previewed, csv(WIDGET_A))
      expect(previewed.clearFlag).not.toHaveBeenCalled()
      expect(seen.staleFlagInvoices).toEqual(['INV-1'])
    })

    it('finishes a stuck order and clears its flag', async () => {
      const deps = makeDeps({
        storedImports: [storedFor({ orderStatus: 'processing' })],
        storedFlags: [{ invoiceNumber: 'INV-1', flaggedChange: [ALTERED_TO_9], flagResolvedAt: null }],
      })
      const done = await commit(deps, csv(WIDGET_A))
      expect(deps.advanceToProcessed).toHaveBeenCalledTimes(1)
      expect(deps.clearFlag).toHaveBeenCalledTimes(1)
      expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'finished' })
    })

    it('reports a flag it could not clear per invoice and carries on', async () => {
      const deps = makeDeps(facts([ALTERED_TO_9]), {
        clearFlag: vi.fn(async () => {
          throw new Error('update failed')
        }),
      })
      const done = await commit(deps, csv(WIDGET_A, WIDGET_B))
      expect(resultOf(done, 'INV-1')).toMatchObject({ outcome: 'failed' })
      expect(resultOf(done, 'INV-1')?.message).not.toContain('update failed')
      expect(resultOf(done, 'INV-2')).toMatchObject({ outcome: 'added' })
    })
  })

  it('takes the invoice date from the file when updating, because the verdict has none', async () => {
    const deps = makeDeps({ storedImports: [storedFor()] })
    await commit(deps, csv('INV-1,7/3/2026,Harbour Bistro,Widget,9,2.50'), ['INV-1'])
    expect(deps.updateInvoice.mock.calls[0][0]).toMatchObject({ invoiceDate: '2026-03-07' })
  })
})
