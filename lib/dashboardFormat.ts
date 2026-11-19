// Number formatting shared by the Admin and Rep dashboards (NX-0041).
//
// The two pages used to mix `toFixed(2)`, `toFixed(0)` and
// `toLocaleString(undefined, …)` — the last one renders differently on the
// en-US CI runner than on an Australian desk. Everything goes through here,
// pinned to en-AU.

const MONEY_CENTS = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const MONEY_WHOLE = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const MONEY_COMPACT = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  currencyDisplay: 'narrowSymbol',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export interface MoneyOptions {
  /** Show cents. Default true. */
  cents?: boolean
}

/** `$1,234.50`, or `$1,235` with `{ cents: false }`. */
export function formatMoney(value: number, { cents = true }: MoneyOptions = {}): string {
  const safe = Number.isFinite(value) ? value : 0
  return (cents ? MONEY_CENTS : MONEY_WHOLE).format(safe)
}

/** `$12K` — for chart axes, where width matters more than precision. */
export function formatMoneyCompact(value: number): string {
  return MONEY_COMPACT.format(Number.isFinite(value) ? value : 0)
}

/** A plain count with thousands separators. */
export function formatCount(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-AU')
}

/**
 * Percentage change from `previous` to `current`.
 *
 * Same rule the Admin Dashboard has always used: from nothing to something is
 * +100%, nothing to nothing is 0.
 */
export function pctDelta(current: number, previous: number): number {
  if (previous > 0) return ((current - previous) / previous) * 100
  return current > 0 ? 100 : 0
}

const SHORT_DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' })

/**
 * `1 Nov` from a `YYYY-MM-DD` key. Parsed as a calendar date, not an instant,
 * so no time zone can move it to the day before.
 */
export function formatShortDate(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return dateKey
  return SHORT_DATE.format(new Date(Date.UTC(y, m - 1, d, 12)))
}
