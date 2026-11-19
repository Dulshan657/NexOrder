import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UserRole } from '@/types'
import { mkUser } from './fixtures'

const signOut = vi.fn()
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut }) }))
const lockKitchen = vi.fn()
vi.mock('@/lib/qr/qrSessionEnd', () => ({ lockKitchen: (...a: unknown[]) => lockKitchen(...a) }))

const { default: ProfileMenu } = await import('@/components/auth/ProfileMenu')

const kitchen = mkUser({ name: 'Sam Lee', role: UserRole.QR_STAFF, hoReCaId: 10 })

beforeEach(() => {
  signOut.mockReset().mockResolvedValue(undefined)
  lockKitchen.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('ProfileMenu — kitchen session', () => {
  it('shows whose session this is and when it ends, as two separate lines', () => {
    render(<ProfileMenu currentUser={kitchen} kitchenSession={{ endsAt: new Date('2026-10-12T14:32:00') }} />)
    const who = screen.getByText('Staff session · Sam Lee')
    const ends = screen.getByText(/^Ends \d/)
    expect(who).not.toBe(ends)
    expect(who.parentElement).toBe(ends.parentElement)
  })

  it('never truncates either line -- the end time is the point of the second one', () => {
    render(<ProfileMenu currentUser={kitchen} kitchenSession={{ endsAt: new Date('2026-10-12T14:32:00') }} />)
    for (const el of [screen.getByText('Staff session · Sam Lee'), screen.getByText(/^Ends \d/)]) {
      expect(el.className).not.toMatch(/truncate|overflow-hidden|whitespace-nowrap|text-ellipsis/)
    }
  })

  it('says whose session it is before the end time has loaded, with no half-written "Ends"', () => {
    render(<ProfileMenu currentUser={kitchen} kitchenSession={{ endsAt: null }} />)
    expect(screen.getByText('Staff session · Sam Lee')).toBeTruthy()
    expect(screen.queryByText(/^Ends/)).toBeNull()
  })

  it('offers Lock, which returns to the PIN pad, and no sign-out or account items', async () => {
    render(<ProfileMenu currentUser={kitchen} kitchenSession={{ endsAt: null }} />)

    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
    expect(screen.queryByText(/password|account|profile settings/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    await waitFor(() => expect(lockKitchen).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('ProfileMenu — everyone else', () => {
  it('is unchanged: a collapsed menu with Sign out inside', () => {
    render(<ProfileMenu currentUser={mkUser({ name: 'Dee', role: UserRole.CUSTOMER })} />)
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lock' })).toBeNull()

    fireEvent.click(screen.getByText('Dee'))
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})

// NX-0038. The help centre is reached from the profile menu, filtered to the
// reader's audience. Only roles with a warehouse guide get the link: a Customer
// would land on articles about work they never do.
describe('ProfileMenu — help link', () => {
  const openMenu = (name: string, role: UserRole) => {
    render(<ProfileMenu currentUser={mkUser({ name, role })} />)
    fireEvent.click(screen.getByText(name))
  }

  it('a Warehouse user gets Help for the floor, in a new tab', () => {
    openMenu('Wes', UserRole.WAREHOUSE)
    const link = screen.getByRole('link', { name: /help/i })
    expect(link.getAttribute('href')).toBe('/help?for=floor')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('an Admin and a Manager get Help for supervisors', () => {
    openMenu('Ada', UserRole.ADMIN)
    expect(screen.getByRole('link', { name: /help/i }).getAttribute('href')).toBe('/help?for=supervisor')
    cleanup()
    openMenu('Max', UserRole.MANAGER)
    expect(screen.getByRole('link', { name: /help/i }).getAttribute('href')).toBe('/help?for=supervisor')
  })

  it('a Customer and a kitchen session get no Help link', () => {
    // Control: the same menu does carry the link for a role with a guide, so the
    // absences below are the role rule withholding it, not a menu without one.
    openMenu('Wes', UserRole.WAREHOUSE)
    expect(screen.getByRole('link', { name: /help/i })).toBeTruthy()
    cleanup()
    openMenu('Dee', UserRole.CUSTOMER)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
    cleanup()
    render(<ProfileMenu currentUser={kitchen} kitchenSession={{ endsAt: null }} />)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })
})
