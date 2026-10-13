// NotApprovedCard -- the Order home card that tells kitchen staff an approver said
// no, and why. What is worth pinning:
//   - it shows MY rejected requests, not a colleague's and not my own cancellations;
//   - the reason is on the card (it used to be gone the moment the banner emptied);
//   - "Edit and resend" hands the request on, and puts the card away only if the
//     cart really was loaded;
//   - "Dismiss" hides it, remembers that, and survives storage that throws.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { clearDismissedMemory, dismissedKey, readDismissed } from '@/lib/qr/dismissedRequests'
import { DAY_MS, ago, mkQrRequest } from './support/qrRequestFixture'
import { expectNoA11yViolations } from './support/axe'

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

import NotApprovedCard from '@/components/qr/NotApprovedCard'

function decided(rows: ReturnType<typeof mkQrRequest>[]) {
  decidedHook.mockReturnValue({ data: rows })
}

const mount = (onResend = vi.fn().mockReturnValue(true)) => {
  render(<NotApprovedCard horecaId={7} onResend={onResend} />)
  return { onResend }
}

beforeEach(() => {
  decidedHook.mockReset()
  authState.userId = 'staff-sam'
  window.localStorage.clear()
  clearDismissedMemory()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NotApprovedCard', () => {
  it('asks for the decided requests of its own venue', () => {
    decided([])
    mount()
    expect(decidedHook).toHaveBeenCalledWith(7)
  })

  it('renders nothing while there is nothing to explain', () => {
    decided([])
    const { container } = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('says "Not approved", when it was sent, why, and what was in it', () => {
    decided([mkQrRequest({ decisionReason: 'Out of season' })])
    mount()

    const card = screen.getByRole('region', { name: 'Orders not approved' })
    expect(within(card).getByText(/^Not approved · sent /)).toBeTruthy()
    expect(within(card).getByText('Reason: Out of season')).toBeTruthy()
    expect(within(card).getByText('Tomato Paste × 3, Chilli Oil × 1')).toBeTruthy()
  })

  it('shows no reason line, rather than "Reason: null", when the row carries none', () => {
    decided([mkQrRequest({ decisionReason: null })])
    mount()
    expect(screen.queryByText(/Reason:/)).toBeNull()
  })

  it('shows one card per own rejected request, newest first as given', () => {
    decided([
      mkQrRequest({ id: 'a', decisionReason: 'First reason' }),
      mkQrRequest({ id: 'b', decisionReason: 'Second reason' }),
    ])
    mount()

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Reason: First reason')).toBeTruthy()
    expect(within(items[1]).getByText('Reason: Second reason')).toBeTruthy()
  })

  it('does not show a colleague\'s rejected order, though the venue can see it', () => {
    decided([
      mkQrRequest({ id: 'mine', requestedBy: 'staff-sam', decisionReason: 'Mine' }),
      mkQrRequest({ id: 'theirs', requestedBy: 'staff-ana', staffName: 'Ana', decisionReason: 'Theirs' }),
    ])
    mount()

    expect(screen.getByText('Reason: Mine')).toBeTruthy()
    expect(screen.queryByText('Reason: Theirs')).toBeNull()
  })

  it('does not show an order the person cancelled themselves', () => {
    decided([mkQrRequest({ status: 'cancelled', decisionReason: null })])
    const { container } = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows nothing when nobody is signed in', () => {
    authState.userId = null
    decided([mkQrRequest()])
    const { container } = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('hides a card whose decision is over a week old', () => {
    decided([
      mkQrRequest({ id: 'new', decisionReason: 'Recent', decidedAt: ago(2 * DAY_MS) }),
      mkQrRequest({ id: 'old', decisionReason: 'Ancient', decidedAt: ago(8 * DAY_MS) }),
    ])
    mount()
    expect(screen.getByText('Reason: Recent')).toBeTruthy()
    expect(screen.queryByText('Reason: Ancient')).toBeNull()
  })

  describe('Edit and resend', () => {
    it('hands the request on, and puts the card away once the cart is loaded', () => {
      const request = mkQrRequest({ id: 'a' })
      decided([request])
      const { onResend } = mount(vi.fn().mockReturnValue(true))

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect(onResend).toHaveBeenCalledTimes(1)
      expect(onResend).toHaveBeenCalledWith(request)
      expect(screen.queryByText(/^Not approved/)).toBeNull()
      expect(readDismissed('staff-sam')).toEqual(['a'])
    })

    it('keeps the card when nothing could be loaded, so the reason is still there', () => {
      decided([mkQrRequest({ id: 'a' })])
      const { onResend } = mount(vi.fn().mockReturnValue(false))

      fireEvent.click(screen.getByRole('button', { name: /^Edit and resend/ }))

      expect(onResend).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Reason: Out of season')).toBeTruthy()
      expect(readDismissed('staff-sam')).toEqual([])
    })

    it('acts on the card whose button was pressed', () => {
      const a = mkQrRequest({ id: 'a', decisionReason: 'A' })
      const b = mkQrRequest({ id: 'b', decisionReason: 'B' })
      decided([a, b])
      const { onResend } = mount()

      fireEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: /^Edit and resend/ }))

      expect(onResend).toHaveBeenCalledWith(b)
      expect(screen.getByText('Reason: A')).toBeTruthy()
      expect(screen.queryByText('Reason: B')).toBeNull()
    })
  })

  describe('Dismiss', () => {
    it('hides the card, and only that card', () => {
      decided([mkQrRequest({ id: 'a', decisionReason: 'A' }), mkQrRequest({ id: 'b', decisionReason: 'B' })])
      mount()

      fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: /^Dismiss/ }))

      expect(screen.queryByText('Reason: A')).toBeNull()
      expect(screen.getByText('Reason: B')).toBeTruthy()
    })

    it('remembers across a reload, per user', () => {
      decided([mkQrRequest({ id: 'a' })])
      const first = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
      first.unmount()

      expect(JSON.parse(window.localStorage.getItem(dismissedKey('staff-sam')) ?? '[]')).toEqual(['a'])

      const second = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
      expect(second.container.firstChild).toBeNull()

      // A different login on the same phone still sees it.
      second.unmount()
      authState.userId = 'staff-ana'
      decided([mkQrRequest({ id: 'a', requestedBy: 'staff-ana' })])
      render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
      expect(screen.getByText(/^Not approved/)).toBeTruthy()
    })

    it('does not show a card that was dismissed in an earlier visit', () => {
      window.localStorage.setItem(dismissedKey('staff-sam'), JSON.stringify(['a']))
      decided([mkQrRequest({ id: 'a' })])
      const { container } = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
      expect(container.firstChild).toBeNull()
    })

    it('still hides the card for this visit when storage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      decided([mkQrRequest({ id: 'a' })])
      mount()

      expect(() => fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))).not.toThrow()
      expect(screen.queryByText(/^Not approved/)).toBeNull()
    })
  })

  describe('accessibility and touch', () => {
    it('names each button for the order it belongs to, so two cards are not two identical "Dismiss"', () => {
      decided([mkQrRequest({ id: 'a' }), mkQrRequest({ id: 'b' })])
      mount()

      const dismiss = screen.getAllByRole('button', { name: /^Dismiss/ })
      expect(dismiss).toHaveLength(2)
      expect(dismiss[0].getAttribute('aria-label')).toMatch(/sent/)
    })

    it('gives every button the 44px touch floor and the dark-blue focus ring', () => {
      decided([mkQrRequest()])
      mount()

      for (const name of [/^Edit and resend/, /^Dismiss/]) {
        const cls = screen.getByRole('button', { name }).className
        expect(cls).toMatch(/touch-target-y/)
        expect(cls).toMatch(/focus-visible:ring-nexgen-blue-dark/)
      }
    })

    it('uses text colours that clear contrast on the red tint: red-800 and stone-600 or darker', () => {
      decided([mkQrRequest()])
      mount()

      const html = screen.getByRole('region', { name: 'Orders not approved' }).innerHTML
      expect(html).toMatch(/text-red-800/)
      expect(html).not.toMatch(/text-stone-[345]00/)
      expect(html).not.toMatch(/text-red-[3-6]00/)
    })

    it('has no WCAG 2.2 AA violations', async () => {
      decided([mkQrRequest({ id: 'a' }), mkQrRequest({ id: 'b' })])
      const { container } = render(<NotApprovedCard horecaId={7} onResend={vi.fn()} />)
      await expectNoA11yViolations(container)
    })
  })
})
