import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserRole } from '@/types'

// The client half of the 2-hour unlock. The database is the control; this must
// only (a) warn ten minutes ahead, (b) put the PIN pad back at the end, and
// (c) not trust a timer on a phone that slept.

const NOW = new Date('2026-10-12T10:00:00.000Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const listQrStaff = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  listQrStaff: (...a: unknown[]) => listQrStaff(...a),
}))
const handleQrSessionEnded = vi.fn()
vi.mock('@/lib/qr/qrSessionEnd', () => ({
  handleQrSessionEnded: (...a: unknown[]) => handleQrSessionEnded(...a),
  lockKitchen: (...a: unknown[]) => handleQrSessionEnded(...a),
}))

const { useQrSessionExpiry } = await import('@/hooks/useQrSessionExpiry')

const kitchen = { role: UserRole.QR_STAFF, name: 'Sam', hoReCaId: 10 }
let last: ReturnType<typeof useQrSessionExpiry> | null = null

function Probe(props: { user: typeof kitchen | { role: UserRole; name: string; hoReCaId?: number }; addToast: (m: string, t: 'info') => void }) {
  last = useQrSessionExpiry({
    currentUser: props.user as never,
    currentUserUuid: 'u1',
    addToast: props.addToast as never,
  })
  return null
}

function mount(user: Parameters<typeof Probe>[0]['user'] = kitchen) {
  const addToast = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Probe user={user} addToast={addToast} />
    </QueryClientProvider>,
  )
  return { addToast }
}

// Let the query resolve and its effects run, without advancing the clock.
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const advance = (minutes: number) => act(async () => void (await vi.advanceTimersByTimeAsync(minutes * 60_000)))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false, now: NOW })
  last = null
  listQrStaff.mockReset()
  handleQrSessionEnded.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useQrSessionExpiry', () => {
  it('does nothing for a role that is not kitchen staff', async () => {
    mount({ role: UserRole.CUSTOMER, name: 'Dee', hoReCaId: 10 })
    await settle()
    expect(listQrStaff).not.toHaveBeenCalled()
    expect(last?.unlockedUntil).toBeNull()
    expect(last?.endsAt).toBeNull()
  })

  it('reads the unlock time and exposes it for the profile menu', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(120) }])
    mount()
    await settle()
    expect(listQrStaff).toHaveBeenCalledWith(10)
    expect(last?.unlockedUntil).toBe(at(120))
    expect(last?.endsAt?.getTime()).toBe(new Date(at(120)).getTime())
  })

  it('warns ten minutes before the end — once — and not before', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(120) }])
    const { addToast } = mount()
    await settle()

    await advance(109)
    expect(addToast).not.toHaveBeenCalled()

    await advance(1) // T-10 minutes
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast.mock.calls[0][0]).toMatch(/^Staff session ends at /)
    expect(addToast.mock.calls[0][1]).toBe('info')
    expect(handleQrSessionEnded).not.toHaveBeenCalled()

    await advance(5)
    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it('returns the phone to the PIN pad at the end of the unlock', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(120) }])
    mount()
    await settle()

    await advance(119)
    expect(handleQrSessionEnded).not.toHaveBeenCalled()
    await advance(1)
    expect(handleQrSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('warns at once when it opens inside the last ten minutes', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(7) }])
    const { addToast } = mount()
    await settle()
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(handleQrSessionEnded).not.toHaveBeenCalled()
  })

  it('ends at once when the unlock is already over', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(-1) }])
    mount()
    await settle()
    expect(handleQrSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('ends at once when the login has no unlock at all (reset or regenerated)', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: null }])
    mount()
    await settle()
    expect(handleQrSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('ends at once when the login can see no row (revoked)', async () => {
    listQrStaff.mockResolvedValue([])
    mount()
    await settle()
    expect(handleQrSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('does NOT end the session just because the read failed', async () => {
    listQrStaff.mockRejectedValue(new Error('offline'))
    mount()
    await settle()
    await advance(300)
    expect(handleQrSessionEnded).not.toHaveBeenCalled()
  })

  it('catches a phone that slept past the end: coming back to the page checks the clock', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(120) }])
    mount()
    await settle()

    // The phone slept: wall-clock time jumped but no timer ever fired.
    vi.setSystemTime(new Date(at(130)))
    expect(handleQrSessionEnded).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(handleQrSessionEnded).toHaveBeenCalledTimes(1)
  })

  it('re-reads the time from the database when the page comes back while still unlocked', async () => {
    listQrStaff.mockResolvedValue([{ name: 'Sam', unlockedUntil: at(120) }])
    mount()
    await settle()
    expect(listQrStaff).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await settle()
    expect(listQrStaff).toHaveBeenCalledTimes(2)
    expect(handleQrSessionEnded).not.toHaveBeenCalled()
  })
})
