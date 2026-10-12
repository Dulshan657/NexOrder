// QrRequestReviewModal -- the approver's screen for a held kitchen order.
//
// What these pin is the CONTRACT with the server, not the layout:
//   - an edit re-prices through `preview` with the EDITED lines (debounced),
//   - `approve` carries `items` only when the approver changed something (that is
//     what the server turns into "approved with changes"),
//   - Approve is withheld whenever the server said the order would not place,
//   - Reject needs a reason of 3+ characters,
//   - a conflict closes the modal with the server's words rather than leaving a
//     button that cannot work.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { QrApiError } from '@/lib/qr/qrApiError'
import type { QrLineInput, QrOrderPreview } from '@/services/supabase/qrService'
import type { QrOrderRequest } from '@/types'

const { previewHook, approveMock, rejectMock, addToast, approveState } = vi.hoisted(() => ({
  previewHook: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  addToast: vi.fn(),
  approveState: { pending: false },
}))

vi.mock('@/hooks/queries/useQrOrderRequests', () => ({
  useQrRequestPreview: (...args: unknown[]) => previewHook(...args),
  useApproveQrRequest: () => ({ mutateAsync: approveMock, isPending: approveState.pending }),
  useRejectQrRequest: () => ({ mutateAsync: rejectMock, isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast }),
  useToastActions: () => ({ addToast }),
}))

import QrRequestReviewModal from '@/components/qr/QrRequestReviewModal'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'

const request: QrOrderRequest = {
  id: REQUEST_ID,
  horecaId: 7,
  requestedBy: 'staff-user',
  qrStaffId: 'staff-1',
  staffName: 'Sam',
  status: 'pending',
  items: [
    { productId: 1, quantity: 2, packSize: null, uomId: null, productName: 'Fresh Cream 1L', productSku: 'CRM-1' },
    { productId: 2, quantity: 3, packSize: null, uomId: null, productName: 'Butter 500g', productSku: 'BTR-5' },
  ],
  notes: 'Leave at the back door',
  deliveryDate: '2026-10-14',
  deliveryTimeSlot: 'Morning (8am-12pm)',
  deliveryAddress: null,
  quotedTotal: 48.2,
  createdAt: '2026-10-12T00:42:00.000Z',
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  lastError: null,
  editedByApprover: false,
  approvedOrderId: null,
}

function makePreview(over: Partial<QrOrderPreview> = {}): QrOrderPreview {
  return {
    ok: true,
    problems: [],
    lines: [
      { productId: 1, quantity: 2, packSize: null, uomId: null, productName: 'Fresh Cream 1L', productSku: 'CRM-1', unitPrice: 5, appliedPromotionId: null, lineTotal: 10, baseUnits: 2 },
      { productId: 2, quantity: 3, packSize: null, uomId: null, productName: 'Butter 500g', productSku: 'BTR-5', unitPrice: 8, appliedPromotionId: null, lineTotal: 24, baseUnits: 3 },
    ],
    stock: [
      { productId: 1, productName: 'Fresh Cream 1L', requested: 2, available: 50, short: false },
      { productId: 2, productName: 'Butter 500g', requested: 3, available: 100, short: false },
    ],
    subtotal: 34,
    cartDiscount: 0,
    total: 34,
    appliedPromotionIds: [],
    bogoFreeItems: [],
    creditLimit: 0,
    outstanding: 0,
    minimumOrderValue: 0,
    hoReCa: { id: 7, name: 'Cafe Roma' },
    ...over,
  }
}

interface HookState {
  req?: QrOrderRequest
  preview?: QrOrderPreview | null
}

/** The preview hook as the component sees it: same request, a preview that follows `items`. */
function installPreview({ req = request, preview = makePreview() }: HookState = {}) {
  previewHook.mockImplementation((_id: string, _items?: QrLineInput[]) => ({
    data: { request: req, preview },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }))
}

const qty = (name: string) => screen.getByLabelText(`Quantity of ${name}`) as HTMLInputElement
const lastItemsArg = () => previewHook.mock.calls[previewHook.mock.calls.length - 1][1] as QrLineInput[] | undefined

function renderModal(onClose = vi.fn()) {
  render(<QrRequestReviewModal requestId={REQUEST_ID} onClose={onClose} />)
  return onClose
}

beforeEach(() => {
  previewHook.mockReset()
  approveMock.mockReset()
  rejectMock.mockReset()
  addToast.mockReset()
  approveState.pending = false
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('QrRequestReviewModal: reading the request', () => {
  it('shows who sent it, each line priced by the server, and the totals', () => {
    installPreview()
    renderModal()

    expect(screen.getByText(/Cafe Roma/)).toBeTruthy()
    expect(screen.getByText(/Sam/)).toBeTruthy()
    expect(screen.getByText('Fresh Cream 1L')).toBeTruthy()
    expect(screen.getByText('$10.00')).toBeTruthy()
    expect(screen.getByText('$24.00')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText('Leave at the back door')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve order' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('flags a line the stock cannot cover and withholds Approve with the server\'s reasons', () => {
    installPreview({
      preview: makePreview({
        ok: false,
        problems: [{ code: 'INSUFFICIENT_STOCK', message: 'Only 1 of Butter 500g is available', productId: 2, requested: 3, available: 1 }],
        stock: [
          { productId: 1, productName: 'Fresh Cream 1L', requested: 2, available: 50, short: false },
          { productId: 2, productName: 'Butter 500g', requested: 3, available: 1, short: true },
        ],
      }),
    })
    renderModal()

    expect(screen.getByText('This order cannot be approved yet')).toBeTruthy()
    expect(screen.getByText('Only 1 of Butter 500g is available')).toBeTruthy()
    expect(screen.getByText('Short on stock: 1 available, 3 needed')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve order' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a decided request read-only, with the reason, and offers no decision', () => {
    installPreview({
      req: { ...request, status: 'rejected', decisionReason: 'Out of season' },
      preview: null,
    })
    renderModal()

    expect(screen.getByText('Declined')).toBeTruthy()
    expect(screen.getByText('Reason: Out of season')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })
})

describe('QrRequestReviewModal: editing lines', () => {
  it('re-prices with the EDITED lines after a short pause, and holds Approve until it has', async () => {
    installPreview()
    renderModal()
    expect(lastItemsArg()).toBeUndefined() // as requested: nothing sent

    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '5' } })

    // Immediately after the edit the figures on screen describe the OLD quantity.
    expect((screen.getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true)

    await waitFor(() => {
      expect(lastItemsArg()).toEqual([
        { productId: 1, quantity: 5, packSize: null, uomId: null },
        { productId: 2, quantity: 3, packSize: null, uomId: null },
      ])
    })
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Approve with changes' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('removing a line re-prices without it', async () => {
    installPreview()
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Butter 500g' }))

    await waitFor(() => {
      expect(lastItemsArg()).toEqual([{ productId: 1, quantity: 2, packSize: null, uomId: null }])
    })
  })

  it('sends no items when the approver changes nothing, and the edited lines when they do', async () => {
    installPreview()
    approveMock.mockResolvedValue({ orderId: 'ORD-9', total: 34 })
    const onClose = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Approve order' }))
    await waitFor(() => expect(approveMock).toHaveBeenCalledTimes(1))
    expect(approveMock).toHaveBeenLastCalledWith({ requestId: REQUEST_ID })
    expect(addToast).toHaveBeenCalledWith('Order ORD-9 placed', 'success')
    expect(onClose).toHaveBeenCalled()

    // Second, edited approval in a fresh modal.
    cleanup()
    approveMock.mockClear()
    installPreview()
    renderModal()
    fireEvent.change(qty('Butter 500g'), { target: { value: '1' } })
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Approve with changes' }) as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve with changes' }))
    await waitFor(() => expect(approveMock).toHaveBeenCalledTimes(1))
    expect(approveMock).toHaveBeenLastCalledWith({
      requestId: REQUEST_ID,
      items: [
        { productId: 1, quantity: 2, packSize: null, uomId: null },
        { productId: 2, quantity: 1, packSize: null, uomId: null },
      ],
    })
  })

  it('does not treat a change that was put back as an edit', async () => {
    installPreview()
    renderModal()

    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '9' } })
    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '2' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve order' })).toBeTruthy()
    })
  })

  it('asks before throwing away edits', async () => {
    installPreview()
    const onClose = renderModal()

    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '5' } })
    // Two ways to dismiss -- the header X and the footer Close -- and both are guarded.
    const dismissers = screen.getAllByRole('button', { name: 'Close' })
    expect(dismissers.length).toBe(2)
    fireEvent.click(dismissers[dismissers.length - 1])

    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes straight away when nothing was edited', () => {
    installPreview()
    const onClose = renderModal()

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('QrRequestReviewModal: rejecting', () => {
  it('needs a reason of at least 3 characters, then sends it trimmed', async () => {
    installPreview()
    rejectMock.mockResolvedValue(undefined)
    const onClose = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const decline = screen.getByRole('button', { name: 'Decline order' }) as HTMLButtonElement
    expect(decline.disabled).toBe(true)

    const reason = screen.getByLabelText(/Reason/)
    fireEvent.change(reason, { target: { value: 'no' } })
    expect(decline.disabled).toBe(true)

    fireEvent.change(reason, { target: { value: '  Out of stock  ' } })
    expect(decline.disabled).toBe(false)

    fireEvent.click(decline)
    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(1))
    expect(rejectMock).toHaveBeenCalledWith({ requestId: REQUEST_ID, reason: 'Out of stock' })
    expect(addToast).toHaveBeenCalledWith('Order request declined', 'success')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('QrRequestReviewModal: when the server says no', () => {
  it('closes with the server\'s message when someone decided first', async () => {
    installPreview()
    approveMock.mockRejectedValue(
      new QrApiError({ code: 'QR_REQUEST_CONFLICT', message: 'Sam\'s order was already approved by someone else', details: { status: 'approved' } }),
    )
    const onClose = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Approve order' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(addToast).toHaveBeenCalledWith('Sam\'s order was already approved by someone else', 'error')
  })

  it('closes, and does not offer a second Approve, when the order was placed but not marked', async () => {
    installPreview()
    approveMock.mockRejectedValue(
      new QrApiError({ code: 'INTERNAL', message: 'Order ORD-7 was placed, but this request could not be marked approved.', details: { orderId: 'ORD-7' } }),
    )
    const onClose = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Approve order' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(addToast).toHaveBeenCalledWith('Order ORD-7 was placed, but this request could not be marked approved.', 'error')
  })

  it('keeps the modal open and says why when a business rule refuses the order', async () => {
    installPreview()
    approveMock.mockRejectedValue(new QrApiError({ code: 'CREDIT_EXCEEDED', message: 'This order would exceed the credit limit' }))
    const onClose = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Approve order' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This order would exceed the credit limit')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('QrRequestReviewModal: edge cases the first review found', () => {
  it('does not leave the old total on screen once every line has been removed', async () => {
    installPreview()
    renderModal()
    expect(screen.getByText('Total')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fresh Cream 1L' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Butter 500g' }))

    await waitFor(() => expect(screen.queryByText('Total')).toBeNull())
    expect(screen.getByText(/Every line has been removed/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hands focus to the line that takes the removed one\'s place', async () => {
    installPreview()
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Fresh Cream 1L' }))

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove Butter 500g')
    })
  })

  it('keeps the editor, and the draft, when a re-price fails', async () => {
    installPreview()
    renderModal()

    // The next pricing attempt fails (a network blip while the approver edits).
    previewHook.mockImplementation(() => ({
      data: undefined,
      error: new QrApiError({ code: 'NETWORK', message: 'Could not reach the server.' }),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    }))
    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '5' } })

    expect(await screen.findByText('Could not price the order')).toBeTruthy()
    expect(screen.getByText(/Your changes are kept/)).toBeTruthy()
    expect(qty('Fresh Cream 1L').value).toBe('5')
    expect((screen.getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('freezes the quantities while an approval is in flight', () => {
    installPreview()
    approveState.pending = true
    renderModal()

    expect(qty('Fresh Cream 1L').disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Increase quantity of Fresh Cream 1L' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove Fresh Cream 1L' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not ask to discard anything once the request is decided', () => {
    installPreview({ req: { ...request, status: 'cancelled' }, preview: null })
    const onClose = renderModal()

    const dismissers = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(dismissers[dismissers.length - 1])

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Discard your changes?')).toBeNull()
  })

  it('keeps the minus button focusable at 1 rather than disabling it under the user', () => {
    installPreview()
    renderModal()

    fireEvent.change(qty('Fresh Cream 1L'), { target: { value: '1' } })
    const minus = screen.getByRole('button', { name: 'Decrease quantity of Fresh Cream 1L' }) as HTMLButtonElement

    expect(minus.disabled).toBe(false)
    expect(minus.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(minus)
    expect(qty('Fresh Cream 1L').value).toBe('1')
  })
})
