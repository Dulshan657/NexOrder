import { describe, it, expect, vi, beforeEach } from 'vitest'

const signOutQrLocally = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  signOutQrLocally: (...a: unknown[]) => signOutQrLocally(...a),
}))

const { handleQrSessionEnded, qrReturnUrl, lockKitchen } = await import('@/lib/qr/qrSessionEnd')
const { markQrEntry, peekQrEntry, clearQrEntry, QR_ENTRY_FLAG_KEY } = await import('@/lib/qr/qrEntryFlag')
const { isQrStaffRole, isVenueUser } = await import('@/lib/venueUser')

const TOKEN = 'A'.repeat(32)

beforeEach(() => {
  signOutQrLocally.mockReset()
  signOutQrLocally.mockResolvedValue(undefined)
})

describe('qrReturnUrl', () => {
  it('returns to the venue PIN pad when a token is remembered', () => {
    expect(qrReturnUrl(TOKEN)).toBe(`/?qr=${TOKEN}`)
  })

  it('falls back to the plain login when the browser remembers no venue', () => {
    expect(qrReturnUrl(null)).toBe('/')
  })
})

describe('handleQrSessionEnded', () => {
  it('signs out locally FIRST, then goes to the venue PIN pad', async () => {
    const order: string[] = []
    const signOut = vi.fn(async () => void order.push('signOut'))
    const navigate = vi.fn((url: string) => void order.push(`navigate:${url}`))

    await handleQrSessionEnded({ signOut, navigate, token: TOKEN })

    expect(order).toEqual(['signOut', `navigate:/?qr=${TOKEN}`])
  })

  it('still navigates when the sign-out throws', async () => {
    const navigate = vi.fn()
    await handleQrSessionEnded({
      signOut: async () => {
        throw new Error('storage blocked')
      },
      navigate,
      token: TOKEN,
    })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('never throws even when the navigation does', async () => {
    await expect(
      handleQrSessionEnded({
        signOut: async () => undefined,
        navigate: () => {
          throw new Error('nope')
        },
        token: TOKEN,
      }),
    ).resolves.toBeUndefined()
  })

  it('is ONE sign-out and ONE navigation when the timer, a failed request and a focus event all fire together', async () => {
    const signOut = vi.fn(async () => undefined)
    const navigate = vi.fn()
    const deps = { signOut, navigate, token: TOKEN }

    await Promise.all([handleQrSessionEnded(deps), handleQrSessionEnded(deps), handleQrSessionEnded(deps)])

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('can run again later (the guard only covers concurrent calls)', async () => {
    const navigate = vi.fn()
    await handleQrSessionEnded({ signOut: async () => undefined, navigate, token: null })
    await Promise.resolve() // let the guard clear
    await handleQrSessionEnded({ signOut: async () => undefined, navigate, token: null })
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('uses signOutQrLocally by default, and Lock is the same action', async () => {
    expect(lockKitchen).toBe(handleQrSessionEnded)
    await handleQrSessionEnded({ navigate: vi.fn(), token: TOKEN })
    expect(signOutQrLocally).toHaveBeenCalledTimes(1)
  })
})

describe('qrEntryFlag', () => {
  const fake = () => {
    const store = new Map<string, string>()
    return {
      store,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
  }

  it('peeking does not consume the marker, clearing does', () => {
    const s = fake()
    expect(peekQrEntry(s)).toBe(false)
    markQrEntry(s)
    expect(s.store.get(QR_ENTRY_FLAG_KEY)).toBe('1')
    expect(peekQrEntry(s)).toBe(true)
    expect(peekQrEntry(s)).toBe(true)
    clearQrEntry(s)
    expect(peekQrEntry(s)).toBe(false)
  })

  it('degrades to "no marker" when storage is unavailable or throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => markQrEntry(boom)).not.toThrow()
    expect(peekQrEntry(boom)).toBe(false)
    expect(() => clearQrEntry(boom)).not.toThrow()
    expect(peekQrEntry(null)).toBe(false)
  })
})

describe('venue user roles', () => {
  it('counts a Customer and QR Staff as venue logins, nobody else', () => {
    expect(isVenueUser('Restaurant/Hotel Customer')).toBe(true)
    expect(isVenueUser('QR Staff')).toBe(true)
    for (const role of ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep', 'Warehouse', '', null, undefined]) {
      expect(isVenueUser(role)).toBe(false)
    }
  })

  it('identifies only QR Staff as kitchen staff', () => {
    expect(isQrStaffRole('QR Staff')).toBe(true)
    expect(isQrStaffRole('Restaurant/Hotel Customer')).toBe(false)
  })
})
