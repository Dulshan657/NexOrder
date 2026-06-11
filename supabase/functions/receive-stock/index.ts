// receive-stock Edge Function
//
// Goods receipt (stock IN). Admin, Manager, and Warehouse roles record received
// quantities against products — optionally into a tracked batch (lot + expiry +
// barcode). A receipt header records WHICH supplier supplied the goods (plus an
// invoice/docket reference, received date, and received-by); each line may
// override the header supplier. Delegates the atomic balance/ledger/cache write
// to the inv_receive_stock Postgres RPC (service_role-only EXECUTE). Direct
// writes to inventory_balances / inventory_movements / batches / goods_receipts
// are RLS-blocked.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

// A YYYY-MM-DD date (matches an HTML <input type="date"> value).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiry_date must be YYYY-MM-DD')

const receiptLineSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  lot_code: z.string().min(1).max(120).optional(),
  expiry_date: isoDate.optional(),
  barcode: z.string().min(1).max(120).optional(),
  supplier_id: z.number().int().positive().optional(),
  po_id: z.string().min(1).max(120).optional(),
})

// Delivery header. A supplier is required to receive stock: either an existing
// supplier_id, or a free-text supplier_name we resolve/create. received_by /
// received_date default server-side to the actor / today when omitted.
const receiptHeaderSchema = z.object({
  supplier_id: z.number().int().positive().optional(),
  supplier_name: z.string().min(1).max(200).optional(),
  reference: z.string().min(1).max(200).optional(),
  received_date: isoDate.optional(),
  received_by: z.string().uuid().optional(),
  // Warehouse to receive into (mig 00038). Defaults to the actor's home warehouse,
  // then the system default. Warehouse-role staff may only receive at their site.
  location_id: z.number().int().positive().optional(),
})

const inputSchema = z.object({
  receipt: receiptHeaderSchema.optional(),
  lines: z.array(receiptLineSchema).min(1).max(200),
})

type ReceiptHeader = z.infer<typeof receiptHeaderSchema>

// Resolve the receipt's supplier to an id, or throw if none was supplied.
//  - supplier_id present  → use it.
//  - supplier_name only   → match an existing supplier (case-insensitive) or
//                           create a minimal one so it joins the master list.
// A supplier is required: a receipt must record who supplied the goods.
async function resolveHeaderSupplier(
  admin: ReturnType<typeof createClient>,
  receipt: ReceiptHeader | undefined,
): Promise<number> {
  if (receipt?.supplier_id) return receipt.supplier_id

  const name = receipt?.supplier_name?.trim()
  if (!name) {
    throw new EdgeFunctionError('INVALID_INPUT', 'A supplier is required to receive stock')
  }

  // Exact case-insensitive match (no wildcards → ilike is an = with folding).
  const { data: existing, error: findErr } = await admin
    .from('suppliers')
    .select('id')
    .ilike('name', name)
    .limit(1)
  if (findErr) throw new EdgeFunctionError('INTERNAL', `supplier lookup failed: ${findErr.message}`)
  if (existing && existing.length > 0) return existing[0].id as number

  const { data: created, error: createErr } = await admin
    .from('suppliers')
    .insert({ name, contact_person: '', email: '', phone: '' })
    .select('id')
    .single()
  if (createErr) throw new EdgeFunctionError('INTERNAL', `supplier create failed: ${createErr.message}`)
  return created!.id as number
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // 30 receipts/min/user — well above interactive pace, throttles scripted abuse.
    const rl = await checkRateLimit(`receive-stock:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many receipts in a short period')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { receipt, lines } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Resolve the header supplier. A supplier is mandatory on every receipt;
    // a free-text supplier_name is matched case-insensitively or created on the
    // fly so it still rolls up in the supplier master (and reports).
    const supplierId = await resolveHeaderSupplier(admin, receipt)

    // Resolve the destination warehouse: explicit > actor's home warehouse >
    // (null → RPC default). Warehouse staff may only receive at their own site.
    const locationId = receipt?.location_id ?? auth.profile.home_warehouse_id ?? null
    if (auth.role === 'Warehouse' && receipt?.location_id && receipt.location_id !== auth.profile.home_warehouse_id) {
      throw new EdgeFunctionError('FORBIDDEN', 'You can only receive stock at your own warehouse')
    }

    const { data: result, error: rpcError } = await admin.rpc('inv_receive_stock', {
      p_lines: lines,
      p_actor: auth.userId,
      p_receipt: {
        location_id: locationId,
        supplier_id: supplierId,
        reference: receipt?.reference ?? null,
        received_date: receipt?.received_date ?? null,
        received_by: receipt?.received_by ?? auth.userId,
      },
    })
    if (rpcError) {
      // INVALID_QTY / NO_WAREHOUSE bubble up from the RPC as P0001.
      const msg = rpcError.message ?? 'inventory receipt failed'
      throw new EdgeFunctionError('INTERNAL', `receive failed: ${msg}`)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'create',
      resource: 'inventory_receipt',
      resourceId: null,
      after: { supplier_id: supplierId, reference: receipt?.reference ?? null, lines },
      metadata: { result },
    })

    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
