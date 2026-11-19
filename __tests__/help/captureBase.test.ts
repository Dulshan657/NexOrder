import { describe, expect, it } from 'vitest'
import { assertCaptureBase } from '@/scripts/help/captureBase'

describe('assertCaptureBase', () => {
  it('allows only the demo origin and localhost', () => {
    expect(assertCaptureBase('https://nexorder.vercel.app')).toBe('https://nexorder.vercel.app')
    expect(assertCaptureBase('https://nexorder.vercel.app/')).toBe('https://nexorder.vercel.app')
    expect(assertCaptureBase('http://localhost:3000')).toBe('http://localhost:3000')
    expect(assertCaptureBase('http://127.0.0.1:3004')).toBe('http://127.0.0.1:3004')
    expect(() => assertCaptureBase('https://nexorder.com.au')).toThrow(/demo/)
    expect(() => assertCaptureBase('https://nexorder.vercel.app.evil.com')).toThrow()
    expect(() => assertCaptureBase('https://preview-xyz.vercel.app')).toThrow()
    expect(() => assertCaptureBase('not a url')).toThrow()
  })
})
