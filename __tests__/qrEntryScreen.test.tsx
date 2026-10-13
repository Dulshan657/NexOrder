import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QrApiError } from '@/lib/qr/qrApiError'
import { QR_LAST_TOKEN_KEY } from '@/lib/qr/qrLink'
import { QR_ENTRY_FLAG_KEY } from '@/lib/qr/qrEntryFlag'
import { expectNoA11yViolations } from './support/axe'

// The screen a venue's printed QR opens. It renders BEFORE AuthGate, so it must
// work for a signed-out phone, and it must never sign a real login out unasked.

const TOKEN = 'T'.repeat(43)
const VENUE = { horecaId: 7, horecaName: 'Harbour Bistro', logoUrl: null, companyName: 'Acme Foods', phone: '' }

const resolveQr = vi.fn()
const signInWithQrPin = vi.fn()
const signOutQrLocally = vi.fn()
const listQrStaff = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  resolveQr: (...a: unknown[]) => resolveQr(...a),
  signInWithQrPin: (...a: unknown[]) => signInWithQrPin(...a),
  signOutQrLocally: (...a: unknown[]) => signOutQrLocally(...a),
  listQrStaff: (...a: unknown[]) => listQrStaff(...a),
}))

interface AuthShape {
  user: { id: string } | null
  profile: { id: string; name: string; role: string; horeca_id: number | null } | null
  isLoading: boolean
  profileError: boolean
  retryProfile: ReturnType<typeof vi.fn>
}
const auth: AuthShape = { user: null, profile: null, isLoading: false, profileError: false, retryProfile: vi.fn() }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))

const { default: QrEntryScreen } = await import('@/components/qr/QrEntryScreen')

const signedInAs = (role: string, horecaId: number | null, name = 'Pat') => {
  auth.user = { id: 'u1' }
  auth.profile = { id: 'u1', name, role, horeca_id: horecaId }
}

const mount = () => {
  const onDone = vi.fn()
  const view = render(<QrEntryScreen token={TOKEN} onDone={onDone} />)
  return { onDone, ...view }
}

const pressPin = (pin: string) => {
  pin.split('').forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })))
  fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }))
}

beforeEach(() => {
  auth.user = null
  auth.profile = null
  auth.isLoading = false
  auth.profileError = false
  auth.retryProfile = vi.fn()
  resolveQr.mockReset().mockResolvedValue(VENUE)
  signInWithQrPin.mockReset()
  signOutQrLocally.mockReset().mockResolvedValue(undefined)
  listQrStaff.mockReset().mockResolvedValue([])
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', `/?qr=${TOKEN}`)
})

afterEach(cleanup)

describe('QrEntryScreen — the sticker', () => {
  it('shows the operator and venue names above a PIN pad when nobody is signed in', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Harbour Bistro' })).toBeTruthy()
    expect(screen.getByText('Acme Foods')).toBeTruthy()
    expect(screen.getByRole('group', { name: /keypad/i })).toBeTruthy()
    expect(resolveQr).toHaveBeenCalledWith(TOKEN)
  })

  it('remembers the venue so an expired phone can come back to it', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    expect(localStorage.getItem(QR_LAST_TOKEN_KEY)).toBe(TOKEN)
  })

  it('says the code is no longer active when the sticker was replaced, and links to sign-in', async () => {
    localStorage.setItem(QR_LAST_TOKEN_KEY, TOKEN)
    resolveQr.mockRejectedValue(new QrApiError({ code: 'QR_UNKNOWN_CODE', message: 'x' }))
    mount()
    expect(await screen.findByRole('heading', { name: /no longer active/i })).toBeTruthy()
    expect(screen.getByText(/ask your manager for the new one/i)).toBeTruthy()
    expect((screen.getByRole('link', { name: /go to sign in/i }) as HTMLAnchorElement).getAttribute('href')).toBe('/')
    // A dead sticker must not stay the place an expired phone bounces to.
    expect(localStorage.getItem(QR_LAST_TOKEN_KEY)).toBeNull()
    expect(screen.queryByRole('group', { name: /keypad/i })).toBeNull()
  })

  it('offers a retry on a network failure instead of declaring the code dead', async () => {
    resolveQr.mockRejectedValueOnce(new QrApiError({ code: 'NETWORK', message: 'Could not reach the server.' }))
    mount()
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy()
    expect(screen.queryByText(/no longer active/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: 'Harbour Bistro' })).toBeTruthy()
    expect(resolveQr).toHaveBeenCalledTimes(2)
  })

  it('always offers the way out for someone who is not venue staff', async () => {
    mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    expect((screen.getByRole('link', { name: 'Sign in' }) as HTMLAnchorElement).getAttribute('href')).toBe('/')
  })
})

describe('QrEntryScreen — the PIN', () => {
  it('tells a wrong PIN apart, clears the pad and does not enter', async () => {
    signInWithQrPin.mockRejectedValue(new QrApiError({ code: 'QR_BAD_PIN', message: 'x' }))
    const { onDone } = mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })

    pressPin('1357')
    expect(await screen.findByText('Incorrect PIN')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText(/staff pin \(4 to 6 digits\)/i) as HTMLInputElement).value).toBe(''))
    expect(signInWithQrPin).toHaveBeenCalledWith(TOKEN, '1357')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('locks the pad and says when to come back', async () => {
    signInWithQrPin.mockRejectedValue(
      new QrApiError({ code: 'QR_LOCKED', message: 'x', details: { lockedUntil: new Date(Date.now() + 15 * 60_000).toISOString() } }),
    )
    mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    pressPin('1357')

    expect(await screen.findByText(/^Too many attempts\. Try again at /)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('says to ask a manager when the code is locked for good', async () => {
    signInWithQrPin.mockRejectedValue(new QrApiError({ code: 'QR_LOCKED', message: 'x', details: { permanent: true } }))
    mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    pressPin('1357')
    expect(await screen.findByText('This code is locked. Ask your manager to unlock it.')).toBeTruthy()
  })

  it('shows the dead-sticker screen if the code is replaced while the pad is open', async () => {
    signInWithQrPin.mockRejectedValue(new QrApiError({ code: 'QR_UNKNOWN_CODE', message: 'x' }))
    mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    pressPin('1357')
    expect(await screen.findByRole('heading', { name: /no longer active/i })).toBeTruthy()
  })

  it('waits for the new login\'s profile before handing over, then opens on the Kitchen screen', async () => {
    signInWithQrPin.mockResolvedValue({ tokenHash: 'h', expiresAt: 'x', staffName: 'Sam', horecaId: 7 })
    const { onDone, rerender } = mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })

    pressPin('1357')
    expect(await screen.findByText('Unlocking…')).toBeTruthy()
    // The session exists but the profile has not loaded: AuthGate would draw LoginPage here.
    expect(onDone).not.toHaveBeenCalled()

    signedInAs('QR Staff', 7, 'Sam')
    rerender(<QrEntryScreen token={TOKEN} onDone={onDone} />)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sessionStorage.getItem(QR_ENTRY_FLAG_KEY)).toBe('1')
    // The token is off the address bar once they are in.
    expect(window.location.search).toBe('')
  })

  it('does not bounce the person it just let in when the auth state changes under it', async () => {
    signInWithQrPin.mockResolvedValue({ tokenHash: 'h', expiresAt: 'x', staffName: 'Sam', horecaId: 7 })
    const { onDone, rerender } = mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    pressPin('1357')
    signedInAs('QR Staff', 7, 'Sam')
    rerender(<QrEntryScreen token={TOKEN} onDone={onDone} />)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    // The signed-in kitchen login must not have been "decided" a second time.
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })
})

describe('QrEntryScreen — somebody is already signed in', () => {
  it('skips the PIN for a Customer of this venue and opens the Kitchen screen', async () => {
    signedInAs('Restaurant/Hotel Customer', 7)
    const { onDone } = mount()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sessionStorage.getItem(QR_ENTRY_FLAG_KEY)).toBe('1')
    expect(signOutQrLocally).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('skips the PIN for a kitchen login whose unlock is still running', async () => {
    signedInAs('QR Staff', 7, 'Sam')
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: new Date(Date.now() + 60 * 60_000).toISOString() }])
    const { onDone } = mount()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })

  it('signs a LAPSED kitchen login out locally and shows the PIN pad', async () => {
    signedInAs('QR Staff', 7, 'Sam')
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: new Date(Date.now() - 60_000).toISOString() }])
    const { onDone } = mount()
    expect(await screen.findByRole('group', { name: /keypad/i })).toBeTruthy()
    expect(signOutQrLocally).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('signs a kitchen login from ANOTHER venue out locally and shows the PIN pad', async () => {
    signedInAs('QR Staff', 99, 'Sam')
    const { onDone } = mount()
    expect(await screen.findByRole('group', { name: /keypad/i })).toBeTruthy()
    expect(signOutQrLocally).toHaveBeenCalledTimes(1)
    expect(listQrStaff).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does not sign a working kitchen login out because the unlock could not be READ', async () => {
    signedInAs('QR Staff', 7, 'Sam')
    listQrStaff.mockRejectedValue(new Error('offline'))
    const { onDone } = mount()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })

  it('asks before doing anything to an admin, and continuing opens the app WITHOUT the Kitchen screen', async () => {
    signedInAs('Admin', null, 'Ada')
    const { onDone } = mount()
    expect(await screen.findByText('Ada')).toBeTruthy()
    expect(screen.getByText(/\(Admin\)/)).toBeTruthy()
    expect(signOutQrLocally).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue as Ada' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(QR_ENTRY_FLAG_KEY)).toBeNull()
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })

  it('treats a Customer of a DIFFERENT venue as somebody to ask, not to sign out', async () => {
    signedInAs('Restaurant/Hotel Customer', 99, 'Dee')
    mount()
    expect(await screen.findByRole('button', { name: 'Continue as Dee' })).toBeTruthy()
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })

  it('signs out locally ONLY when they choose the kitchen PIN, then shows the pad', async () => {
    signedInAs('Admin', null, 'Ada')
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /use staff pin instead/i }))
    expect(await screen.findByRole('group', { name: /keypad/i })).toBeTruthy()
    expect(signOutQrLocally).toHaveBeenCalledTimes(1)
  })

  it('waits for the session to finish loading before deciding anything', async () => {
    signedInAs('Restaurant/Hotel Customer', 7)
    auth.isLoading = true
    const { onDone, rerender } = mount()
    await screen.findByText('Opening your order screen…')
    expect(onDone).not.toHaveBeenCalled()

    auth.isLoading = false
    rerender(<QrEntryScreen token={TOKEN} onDone={onDone} />)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('shows the PIN pad (not a spinner) for a session with no profile behind it', async () => {
    auth.user = { id: 'ghost' }
    auth.profile = null
    auth.profileError = false
    mount()
    expect(await screen.findByRole('group', { name: /keypad/i })).toBeTruthy()
    // Nothing was signed out: a correct PIN simply replaces that session.
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })

  it('offers a retry, not the PIN pad, when a signed-in profile could not be loaded', async () => {
    auth.user = { id: 'u1' }
    auth.profile = null
    auth.profileError = true
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(auth.retryProfile).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: /keypad/i })).toBeNull()
    expect(signOutQrLocally).not.toHaveBeenCalled()
  })
})

describe('QrEntryScreen — accessibility', () => {
  it('has no WCAG 2.2 AA violations on the PIN pad, the dead-sticker screen or the sign-in choice', async () => {
    const pad = mount()
    await screen.findByRole('heading', { name: 'Harbour Bistro' })
    await expectNoA11yViolations(pad.container)
    pad.unmount()

    resolveQr.mockRejectedValue(new QrApiError({ code: 'QR_UNKNOWN_CODE', message: 'x' }))
    const dead = mount()
    await screen.findByRole('heading', { name: /no longer active/i })
    await expectNoA11yViolations(dead.container)
    dead.unmount()

    resolveQr.mockResolvedValue(VENUE)
    signedInAs('Admin', null, 'Ada')
    const choice = mount()
    await screen.findByRole('button', { name: 'Continue as Ada' })
    await expectNoA11yViolations(choice.container)
    await act(async () => {})
  })
})
