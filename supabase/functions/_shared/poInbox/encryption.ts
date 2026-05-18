// AES-256-GCM encryption helpers for OAuth refresh tokens.
//
// Tokens are stored in the DB as a base64 envelope:
//
//     {iv-base64}:{ciphertext-and-tag-base64}
//
// The CHECK constraint in migration 00018 rejects obvious plaintext token
// prefixes ('1//', 'ya29.', 'ey', 'M.C', 'OAQABAA'). Our envelope never
// matches any of those because the IV portion is 12 random bytes of base64.
//
// The key is a 32-byte secret stored in the PO_ENCRYPTION_KEY secret as
// base64. Generate it once with `openssl rand -base64 32` and store via
// `npx supabase secrets set PO_ENCRYPTION_KEY=...`. ROTATING the key is a
// two-step operation: decrypt all rows with the old key, write the new
// key, encrypt all rows with the new key — out of scope for the MVP, but
// the envelope reserves space for a key version prefix in Phase 2.
//
// Scope note: cachedKey is module-level by design. Deno Edge Function
// isolates are single-tenant under Supabase's current runtime, so the
// cached CryptoKey object can never be observed by another tenant.
// If that ever changes, this cache must be promoted to a per-request
// AsyncLocalStorage context.
//
// The file uses only Web Crypto + base64 helpers available in both Deno
// and modern Node, so the pure logic is unit-testable from vitest in
// addition to running natively in the Edge Function runtime.

import { readEnv } from './env.ts'

const ENV_KEY = 'PO_ENCRYPTION_KEY'
const AES_KEY_BYTES = 32
const IV_BYTES = 12
const ENVELOPE_SEPARATOR = ':'

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

let cachedKey: CryptoKey | null = null

async function importKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  const b64 = readEnv(ENV_KEY)
  if (!b64) {
    throw new Error(`${ENV_KEY} is not configured`)
  }

  let rawBytes: Uint8Array
  try {
    rawBytes = base64Decode(b64)
  } catch {
    throw new Error(`${ENV_KEY} is not valid base64`)
  }

  if (rawBytes.length !== AES_KEY_BYTES) {
    throw new Error(
      `${ENV_KEY} must decode to ${AES_KEY_BYTES} bytes; got ${rawBytes.length}`,
    )
  }

  cachedKey = await crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
  return cachedKey
}

/**
 * Encrypt a plaintext OAuth token (or any short secret) into the envelope
 * format the DB stores. Each call uses a fresh random IV — never reuse one
 * with the same key.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToken: plaintext must be a non-empty string')
  }
  const key = await importKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes),
  )
  return `${base64Encode(iv)}${ENVELOPE_SEPARATOR}${base64Encode(ciphertext)}`
}

/**
 * Decrypt a stored envelope back to plaintext. Throws on any malformed
 * envelope, wrong key, or tampered ciphertext (AES-GCM's auth tag
 * verification fails closed).
 */
export async function decryptToken(envelope: string): Promise<string> {
  if (typeof envelope !== 'string' || !envelope.includes(ENVELOPE_SEPARATOR)) {
    throw new Error('decryptToken: malformed envelope')
  }
  // split with limit=2 keeps the ciphertext intact even on the (impossible
  // in base64) chance the envelope contains an extra separator.
  const sepAt = envelope.indexOf(ENVELOPE_SEPARATOR)
  const ivB64 = envelope.slice(0, sepAt)
  const ciphertextB64 = envelope.slice(sepAt + 1)
  if (!ivB64 || !ciphertextB64) {
    throw new Error('decryptToken: malformed envelope')
  }
  const key = await importKey()
  const iv = base64Decode(ivB64)
  const ciphertext = base64Decode(ciphertextB64)
  if (iv.length !== IV_BYTES) {
    throw new Error(`decryptToken: IV length must be ${IV_BYTES} bytes`)
  }
  const plaintextBytes = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
  )
  return new TextDecoder().decode(plaintextBytes)
}

/**
 * Test-only: wipes the cached key so a subsequent call re-reads the env
 * var. Only callable when PO_ENCRYPTION_KEY_ALLOW_RESET=1 is set in env;
 * vitest sets that in the test setup. The runtime guard ensures a
 * production caller can't accidentally invalidate the cache mid-request.
 *
 * Double-underscore prefix marks this as private-by-convention.
 */
export function __resetEncryptionForTests(): void {
  if (readEnv('PO_ENCRYPTION_KEY_ALLOW_RESET') !== '1') {
    throw new Error('__resetEncryptionForTests is not callable outside tests')
  }
  cachedKey = null
}
