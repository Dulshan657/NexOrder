// Order History -- the lasting record of orders an approver turned down (or staff
// withdrew). A rejected request never becomes an order, so without this section
// the history showed no trace of it at all.
//
//   - kitchen staff see THEIR OWN, a Customer sees the whole venue's;
//   - "Not approved" (red) vs "Cancelled by you" / "Cancelled by staff" (stone);
//   - kitchen staff get "Edit and resend", a Customer does not;
//   - it sits directly under the pending banner, above the filters and the table.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import { clearDismissedMemory, dismissedKey, readDismissed } from '@/lib/qr/dismissedRequests'
import { UserRole } from '@/types'
import { mkUser } from './fixtures'
import { expectNoA11yViolations } from './support/axe'
import { DAY_MS, ago, mkQrRequest } from './support/qrRequestFixture'

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
// The pending banner has its own tests; here it is a marker to place the section against.
vi.mock('@/components/qr/PendingQrRequests', () => ({
  default: () => <div data-testid="pending" />,
}))

const { default: OrderHistory } = await import('@/components/OrderHistory')
// OrderHistory pulls the section in through a lazy import(). Transforming it on first use
// can outlast a findBy's default second when the whole suite is running; doing it here, once,
// makes every test below wait only for React, not for the module graph.
await import('@/components/qr/DecidedQrRequests')
configure({ asyncUtilTimeout: 5000 })

const kitchen = mkUser({ id: 7, name: 'Sam Lee', role: UserRole.QR_STAFF, hoReCaId: 7 })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 7 })

function renderHistory(currentUser = kitchen, onResendQrRequest = vi.fn().mockReturnValue(true)) {
  render(
    <OrderHistory
      orders={[]}
      hoReCas={[]}
      invoices={[]}
      currentUser={currentUser}
      onReorder={vi.fn()}
      onViewDetail={vi.fn()}
      onBack={vi.fn()}
      onResendQrRequest={onResendQrRequest}
    />,
  )
  return { onResendQrRequest }
}

const section = () => screen.findByRole('region', { name: 'Not approved and cancelled' })

beforeEach(() => {
  decidedHook.mockReset().mockReturnValue({ data: [] })
  authState.userId = 'staff-sam'
  window.localStorage.clear()
  clearDismissedMemory()
})
afterEach(cleanup)

describe('OrderHistory: Not approved and cancelled', () => {
  it('shows a rejected order as "Not approved", with when, what, how much and why', async () => {
    decidedHook.mockReturnValue({ data: [mkQrRequest({ decisionReason: 'Out of season', quotedTotal: 22 })] })
    renderHistory()

    const region = await section()
    expect(decidedHook).toHaveBeenCalledWith(7)
    expect(within(region).getByText('Not approved')).toBeTruthy()
    expect(within(region).getByText(/^sent /)).toBeTruthy()
    expect(within(region).getByText('Tomato Paste × 3, Chilli Oil × 1')).toBeTruthy()
    // An estimate, and it says so.
    expect(within(region).getByText('$22.00 est.')).toBeTruthy()
    expect(within(region).getByText('Reason: Out of season')).toBeTruthy()
  })

  it('sits under the pending banner and above the filters', async () => {
    decidedHook.mockReturnValue({ data: [mkQrRequest()] })
    renderHistory()

    const region = await section()
    const pending = screen.getByTestId('pending')
    const search = screen.getByLabelText(/Search by Order ID/)
    expect(pending.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(region.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders nothing while there is nothing decided', async () => {
    renderHistory()
    await screen.findByTestId('pending')
    expect(screen.queryByRole('region', { name: 'Not approved and cancelled' })).toBeNull()
  })

  describe('kitchen staff', () => {
    it('see their own rejected and cancelled orders, labelled differently', async () => {
      decidedHook.mockReturnValue({
        data: [
          mkQrRequest({ id: 'rej', status: 'rejected', decisionReason: 'Out of season' }),
          mkQrRequest({ id: 'can', status: 'cancelled', decisionReason: null }),
        ],
      })
      renderHistory()

      const region = await section()
      expect(within(region).getByText('Not approved')).toBeTruthy()
      expect(within(region).getByText('Cancelled by you')).toBeTruthy()
      // A cancellation has no reason to give, so no empty "Reason:" line.
      expect(within(region).getAllByText(/^Reason:/)).toHaveLength(1)
    })

    it('do not see a colleague\'s', async () => {
      decidedHook.mockReturnValue({
        data: [
          mkQrRequest({ id: 'mine', decisionReason: 'Mine' }),
          mkQrRequest({ id: 'theirs', requestedBy: 'staff-ana', staffName: 'Ana', decisionReason: 'Theirs' }),
        ],
      })
      renderHistory()

      const region = await section()
      expect(within(region).getByText('Reason: Mine')).toBeTruthy()
      expect(within(region).queryByText('Reason: Theirs')).toBeNull()
    })

    it('still see one the home card has aged out or they dismissed: this is the record', async () => {
      window.localStorage.setItem(dismissedKey('staff-sam'), JSON.stringify(['old']))
      decidedHook.mockReturnValue({
        data: [mkQrRequest({ id: 'old', decisionReason: 'From last month', decidedAt: ago(40 * DAY_MS) })],
      })
      renderHistory()

      expect(within(await section()).getByText('Reason: From last month')).toBeTruthy()
    })

    it('can edit and resend, which loads the cart and puts the home card away', async () => {
      const request = mkQrRequest({ id: 'a' })
      decidedHook.mockReturnValue({ data: [request] })
      const { onResendQrRequest } = renderHistory()

      fireEvent.click(within(await section()).getByRole('button', { name: /^Edit and resend/ }))

      expect(onResendQrRequest).toHaveBeenCalledWith(request)
      expect(readDismissed('staff-sam')).toEqual(['a'])
      // The history row stays: it is a record, not a to-do.
      expect(within(await section()).getByText('Not approved')).toBeTruthy()
    })

    it('leave the home card alone when the resend loaded nothing', async () => {
      decidedHook.mockReturnValue({ data: [mkQrRequest({ id: 'a' })] })
      renderHistory(kitchen, vi.fn().mockReturnValue(false))

      fireEvent.click(within(await section()).getByRole('button', { name: /^Edit and resend/ }))

      expect(readDismissed('staff-sam')).toEqual([])
    })
  })

  describe('a Customer login', () => {
    it('sees every decided order of the venue, naming who sent it, but cannot resend', async () => {
      authState.userId = 'cust-dee'
      decidedHook.mockReturnValue({
        data: [
          mkQrRequest({ id: 'a', requestedBy: 'staff-sam', staffName: 'Sam', decisionReason: 'No stock' }),
          mkQrRequest({ id: 'b', requestedBy: 'staff-ana', staffName: 'Ana', status: 'cancelled', decisionReason: null }),
        ],
      })
      renderHistory(customer)

      const region = await section()
      expect(within(region).getByText('Not approved')).toBeTruthy()
      expect(within(region).getByText('Cancelled by staff')).toBeTruthy()
      expect(within(region).getByText(/^Sam · sent /)).toBeTruthy()
      expect(within(region).getByText(/^Ana · sent /)).toBeTruthy()
      expect(within(region).queryByRole('button', { name: /Edit and resend/ })).toBeNull()
    })
  })

  it('folds a long list behind "Show all"', async () => {
    decidedHook.mockReturnValue({
      data: Array.from({ length: 7 }, (_, i) => mkQrRequest({ id: `r${i}`, decisionReason: `Reason ${i}` })),
    })
    renderHistory()

    const region = await section()
    expect(within(region).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(within(region).getByRole('button', { name: 'Show all 7' }))
    expect(within(region).getAllByRole('listitem')).toHaveLength(7)
  })

  it('lets the amount and the reason wrap at 360px: nothing in a row truncates or refuses to wrap', async () => {
    decidedHook.mockReturnValue({ data: [mkQrRequest({ decisionReason: 'A reason long enough to need a second line on a phone' })] })
    renderHistory()

    const region = await section()
    for (const text of [region.querySelector('li')!, within(region).getByText('$22.00 est.'), within(region).getByText(/^Reason:/)]) {
      for (let el: HTMLElement | null = text as HTMLElement; el && el !== region; el = el.parentElement) {
        expect(el.className, el.tagName).not.toMatch(/truncate|whitespace-nowrap|overflow-hidden|text-ellipsis/)
      }
    }
  })

  it('has no WCAG 2.2 AA violations', async () => {
    decidedHook.mockReturnValue({
      data: [mkQrRequest({ id: 'a' }), mkQrRequest({ id: 'b', status: 'cancelled', decisionReason: null })],
    })
    renderHistory()

    const region = await section()
    await expectNoA11yViolations(region)
  })
})
