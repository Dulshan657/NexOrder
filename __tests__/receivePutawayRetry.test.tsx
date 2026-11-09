import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// NX-0032: a receipt is booked even when putaway could not read a product's home
// bin (receive-stock answers with `putaway_error`, and no task exists yet). The
// receive screen must say so and offer a Retry that sends the lines the server
// returned to recommend-putaway: same base units, same plates, same hold flags.
// Success clears the message and shows the new tasks; a failed retry says why,
// and can be tried again.

const { invoke, from, receiveMock } = vi.hoisted(() => ({
  invoke: vi.fn(), from: vi.fn(), receiveMock: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke }, from } }))
vi.mock('@/hooks/queries/useReceiveStock', () => ({
  useReceiveStock: () => ({ mutateAsync: receiveMock, isPending: false }),
  useReceiptPlates: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useReceivingRequirements', () => ({
  useReceivingRequirements: () => ({ data: new Map(), isLoading: false }),
}))
vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useRecentReceipts: () => ({ data: [], isLoading: false }),
  inventoryKeys: { balances: ['inventory-balances'], recentReceipts: ['recent-receipts'] },
}))
vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 1, name: 'MAIN', isActive: true, code: 'MAIN' }] }),
}))
vi.mock('@/hooks/queries/useSuppliers', () => ({
  useSuppliers: () => ({ data: [{ id: 1, name: 'Acme Foods' }] }),
}))
vi.mock('@/hooks/queries/useLevelRoles', async () => {
  const { FALLBACK_LEVEL_ROLES } = await import('@/lib/levelRoles')
  return { useLevelRoles: () => ({ data: FALLBACK_LEVEL_ROLES }) }
})
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
vi.mock('@/hooks/queries/useSettings', () => ({ useSettings: () => ({ data: null }) }))
// The label sheet and the suggestions panel have their own tests.
vi.mock('@/components/inventory/receive/ReceiptPlateLabels', () => ({ ReceiptPlateLabels: () => null }))
vi.mock('@/components/inventory/PutawayPanel', () => ({
  PutawayPanel: ({ recommendations }: { recommendations: unknown[] }) => (
    <div data-testid="panel">{recommendations.length} suggested</div>
  ),
}))

import ReceiveStockView from '@/components/inventory/ReceiveStockView'
import ReceiveSuccessCard, { type ReceivedSummary } from '@/components/inventory/receive/ReceiveSuccessCard'
import { UserRole, type Product, type PutawayLineRecommendation, type User } from '@/types'

const HOME_UNAVAILABLE = 'Home bin unavailable, try again.'

/** What receive-stock returned: base units, the plate, the hold flag. */
const PUTAWAY_LINES = [
  { product_id: 1, quantity: 48, hu_type: 'pallet' as const, hu_id: 900, quarantine: false },
  { product_id: 2, quantity: 6, hu_type: 'carton' as const, hu_id: 901, quarantine: true },
]

const recommendation = {
  recommendationId: 77,
  productId: 1,
  quantity: 48,
  recommendedLocationId: 20,
  alternatives: [],
  explanation: {
    engineVersion: 'test', layoutId: 1, candidatesConsidered: 1, hardFilters: [], winner: null, alternatives: [],
  },
} satisfies PutawayLineRecommendation

const engineReply = {
  data: { ok: true, mode: 'engine', layout_id: 3, recommendations: [recommendation] },
  error: null,
}

function httpError(message: string, status = 500, code = 'INTERNAL') {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const failedSummary: ReceivedSummary = {
  receiptId: 501,
  linesReceived: 2,
  units: '54 each',
  destName: 'MAIN',
  warehouseId: 9,
  recommendations: [],
  putawayError: HOME_UNAVAILABLE,
  putawayLines: PUTAWAY_LINES,
}

const renderCard = (summary: ReceivedSummary = failedSummary) =>
  wrap(<ReceiveSuccessCard summary={summary} productNameById={new Map()} onStartNext={() => {}} />)

const retryButton = () => screen.getByRole('button', { name: /^Retry/ }) as HTMLButtonElement

beforeEach(() => {
  invoke.mockReset()
  receiveMock.mockReset()
})
afterEach(cleanup)

describe('ReceiveSuccessCard after a failed home read', () => {
  it('says the receipt is booked and shows the message with a Retry', () => {
    renderCard()

    expect(screen.getByRole('alert').textContent).toContain(HOME_UNAVAILABLE)
    expect(screen.getByText(/Received 2 lines/)).toBeTruthy()
    expect(retryButton().disabled).toBe(false)
    // No tasks exist yet, so there is nothing to suggest.
    expect(screen.queryByText(/Suggested locations/)).toBeNull()
  })

  it('Retry sends recommend-putaway the returned lines and receipt', async () => {
    invoke.mockResolvedValue(engineReply)
    renderCard()

    fireEvent.click(retryButton())

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(invoke).toHaveBeenCalledWith('recommend-putaway', {
      body: expect.objectContaining({
        warehouse_id: 9,
        goods_receipt_id: 501,
        lines: PUTAWAY_LINES,
      }),
    })
    // A real run, not a preview.
    expect(invoke.mock.calls[0][1].body.dry_run).toBeFalsy()
  })

  it('clears the message on success and shows the new tasks', async () => {
    invoke.mockResolvedValue(engineReply)
    renderCard()

    fireEvent.click(retryButton())

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Suggested locations \(1\)/ }))
    expect(within(screen.getByTestId('panel')).getByText('1 suggested')).toBeTruthy()
  })

  it('a second failure shows the message again, and Retry can be pressed again', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(HOME_UNAVAILABLE) })
    invoke.mockResolvedValueOnce({ data: null, error: httpError(HOME_UNAVAILABLE) })
    invoke.mockResolvedValueOnce(engineReply)
    renderCard()

    fireEvent.click(retryButton())
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(retryButton().disabled).toBe(false))
    expect(screen.getByRole('alert').textContent).toContain(HOME_UNAVAILABLE)

    fireEvent.click(retryButton())
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(retryButton().disabled).toBe(false))
    expect(screen.getByRole('alert').textContent).toContain(HOME_UNAVAILABLE)

    fireEvent.click(retryButton())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows what the server said when the retry fails for another reason', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError('Plate 900 is not on receipt 501', 400, 'INVALID_INPUT') })
    renderCard()

    fireEvent.click(retryButton())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Plate 900 is not on receipt 501'))
  })

  it('cannot be pressed twice while the retry is running', async () => {
    let finish: (v: unknown) => void = () => {}
    invoke.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderCard()

    fireEvent.click(retryButton())
    await waitFor(() => expect(retryButton().disabled).toBe(true))
    fireEvent.click(retryButton())
    expect(invoke).toHaveBeenCalledTimes(1)

    await act(async () => { finish(engineReply) })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('has no message and no Retry when putaway worked', () => {
    renderCard({ ...failedSummary, putawayError: undefined, putawayLines: undefined, recommendations: [recommendation] })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Suggested locations \(1\)/ })).toBeTruthy()
  })
})

describe('ReceiveStockView', () => {
  function product(id: number, name: string, sku: string): Product {
    return {
      id, sku, name, description: '', price: 1, category: 'Other',
      inventory: 0, available: 0, unit: 'each', cartonSize: 1, supplierId: 1,
      suppliers: [{ supplierId: 1, isPrimary: true, sortOrder: 0 }],
    } as Product
  }
  const products = [product(1, 'Coconut Milk', 'TST-RCV-001')]
  const currentUser = { id: 1, name: 'Ada', role: UserRole.ADMIN } as unknown as User

  it('shows the putaway error from receive-stock and retries with its lines', async () => {
    window.localStorage.clear()
    receiveMock.mockResolvedValue({
      lines_received: 1,
      receipt_id: 501,
      location_id: 9,
      putaway: null,
      putaway_error: HOME_UNAVAILABLE,
      putaway_lines: PUTAWAY_LINES,
    })
    invoke.mockResolvedValue(engineReply)
    wrap(<ReceiveStockView products={products} currentUser={currentUser} />)

    fireEvent.focus(screen.getByLabelText('Supplier'))
    fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
    const search = screen.getByLabelText('Search products')
    fireEvent.change(search, { target: { value: 'TST-RCV-001' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    const dock = document.querySelector('[data-scan-dock]') as HTMLElement
    await act(async () => { fireEvent.click(within(dock).getByRole('button', { name: /^Receive/ })) })

    expect((await screen.findByRole('alert')).textContent).toContain(HOME_UNAVAILABLE)
    fireEvent.click(retryButton())
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('recommend-putaway', {
      body: expect.objectContaining({ warehouse_id: 9, goods_receipt_id: 501, lines: PUTAWAY_LINES }),
    }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
