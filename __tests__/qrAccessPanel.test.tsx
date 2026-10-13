// QrAccessPanel -- the manager's "QR & PINs" sheet.
//
// What these pin:
//   - a weak PIN is refused as it is typed, with the SERVER'S rule (qrPin.ts), so
//     the form never offers a PIN `mutate-qr-access` will reject for being weak;
//   - the server's own refusals (taken PIN) land under the PIN field;
//   - the two destructive actions -- regenerate the code, remove a person -- each
//     ask first, and do nothing until confirmed;
//   - a rep who is not assigned to the venue is told what to do, not shown an error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { QrApiError } from '@/lib/qr/qrApiError'
import type { QrAccessState } from '@/services/supabase/qrService'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  regenerate: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  reset: vi.fn(),
  revoke: vi.fn(),
  unlock: vi.fn(),
  poster: vi.fn(),
  addToast: vi.fn(),
  showPoster: vi.fn(),
  openPending: vi.fn(),
  discard: vi.fn(),
}))

const pending = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, isPending: false })

vi.mock('@/hooks/queries/useQrAccess', () => ({
  useQrAccess: (...args: unknown[]) => m.access(...args),
  useRegenerateQrCode: () => pending(m.regenerate),
  useCreateQrStaff: () => pending(m.create),
  useRenameQrStaff: () => pending(m.rename),
  useResetQrPin: () => pending(m.reset),
  useRevokeQrStaff: () => pending(m.revoke),
  useUnlockQrCode: () => pending(m.unlock),
  useQrPoster: () => pending(m.poster),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: m.addToast }),
  useToastActions: () => ({ addToast: m.addToast }),
}))
vi.mock('@/lib/qr/openPoster', () => ({
  openPendingWindow: () => m.openPending(),
  discardPendingWindow: (w: unknown) => m.discard(w),
  showPoster: (...args: unknown[]) => m.showPoster(...args),
}))

import QrAccessPanel from '@/components/qr/QrAccessPanel'

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()

function state(over: Partial<QrAccessState> = {}): QrAccessState {
  return {
    horecaId: 7,
    horecaName: 'Cafe Roma',
    token: 'tok',
    url: 'https://app.example/?qr=tok',
    staff: [
      { id: 'st-1', horecaId: 7, name: 'Sam', unlockedUntil: FUTURE, lastUnlockedAt: new Date().toISOString(), createdAt: '2026-10-01T00:00:00Z', revokedAt: null },
      { id: 'st-2', horecaId: 7, name: 'Ana', unlockedUntil: null, lastUnlockedAt: null, createdAt: '2026-10-02T00:00:00Z', revokedAt: null },
    ],
    locked: false,
    lockedUntil: null,
    permanent: false,
    failedAttempts: 0,
    ...over,
  }
}

function loaded(data: QrAccessState) {
  m.access.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() })
}

function renderPanel() {
  const onClose = vi.fn()
  render(<QrAccessPanel horecaId={7} open onClose={onClose} />)
  return onClose
}

const nameField = () => screen.getByLabelText('Name', { selector: '#qr-staff-name' }) as HTMLInputElement
const pinField = () => document.getElementById('qr-staff-pin') as HTMLInputElement
const addButton = () => screen.getByRole('button', { name: 'Add staff member' }) as HTMLButtonElement

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.openPending.mockReturnValue(null)
  loaded(state())
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('QrAccessPanel: the code', () => {
  it('only asks for the code while it is open (asking creates it)', () => {
    cleanup()
    render(<QrAccessPanel horecaId={7} open={false} onClose={vi.fn()} />)
    expect(m.access).toHaveBeenCalledWith(7, { enabled: false })
  })

  it('shows the venue and the explanation', () => {
    renderPanel()
    expect(screen.getAllByText('Cafe Roma').length).toBeGreaterThan(0)
    expect(screen.getByText('How it works')).toBeTruthy()
  })

  it('asks before regenerating, and does nothing until confirmed', async () => {
    m.regenerate.mockResolvedValue({})
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate code' }))
    expect(screen.getByText('Regenerate this QR code?')).toBeTruthy()
    expect(screen.getByText(/Old stickers stop working immediately/)).toBeTruthy()
    expect(m.regenerate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(m.regenerate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Regenerate this QR code?')).toBeNull())
  })

  it('cancelling the regenerate confirm leaves the code alone', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(m.regenerate).not.toHaveBeenCalled()
    expect(screen.queryByText('Regenerate this QR code?')).toBeNull()
  })

  it('opens the tab in the click, then hands the finished PDF to it', async () => {
    const win = { closed: false }
    m.openPending.mockReturnValue(win)
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    m.poster.mockResolvedValue(blob)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Print A4 poster' }))

    // The blank tab exists BEFORE the poster does: it is opened inside the click.
    expect(m.openPending).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(m.poster).toHaveBeenCalledWith({ horecaId: 7, format: 'a4' }))
    await waitFor(() => expect(m.showPoster).toHaveBeenCalledWith(blob, 'qr-cafe-roma-a4.pdf', win))
  })

  it('closes the placeholder tab and says so when the poster fails', async () => {
    const win = { closed: false }
    m.openPending.mockReturnValue(win)
    m.poster.mockRejectedValue(new QrApiError({ code: 'INTERNAL', message: 'Could not generate the poster.' }))
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Print sticker' }))

    await waitFor(() => expect(m.discard).toHaveBeenCalledWith(win))
    expect((await screen.findByText('Could not generate the poster.')).getAttribute('role')).toBe('alert')
  })

  it('offers to clear a lock, and says when it ends', async () => {
    loaded(state({ locked: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString() }))
    m.unlock.mockResolvedValue(undefined)
    renderPanel()

    expect(screen.getByText('Temporarily locked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unlock code' }))
    await waitFor(() => expect(m.unlock).toHaveBeenCalledTimes(1))
  })

  it('explains a permanent lock', () => {
    loaded(state({ locked: true, permanent: true }))
    renderPanel()
    expect(screen.getByText('Locked after too many wrong PINs')).toBeTruthy()
  })

  it('tells an unassigned rep what to do instead of showing an error', () => {
    m.access.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new QrApiError({ code: 'FORBIDDEN', message: 'Forbidden' }),
      refetch: vi.fn(),
    })
    renderPanel()

    expect(screen.getByText('Ask an admin to assign you to this venue.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Print A4 poster' })).toBeNull()
  })
})

describe('QrAccessPanel: kitchen staff', () => {
  it('lists each person and who is unlocked right now', () => {
    renderPanel()
    expect(screen.getByText('Sam')).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByText(/Unlocked until/)).toBeTruthy()
    expect(screen.getByText('Has not unlocked yet')).toBeTruthy()
  })

  it('refuses a weak PIN as it is typed and will not send it', () => {
    renderPanel()
    fireEvent.change(nameField(), { target: { value: 'Joe' } })
    fireEvent.change(pinField(), { target: { value: '1234' } })

    expect(screen.getByText(/too easy to guess/)).toBeTruthy()
    expect(addButton().disabled).toBe(true)

    fireEvent.click(addButton())
    expect(m.create).not.toHaveBeenCalled()
  })

  it('does not nag about length while the PIN is still being typed', () => {
    renderPanel()
    fireEvent.change(pinField(), { target: { value: '73' } })
    expect(screen.queryByText('A PIN is 4 to 6 digits.')).toBeNull()

    fireEvent.blur(pinField())
    expect(screen.getByText('A PIN is 4 to 6 digits.')).toBeTruthy()
  })

  it('keeps only digits', () => {
    renderPanel()
    fireEvent.change(pinField(), { target: { value: '73-91 x' } })
    expect(pinField().value).toBe('7391')
  })

  it('adds a person with the PIN the manager chose, then clears the form', async () => {
    m.create.mockResolvedValue({})
    renderPanel()
    fireEvent.change(nameField(), { target: { value: '  Joe  ' } })
    fireEvent.change(pinField(), { target: { value: '7391' } })
    expect(addButton().disabled).toBe(false)

    fireEvent.click(addButton())

    await waitFor(() => expect(m.create).toHaveBeenCalledWith({ name: 'Joe', pin: '7391' }))
    await waitFor(() => expect(nameField().value).toBe(''))
    expect(pinField().value).toBe('')
    expect(m.addToast).toHaveBeenCalledWith('Joe can now order with the venue QR', 'success')
  })

  it('shows the server\'s refusal of a taken PIN under the PIN field', async () => {
    m.create.mockRejectedValue(new QrApiError({ code: 'QR_PIN_TAKEN', message: 'Another person here already uses that PIN' }))
    renderPanel()
    fireEvent.change(nameField(), { target: { value: 'Joe' } })
    fireEvent.change(pinField(), { target: { value: '7391' } })
    fireEvent.click(addButton())

    const message = await screen.findByText('Another person here already uses that PIN')
    expect(message.getAttribute('role')).toBe('alert')
    // The name is kept so the manager only has to choose another PIN.
    expect(nameField().value).toBe('Joe')

    fireEvent.change(pinField(), { target: { value: '7392' } })
    expect(screen.queryByText('Another person here already uses that PIN')).toBeNull()
  })

  it('shows and hides the PIN on request', () => {
    renderPanel()
    expect(pinField().type).toBe('password')
    fireEvent.click(screen.getAllByRole('button', { name: 'Show PIN' })[0])
    expect(pinField().type).toBe('text')
  })

  it('asks before removing someone, and removes only that person', async () => {
    m.revoke.mockResolvedValue(undefined)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }))
    expect(screen.getByText('Remove Sam?')).toBeTruthy()
    expect(m.revoke).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(m.revoke).toHaveBeenCalledWith('st-1'))
    await waitFor(() => expect(m.addToast).toHaveBeenCalledWith('Sam removed', 'success'))
  })

  it('resets a PIN with the same rules as adding one', async () => {
    m.reset.mockResolvedValue({ sessionsEnded: true })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN for Ana' }))
    const field = document.getElementById('qr-reset-st-2') as HTMLInputElement
    fireEvent.change(field, { target: { value: '0000' } })
    expect(screen.getByText(/too easy to guess/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Set new PIN' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(field, { target: { value: '7391' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new PIN' }))
    await waitFor(() => expect(m.reset).toHaveBeenCalledWith({ staffId: 'st-2', pin: '7391' }))
  })

  it('renames a person', async () => {
    m.rename.mockResolvedValue({ id: 'st-2', name: 'Anna' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Rename Ana' }))
    const field = document.getElementById('qr-rename-st-2') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Anna' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(m.rename).toHaveBeenCalledWith({ staffId: 'st-2', name: 'Anna' }))
  })

  it('puts focus back on the button that opened an inline form when it is cancelled', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN for Ana' }))
    const cancel = screen.getAllByRole('button', { name: 'Cancel' })[0]
    fireEvent.click(cancel)

    await waitFor(() => expect(document.activeElement?.id).toBe('qr-reset-btn-st-2'))
  })

  it('says so when nobody can unlock yet', () => {
    loaded(state({ staff: [] }))
    renderPanel()
    expect(screen.getByText(/No one can unlock this code yet/)).toBeTruthy()
  })
})
