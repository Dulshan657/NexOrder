import { describe, expect, it } from 'vitest'
import { pinFeedback, sanitizePinInput } from '@/lib/qr/pinForm'
import { validatePin } from '@/supabase/functions/_shared/qrPin'

describe('sanitizePinInput', () => {
  it('keeps digits only and at most six', () => {
    expect(sanitizePinInput('73-91 x')).toBe('7391')
    expect(sanitizePinInput('1234567890')).toBe('123456')
    expect(sanitizePinInput('')).toBe('')
  })
})

describe('pinFeedback', () => {
  it('accepts a PIN the server accepts', () => {
    expect(pinFeedback('7391', false)).toEqual({ ok: true, error: null })
  })

  it('reports a weak PIN the moment it is whole, even before the field is left', () => {
    const f = pinFeedback('1234', false)
    expect(f.ok).toBe(false)
    expect(f.error).toMatch(/too easy to guess/)
    expect(pinFeedback('0000', false).error).toMatch(/too easy to guess/)
    expect(pinFeedback('1990', false).error).toMatch(/too easy to guess/) // a year
  })

  it('stays quiet about a short PIN until the field is left or a save is tried', () => {
    expect(pinFeedback('73', false)).toEqual({ ok: false, error: null })
    expect(pinFeedback('', false)).toEqual({ ok: false, error: null })
    expect(pinFeedback('73', true).error).toBe('A PIN is 4 to 6 digits.')
    expect(pinFeedback('', true).error).toBe('A PIN is 4 to 6 digits.')
  })

  it('never calls ok a PIN the shared server rule refuses', () => {
    for (const pin of ['', '1', '123', '1234', '0000', '4321', '1212', '2580', '123456', '654321', '1980']) {
      expect(pinFeedback(pin, true).ok).toBe(validatePin(pin).ok)
    }
  })
})
