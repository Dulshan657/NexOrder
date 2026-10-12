// qr-order-request Edge Function
//
// The whole life of a QR-placed order, from the kitchen's "Order same again" to
// the order the warehouse sees. A kitchen phone cannot place an order itself: it
// files a REQUEST (`qr_order_requests`, mig 00129), and a person who answers for
// the venue approves it. Only then does an order exist.
//
//   submit   QR Staff     files the request; approvers are notified
//   cancel   QR Staff     withdraws their own request while it is still pending
//   preview  approver     what approving would do, every problem included
//   approve  approver     claims the request, places the REAL order, links it
//   reject   approver     declines it, with a reason the requester is told
//
// Callers other than QR Staff cannot submit or cancel, and QR Staff can never
// preview, approve or reject -- "approver" is Admin, Manager, the venue's
// ASSIGNED reps and the venue's own Customer logins (`canApproveHoreca`).
//
// ── APPROVAL REUSES place-order, IT DOES NOT COPY IT ─────────────────────────
//
// `approve` calls `placeOrderCore` -- the same function `place-order` runs -- so a
// held order gets the venue's pricing, promotions, the stock / minimum / credit
// rules, stock reservation, the invoice and the confirmation email by exactly the
// path a Customer login's order does. (`approve-po` reimplements a subset and so
// misses HoReCa pricing; that is the trap this avoids.)
//
// `actorRole` is passed as 'Restaurant/Hotel Customer', not 'QR Staff'. The role
// reaches only pricing's `UserContext`, so today it changes nothing -- but the
// order is placed ON BEHALF OF the venue, at the venue's prices, and if pricing
// ever branches on role the right answer is the venue's own. The dry runs (submit
// quote, approver preview) use the same value, so a preview is never priced under
// different rules from the order it previews.
//
// ── THE CLAIM ───────────────────────────────────────────────────────────────
//
// Placing an order cannot share a transaction with the request row, so approval
// first CLAIMS it with one conditional UPDATE (`pending -> approving`). A second
// approver, a concurrent reject and the requester's cancel all lose that race and
// get QR_REQUEST_CONFLICT, so an order is never placed twice. If the placement
// fails the claim is reverted to `pending` with `last_error` set, so the request
// is back in the queue for someone to edit or decline. A claim whose function died
// is taken over after QR_CLAIM_STALE_MS. The state machine is the pure
// `_shared/qrRequestTransitions.ts`.
//
// No stock is reserved while a request is pending; it is reserved at approval, and
// a shortage is the approver's to resolve, not the kitchen's to be refused for.

//
// FILES: `schema.ts` (what each action accepts), `shared.ts` (the row, guards and
// helpers), `requester.ts` (submit, cancel), `approver.ts` (preview, approve,
// reject). This file is the HTTP shell: CORS, the module gate, authentication,
// body validation and dispatch.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { requireAuth } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { inputSchema, validationIssues } from './schema.ts'
import { cancel, submit } from './requester.ts'
import { approve, preview, reject } from './approver.ts'

// ── handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('shop')
    // No allow-list here: submit/cancel are QR Staff's and the rest are the
    // approvers', and each action enforces its own side. `requireAuth` already
    // refuses a QR Staff login whose unlock has lapsed.
    const auth = await requireAuth(req)

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const result =
      input.action === 'submit' ? await submit(admin, auth, input)
      : input.action === 'cancel' ? await cancel(admin, auth, input)
      : input.action === 'preview' ? await preview(admin, auth, input)
      : input.action === 'approve' ? await approve(admin, auth, input)
      : await reject(admin, auth, input)

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[qr-order-request] unexpected error:', e)
    return errorResponse('INTERNAL', 'Something went wrong. Please try again.', undefined, undefined, req)
  }
})
