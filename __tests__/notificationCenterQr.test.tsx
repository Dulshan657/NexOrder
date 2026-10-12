// NotificationCenter -- the four kitchen-QR notification types.
//
//   qr_order_pending    opens the review modal for metadata.requestId
//   qr_order_approved   goes to order history (when the shell gave the bell a way to)
//   qr_order_rejected   same, and carries the reason
//   qr_code_locked      opens QR & PINs for metadata.horecaId
//
// Every tap also marks the notification read, as for every other type, and a
// notification whose action is unavailable is simply a plain one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { AppNotification } from '@/types'

vi.mock('@/hooks/queries/usePendingPos', () => ({
  usePendingPos: () => ({ data: [] }),
}))
// The real overlays are covered by their own tests; here they are markers.
vi.mock('@/components/qr/QrRequestReviewModal', () => ({
  default: ({ requestId }: { requestId: string }) => <div data-testid="review-modal">{requestId}</div>,
}))
vi.mock('@/components/qr/QrAccessPanel', () => ({
  default: ({ horecaId, open }: { horecaId: number; open: boolean }) => (
    <div data-testid="access-panel">{open ? horecaId : 'closed'}</div>
  ),
}))

import NotificationCenter from '@/components/NotificationCenter'

function notif(over: Partial<AppNotification> & Pick<AppNotification, 'id' | 'type'>): AppNotification {
  return { message: 'message', timestamp: new Date().toISOString(), read: false, ...over }
}

const pending = notif({
  id: 'n-pending',
  type: 'qr_order_pending',
  message: 'Sam sent an order for Cafe Roma',
  metadata: { requestId: 'req-1', horecaId: 7, staffName: 'Sam', itemCount: 3, quotedTotal: 48.2 },
})
const approved = notif({
  id: 'n-approved',
  type: 'qr_order_approved',
  message: 'Your order for Cafe Roma was approved with changes',
  metadata: { requestId: 'req-1', orderId: 'ORD-5', horecaId: 7, edited: true },
})
const rejected = notif({
  id: 'n-rejected',
  type: 'qr_order_rejected',
  message: 'Your order for Cafe Roma was declined',
  metadata: { requestId: 'req-2', horecaId: 7, reason: 'Out of season' },
})
const locked = notif({
  id: 'n-locked',
  type: 'qr_code_locked',
  message: 'Cafe Roma\'s QR code was locked',
  metadata: { horecaId: 7, horecaName: 'Cafe Roma' },
})

function renderCenter(
  notifications: AppNotification[],
  extra: { onOpenOrders?: (orderId: string | null) => void } = {},
) {
  const onMarkRead = vi.fn()
  render(
    <NotificationCenter
      notifications={notifications}
      onMarkRead={onMarkRead}
      onMarkAllRead={vi.fn()}
      isAdminOrManager={false}
      onOpenPoInbox={vi.fn()}
      {...extra}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }))
  return onMarkRead
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('NotificationCenter: kitchen QR notifications', () => {
  it('shows the server\'s message with the facts from metadata under it', () => {
    renderCenter([pending, rejected, approved])

    expect(screen.getByText('Sam sent an order for Cafe Roma')).toBeTruthy()
    expect(screen.getByText('Sam · 3 items · $48.20 est.')).toBeTruthy()
    expect(screen.getByText('Reason: Out of season')).toBeTruthy()
    expect(screen.getByText('Approved with changes')).toBeTruthy()
  })

  it('opens the review modal for the request when a pending notification is tapped, and marks it read', async () => {
    const onMarkRead = renderCenter([pending])

    fireEvent.click(screen.getByText('Sam sent an order for Cafe Roma'))

    const modal = await screen.findByTestId('review-modal')
    expect(modal.textContent).toBe('req-1')
    expect(onMarkRead).toHaveBeenCalledWith('n-pending')
    // The dropdown gets out of the way of the overlay.
    expect(screen.queryByText('No notifications')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close notifications' })).toBeNull()
  })

  it('opens QR & PINs for the venue when a lock notification is tapped', async () => {
    renderCenter([locked])

    fireEvent.click(screen.getByText('Cafe Roma\'s QR code was locked'))

    const panel = await screen.findByTestId('access-panel')
    expect(panel.textContent).toBe('7')
  })

  it('takes an approval to order history with the order it placed', () => {
    const onOpenOrders = vi.fn()
    const onMarkRead = renderCenter([approved], { onOpenOrders })

    fireEvent.click(screen.getByText('Your order for Cafe Roma was approved with changes'))

    expect(onOpenOrders).toHaveBeenCalledWith('ORD-5')
    expect(onMarkRead).toHaveBeenCalledWith('n-approved')
  })

  it('takes a rejection to order history too, with no order', () => {
    const onOpenOrders = vi.fn()
    renderCenter([rejected], { onOpenOrders })

    fireEvent.click(screen.getByText('Your order for Cafe Roma was declined'))

    expect(onOpenOrders).toHaveBeenCalledWith(null)
  })

  it('just marks a decision read when the shell gave no way to navigate', () => {
    const onMarkRead = renderCenter([approved])

    expect(screen.queryByText(/View order history/)).toBeNull()
    fireEvent.click(screen.getByText('Your order for Cafe Roma was approved with changes'))

    expect(onMarkRead).toHaveBeenCalledWith('n-approved')
    expect(screen.queryByTestId('review-modal')).toBeNull()
  })

  it('labels what a tap will do', () => {
    renderCenter([pending, locked], { onOpenOrders: vi.fn() })

    expect(screen.getByText(/Review order/)).toBeTruthy()
    expect(screen.getByText(/Open QR & PINs/)).toBeTruthy()
  })

  it('does nothing extra for a pending notification that lost its request id', () => {
    const broken = notif({ id: 'n-broken', type: 'qr_order_pending', message: 'broken', metadata: {} })
    const onMarkRead = renderCenter([broken])

    fireEvent.click(screen.getByText('broken'))

    expect(onMarkRead).toHaveBeenCalledWith('n-broken')
    expect(screen.queryByTestId('review-modal')).toBeNull()
  })
})
