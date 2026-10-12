// PendingQrRequests -- held kitchen orders, from the kitchen's side and the
// approver's. The two rules worth pinning:
//   - a kitchen sees Cancel on the requests THEY sent, never a colleague's, and
//   - an approver's Review opens the review modal for THAT request.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { QrApiError } from '@/lib/qr/qrApiError'
import type { QrOrderRequest } from '@/types'

const { pendingHook, cancelMock, addToast, authState } = vi.hoisted(() => ({
  pendingHook: vi.fn(),
  cancelMock: vi.fn(),
  addToast: vi.fn(),
  authState: { userId: 'staff-sam' as string | null },
}))

vi.mock('@/hooks/queries/useQrOrderRequests', () => ({
  usePendingQrRequests: (...args: unknown[]) => pendingHook(...args),
  useCancelQrRequest: () => ({ mutateAsync: cancelMock, isPending: false }),
}))
vi.mock('@/hooks/queries/useHoReCas', () => ({
  useHoReCas: () => ({
    data: [
      { id: 7, name: 'Cafe Roma' },
      { id: 8, name: 'Hotel Aurora' },
    ],
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.userId ? { id: authState.userId } : null }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast }),
  useToastActions: () => ({ addToast }),
}))
// The real modal is covered by qrRequestReviewModal.test.tsx; here it is just a marker.
vi.mock('@/components/qr/QrRequestReviewModal', () => ({
  default: ({ requestId }: { requestId: string }) => <div data-testid="review-modal">{requestId}</div>,
}))

import PendingQrRequests from '@/components/qr/PendingQrRequests'

function req(over: Partial<QrOrderRequest>): QrOrderRequest {
  return {
    id: 'req-1',
    horecaId: 7,
    requestedBy: 'staff-sam',
    qrStaffId: 's1',
    staffName: 'Sam',
    status: 'pending',
    items: [
      { productId: 1, quantity: 2, packSize: null, uomId: null },
      { productId: 2, quantity: 1, packSize: null, uomId: null },
      { productId: 3, quantity: 4, packSize: null, uomId: null },
    ],
    notes: null,
    deliveryDate: null,
    deliveryTimeSlot: null,
    deliveryAddress: null,
    quotedTotal: 48.2,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    lastError: null,
    editedByApprover: false,
    approvedOrderId: null,
    ...over,
  }
}

function pending(rows: QrOrderRequest[]) {
  pendingHook.mockReturnValue({ data: rows })
}

beforeEach(() => {
  pendingHook.mockReset()
  cancelMock.mockReset()
  addToast.mockReset()
  authState.userId = 'staff-sam'
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('PendingQrRequests', () => {
  it('renders nothing while there is nothing pending', () => {
    pending([])
    const { container } = render(<PendingQrRequests mode="approver" />)
    expect(container.firstChild).toBeNull()
  })

  it('scopes the list to the venue it is given', () => {
    pending([])
    render(<PendingQrRequests mode="requester" horecaId={7} />)
    expect(pendingHook).toHaveBeenCalledWith(7)
  })

  describe('requester (kitchen staff)', () => {
    it('says the order is waiting, with the estimate and the size', () => {
      pending([req({})])
      render(<PendingQrRequests mode="requester" horecaId={7} />)

      expect(screen.getByText('Waiting for approval')).toBeTruthy()
      const row = screen.getByText(/sent/)
      expect(row.textContent).toContain('$48.20 est.')
      expect(row.textContent).toContain('3 items')
    })

    it('offers Cancel on their own request only, not a colleague\'s', () => {
      pending([
        req({ id: 'mine', requestedBy: 'staff-sam', staffName: 'Sam' }),
        req({ id: 'theirs', requestedBy: 'staff-ana', staffName: 'Ana' }),
      ])
      render(<PendingQrRequests mode="requester" horecaId={7} />)

      expect(screen.getAllByRole('button', { name: /Cancel your order request/ })).toHaveLength(1)
      // The colleague's order is still shown, so the kitchen knows one is already in.
      expect(screen.getByText(/Ana/)).toBeTruthy()
    })

    it('cancels the request and says so', async () => {
      pending([req({ id: 'mine' })])
      cancelMock.mockResolvedValue(undefined)
      render(<PendingQrRequests mode="requester" horecaId={7} />)

      fireEvent.click(screen.getByRole('button', { name: /Cancel your order request/ }))

      await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('mine'))
      await waitFor(() => expect(addToast).toHaveBeenCalledWith('Order request cancelled', 'success'))
    })

    it('shows the server\'s words when an approver got there first', async () => {
      pending([req({ id: 'mine' })])
      cancelMock.mockRejectedValue(
        new QrApiError({ code: 'QR_REQUEST_CONFLICT', message: 'That order was already approved', details: { status: 'approved' } }),
      )
      render(<PendingQrRequests mode="requester" horecaId={7} />)

      fireEvent.click(screen.getByRole('button', { name: /Cancel your order request/ }))

      await waitFor(() => expect(addToast).toHaveBeenCalledWith('That order was already approved', 'error'))
    })

    it('offers no Cancel when nobody is signed in', () => {
      authState.userId = null
      pending([req({})])
      render(<PendingQrRequests mode="requester" horecaId={7} />)

      expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull()
    })
  })

  describe('approver', () => {
    it('lists each held order with its venue and who sent it, under a count', () => {
      pending([
        req({ id: 'a', horecaId: 7, staffName: 'Sam' }),
        req({ id: 'b', horecaId: 8, staffName: 'Ana', quotedTotal: 12 }),
      ])
      render(<PendingQrRequests mode="approver" />)

      expect(screen.getByText('Awaiting approval (2)')).toBeTruthy()
      expect(screen.getByText('Cafe Roma')).toBeTruthy()
      expect(screen.getByText('Hotel Aurora')).toBeTruthy()
      expect(screen.getByText(/Ana/).textContent).toContain('$12.00 est.')
      expect(screen.getAllByRole('button', { name: /Review order from/ })).toHaveLength(2)
      expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull()
    })

    it('opens the review modal for the request whose Review was pressed', async () => {
      pending([
        req({ id: 'a', horecaId: 7 }),
        req({ id: 'b', horecaId: 8 }),
      ])
      render(<PendingQrRequests mode="approver" />)

      fireEvent.click(screen.getByRole('button', { name: /Review order from Hotel Aurora/ }))

      const modal = await screen.findByTestId('review-modal')
      expect(modal.textContent).toBe('b')
    })

    it('keeps the review modal open when approving empties the list', async () => {
      // Approving claims the request, which takes it out of the pending list. With one
      // request that empties the list -- and the modal must survive that, or it would
      // unmount in the middle of its own approval.
      pending([req({ id: 'only', horecaId: 7 })])
      const { rerender } = render(<PendingQrRequests mode="approver" />)

      fireEvent.click(screen.getByRole('button', { name: /Review order from Cafe Roma/ }))
      expect((await screen.findByTestId('review-modal')).textContent).toBe('only')

      pending([])
      rerender(<PendingQrRequests mode="approver" />)

      expect(screen.queryByText(/Awaiting approval/)).toBeNull()
      expect(screen.getByTestId('review-modal').textContent).toBe('only')
    })

    it('says when the last approval attempt failed', () => {
      pending([req({ lastError: 'Not enough stock' })])
      render(<PendingQrRequests mode="approver" />)

      expect(screen.getByText(/Last approval attempt failed: Not enough stock/)).toBeTruthy()
    })

    it('folds a long queue behind Show all', () => {
      pending(Array.from({ length: 7 }, (_, i) => req({ id: `r${i}`, horecaId: 7 })))
      render(<PendingQrRequests mode="approver" compact />)

      expect(screen.getAllByRole('button', { name: /Review order from/ })).toHaveLength(5)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }))
      expect(screen.getAllByRole('button', { name: /Review order from/ })).toHaveLength(7)
    })
  })
})
