import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import {
  encryptToken,
  decryptToken,
  __resetEncryptionForTests,
} from '../supabase/functions/_shared/poInbox/encryption'

// Tests must opt in to the reset guard explicitly so production callers
// can't accidentally invalidate the encryption-key cache mid-request.
process.env.PO_ENCRYPTION_KEY_ALLOW_RESET = '1'

// Generate a deterministic 32-byte test key in base64. We don't care about
// the value — only that it's the right shape.
function setKey(b64: string): void {
  process.env.PO_ENCRYPTION_KEY = b64
  __resetEncryptionForTests()
}

const VALID_KEY_B64 = Buffer.from(
  new Uint8Array(32).map((_, i) => (i * 31) % 251),
).toString('base64')

describe('encryption helper', () => {
  beforeAll(() => {
    if (typeof globalThis.crypto?.subtle === 'undefined') {
      throw new Error('Web Crypto subtle is required for this test')
    }
  })

  beforeEach(() => {
    setKey(VALID_KEY_B64)
  })

  it('round-trips arbitrary plaintext', async () => {
    const original = 'refresh-token-abcdef-1234'
    const envelope = await encryptToken(original)
    expect(envelope).toContain(':')
    const decrypted = await decryptToken(envelope)
    expect(decrypted).toBe(original)
  })

  it('uses a fresh IV per call (output differs across calls)', async () => {
    const a = await encryptToken('same-plaintext')
    const b = await encryptToken('same-plaintext')
    expect(a).not.toBe(b)
  })

  it('produces an envelope that does NOT match the migration plaintext-prefix CHECKs', async () => {
    // The DB CHECK rejects values starting with these well-known OAuth
    // token prefixes. The envelope must never start with any of them so
    // legitimate inserts succeed.
    const forbidden = ['1//', 'ya29.', 'ey', 'M.C', 'OAQABAA']
    for (let i = 0; i < 50; i++) {
      const env = await encryptToken('ya29.this-would-be-plaintext')
      for (const p of forbidden) {
        expect(env.startsWith(p)).toBe(false)
      }
    }
  })

  it('rejects empty plaintext', async () => {
    await expect(encryptToken('')).rejects.toThrow(/non-empty/)
  })

  it('rejects malformed envelopes on decrypt', async () => {
    await expect(decryptToken('not-a-valid-envelope')).rejects.toThrow(/malformed/)
    await expect(decryptToken(':')).rejects.toThrow(/malformed/)
    await expect(decryptToken('only-one-half:')).rejects.toThrow(/malformed/)
  })

  it('decryption fails when ciphertext is tampered', async () => {
    const envelope = await encryptToken('sensitive-data')
    const [iv, ct] = envelope.split(':')
    // Flip one byte in the ciphertext portion.
    const tampered = ct.length > 4
      ? `${iv}:${ct.slice(0, -2)}${ct[ct.length - 2] === 'A' ? 'B' : 'A'}A`
      : envelope
    await expect(decryptToken(tampered)).rejects.toThrow()
  })

  it('throws a clear error when the key env var is missing', async () => {
    delete process.env.PO_ENCRYPTION_KEY
    __resetEncryptionForTests()
    await expect(encryptToken('x')).rejects.toThrow(/PO_ENCRYPTION_KEY/)
  })

  it('throws when the key decodes to the wrong byte length', async () => {
    setKey(Buffer.from(new Uint8Array(16)).toString('base64'))
    await expect(encryptToken('x')).rejects.toThrow(/32 bytes/)
  })

  it('throws when the key env var is not valid base64', async () => {
    setKey('!!!!not base64!!!!')
    await expect(encryptToken('x')).rejects.toThrow()
  })

  it('__resetEncryptionForTests refuses to run when the guard env is unset', async () => {
    delete process.env.PO_ENCRYPTION_KEY_ALLOW_RESET
    expect(() => __resetEncryptionForTests()).toThrow(/outside tests/)
    process.env.PO_ENCRYPTION_KEY_ALLOW_RESET = '1'   // restore for sibling tests
  })

  it('decryption survives envelopes generated via the existing helper without colon issues', async () => {
    // Round-trip across many encryptions to ensure no envelope produced
    // by encryptToken triggers a split-related decode error. Standard
    // base64 cannot contain ':', so this just regression-guards against
    // edge cases in the indexOf-based split.
    for (let i = 0; i < 20; i++) {
      const text = `payload-${i}-with-some-noise-${Math.random()}`
      const env = await encryptToken(text)
      expect(await decryptToken(env)).toBe(text)
    }
  })
})
