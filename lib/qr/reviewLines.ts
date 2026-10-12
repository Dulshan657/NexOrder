// The approver's working copy of a held QR order's lines.
//
// Pure: the review modal keeps a draft list the approver edits, and these are the
// few operations on it. They live apart from the component because the one rule
// that matters here is easy to get subtly wrong in JSX: **`items` is sent to the
// server only when the approver actually changed something.** The server treats
// "items present" as "the approver edited this" (`editedByApprover`, and the
// requester is told "approved with changes"), so sending an unchanged copy would
// mislabel a plain approval.

import { QR_MAX_LINE_QUANTITY } from '@/supabase/functions/_shared/qrRequestItems'
import type { QrOrderRequestItem } from '@/types'
import type { QrLineInput } from '@/services/supabase/qrService'

export { QR_MAX_LINE_QUANTITY }

/** Strip the display snapshot (name, SKU): what the server accepts as a line. */
export function toLineInputs(items: ReadonlyArray<QrOrderRequestItem>): QrLineInput[] {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    packSize: i.packSize ?? null,
    uomId: i.uomId ?? null,
  }))
}

/** Identity of a line for matching a priced line back to the one the approver sees. */
export function lineKey(l: { productId: number; uomId?: number | null; packSize?: number | null }): string {
  return `${l.productId}:${l.uomId ?? ''}:${l.packSize ?? ''}`
}

/** Same lines, same order, same quantities. */
export function sameLines(a: ReadonlyArray<QrLineInput>, b: ReadonlyArray<QrLineInput>): boolean {
  return (
    a.length === b.length &&
    a.every(
      (l, i) =>
        l.productId === b[i].productId &&
        l.quantity === b[i].quantity &&
        (l.uomId ?? null) === (b[i].uomId ?? null) &&
        (l.packSize ?? null) === (b[i].packSize ?? null),
    )
  )
}

/** Clamp to what the server accepts for one line: a whole number from 1 to the cap. */
export function clampQuantity(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(QR_MAX_LINE_QUANTITY, Math.max(1, Math.round(n)))
}

/** A new list with line `index` set to `quantity` (clamped). Out-of-range index returns the list unchanged. */
export function withQuantity(lines: ReadonlyArray<QrLineInput>, index: number, quantity: number): QrLineInput[] {
  if (index < 0 || index >= lines.length) return [...lines]
  return lines.map((l, i) => (i === index ? { ...l, quantity: clampQuantity(quantity) } : l))
}

/** A new list without line `index`. */
export function withoutLine(lines: ReadonlyArray<QrLineInput>, index: number): QrLineInput[] {
  return lines.filter((_, i) => i !== index)
}

/**
 * What to put in `approve`'s `items`: the draft when it differs from the request,
 * `undefined` ("as requested") when it does not. An empty draft differs from any
 * non-empty request, so it is returned as `[]`; the server refuses that, and the
 * modal disables Approve before it ever gets there.
 */
export function itemsToSend(
  original: ReadonlyArray<QrLineInput>,
  draft: ReadonlyArray<QrLineInput>,
): QrLineInput[] | undefined {
  return sameLines(original, draft) ? undefined : [...draft]
}
