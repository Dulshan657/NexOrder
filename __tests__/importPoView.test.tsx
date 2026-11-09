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
    { invoiceNumber: 'INV-1', name: 'Other Brand Cola', rowNumber: 3 },
    { invoiceNumber: 'INV-8', name: 'Other Brand Lime', rowNumber: 7 },
  ],
  unfinishedInvoices: [],
  staleFlagInvoices: [],
  invoiceCustomers: { 'INV-1': 'Harbour Bistro', 'INV-3': 'Corner Cafe', 'INV-4': 'Pier Deli' },
  verdicts: [
    {
      kind: 'add',
      invoiceNumber: 'INV-1',
      invoiceDate: '2026-03-05',
      horecaId: 7,
      lines: [{ productId: 11, quantity: 1, packSize: 12, unitPrice: 234, qbProductName: 'Prod A' }],
      skippedLines: ['Other Brand Cola'],
      rowNumbers: [2, 3],
    },
    { kind: 'unchanged', invoiceNumber: 'INV-2', skippedLines: [], rowNumbers: [4] },
    {
      kind: 'changed',
      invoiceNumber: 'INV-3',
      orderId: 'QB-INV-3',
      horecaId: 7,
      lines: [{ productId: 11, quantity: 9, packSize: null, unitPrice: 2.5, qbProductName: 'Widget' }],
      differences: [
        { kind: 'altered', productId: 11, qbProductName: 'Widget', from: { quantity: 3, unitPrice: 2.5 }, to: { quantity: 9, unitPrice: 2.5 } },
        { kind: 'altered', productId: 12, qbProductName: 'Gadget', from: { quantity: 1, unitPrice: 4 }, to: { quantity: 1, unitPrice: 4 }, packSize: { from: 6, to: 12 } },
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

const pick = (file: File) =>
  fireEvent.change(screen.getByLabelText(/choose a csv or excel file/i), { target: { files: [file] } })

const upload = (name = 'invoices.csv', text = 'Invoice Number\nINV-1') => pick(new File([text], name, { type: 'text/csv' }))

/** A file whose text arrives only when the test says so. */
function slowFile(name: string, text: string) {
  const file = new File([text], name, { type: 'text/csv' })
  let finish: (value: string) => void = () => undefined
  file.text = () => new Promise<string>((resolve) => { finish = resolve })
  return { file, finish: () => finish(text) }
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

  it('shows the customer and every line of each added and changed invoice', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()

    const added = await screen.findByRole('list', { name: /new orders/i })
    const row = within(added).getByText(/INV-1/).closest('li')
    expect(row?.textContent).toContain('Harbour Bistro')
    const cells = within(row as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells).toEqual(['Prod A', '1', '$234.00', '12'])

    const changed = screen.getByRole('list', { name: /changed invoices/i })
    const changedRow = within(changed).getByRole('checkbox', { name: /INV-3/ }).closest('li')
    expect(changedRow?.textContent).toContain('Corner Cafe')
    expect(within(changedRow as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Widget', '9', '$2.50', 'Units'])
  })

  it('shows old and new carton size for a carton change', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(screen.getByText(/Gadget.*carton size.*6.*12/i)).toBeTruthy()
  })

  it('names the file above the preview and on Confirm', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload('march-invoices.csv')
    await screen.findByRole('list', { name: /what this file will do/i })
    expect(screen.getByTestId('import-po-file-name').textContent).toContain('march-invoices.csv')
    expect(screen.getByRole('button', { name: /confirm/i }).textContent).toContain('march-invoices.csv')
  })

  it('disables the picker while reading, and ignores a read another file has overtaken', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    const first = slowFile('first.csv', 'FIRST')
    pick(first.file)
    await waitFor(() => expect((screen.getByLabelText(/choose a csv or excel file/i) as HTMLInputElement).disabled).toBe(true))

    upload('second.csv', 'SECOND')
    await screen.findByRole('list', { name: /what this file will do/i })
    first.finish()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(runImportPo).toHaveBeenCalledTimes(1)
    expect(runImportPo.mock.calls[0][0]).toMatchObject({ csvText: 'SECOND' })
    expect(screen.getByTestId('import-po-file-name').textContent).toContain('second.csv')
  })

  it('clears the old preview as soon as another file is picked', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload('first.csv', 'FIRST')
    await screen.findByRole('list', { name: /what this file will do/i })

    pick(slowFile('second.csv', 'SECOND').file)
    await waitFor(() => expect(screen.queryByRole('list', { name: /what this file will do/i })).toBeNull())
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('commits what the second file sent when a different file is picked after a preview', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    renderView()
    upload('first.csv', 'FIRST')
    await screen.findByRole('list', { name: /what this file will do/i })
    fireEvent.click(screen.getByRole('checkbox', { name: /INV-3/ }))

    upload('second.csv', 'SECOND')
    await waitFor(() => expect(runImportPo).toHaveBeenCalledTimes(2))
    await screen.findByRole('list', { name: /what this file will do/i })

    runImportPo.mockResolvedValue(COMMITTED)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await screen.findByRole('list', { name: /results/i })
    expect(runImportPo.mock.calls[2][0]).toMatchObject({ action: 'commit', csvText: 'SECOND', applyChanges: [] })
  })

  it('keeps the screen open while a commit runs, whatever is pressed', async () => {
    runImportPo.mockResolvedValue(PREVIEW)
    const { onClose } = renderView()
    upload()
    await screen.findByRole('list', { name: /what this file will do/i })

    let finish: (value: ImportOk) => void = () => undefined
    runImportPo.mockReturnValue(new Promise<ImportOk>((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText(/importing/i)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    finish(COMMITTED)
    await screen.findByRole('list', { name: /results/i })
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('collapses skipped lines to distinct names with a count, and rows on expanding', async () => {
    const skippedLines = Array.from({ length: 3000 }, (_, i) => ({
      invoiceNumber: `INV-${i}`,
      name: i % 2 === 0 ? 'Freight' : 'Discount',
      rowNumber: i + 2,
    }))
    runImportPo.mockResolvedValue({ ...PREVIEW, skippedLines, counts: { ...PREVIEW.counts, skipped: 3000 } })
    renderView()
    upload()

    const list = await screen.findByRole('list', { name: /skipped lines/i })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toMatch(/Freight.*1,?500/)
    expect(rows[1].textContent).toMatch(/Discount.*1,?500/)
    expect(rows[0].querySelector('details')).toBeTruthy()
    expect(rows[0].querySelector('details')?.textContent).toContain('INV-0 row 2')
    expect(rows[0].querySelector('details')?.textContent).toContain('INV-2998 row 3000')
  })

  it('never hides a name silently: a long list says how many more and shows them', async () => {
    const skippedLines = Array.from({ length: 250 }, (_, i) => ({ invoiceNumber: 'INV-1', name: `Name ${i}`, rowNumber: i + 2 }))
    runImportPo.mockResolvedValue({ ...PREVIEW, skippedLines })
    renderView()
    upload()

    const list = await screen.findByRole('list', { name: /skipped lines/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: /show 100 more.*150/i }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(200)
    fireEvent.click(screen.getByRole('button', { name: /show 50 more/i }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(250)
    expect(within(list).getByText(/Name 249/)).toBeTruthy()
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
