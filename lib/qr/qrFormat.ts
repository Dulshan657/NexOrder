// Small display formatters shared by the QR approval and access screens.
// Pure and locale-aware (the operator's own locale), never throwing on a bad date.

const money = (n: number): string => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`

/** `$12.50`. A non-finite amount reads as `$0.00` rather than `$NaN`. */
export function formatMoney(n: number): string {
  return money(n)
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** `10:42` (the viewer's locale and clock style). Empty string for a missing or unreadable time. */
export function formatClock(iso: string | null | undefined): string {
  const d = toDate(iso)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** The clock time for today, `12 Oct, 10:42` for any other day. */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const d = toDate(iso)
  if (!d) return ''
  const clock = formatClock(iso)
  if (sameLocalDay(d, now)) return clock
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`
}

/** `1 item`, `3 items`. */
export function itemCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`
}

/** True when `iso` is a readable time after `now` (an unlock that has not run out yet). */
export function isFutureTime(iso: string | null | undefined, now: Date = new Date()): boolean {
  const d = toDate(iso)
  return d !== null && d.getTime() > now.getTime()
}
