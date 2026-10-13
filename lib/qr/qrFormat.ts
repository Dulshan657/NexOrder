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

/** The size of a held order's estimate: `$48.20 est. · 3 items`. The one line every QR list shows. */
export function requestEstimateSummary(r: { quotedTotal: number; items: ReadonlyArray<unknown> }): string {
  return `${formatMoney(r.quotedTotal)} est. · ${itemCountLabel(r.items.length)}`
}

/** How many lines are named before the rest fold into "and N more". */
const SUMMARY_NAMED_LINES = 3

interface SummaryLine {
  productId: number
  quantity: number
  productName?: string
}

/**
 * What was in a held order, from the name snapshot taken when it was sent:
 * `Tomato Paste × 3, Chilli Oil × 1 and 2 more`. A row written before names were
 * snapshotted falls back to `Product #42`, so a line is never blank.
 */
export function requestItemsSummary(items: ReadonlyArray<SummaryLine>): string {
  const named = items
    .slice(0, SUMMARY_NAMED_LINES)
    .map((i) => `${i.productName?.trim() || `Product #${i.productId}`} × ${i.quantity}`)
    .join(', ')
  const more = items.length - SUMMARY_NAMED_LINES
  return more > 0 ? `${named} and ${more} more` : named
}

/** True when `iso` is a readable time after `now` (an unlock that has not run out yet). */
export function isFutureTime(iso: string | null | undefined, now: Date = new Date()): boolean {
  const d = toDate(iso)
  return d !== null && d.getTime() > now.getTime()
}
