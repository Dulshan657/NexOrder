// The `?qr=<token>` entry URL printed on a venue's poster or sticker -- parse it,
// remember it, take it back off the address bar.
//
// Pure apart from the storage helpers, and those take the storage as a parameter
// (defaulting to `localStorage`) so they test without a DOM. Every storage access
// is wrapped: a private window, blocked site data or a quota error must degrade
// to "no remembered venue", never to a thrown render.
//
// The token is an OPAQUE venue identifier, not a credential -- the PIN is. It is
// still validated with the same `isQrToken` the server uses before it is used for
// anything, and a value read back from storage is validated again: storage is
// user-writable, and a token that reaches `qr-unlock` unchecked is just noise for
// its rate limiter.

import { isQrToken } from '@/supabase/functions/_shared/qrPin'

/** The query parameter the printed URL carries: `https://app/?qr=<token>`. */
export const QR_PARAM = 'qr'

/**
 * localStorage key for the last venue token this browser opened. Lets a locked
 * (expired) kitchen phone return to that venue's PIN pad instead of a login page.
 */
export const QR_LAST_TOKEN_KEY = 'nexorder.qr.lastToken'

/**
 * The venue token in a `location.search` string (`?qr=...`, leading `?` optional),
 * or null when absent or malformed. A malformed token is treated exactly like a
 * missing one: the server would refuse it as unknown anyway, and the app then
 * behaves as if the URL were an ordinary one.
 */
export function readQrToken(search: string): string | null {
  const value = new URLSearchParams(search).get(QR_PARAM)
  return isQrToken(value) ? value : null
}

/** The slice of `Storage` these helpers use, so tests can pass a fake. */
export type QrTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): QrTokenStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Merely touching `localStorage` can throw (blocked site data).
    return null
  }
}

/** The remembered venue token, re-validated on the way out; null when none or unreadable. */
export function readLastQrToken(storage: QrTokenStorage | null = defaultStorage()): string | null {
  if (!storage) return null
  try {
    const value = storage.getItem(QR_LAST_TOKEN_KEY)
    return isQrToken(value) ? value : null
  } catch {
    return null
  }
}

/** Remember a venue token. Silently does nothing if storage is unavailable or the token is malformed. */
export function saveLastQrToken(token: string, storage: QrTokenStorage | null = defaultStorage()): void {
  if (!storage || !isQrToken(token)) return
  try {
    storage.setItem(QR_LAST_TOKEN_KEY, token)
  } catch {
    // Quota / private mode: the venue just is not remembered.
  }
}

/** Forget the remembered venue (a regenerated code, or the user chose "not this venue"). */
export function clearLastQrToken(storage: QrTokenStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(QR_LAST_TOKEN_KEY)
  } catch {
    // Nothing useful to do.
  }
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i
// A throwaway origin so relative inputs can be parsed; it never appears in the output.
const PLACEHOLDER_BASE = 'http://qr.invalid'

/**
 * `url` with the `qr` parameter removed -- for `history.replaceState` once the
 * token has been captured, so it does not linger in the address bar, the browser
 * history or a screenshot of the phone.
 *
 * Accepts an absolute URL (`window.location.href`), an origin-relative one
 * (`/path?x=1#h`) or a bare query (`?qr=...`), and returns the same form. Every
 * other parameter and the hash are kept, in order.
 */
export function stripQrParam(url: string): string {
  const absolute = ABSOLUTE_URL.test(url)
  const parsed = new URL(url, absolute ? undefined : PLACEHOLDER_BASE)
  parsed.searchParams.delete(QR_PARAM)
  if (absolute) return parsed.toString()
  // A bare query or fragment has no path of its own to give back.
  if (url.startsWith('?') || url.startsWith('#')) return `${parsed.search}${parsed.hash}`
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
