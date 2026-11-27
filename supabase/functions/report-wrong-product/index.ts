// Edge Function: report-wrong-product (NX-0050)
//
// POST { recommendation_id, real_product_id, quantity, scanned_code? }
//   -> { ok: true, mismatchId, heldTasks: [{ recommendationId, locationId }] }
//
// "Not this product?" on a putaway Walk stop: the carton's label says the
// task's product, but it holds another. In ONE transaction
// (wie_report_wrong_product_tx, mig 00152) the label product's quantity comes
// off the warehouse root, the counted quantity of the real product goes on (on
// the same plate), the task is closed as written_off and the mismatch is
// recorded. Then the real product is planned HELD (quarantine): its putaway
// goes to a hold location. Then Admin and Manager are told to check the barcode.
//
// The decision is _shared/labelMismatch.ts planWrongProduct, asked here first so
// a refusal reads in plain words; the transaction asks again under its lock.

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
import { normalizeScan } from '../_shared/scanNormalize.ts'
import { generatePutawayTasks } from '../_shared/putawayTasks.ts'
import { planWrongProduct, recordLabelMismatches } from '../_shared/labelMismatch.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  recommendation_id: z.number().int().positive(),
  real_product_id: z.number().int().positive(),
  quantity: z.number(),
  scanned_code: z.string().max(120).optional(),
})

const PG_ERROR_CODES: ReadonlyArray<['NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT', string]> = [
  ['NOT_FOUND', 'NOT_FOUND:'],
  ['CONFLICT', 'CONFLICT:'],
  ['INVALID_INPUT', 'INVALID_INPUT:'],
  ['INVALID_INPUT', 'INVALID_QTY:'],
  ['CONFLICT', 'INSUFFICIENT_STOCK:'],
]

function rpcError(message: string): EdgeFunctionError {
  for (const [code, prefix] of PG_ERROR_CODES) {
    if (message.includes(prefix)) {
      return new EdgeFunctionError(code, message.slice(message.indexOf(prefix) + prefix.length).trim())
    }
  }
  return new EdgeFunctionError('INTERNAL', `Could not record it, try again. (${message})`)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`report-wrong-product:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const { recommendation_id, real_product_id, quantity, scanned_code } = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: rec, error: recErr } = await admin.from('wie_putaway_recommendations')
      .select('id, product_id, quantity, warehouse_id, handling_unit_id, status')
      .eq('id', recommendation_id).maybeSingle()
    if (recErr) throw new EdgeFunctionError('INTERNAL', 'Could not read that stop, try again.')
    if (!rec) throw new EdgeFunctionError('NOT_FOUND', `Putaway task ${recommendation_id} not found`)
    const r = rec as any
    if (auth.role === 'Warehouse' && auth.profile.home_warehouse_id !== r.warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only put away stock at your own warehouse')
    }

    let plateProductIds: number[] = []
    let huType: 'pallet' | 'carton' | undefined
    if (r.handling_unit_id != null) {
      const [{ data: bal }, { data: hu }] = await Promise.all([
        admin.from('inventory_balances').select('product_id')
          .eq('handling_unit_id', r.handling_unit_id).gt('on_hand', 0),
        admin.from('handling_units').select('hu_type').eq('id', r.handling_unit_id).maybeSingle(),
      ])
      plateProductIds = ((bal ?? []) as any[]).map((b) => Number(b.product_id))
      const t = (hu as any)?.hu_type
      huType = t === 'pallet' || t === 'carton' ? t : undefined
    }

    const plan = planWrongProduct({
      task: {
        id: r.id, productId: r.product_id, quantity: Number(r.quantity), warehouseId: r.warehouse_id,
        handlingUnitId: r.handling_unit_id ?? null, status: r.status,
      },
      realProductId: real_product_id,
      quantity,
      plateProductIds,
    })
    if (!plan.ok) throw new EdgeFunctionError(plan.code, plan.message)

    const { data: tx, error: txErr } = await admin.rpc('wie_report_wrong_product_tx', {
      p_rec_id: recommendation_id,
      p_real_product_id: real_product_id,
      p_quantity: quantity,
      p_scanned_code: scanned_code ? normalizeScan(scanned_code) : null,
      p_actor: auth.userId,
    })
    if (txErr) throw rpcError(txErr.message ?? '')
    const t = tx as any

    // The real product, held: its putaway goes to a hold location.
    let heldTasks: Array<{ recommendationId: number; locationId: number | null }> = []
    try {
      const planned = await generatePutawayTasks(admin, {
        warehouseId: r.warehouse_id,
        lines: [{
          product_id: real_product_id,
          quantity,
          hu_id: r.handling_unit_id ?? undefined,
          hu_type: huType,
          quarantine: true,
        }],
        actorId: auth.userId,
        goodsReceiptId: t.goods_receipt_id ?? undefined,
      })
      if (planned.mode === 'engine') {
        heldTasks = planned.recommendations.map((x) => ({
          recommendationId: x.recommendationId, locationId: x.recommendedLocationId,
        }))
      }
    } catch (e) {
      // The stock is already recorded and held at the warehouse root; the desk
      // can plan its putaway. Say so rather than undo a correct record.
      console.error('[report-wrong-product] held putaway could not be planned', e)
    }

    await recordLabelMismatches(admin, [{
      scannedCode: t.scanned_code,
      labelProductId: r.product_id,
      realProductId: real_product_id,
      quantity,
      warehouseId: r.warehouse_id,
      goodsReceiptId: t.goods_receipt_id ?? null,
      putawayRecId: r.id,
      reportedBy: auth.userId,
    }], { alreadyInserted: [Number(t.mismatch_id)] })

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'putaway_task',
      resourceId: String(recommendation_id),
      after: { label_mismatch_id: t.mismatch_id, real_product_id, quantity, held_tasks: heldTasks },
      metadata: { reason: 'label mismatch' },
    })

    return new Response(JSON.stringify({ ok: true, mismatchId: Number(t.mismatch_id), heldTasks }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[report-wrong-product] unexpected', e)
    return errorResponse('INTERNAL', 'Could not record it, try again.', undefined, undefined, req)
  }
})
