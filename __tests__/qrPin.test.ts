import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  QR_TOKEN_BYTES,
  QR_UNLOCK_MINUTES,
  describePinProblem,
  generateQrToken,
  hmacPin,
  isQrToken,
  tokenFingerprint,
  validatePin,
} from '@/supabase/functions/_shared/qrPin'

/**
 * qrPin.ts is imported by the browser (the PIN field) AND by the Edge Functions
 * (the server refuses again), so what it accepts is a contract between them.
 * Every refusal here is pinned by `reason`, so a failure names which rule moved.
 */
describe('validatePin -- format', () => {
  it.each(['', '1', '123', '1234567', 'abcd', '12a4', '12 4', '١٢٣٤', '12.4', '-123'])(
    'rejects %j as a format problem',
    (pin) => {
      expect(validatePin(pin)).toEqual({ ok: false, reason: 'format' })
    },
  )

  it('rejects non-strings without throwing', () => {
    expect(validatePin(undefined as unknown as string)).toEqual({ ok: false, reason: 'format' })
    expect(validatePin(4826 as unknown as string)).toEqual({ ok: false, reason: 'format' })
  })
})

describe('validatePin -- weak', () => {
  it.each(['0000', '1111', '9999', '000000', '777777'])('refuses the repeated digit %s', (pin) => {
    expect(validatePin(pin)).toEqual({ ok: false, reason: 'weak' })
  })

  it.each(['1234', '4321', '0123', '3210', '012345', '987654', '123456', '654321', '7890', '8901'])(
    'refuses the run %s',
    (pin) => {
      expect(validatePin(pin)).toEqual({ ok: false, reason: 'weak' })
    },
  )

  it.each(['1212', '6969', '4545', '121212', '696969', '123123', '456456'])(
    'refuses the repeated block %s',
    (pin) => {
      expect(validatePin(pin)).toEqual({ ok: false, reason: 'weak' })
    },
  )

  it.each(['2580', '0852', '1357', '2468', '1004', '0007', '1122', '112233'])(
    'refuses the denylisted %s',
    (pin) => {
      expect(validatePin(pin)).toEqual({ ok: false, reason: 'weak' })
    },
  )

  it.each(['1950', '1985', '1999', '2000', '2024', '2030', '2035'])('refuses the year %s', (pin) => {
    expect(validatePin(pin)).toEqual({ ok: false, reason: 'weak' })
  })

  it('does not treat a year-like number as a year outside the window', () => {
    expect(validatePin('1949')).toEqual({ ok: true })
    expect(validatePin('2036')).toEqual({ ok: true })
  })

  it('does not apply the year rule to 5- or 6-digit PINs', () => {
    expect(validatePin('19850')).toEqual({ ok: true })
    expect(validatePin('201945')).toEqual({ ok: true })
  })
})

describe('validatePin -- accepted', () => {
  it.each(['4826', '7391', '0419', '90210', '482615', '735918', '3817'])('accepts %s', (pin) => {
    expect(validatePin(pin)).toEqual({ ok: true })
  })

  it('accepts the smallest and largest lengths', () => {
    expect(validatePin('4826')).toEqual({ ok: true })
    expect(validatePin('482615')).toEqual({ ok: true })
  })
})

describe('describePinProblem', () => {
  it('has a distinct message for each reason', () => {
    expect(describePinProblem('format')).not.toBe(describePinProblem('weak'))
    expect(describePinProblem('format')).toMatch(/4 to 6 digits/)
  })
})

describe('isQrToken', () => {
  it('accepts a generated token', () => {
    expect(isQrToken(generateQrToken())).toBe(true)
  })

  it('accepts base64url of 32 or more characters', () => {
    expect(isQrToken('A'.repeat(32))).toBe(true)
    expect(isQrToken('a-b_c'.repeat(8))).toBe(true)
  })

  it.each([
    ['too short', 'A'.repeat(31)],
    ['standard base64 plus', 'A'.repeat(31) + '+'],
    ['standard base64 slash', 'A'.repeat(31) + '/'],
    ['padding', 'A'.repeat(31) + '='],
    ['whitespace', 'A'.repeat(31) + ' '],
    ['an absurd length', 'A'.repeat(129)],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isQrToken(value)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isQrToken(undefined)).toBe(false)
    expect(isQrToken(null)).toBe(false)
    expect(isQrToken(12345)).toBe(false)
  })
})

describe('generateQrToken', () => {
  it('is 24 bytes of base64url -- 32 characters, no padding', () => {
    const t = generateQrToken()
    expect(QR_TOKEN_BYTES).toBe(24)
    expect(t).toHaveLength(32)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateQrToken()))
    expect(seen.size).toBe(200)
  })
})

describe('hmacPin', () => {
  const pepper = 'test-pepper-not-a-real-secret'

  it('matches HMAC-SHA256(pepper, "horecaId:pin") as lowercase hex', async () => {
    const expected = createHmac('sha256', pepper).update('42:4826').digest('hex')
    expect(await hmacPin(pepper, 42, '4826')).toBe(expected)
  })

  it('is bound to the venue: the same PIN at two venues differs', async () => {
    expect(await hmacPin(pepper, 1, '4826')).not.toBe(await hmacPin(pepper, 2, '4826'))
  })

  it('is keyed: a different pepper gives a different value', async () => {
    expect(await hmacPin(pepper, 1, '4826')).not.toBe(await hmacPin('another-pepper', 1, '4826'))
  })

  it('is deterministic', async () => {
    expect(await hmacPin(pepper, 7, '9021')).toBe(await hmacPin(pepper, 7, '9021'))
  })

  it('refuses an empty pepper rather than producing a recomputable hash', async () => {
    await expect(hmacPin('', 1, '4826')).rejects.toThrow(/QR_PIN_PEPPER/)
  })
})

describe('tokenFingerprint', () => {
  const token = 'A'.repeat(32)

  it('is the first 16 hex characters of SHA-256(token)', async () => {
    const expected = createHash('sha256').update(token).digest('hex').slice(0, 16)
    expect(await tokenFingerprint(token)).toBe(expected)
    expect(await tokenFingerprint(token)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is stable for a token and different between tokens', async () => {
    expect(await tokenFingerprint(token)).toBe(await tokenFingerprint(token))
    expect(await tokenFingerprint(token)).not.toBe(await tokenFingerprint('B'.repeat(32)))
  })

  it('does not contain the token', async () => {
    expect(await tokenFingerprint('abcdefghijklmnopqrstuvwxyz012345')).not.toContain('abcdef')
  })
})

describe('constants', () => {
  it('unlocks for two hours', () => {
    expect(QR_UNLOCK_MINUTES).toBe(120)
  })
})
