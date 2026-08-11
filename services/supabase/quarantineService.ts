// Ending a hold (mig 00101).
//
// The hold lives on the PLACE, not on the stock, so releasing is a move and
// nothing else — there is no flag to clear. `release-quarantine` is the only
// path: it is the one that verifies the source really is held and the
// destination really is not, and the one whose audit event says a hold ended
// rather than that stock moved. See its header for why it is not transfer-stock.

import { supabase } from '@/lib/supabase'
import { describeValidationIssues, extractFunctionErrorDetails, extractFunctionErrorMessage } from '@/lib/functionError'

export interface ReleaseQuarantineLine {
  productId: number
  quantity: number
  /** The plate that physically moves; omitted = unconstrained, expiry-ordered. */
  handlingUnitId?: number | null
}

export interface ReleaseQuarantineInput {
  fromLocationId: number
  toLocationId: number
  lines: ReleaseQuarantineLine[]
  note?: string | null
}

export interface ReleaseQuarantineResult {
  moved: unknown[]
  /** Lines the transfer refused — reported, never fatal, because the ones that
   *  DID move really did move and the operator needs to know which. */
  failed: Array<{ product_id: number; error: string }>
}

export async function releaseQuarantine(input: ReleaseQuarantineInput): Promise<ReleaseQuarantineResult> {
  const { data, error } = await supabase.functions.invoke<ReleaseQuarantineResult & { ok: true }>(
    'release-quarantine',
    {
      body: {
        from_location_id: input.fromLocationId,
        to_location_id: input.toLocationId,
        lines: input.lines.map((l) => ({
          product_id: l.productId,
          quantity: l.quantity,
          handling_unit_id: l.handlingUnitId ?? null,
        })),
        note: input.note ?? null,
      },
    },
  )
  if (error) {
    // functions.invoke collapses every non-2xx into "non-2xx status code" and
    // leaves the real reason unread on `.context`. The refusals here are all
    // actionable — not held, destination also held, insufficient stock — and
    // read identically without this.
    const message = await extractFunctionErrorMessage(error, 'Release failed')
    const issues = describeValidationIssues(await extractFunctionErrorDetails(error))
    throw new Error(issues ? `${message} — ${issues}` : message)
  }
  return { moved: (data as any)?.moved ?? [], failed: (data as any)?.failed ?? [] }
}
