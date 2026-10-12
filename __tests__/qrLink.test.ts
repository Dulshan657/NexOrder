import { describe, it, expect } from 'vitest'
import {
  QR_LAST_TOKEN_KEY,
  QR_PARAM,
  clearLastQrToken,
  readLastQrToken,
  readQrToken,
  saveLastQrToken,
  stripQrParam,
  type QrTokenStorage,
} from '@/lib/qr/qrLink'
import { generateQrToken } from '@/supabase/functions/_shared/qrPin'

// 32 base64url characters: what generateQrToken() produces.
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'
const OTHER = 'ZYXWVUTSRQPONMLKJIHGFEDCBA_-9876'

function memoryStorage(initial: Record<string, string> = {}): QrTokenStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const throwingStorage: QrTokenStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('readQrToken', () => {
  it('reads the token from a search string, with or without the leading ?', () => {
    expect(readQrToken(`?${QR_PARAM}=${TOKEN}`)).toBe(TOKEN)
    expect(readQrToken(`${QR_PARAM}=${TOKEN}`)).toBe(TOKEN)
  })

  it('finds it among other parameters', () => {
    expect(readQrToken(`?tab=Orders&qr=${TOKEN}&x=1`)).toBe(TOKEN)
  })

  it('accepts what generateQrToken produces', () => {
    const fresh = generateQrToken()
    expect(readQrToken(`?qr=${fresh}`)).toBe(fresh)
  })

  it('returns null when absent', () => {
    expect(readQrToken('')).toBeNull()
    expect(readQrToken('?tab=Orders')).toBeNull()
  })

  it('returns null for a malformed token rather than passing it on', () => {
    expect(readQrToken('?qr=')).toBeNull()
    expect(readQrToken('?qr=short')).toBeNull()
    expect(readQrToken(`?qr=${TOKEN}!`)).toBeNull() // not base64url
    expect(readQrToken(`?qr=${'a'.repeat(129)}`)).toBeNull() // absurdly long
    expect(readQrToken('?qr=%3Cscript%3Ealert(1)%3C/script%3Eabcdefghijklmnopqrst')).toBeNull()
  })

  it('takes the first token when the parameter is repeated', () => {
    expect(readQrToken(`?qr=${TOKEN}&qr=${OTHER}`)).toBe(TOKEN)
  })
})

describe('remembered token', () => {
  it('round-trips', () => {
    const s = memoryStorage()
    saveLastQrToken(TOKEN, s)
    expect(s.data.get(QR_LAST_TOKEN_KEY)).toBe(TOKEN)
    expect(readLastQrToken(s)).toBe(TOKEN)
  })

  it('overwrites with the newer venue', () => {
    const s = memoryStorage()
    saveLastQrToken(TOKEN, s)
    saveLastQrToken(OTHER, s)
    expect(readLastQrToken(s)).toBe(OTHER)
  })

  it('clear forgets it', () => {
    const s = memoryStorage()
    saveLastQrToken(TOKEN, s)
    clearLastQrToken(s)
    expect(readLastQrToken(s)).toBeNull()
  })

  it('refuses to store a malformed token', () => {
    const s = memoryStorage()
    saveLastQrToken('nope', s)
    expect(s.data.size).toBe(0)
  })

  it('re-validates on read: storage is user-writable', () => {
    expect(readLastQrToken(memoryStorage({ [QR_LAST_TOKEN_KEY]: '<img src=x onerror=alert(1)>' }))).toBeNull()
    expect(readLastQrToken(memoryStorage({ [QR_LAST_TOKEN_KEY]: '' }))).toBeNull()
  })

  it('returns null when nothing is stored', () => {
    expect(readLastQrToken(memoryStorage())).toBeNull()
  })

  it('never throws when storage throws (private window, blocked site data)', () => {
    expect(readLastQrToken(throwingStorage)).toBeNull()
    expect(() => saveLastQrToken(TOKEN, throwingStorage)).not.toThrow()
    expect(() => clearLastQrToken(throwingStorage)).not.toThrow()
  })

  it('does nothing when there is no storage at all', () => {
    expect(readLastQrToken(null)).toBeNull()
    expect(() => saveLastQrToken(TOKEN, null)).not.toThrow()
    expect(() => clearLastQrToken(null)).not.toThrow()
  })
})

describe('stripQrParam', () => {
  it('removes the qr param from an absolute URL', () => {
    expect(stripQrParam(`https://nexorder.example/?qr=${TOKEN}`)).toBe('https://nexorder.example/')
  })

  it('keeps every other parameter, in order, and the hash', () => {
    expect(stripQrParam(`https://nexorder.example/app?a=1&qr=${TOKEN}&b=2#orders`)).toBe(
      'https://nexorder.example/app?a=1&b=2#orders',
    )
  })

  it('handles an origin-relative URL', () => {
    expect(stripQrParam(`/?qr=${TOKEN}`)).toBe('/')
    expect(stripQrParam(`/shop?x=1&qr=${TOKEN}#cart`)).toBe('/shop?x=1#cart')
  })

  it('handles a bare query string', () => {
    expect(stripQrParam(`?qr=${TOKEN}`)).toBe('')
    expect(stripQrParam(`?qr=${TOKEN}&x=1`)).toBe('?x=1')
  })

  it('leaves a URL without the param untouched', () => {
    expect(stripQrParam('https://nexorder.example/?x=1')).toBe('https://nexorder.example/?x=1')
    expect(stripQrParam('/shop')).toBe('/shop')
  })

  it('removes a repeated param entirely', () => {
    expect(stripQrParam(`/?qr=${TOKEN}&qr=${OTHER}`)).toBe('/')
  })

  it('never leaves the token behind', () => {
    for (const url of [`https://a.b/?qr=${TOKEN}`, `/x?qr=${TOKEN}#h`, `?qr=${TOKEN}`]) {
      expect(stripQrParam(url)).not.toContain(TOKEN)
    }
  })
})
