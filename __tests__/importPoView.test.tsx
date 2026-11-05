// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ImportOk } from '../supabase/functions/_shared/qbImport/runImport'
import type { User } from '../types'
import { UserRole } from '../types'
import { ImportPoView } from '../components/admin/ImportPoView'
import OrderImportPage from '../components/OrderImportPage'
import { ToastProvider } from '../hooks/useToasts'
import { DocumentViewerProvider } from '../context/DocumentViewerContext'
import { expectNoA11yViolations } from './support/axe'

const runImportPo = vi.hoisted(() => vi.fn())
const downloadCsv = vi.hoisted(() => vi.fn())

vi.mock('@/services/supabase/importPoService', () => ({ runImportPo }))
vi.mock('@/lib/csvExport', async (original) => ({
  ...(await original<typeof import('@/lib/csvExport')>()),
  downloadCsv,
}))
vi.mock('../lib/csvExport', async (original) => ({
  ...(await original<typeof import('../lib/csvExport')>()),
  downloadCsv,
}))

const PREVIEW: ImportOk = {
  status: 'ok',
  action: 'preview',
  counts: { added: 1, unchanged: 1, changed: 2, skipped: 2, rejected: 2 },
  fileErrors: [],
  unattachedRowErrors: [{ rowNumber: 9, invoiceNumber: null, message: 'has no invoice number' }],
  skippedLines: [
    { invoiceNumber: 'INV-1', name: 'Other Brand Cola' },
    { invoiceNumber: 'INV-8', name: 'Other Brand Lime' },
  ],
  unfinishedInvoices: [],
  staleFlagInvoices: [],
  verdicts: [
    {
      kind: 'add',
      invoiceNumber: 'INV-1',
      invoiceDate: '2026-03-05',
      horecaId: 7,
      lines: [],
      skippedLines: ['Other Brand Cola'],
      rowNumbers: [2, 3],
    },
    { kind: 'unchanged', invoiceNumber: 'INV-2', skippedLines: [], rowNumbers: [4] },
    {
      kind: 'changed',
      invoiceNumber: 'INV-3',
      orderId: 'QB-INV-3',
      horecaId: 7,
      lines: [],
      differences: [
        { kind: 'altered', productId: 11, qbProductName: 'Widget', from: { quantity: 3, unitPrice: 2.5 }, to: { quantity: 9, unitPrice: 2.5 } },
      ],
      editable: true,
      skippedLines: [],
      rowNumbers: [5],
    },
    {
      kind: 'changed',
      invoiceNumber: 'INV-4',
      orderId: 'QB-INV-4',
      horecaId: 7,
      lines: [],
      differences: [{ kind: 'removed', productId: 12, quantity: 1, unitPrice: 4 }],
      editable: false,
      skippedLines: [],
      rowNumbers: [6],
    },
    { kind: 'no_mapped_lines', invoiceNumber: 'INV-8', skippedLines: ['Other Brand Lime'], rowNumbers: [7] },
    { kind: 'rejected', invoiceNumber: 'INV-5', reasons: ['Customer "Nobody Known" is not in the customer list'], rowNumbers: [8] },
  ],
}

const COMMITTED: ImportOk = {
  ...PREVIEW,
  action: 'commit',
  results: [
    { invoiceNumber: 'INV-1', outcome: 'added', orderId: 'QB-INV-1' },
    { invoiceNumber: 'INV-3', outcome: 'updated', orderId: 'QB-INV-3' },
    { invoiceNumber: 'INV-4', outcome: 'flagged', orderId: 'QB-INV-4', message: 'Differences stored for the office' },
    { invoiceNumber: 'INV-6', outcome: 'failed', message: 'The warehouse needs to check this order' },
  ],
  resultCounts: { added: 1, updated: 1, flagged: 1, unchanged: 0, finished: 0, skipped: 0, rejected: 0, refused: 0, failed: 1 },
  ignoredApplyChanges: [{ invoiceNumber: 'NOPE-9', reason: 'not in this file' }],
}

function renderView(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onClose = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <ImportPoView onClose={onClose} />
    </QueryClientProvider>,
  )
  return { ...view, onClose, client }
}

const upload = (name = 'invoices.csv', text = 'Invoice Number\nINV-1') => {
  const file = new File([text], name, { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText(/choose a csv or excel file/i), { target: { files: [file] } })
}

const userWith = (role: UserRole): User => ({ id: 'u-1', name: 'Pat Example', email: 'pat@example.test', role }) as unknown as User

function renderPage(role: UserRole) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
      <DocumentViewerProvider>
      <OrderImportPage
        orders={[]}
        hoReCas={[]}
        invoices={[]}
        currentUser={userWith(role)}
        onReorder={vi.fn()}
        onViewDetail={vi.fn()}
        onUpdateStatus={vi.fn()}
        onBack={vi.fn()}
      />
      </DocumentViewerProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  runImportPo.mockReset()
  downloadCsv.mockReset()
})

afterEach(cleanup)

describe('Import PO', () => {
  it('shows the button to Admin and Manager only', () => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER]) {
      renderPage(role)
      expect(screen.getByRole('button', { name: 'Import PO' }), role).toBeTruthy()
      cleanup()
    }
    for (const role of [UserRole.WAREHOUSE, UserRole.CUSTOMER, UserRole.FIELD_REP, UserRole.OFFICE_REP]) {
      renderPage(role)
      expect(screen.queryByRole('button', { name: 'Import PO' }), role).toBeNull()
      cleanup()
    }
  })

  it('shows every count, skipped line and rejection before confirming', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()

    const counts = await screen.findByRole('list', { name: /what this file will do/i })
    for (const [label, value] of [['Added', '1'], ['Unchanged', '1'], ['Changed', '2'], ['Skipped', '2'], ['Rejected', '2']]) {
      expect(within(counts).getByText(label).closest('li')?.textContent, label).toContain(value)
    }

    const skipped = screen.getByRole('list', { name: /skipped lines/i })
    expect(within(skipped).getByText(/Other Brand Cola/)).toBeTruthy()
    expect(within(skipped).getByText(/Other Brand Lime/)).toBeTruthy()

    const rejected = screen.getByRole('list', { name: /rejected/i })
    expect(within(rejected).getByText(/Nobody Known/)).toBeTruthy()
    expect(within(rejected).getByText(/INV-5/)).toBeTruthy()
    expect(within(rejected).getByText(/Row 9/)).toBeTruthy()
  })

  it('writes nothing until confirmed and offers the template', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()

    fireEvent.click(screen.getByRole('button', { name: /download template/i }))
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [headers, rows, filename] = downloadCsv.mock.calls[0]
    expect(headers).toEqual(['Invoice Number', 'Invoice Date', 'Customer', 'Product', 'Quantity', 'Unit Price'])
    expect(rows.length).toBeGreaterThan(0)
    expect(filename).toMatch(/\.csv$/)

    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(runImportPo).toHaveBeenCalledTimes(1)
    expect(runImportPo.mock.calls[0][0]).toMatchObject({ action: 'preview' })

    runImportPo.mockResolvedValue(COMMITTED)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await screen.findByRole('list', { name: /results/i })
    expect(runImportPo).toHaveBeenCalledTimes(2)
    expect(runImportPo.mock.calls[1][0]).toMatchObject({ action: 'commit', csvText: 'Invoice Number\nINV-1', applyChanges: [] })
  })

  it('offers a checkbox only for an editable changed invoice, unselected, and sends what was ticked', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })

    const editable = screen.getByRole('checkbox', { name: /INV-3/ }) as HTMLInputElement
    expect(editable.checked).toBe(false)
    expect(screen.queryByRole('checkbox', { name: /INV-4/ })).toBeNull()
    expect(screen.getByText(/INV-4/).closest('li')?.textContent).toMatch(/stored/i)

    fireEvent.click(editable)
    expect(editable.checked).toBe(true)

    runImportPo.mockResolvedValue(COMMITTED)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await screen.findByRole('list', { name: /results/i })
    expect(runImportPo.mock.calls[1][0].applyChanges).toEqual(['INV-3'])
  })

  it('shows results after commit, including per-invoice failures and ignored selections', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })

    runImportPo.mockResolvedValue(COMMITTED)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    const results = await screen.findByRole('list', { name: /results/i })
    expect(within(results).getByText(/INV-6/).closest('li')?.textContent).toContain('The warehouse needs to check this order')
    expect(within(results).getByText(/INV-4/).closest('li')?.textContent).toContain('Differences stored')
    expect(screen.getByText(/NOPE-9/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('refreshes the Pick Queue and the order list after a commit', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    runImportPo.mockResolvedValue(PREVIEW)
    renderView(client)
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(invalidate).not.toHaveBeenCalled()

    runImportPo.mockResolvedValue(COMMITTED)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await screen.findByRole('list', { name: /results/i })

    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
    expect(keys).toContain(JSON.stringify(['pick_queue']))
    expect(keys.some((key) => key.includes('orders'))).toBe(true)
  })

  it('refuses a file on the screen without calling the server', async () => {
    renderView()
    upload('old.xls', 'x')
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toMatch(/\.xlsx/)
    expect(runImportPo).not.toHaveBeenCalled()
  })

  it('shows a file-level refusal and offers no confirm', async () => {
    runImportPo.mockResolvedValue({
      ...PREVIEW,
      counts: { added: 0, unchanged: 0, changed: 0, skipped: 0, rejected: 0 },
      fileErrors: ['The file has no "Unit Price" column.'],
      unattachedRowErrors: [],
      skippedLines: [],
      verdicts: [],
    })
    renderView()
    upload()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unit Price'))
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('offers no confirm when the file holds nothing to do', async () => {
    runImportPo.mockResolvedValue({
      ...PREVIEW,
      counts: { added: 0, unchanged: 0, changed: 0, skipped: 1, rejected: 0 },
      unattachedRowErrors: [],
      skippedLines: [{ invoiceNumber: 'INV-8', name: 'Other Brand Lime' }],
      verdicts: [{ kind: 'no_mapped_lines', invoiceNumber: 'INV-8', skippedLines: ['Other Brand Lime'], rowNumbers: [2] }],
    })
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('still offers confirm when the only work is finishing an earlier order', async () => {
    runImportPo.mockResolvedValue({
      ...PREVIEW,
      counts: { added: 0, unchanged: 1, changed: 0, skipped: 0, rejected: 0 },
      unattachedRowErrors: [],
      skippedLines: [],
      unfinishedInvoices: ['INV-2'],
      verdicts: [{ kind: 'unchanged', invoiceNumber: 'INV-2', skippedLines: [], rowNumbers: [2] }],
    })
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy()
    expect(screen.getByText(/INV-2/)).toBeTruthy()
  })

  it('offers confirm when the only work is clearing a flag the file no longer supports', async () => {
    runImportPo.mockResolvedValue({
      ...PREVIEW,
      counts: { added: 0, unchanged: 1, changed: 0, skipped: 0, rejected: 0 },
      unattachedRowErrors: [],
      skippedLines: [],
      staleFlagInvoices: ['INV-2'],
      verdicts: [{ kind: 'unchanged', invoiceNumber: 'INV-2', skippedLines: [], rowNumbers: [2] }],
    })
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy()
    expect(screen.getByText(/INV-2/)).toBeTruthy()
  })

  it('shows a server failure and lets the person try again', async () => {
    runImportPo.mockRejectedValue(new Error('Rate limit exceeded'))
    renderView()
    upload()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Rate limit exceeded'))
  })

  it('has no accessibility violations with a preview on screen', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    await expectNoA11yViolations(document.body)
  })
})
