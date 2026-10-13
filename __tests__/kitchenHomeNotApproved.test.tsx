// KitchenHomeView + the "Not approved" card, wired for real (the card, the resend
// glue and the pricing are not mocked; only the network read and the sign-in are).
//
//   - kitchen staff see their OWN rejected orders under the pending banner, with why;
//   - not a colleague's, not one they put away, not one a Customer would see;
//   - "Edit and resend" puts the order's lines into the cart via onEditItems.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { clearDismissedMemory, dismissedKey } from '@/lib/qr/dismissedRequests'
import { UserRole } from '@/types'
import type { OrderItem, Product } from '@/types'
import { mkHoReCa, mkProduct, mkUser } from './fixtures'
import { mkQrRequest } from './support/qrRequestFixture'

const { decidedHook, authState } = vi.hoisted(() => ({
  decidedHook: vi.fn(),
  authState: { userId: 'staff-sam' as string | null },
}))

vi.mock('@/hooks/queries/useQrOrderRequests', () => ({
  useDecidedQrRequests: (...args: unknown[]) => decidedHook(...args),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.userId ? { id: authState.userId } : null }),
}))
vi.mock('@/components/qr/PendingQrRequests', () => ({
  default: () => <div data-testid="pending" />,
}))

const { default: KitchenHomeView } = await import('@/views/KitchenHomeView')

const tomato = mkProduct({ id: 1, name: 'Tomato Paste', price: 4, available: 50 })
const chilli = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', price: 10, available: 20 })
const venue = mkHoReCa({ id: 7, name: 'Harbour Bistro' })
const kitchen = mkUser({ id: 7, name: 'Sam Lee', role: UserRole.QR_STAFF, hoReCaId: 7 })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 7 })

const baseProps = (products: Product[] = [tomato, chilli]) => ({
  currentUser: kitchen,
  products,
  hoReCa: venue,
  orders: [],
  promotions: [],
  cartonDiscountPercent: 5,
  pantryCount: 0,
  onOrderNow: vi.fn().mockResolvedValue({ ok: true }),
  onEditItems: vi.fn(),
  onOpenShop: vi.fn(),
  onOpenPantry: vi.fn(),
  onOpenHistory: vi.fn(),
  onViewOrder: vi.fn(),
  addToast: vi.fn(),
})

beforeEach(() => {
  decidedHook.mockReset().mockReturnValue({ data: [] })
  authState.userId = 'staff-sam'
  window.localStorage.clear()
  clearDismissedMemory()
})
afterEach(cleanup)

describe('KitchenHomeView: Not approved', () => {
  it('shows my rejected order with its reason, under the pending banner', () => {
    decidedHook.mockReturnValue({ data: [mkQrRequest({ decisionReason: 'Out of season' })] })
    render(<KitchenHomeView {...baseProps()} />)

    const card = screen.getByRole('region', { name: 'Orders not approved' })
    expect(within(card).getByText('Reason: Out of season')).toBeTruthy()
    expect(decidedHook).toHaveBeenCalledWith(7)

    const pending = screen.getByTestId('pending')
    expect(pending.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not show a colleague\'s rejected order', () => {
    decidedHook.mockReturnValue({
      data: [mkQrRequest({ id: 'theirs', requestedBy: 'staff-ana', staffName: 'Ana', decisionReason: 'Theirs' })],
    })
    render(<KitchenHomeView {...baseProps()} />)

    expect(screen.queryByRole('region', { name: 'Orders not approved' })).toBeNull()
    expect(screen.queryByText('Reason: Theirs')).toBeNull()
  })

  it('does not show one that was dismissed', () => {
    window.localStorage.setItem(dismissedKey('staff-sam'), JSON.stringify(['gone']))
    decidedHook.mockReturnValue({ data: [mkQrRequest({ id: 'gone' })] })
    render(<KitchenHomeView {...baseProps()} />)

    expect(screen.queryByRole('region', { name: 'Orders not approved' })).toBeNull()
  })

  it('is not part of a Customer\'s home: they are the approver, not the one told no', () => {
    // Even a request attributed to the signed-in login: the card is the requester's, by role.
    decidedHook.mockReturnValue({ data: [mkQrRequest({ requestedBy: 'staff-sam' })] })
    render(<KitchenHomeView {...baseProps()} currentUser={customer} />)

    expect(decidedHook).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Orders not approved' })).toBeNull()
  })

  describe('Edit and resend', () => {
    it('loads the rejected order\'s lines into the cart, at today\'s prices, and puts the card away', () => {
      decidedHook.mockReturnValue({ data: [mkQrRequest({ id: 'a' })] })
      const props = baseProps()
      render(<KitchenHomeView {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect(props.onEditItems).toHaveBeenCalledTimes(1)
      const items = props.onEditItems.mock.calls[0][0] as OrderItem[]
      expect(items.map((i) => [i.id, i.quantity, i.price])).toEqual([
        [1, 3, 4],
        [2, 1, 10],
      ])
      expect(props.addToast).not.toHaveBeenCalled()
      expect(screen.queryByRole('region', { name: 'Orders not approved' })).toBeNull()
    })

    it('brings the notes and delivery of the order back with it, as the second argument', () => {
      decidedHook.mockReturnValue({
        data: [mkQrRequest({ id: 'a', notes: 'Back door please', deliveryDate: null, deliveryTimeSlot: 'Morning (8am-12pm)' })],
      })
      const props = baseProps()
      render(<KitchenHomeView {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect(props.onEditItems.mock.calls[0][1]).toEqual({
        notes: 'Back door please',
        deliveryDate: '',
        deliveryTimeSlot: 'Morning (8am-12pm)',
      })
    })

    it('leaves out what is gone, loads the rest, and says how many', () => {
      decidedHook.mockReturnValue({ data: [mkQrRequest({ id: 'a' })] })
      const props = baseProps([chilli])
      render(<KitchenHomeView {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect((props.onEditItems.mock.calls[0][0] as OrderItem[]).map((i) => i.id)).toEqual([2])
      expect(props.addToast).toHaveBeenCalledWith('1 item is no longer available', 'info')
    })

    it('does not load an empty cart, and keeps the card, when nothing is left', () => {
      decidedHook.mockReturnValue({ data: [mkQrRequest({ id: 'a', decisionReason: 'Out of season' })] })
      const props = baseProps([mkProduct({ id: 99, name: 'Something else' })])
      render(<KitchenHomeView {...props} />)

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect(props.onEditItems).not.toHaveBeenCalled()
      expect(props.addToast).toHaveBeenCalledWith('2 items are no longer available', 'error')
      expect(screen.getByText('Reason: Out of season')).toBeTruthy()
    })
  })
})
