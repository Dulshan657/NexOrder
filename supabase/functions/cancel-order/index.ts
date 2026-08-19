// cancel-order Edge Function
//
// Admin-only. Cancels an order that has been placed but not yet picked: sets the
// terminal `cancelled` status (mig 00111), releases every reservation the order
// still holds through the inventory ledger, cancels its unpaid invoice, and
// writes an audit event. A reason is mandatory.
//
// WHY THIS EXISTS. Mig 00112 revokes the direct INSERT/UPDATE/DELETE grants that
// `authenticated` had held on `orders` and `order_items` since 00001, and drops
// the three write policies 00009/00010 left behind — security-audit finding
// DB-1. Until now an Admin could DELETE an order straight over PostgREST: no
// audit row, no ledger correction, and its `allocate` legs left in
// inventory_movements naming an order that no longer existed. This is the
// capability that replaces it, and it is strictly better than what it replaces:
// nothing is destroyed, the stock actually goes back, and there is a record.
//
// THE DECISION IS NOT MADE HERE. `_shared/orderCancel.ts` decides whether an
// order may be cancelled and what the operator is told if it may not, and the
// browser imports the very same module — so the disabled Cancel button and its
// tooltip are the server's verdict, not a guess at it.
//
// THE WRITE IS NOT MADE HERE EITHER. `order_cancel_tx` (mig 00111) does the
// claim, the release and the invoice in one transaction, because
// `inv_release_reservation` is not idempotent and is not keyed by order:
// releasing twice lowers a shared `allocated` counter twice and eats another
// order's reservation. The conditional UPDATE inside that function is what
// serialises two operators pressing Cancel at the same moment.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  evaluateCancel,
  type CancelInvoiceStatus,
  type CancellableOrderStatus,
} from '../_shared/orderCancel.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

const inputSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(CANCEL_REASON_MIN).max(CANCEL_REASON_MAX),
})

/** What `order_cancel_tx` answers with. A precondition failure is a verdict, not
 *  an exception — nothing was written, so there is nothing to roll back. */
type CancelTxResult =
  | {
      ok: true
      orderId: string
      previousStatus: CancellableOrderStatus
      cancelledAt: string
      invoiceId: string | null
      invoiceWas: CancelInvoiceStatus | null
    }
  | {
      ok: false
      code: 'NOT_FOUND' | 'ALREADY_CANCELLED' | 'NOT_CANCELLABLE' | 'PICKING_STARTED' | 'INVOICE_PAID' | 'CONFLICT'
      status?: CancellableOrderStatus
      pickedUnits?: number
    }

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('sales_orders')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Own bucket at 10/min/user. Deliberately far below update-order-status's
    // 60/min: cancelling is a rare, destructive act, and a burst of them is
    // either a mistake or an attack. Matches the mutate-warehouse-location
    // corrective buckets rather than the routine mutate functions.
    const rl = await checkRateLimit(`cancel-order:${auth.userId}`, {
      windowMs: 60_000,
      max: 10,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { orderId, reason } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // ---- Gather what the shared decision turns on ----------------------------
    const { data: orderRow, error: orderError } = await admin
      .from('orders')
      .select('id, status, total, horeca_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError) {
      throw new EdgeFunctionError('INTERNAL', `Failed to query orders: ${orderError.message}`)
    }
    if (!orderRow) {
      throw new EdgeFunctionError('NOT_FOUND', `No order with id ${orderId}`)
    }

    const { data: invoiceRow, error: invoiceError } = await admin
      .from('invoices')
      .select('id, status')
      .eq('order_id', orderId)
      .maybeSingle()

    if (invoiceError) {
      throw new EdgeFunctionError('INTERNAL', `Failed to query invoices: ${invoiceError.message}`)
    }

    // Count picked units rather than trusting the status. An order's status is
    // the rollup of its per-warehouse fulfilments and takes the LOWEST rung, so
    // an order reading `processed` may have a warehouse that has already picked.
    const { data: pickRows, error: pickError } = await admin
      .from('pick_progress')
      .select('picked_qty')
      .eq('order_id', orderId)

    if (pickError) {
      throw new EdgeFunctionError('INTERNAL', `Failed to query pick_progress: ${pickError.message}`)
    }
    const pickedUnits = (pickRows ?? []).reduce(
      (sum: number, r: any) => sum + Number(r.picked_qty ?? 0),
      0,
    )

    // ---- The decision, shared with the browser -------------------------------
    const verdict = evaluateCancel({
      status: (orderRow as any).status as CancellableOrderStatus,
      invoiceStatus: ((invoiceRow as any)?.status ?? null) as CancelInvoiceStatus | null,
      pickedUnits,
      actorRole: auth.role,
      reason,
    })

    if (verdict.ok === false) {
      // CONFLICT rather than INVALID_INPUT for the state-based refusals: the
      // request was well formed, the world was not in a state that permits it.
      const code = verdict.code === 'REASON_REQUIRED' ? 'INVALID_INPUT' : 'CONFLICT'
      throw new EdgeFunctionError(code, verdict.message, {
        reason: verdict.code,
        status: (orderRow as any).status,
        pickedUnits,
      })
    }

    // ---- The write, atomically ----------------------------------------------
    const { data: txData, error: txError } = await admin.rpc('order_cancel_tx', {
      p_order_id: orderId,
      p_actor: auth.userId,
      p_reason: reason,
    })

    if (txError) {
      throw new EdgeFunctionError('INTERNAL', `Cancellation failed: ${txError.message}`)
    }

    const result = txData as CancelTxResult

    // The transaction re-asserted the preconditions under a row lock. Reaching
    // here means something changed between our read and the claim — another
    // cancel, or a pick landing mid-request. Report it as the conflict it is
    // rather than as a success, and say so in terms the operator can act on.
    if (!result || result.ok === false) {
      throw new EdgeFunctionError(
        'CONFLICT',
        conflictMessage(result?.code ?? 'CONFLICT'),
        { reason: result?.code ?? 'CONFLICT' },
      )
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'order_cancellation',
      resourceId: orderId,
      before: { status: result.previousStatus, invoiceStatus: result.invoiceWas },
      after: {
        status: 'cancelled',
        invoiceStatus: result.invoiceId && result.invoiceWas !== 'paid' ? 'cancelled' : result.invoiceWas,
      },
      reason,
      metadata: {
        orderId,
        total: (orderRow as any).total,
        horecaId: (orderRow as any).horeca_id,
        invoiceId: result.invoiceId,
        reservationReleased: true,
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        orderId,
        status: 'cancelled',
        previousStatus: result.previousStatus,
        cancelledAt: result.cancelledAt,
        invoiceId: result.invoiceId,
        invoiceCancelled: Boolean(result.invoiceId) && result.invoiceWas !== 'paid',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse(
      'INTERNAL',
      e instanceof Error ? e.message : 'Unknown error',
      undefined,
      undefined,
      req,
    )
  }
})

/** Phrasing for a race the transaction caught. These are all "someone else got
 *  there first" — the operator's next step is always to reload and look. */
function conflictMessage(code: string): string {
  switch (code) {
    case 'ALREADY_CANCELLED':
      return 'This order was cancelled by someone else a moment ago. Reload to see it.'
    case 'PICKING_STARTED':
      return 'A warehouse started picking this order while you were cancelling it. Reload and check the pick queue.'
    case 'INVOICE_PAID':
      return 'This order was marked paid while you were cancelling it. Refund or credit the invoice first.'
    case 'NOT_CANCELLABLE':
      return 'This order moved forward while you were cancelling it. Reload to see its current status.'
    case 'NOT_FOUND':
      return 'This order no longer exists.'
    default:
      return 'The order changed while you were cancelling it. Reload and try again.'
  }
}
