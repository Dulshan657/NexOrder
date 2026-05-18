// String normalization helpers for deterministic alias-table lookups.
//
// Pure functions, vitest-friendly. The alias resolver applies these to
// both the candidate value extracted from a PO and the stored
// source_value before doing equality comparison, so two visually-equal
// strings with different whitespace/casing/punctuation still match.

// Unicode combining-diacritics block (U+0300..U+036F). Constructed via
// RegExp so the source is portable across editors that strip or
// normalize the combining-mark literal range.
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036F]', 'g')

// ASCII control characters: NUL..US plus DEL. Constructed via RegExp so
// the literal control codes never appear in source text.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]+', 'g')

/**
 * Aggressive normalization for company name and product description
 * matching:
 *   - lowercase
 *   - strip Unicode diacritics (NFKD + remove combining marks)
 *   - replace any non-alphanumeric run with a single space
 *   - collapse whitespace
 *   - trim
 *
 *   "Acme Foods, Pty. Ltd."  ->  "acme foods pty ltd"
 *   "Cafe Creme"             ->  "cafe creme"
 */
export function normalizeCompanyName(input: string | null | undefined): string {
  if (!input) return ''
  const stripped = input.normalize('NFKD').replace(COMBINING_DIACRITICS, '')
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Lighter normalization for item codes: lowercase, strip leading
 * zeros only when followed by an alpha (so "0402" stays "0402" but
 * "00ABC" becomes "abc"), strip whitespace and dashes.
 *
 *   "  402 "      ->  "402"
 *   "ITM-0402"    ->  "itm0402"
 */
export function normalizeItemCode(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^0+(?=[a-z])/, '')
}

/**
 * Email-address normalization: lowercase and trim. Does not strip
 * gmail-style "+suffix" parts (those can be load-bearing for the
 * sender — we want a different alias row for orders+acme@gmail than
 * orders@gmail).
 */
export function normalizeEmail(input: string | null | undefined): string {
  if (!input) return ''
  return input.trim().toLowerCase()
}

/**
 * Domain normalization: lowercase, strip leading "www.".
 *
 *   "  Mail.Acme-Foods.COM"  ->  "mail.acme-foods.com"
 *   "www.acme.com"           ->  "acme.com"
 */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

/**
 * Strip control characters (tab, newline, CR, NUL, etc.) and collapse
 * whitespace. Used before embedding a string in a tab-separated AI
 * prompt — without this, a stray \t or \n in a customer name field
 * would corrupt the table structure the model is asked to parse.
 */
export function stripControlChars(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
