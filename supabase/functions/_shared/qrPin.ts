// The pure half of the HoReCa QR reorder access scheme: what a PIN may be, what
// a QR token looks like, and how a PIN becomes the value stored.
//
// PURE ON PURPOSE. No Deno APIs, no URL imports, nothing outside the standard
// Web Crypto / `btoa` surface that Deno, modern Node and every browser share.
// The browser imports this very file (the PIN field refuses a weak PIN as the
// manager types it) and the Edge Functions import the same one (the server
// refuses it again) -- the client's verdict IS the server's, evaluated early,
// like `_shared/scanNormalize.ts`. A copy in `lib/` would eventually disagree,
// and a PIN the form accepted but `mutate-qr-access` refused is a bug report
// that reads "it just says Invalid".

/** How long a correct PIN keeps a phone unlocked. The DB enforces it; this is
 *  the number the UI counts down from (qr_verify_pin hard-codes the same 2h). */
export const QR_UNLOCK_MINUTES = 120

export const QR_PIN_MIN_LENGTH = 4
export const QR_PIN_MAX_LENGTH = 6

/** 24 random bytes -> 32 base64url characters. */
export const QR_TOKEN_BYTES = 24

export type PinProblem = 'format' | 'weak'

export type PinCheck = { ok: true } | { ok: false; reason: PinProblem }

// Keypad geometry and a few perennial favourites. Short on purpose: the
// structural rules below catch the families (runs, repeats, years); this list
// is only the entries no rule would find.
//   2580 / 0852   the straight column down / up the middle of a phone keypad
//   1357 / 7531   odd digits
//   2468 / 8642   even digits
//   1004 / 0007   "100 4 ever", "007"
//   1122 / 2211   doubled runs
//   112233 / 332211
//   2022-style    covered by the year rule
const DENYLIST: ReadonlySet<string> = new Set([
  '2580',
  '0852',
  '1357',
  '7531',
  '2468',
  '8642',
  '1004',
  '0007',
  '1122',
  '2211',
  '112233',
  '332211',
  '147258',
  '258369',
  '159357',
])

// Four digits that read as a year somebody was born, married or opened in.
// A venue has a handful of staff and the code is guarded by backoff, but a
// birth year is the first thing anyone who knows the person would try.
const YEAR_FROM = 1950
const YEAR_TO = 2035

function allSame(pin: string): boolean {
  return [...pin].every((d) => d === pin[0])
}

/**
 * Every adjacent pair steps by the same +1 or -1 (mod 10, so 7890 and 3210 are
 * runs too). 1234, 4321, 012345, 987654, 8901.
 */
function isRun(pin: string): boolean {
  const digits = [...pin].map(Number)
  for (const step of [1, 9]) {
    if (digits.every((d, i) => i === 0 || d === (digits[i - 1] + step) % 10)) return true
  }
  return false
}

/**
 * The PIN is one short block said twice or three times over: 1212, 6969,
 * 121212, 123123, 696969. (A block of one digit is `allSame`.)
 */
function isRepeatedBlock(pin: string): boolean {
  for (let block = 2; block <= pin.length / 2; block++) {
    if (pin.length % block !== 0) continue
    const unit = pin.slice(0, block)
    if (unit.repeat(pin.length / block) === pin) return true
  }
  return false
}

function isYear(pin: string): boolean {
  if (pin.length !== 4) return false
  const n = Number(pin)
  return n >= YEAR_FROM && n <= YEAR_TO
}

/**
 * May a manager choose this PIN?
 *
 *   format  not 4-6 ASCII digits. (`\d` would match other scripts' digits.)
 *   weak    all the same digit, an ascending/descending run, a repeated block,
 *           a plausible year, or on the short denylist.
 *
 * Uniqueness within a venue is a database fact and is checked there; this is
 * only about the PIN itself.
 */
export function validatePin(pin: string): PinCheck {
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin)) {
    return { ok: false, reason: 'format' }
  }
  if (allSame(pin) || isRun(pin) || isRepeatedBlock(pin) || isYear(pin) || DENYLIST.has(pin)) {
    return { ok: false, reason: 'weak' }
  }
  return { ok: true }
}

/** What the form says for each refusal. One place, so the client and the
 *  server's INVALID_INPUT/QR_WEAK_PIN message agree. */
export function describePinProblem(reason: PinProblem): string {
  return reason === 'format'
    ? 'A PIN is 4 to 6 digits.'
    : 'That PIN is too easy to guess. Avoid repeats, runs like 1234, and years.'
}

/** A QR token as the URL carries it: base64url, at least 32 characters. The
 *  upper bound only keeps an absurd string from reaching the database. */
export function isQrToken(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(s)
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh opaque venue token: 24 CSPRNG bytes, base64url (32 characters). */
export function generateQrToken(): string {
  const bytes = new Uint8Array(QR_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * HMAC-SHA256(pepper, `${horecaId}:${pin}`) as lowercase hex -- the value
 * stored in qr_staff.pin_hmac and passed to qr_verify_pin().
 *
 * Bound to the venue so two venues choosing the same PIN store different
 * values, and keyed with QR_PIN_PEPPER because a 4-6 digit PIN has at most a
 * million values: without a secret key the stored hash would be a lookup table.
 * Rotating the pepper invalidates every PIN, by design.
 *
 * Throws on an empty pepper rather than producing a hash anyone could
 * recompute.
 */
export async function hmacPin(pepper: string, horecaId: number, pin: string): Promise<string> {
  if (!pepper) throw new Error('QR_PIN_PEPPER is not configured')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${horecaId}:${pin}`)))
}

/**
 * A short, stable, non-reversible handle for a venue token: the first 16 hex
 * characters of SHA-256(token). It keys the per-token rate-limit bucket in
 * `qr-unlock`, so the bucket is independent of every request header (an
 * attacker can rotate IPs and spoof `X-Forwarded-For`; they cannot change which
 * sticker they are guessing against) while the token itself never lands in a
 * database key or a log line.
 */
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toHex(digest).slice(0, 16)
}
