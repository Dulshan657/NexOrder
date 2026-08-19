import { describe, expect, it } from 'vitest'

import { toStorageRef, signableKey, isSafeStorageKey } from '../supabase/functions/_shared/storageKey'

/**
 * The classifier both runtimes share (mig 00113).
 *
 * The reason it exists is that three shapes of stored value remain reachable
 * after the migration normalised the database, and getting the classification
 * wrong fails in a different way for each: a URL treated as a key gets signed
 * into a path that exists nowhere, a key treated as a URL renders a broken
 * image, and a `data:` value pushed through either branch throws away a
 * signature that was never in object storage to begin with.
 */

const PUBLIC_URL =
  'https://uqvekvavkjjurpqtovbq.supabase.co/storage/v1/object/public/signatures/orders/6f1c9d2e.png'

describe('toStorageRef', () => {
  it('treats a bare key as a key', () => {
    expect(toStorageRef('signatures', 'orders/6f1c9d2e.png')).toEqual({
      kind: 'key',
      key: 'orders/6f1c9d2e.png',
    })
  })

  it('recovers the key from a legacy absolute public URL', () => {
    expect(toStorageRef('signatures', PUBLIC_URL)).toEqual({
      kind: 'key',
      key: 'orders/6f1c9d2e.png',
    })
  })

  it('keeps a data: URL inline rather than trying to sign it', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo='
    expect(toStorageRef('signatures', data)).toEqual({ kind: 'inline', url: data })
  })

  it('classifies a foreign URL as external, never as a key', () => {
    // UserForm lets an operator type any avatar URL, and Header falls back to
    // i.pravatar.cc. Signing either would be nonsense.
    const foreign = 'https://i.pravatar.cc/150?u=alice'
    expect(toStorageRef('avatars', foreign)).toEqual({ kind: 'external', url: foreign })
  })

  it('does not mistake another bucket’s URL for this bucket’s object', () => {
    expect(toStorageRef('visit-photos', PUBLIC_URL).kind).toBe('external')
  })

  it('drops a cache-busting query string, which is not part of the key', () => {
    expect(toStorageRef('signatures', `${PUBLIC_URL}?t=1699999`)).toEqual({
      kind: 'key',
      key: 'orders/6f1c9d2e.png',
    })
  })

  it('treats null, undefined and blank as empty', () => {
    expect(toStorageRef('signatures', null).kind).toBe('empty')
    expect(toStorageRef('signatures', undefined).kind).toBe('empty')
    expect(toStorageRef('signatures', '   ').kind).toBe('empty')
  })

  it('checks data: before anything URL-shaped', () => {
    // A data URL can contain the marker inside its payload; it must still be
    // inline, because there is no object behind it.
    const sneaky = 'data:image/png;base64,L3N0b3JhZ2UvdjEvb2JqZWN0L3B1YmxpYy9zaWduYXR1cmVzLw=='
    expect(toStorageRef('signatures', sneaky).kind).toBe('inline')
  })
})

describe('isSafeStorageKey', () => {
  it('accepts the shape this app mints', () => {
    expect(isSafeStorageKey('orders/6f1c9d2e-4b1a-4c11-9a3e-000000000000.png')).toBe(true)
    expect(isSafeStorageKey('visits/6f1c9d2e.jpg')).toBe(true)
  })

  it('rejects traversal and absolute paths', () => {
    expect(isSafeStorageKey('../po-archive/secret.eml')).toBe(false)
    expect(isSafeStorageKey('/orders/x.png')).toBe(false)
    expect(isSafeStorageKey('orders//x.png')).toBe(false)
    expect(isSafeStorageKey('orders/./x.png')).toBe(false)
  })

  it('rejects a percent sign outright', () => {
    // The archivePaths trap: createSignedUrl signs an encoded spelling
    // SUCCESSFULLY and returns a URL that only 400s when fetched. Every key we
    // mint is uuid-based, so a % means malformed, not "needs decoding".
    expect(isSafeStorageKey('orders/a%2Fb.png')).toBe(false)
  })

  it('rejects blank and absurdly long keys', () => {
    expect(isSafeStorageKey('')).toBe(false)
    expect(isSafeStorageKey(`orders/${'a'.repeat(600)}.png`)).toBe(false)
  })
})

describe('signableKey', () => {
  it('returns a key for both stored spellings', () => {
    expect(signableKey('signatures', 'orders/x.png')).toBe('orders/x.png')
    expect(signableKey('signatures', PUBLIC_URL)).toBe('orders/6f1c9d2e.png')
  })

  it('refuses to sign anything that is not an object in this bucket', () => {
    expect(signableKey('signatures', 'data:image/png;base64,AAAA')).toBeNull()
    expect(signableKey('signatures', 'https://example.com/x.png')).toBeNull()
    expect(signableKey('signatures', null)).toBeNull()
  })
})
