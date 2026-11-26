import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import NewOrderView from '../../components/admin/NewOrderView'
import { AUTOSAVE_DELAY_MS } from '../../components/admin/newOrder/useNewOrderState'
import { mkHoReCa, mkProduct, mkUser } from '../fixtures'
import { UserRole, type Product, type ProductUom } from '../../types'
import type { OrderDraft } from '../../lib/newOrder/orderDraft'

const mocks = vi.hoisted(() => ({
  placeOrder: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  drafts: [] as unknown[],
}))

vi.mock('../../hooks/queries/useOrders', () => ({
  usePlaceOrder: () => ({ mutateAsync: mocks.placeOrder, isPending: false }),
}))

vi.mock('../../hooks/queries/useOrderDrafts', () => ({
  useOrderDrafts: () => ({ data: mocks.drafts, isLoading: false, error: null }),
  useSaveOrderDraft: () => ({ mutateAsync: mocks.saveDraft, isPending: false }),
  useDeleteOrderDraft: () => ({ mutateAsync: mocks.deleteDraft, isPending: false }),
}))

vi.mock('../../hooks/queries/useSettings', () => ({ useSettings: () => ({ data: { low_stock_threshold: 10 } }) }))

const uom = (over: Partial<ProductUom>): ProductUom => ({
  id: 11, productId: 1, code: 'each', factorToBase: 1, isBase: true, price: 4,
  isOrderable: true, isReceivable: true, sortOrder: 0, ...over,
})
const CARTON_ID = 12

const coconut = (available: number): Product =>
  mkProduct({
    id: 1,
    sku: 'CM-1',
    name: 'Coconut Milk',
    available,
    uoms: [uom({}), uom({ id: CARTON_ID, code: 'carton', factorToBase: 12, isBase: false, price: 45, sortOrder: 1 })],
  })

const customer = mkHoReCa({ id: 10, name: 'Test Restaurant' })
const admin = mkUser({ id: 1, role: UserRole.ADMIN })

const renderView = (products: Product[]) =>
  render(
    <NewOrderView
      products={products}
      hoReCas={[customer]}
      orders={[]}
      currentUser={admin}
      promotions={[]}
      addToast={vi.fn()}
      onViewInOrderImport={vi.fn()}
    />,
  )

const chooseCustomer = () => {
  fireEvent.click(screen.getByRole('button', { name: /select horeca/i }))
  fireEvent.click(screen.getByRole('button', { name: /test restaurant/i }))
}

const quickAdd = () => screen.getByRole('combobox', { name: /add product by sku or name/i })

const addBySku = (sku: string) => {
  fireEvent.change(quickAdd(), { target: { value: sku } })
  fireEvent.keyDown(quickAdd(), { key: 'Enter' })
}

const placeButtons = () => screen.getAllByRole('button', { name: /place order/i })

beforeEach(() => {
  mocks.placeOrder.mockReset().mockResolvedValue({ orderId: 'ORD-1', total: 0, cartDiscount: 0, appliedPromotionIds: [], bogoFreeItems: [] })
  mocks.saveDraft.mockReset().mockResolvedValue({ id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b' })
  mocks.deleteDraft.mockReset().mockResolvedValue(undefined)
  mocks.drafts = []
})

afterEach(cleanup)

describe('NewOrderView', () => {
  it('submits a carton line with its unit', async () => {
    renderView([coconut(100)])
    chooseCustomer()
    addBySku('CM-1')

    fireEvent.change(screen.getByRole('combobox', { name: 'Unit for Coconut Milk' }), { target: { value: String(CARTON_ID) } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }), { target: { value: '3' } })
    fireEvent.click(placeButtons()[0])

    await waitFor(() => expect(mocks.placeOrder).toHaveBeenCalledTimes(1))
    expect(mocks.placeOrder.mock.calls[0][0]).toMatchObject({
      hoReCaId: 10,
      items: [{ productId: 1, quantity: 3, uomId: CARTON_ID }],
    })
  })

  it('disables Place order while a line is over stock', () => {
    renderView([coconut(30)])
    chooseCustomer()
    addBySku('CM-1')

    fireEvent.change(screen.getByRole('combobox', { name: 'Unit for Coconut Milk' }), { target: { value: String(CARTON_ID) } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }), { target: { value: '3' } })

    expect(screen.getAllByText(/only 30 available/i).length).toBeGreaterThan(0)
    for (const button of placeButtons()) expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }), { target: { value: '2' } })
    for (const button of placeButtons()) expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('Enter on a SKU adds the line and focuses its quantity', () => {
    renderView([coconut(100)])
    addBySku('cm-1')

    const qty = screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' })
    expect(document.activeElement).toBe(qty)

    fireEvent.keyDown(qty, { key: 'Enter' })
    expect(document.activeElement).toBe(quickAdd())
    expect((quickAdd() as HTMLInputElement).value).toBe('')
  })

  it('the paste panel opens only from Import from paste', () => {
    renderView([coconut(100)])
    expect(screen.queryByPlaceholderText(/AMD-001, 10/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /import from paste/i }))
    const box = screen.getByPlaceholderText(/AMD-001, 10/)
    fireEvent.change(box, { target: { value: 'CM-1, 4' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 to order/i }))

    expect((screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }) as HTMLInputElement).value).toBe('4')
  })

  it('auto-saves the order as a draft after a pause, then updates that same draft', async () => {
    vi.useFakeTimers()
    try {
      renderView([coconut(100)])
      addBySku('CM-1')
      expect(mocks.saveDraft).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS) })
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
      expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ id: null, lines: [{ productId: 1, uomId: null, quantity: 1 }] })

      fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }), { target: { value: '5' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS) })
      expect(mocks.saveDraft).toHaveBeenCalledTimes(2)
      expect(mocks.saveDraft.mock.calls[1][0]).toMatchObject({
        id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b',
        lines: [{ productId: 1, uomId: null, quantity: 5 }],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('opening a draft restores customer, lines, date and notes', () => {
    const draft: OrderDraft = {
      id: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b',
      hoReCaId: 10,
      lines: [{ productId: 1, uomId: null, quantity: 4 }],
      deliveryDate: '2026-12-01',
      notes: 'Back door',
      createdBy: 'u-1',
      createdByName: 'Ann',
      updatedBy: 'u-1',
      updatedByName: 'Ann',
      createdAt: '2026-11-26T01:00:00Z',
      updatedAt: '2026-11-26T02:00:00Z',
    }
    mocks.drafts = [draft]
    renderView([coconut(100)])

    fireEvent.click(screen.getByRole('button', { name: /drafts \(1\)/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Test Restaurant')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /open/i }))

    expect(screen.getByRole('button', { name: /test restaurant/i })).toBeTruthy()
    expect((screen.getByRole('spinbutton', { name: 'Quantity for Coconut Milk' }) as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Delivery date') as HTMLInputElement).value).toBe('2026-12-01')
    expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('Back door')
  })
})
