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
import { generatePutawayTasks, type GeneratePutawayResult } from '../_shared/putawayTasks.ts'
import { resolveReceiveDestination } from '../_shared/receiveDestination.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

// A YYYY-MM-DD date (matches an HTML <input type="date"> value).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiry_date must be YYYY-MM-DD')

const receiptLineSchema = z.object({
  product_id: z.number().int().positive(),
  // Quantity in the chosen UOM (or base units when uom_id is absent). Converted
  // to base units server-side before the RPC, which always expects base units.
  quantity: z.number().positive(),
  uom_id: z.number().int().positive().optional(),
  lot_code: z.string().min(1).max(120).optional(),
  expiry_date: isoDate.optional(),
  barcode: z.string().min(1).max(120).optional(),
  supplier_id: z.number().int().positive().optional(),
  po_id: z.string().min(1).max(120).optional(),
  // Which plate (from `plates` below) this line lands on. Client-side key, not
  // an id: plate codes are minted server-side by hu_next_code() so they cannot
  // be guessed or spoofed by the caller.
  plate_key: z.string().min(1).max(64).optional(),
  // Hold this line (mig 00101). Per LINE so a single suspect product can be held
  // while the rest of the delivery goes to ordinary stock; the header flag below
  // is what makes "hold the whole delivery" one click.
  quarantine: z.boolean().optional(),
})

// A pallet or carton the operator built at the dock (mig 00075).
const receiptPlateSchema = z.object({
  key: z.string().min(1).max(64),
  hu_type: z.enum(['pallet', 'carton']),
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
  // Hold the WHOLE delivery (mig 00101). Resolved to the per-line flag below, so
  // nothing downstream ever has to decide which of the two wins: the header sets
  // every line, and a line that says false for itself stays false.
  quarantine: z.boolean().optional(),
})

const inputSchema = z.object({
  receipt: receiptHeaderSchema.optional(),
  lines: z.array(receiptLineSchema).min(1).max(200),
  plates: z.array(receiptPlateSchema).max(200).optional(),
})

type ReceiptHeader = z.infer<typeof receiptHeaderSchema>
type ReceiptLine = z.infer<typeof receiptLineSchema>
type ReceiptPlate = z.infer<typeof receiptPlateSchema>

/**
 * Mint the handling units for this receipt and map client keys to plate ids.
 *
 * Every received line ends up on a plate. A line that names no plate_key gets
 * one minted for it — which is what makes "mandatory on every receipt line"
 * true without breaking the other callers that land here, notably the CSV
 * opening-stock importer, which has no concept of pallets.
 *
 * hu_type for an auto-minted plate is inferred from the destination's
 * locations.slot_kind, the same rule the 00076 backfill used, so the two agree.
 */
async function createPlates(
  admin: ReturnType<typeof createClient>,
  plates: ReceiptPlate[] | undefined,
  lines: ReceiptLine[],
  locationId: number | null,
): Promise<{ idByKey: Map<string, number>; autoTypeUsed: string }> {
  const idByKey = new Map<string, number>()

  // Reject a line pointing at a plate that was never declared, rather than
  // silently auto-minting one and hiding the client bug.
  const declared = new Set((plates ?? []).map((p) => p.key))
  for (const line of lines) {
    if (line.plate_key && !declared.has(line.plate_key)) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `Line references plate "${line.plate_key}", which is not in the plates list`,
      )
    }
  }
  // An unreferenced plate would become an orphan holding no stock — the exact
  // condition mig 00076's guard treats as a failure.
  const referenced = new Set(lines.map((l) => l.plate_key).filter(Boolean))
  for (const plate of plates ?? []) {
    if (!referenced.has(plate.key)) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `Plate "${plate.key}" has no lines on it. Remove it or put something on it.`,
      )
    }
  }

  let autoType = 'pallet'
  if (locationId != null) {
    const { data: loc } = await admin
      .from('locations')
      .select('slot_kind')
      .eq('id', locationId)
      .maybeSingle()
    if ((loc as any)?.slot_kind === 'carton') autoType = 'carton'
  }

  const toCreate: Array<{ key: string; hu_type: string }> = [
    ...(plates ?? []).map((p) => ({ key: p.key, hu_type: p.hu_type })),
    ...lines
      .filter((l) => !l.plate_key)
      .map((_l, i) => ({ key: `__auto_${i}`, hu_type: autoType })),
  ]
  if (toCreate.length === 0) return { idByKey, autoTypeUsed: autoType }

  // `code` is deliberately not sent: the column DEFAULTs to hu_next_code()
  // (mig 00077), so plate codes are minted by the database in one round trip
  // and can never be supplied — or collided — by a caller.
  const { data: created, error } = await admin
    .from('handling_units')
    .insert(
      toCreate.map((p) => ({
        hu_type: p.hu_type,
        status: 'open',
        warehouse_id: locationId,
        location_id: locationId,
      })),
    )
    .select('id')
  if (error) throw new EdgeFunctionError('INTERNAL', `plate create failed: ${error.message}`)

  // Postgres returns inserted rows in the order supplied, so index alignment
  // holds; assert it rather than trusting it, because a mismatch would put
  // stock on the wrong plate.
  const ids = ((created ?? []) as Array<{ id: number }>).map((r) => r.id)
  if (ids.length !== toCreate.length) {
    throw new EdgeFunctionError('INTERNAL', 'plate create returned an unexpected row count')
  }
  toCreate.forEach((p, i) => idByKey.set(p.key, ids[i]))
  return { idByKey, autoTypeUsed: autoType }
}

// Convert each line's quantity from its chosen UOM into BASE units (the only
// unit the inv_receive_stock RPC and the ledger understand). A line without a
// uom_id is already in base units. Validates that the UOM belongs to the line's
// product. Returns lines with base quantities and uom_id stripped (the RPC has
// no UOM concept).
async function toBaseLines(
  admin: ReturnType<typeof createClient>,
  lines: ReceiptLine[],
): Promise<Array<Omit<ReceiptLine, 'uom_id'>>> {
  const uomIds = [...new Set(lines.map(l => l.uom_id).filter((id): id is number => id != null))]
  const factorById = new Map<number, { productId: number; factor: number }>()
  if (uomIds.length > 0) {
    const { data, error } = await admin
      .from('product_uoms')
      .select('id, product_id, factor_to_base')
      .in('id', uomIds)
    if (error) throw new EdgeFunctionError('INTERNAL', `UOM lookup failed: ${error.message}`)
    for (const r of (data ?? []) as Array<any>) {
      factorById.set(r.id, { productId: r.product_id, factor: Number(r.factor_to_base) })
    }
  }

  return lines.map(line => {
    const { uom_id, ...rest } = line
    if (uom_id == null) return rest
    const uom = factorById.get(uom_id)
    if (!uom) throw new EdgeFunctionError('INVALID_INPUT', `Unknown unit of measure ${uom_id}`)
    if (uom.productId !== line.product_id) {
      throw new EdgeFunctionError('INVALID_INPUT', `Unit of measure ${uom_id} does not belong to product ${line.product_id}`)
    }
    return { ...rest, quantity: line.quantity * uom.factor }
  })
}

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
    requireModule('inventory_dispatch')
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
    const { receipt, lines, plates } = parsed.data

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
    // (null → RPC default, only when a single warehouse is active). Warehouse
    // staff with an assigned home site may only receive there; with no home
    // site (home_warehouse_id NULL — true for every profile today) they are
    // unrestricted, same as Admin/Manager. A null destination is rejected
    // outright once more than one warehouse is active, so a receipt can never
    // silently fall through to inv_default_location()'s lowest-id warehouse.
    const { count: activeWarehouseCount, error: warehouseCountError } = await admin
      .from('locations')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'WAREHOUSE')
      .eq('is_active', true)
    if (warehouseCountError) {
      throw new EdgeFunctionError('INTERNAL', `warehouse lookup failed: ${warehouseCountError.message}`)
    }
    const locationId = resolveReceiveDestination(
      receipt?.location_id,
      { role: auth.role, homeWarehouseId: auth.profile.home_warehouse_id },
      activeWarehouseCount ?? 0,
    )

    // Convert UOM quantities to base units (the RPC + ledger only speak base).
    const baseLines = await toBaseLines(admin, lines)

    // Mint this receipt's plates, then stamp each line with the plate it lands
    // on. `lines` and `baseLines` are index-aligned (toBaseLines maps 1:1 and
    // preserves order), which is what lets the plate_key be read off the
    // original line here.
    const { idByKey } = await createPlates(admin, plates, lines, locationId)
    let autoIndex = 0
    const platedLines = baseLines.map((line, i) => {
      const key = lines[i].plate_key ?? `__auto_${autoIndex++}`
      const huId = idByKey.get(key)
      if (huId == null) {
        throw new EdgeFunctionError('INTERNAL', `no plate resolved for line ${i + 1}`)
      }
      // plate_key is a client-side correlation token; the RPC wants the id.
      const { plate_key: _pk, ...rest } = line as Record<string, unknown>
      return { ...rest, handling_unit_id: huId }
    })

    const { data: result, error: rpcError } = await admin.rpc('inv_receive_stock', {
      p_lines: platedLines,
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
      // Holding a delivery is a decision worth being able to answer for later —
      // who held it, and was it the whole delivery or one line (mig 00101).
      metadata: {
        result,
        quarantine: receipt?.quarantine === true
          || lines.some((l) => l.quarantine === true)
          ? { header: receipt?.quarantine === true, lines: lines.filter((l) => l.quarantine === true).length }
          : undefined,
      },
    })

    // Generate putaway tasks server-side. This is what makes putaway work for
    // EVERY receipt path — the receiving screen AND the CSV opening-stock import
    // both land here. Putaway is advisory: a failure must never fail the receipt,
    // and non-racked/unpublished warehouses simply no-op (mode 'legacy').
    let putaway: GeneratePutawayResult | null = null
    const destLocationId = (result as any)?.location_id as number | undefined
    if (destLocationId) {
      try {
        // hu_type rides along so the engine steers pallets to bulk/reserve
        // levels and cartons to pick faces (mig 00072 roles + 00075 plates).
        const typeByKey = new Map<string, 'pallet' | 'carton'>(
          (plates ?? []).map((p) => [p.key, p.hu_type]),
        )
        putaway = await generatePutawayTasks(admin, {
          warehouseId: destLocationId,
          // hu_id rides along too, so the several lines of a MIXED pallet are
          // recognised as one physical object: they all follow it to a single
          // bin and it consumes one position, not one per line (mig 00078).
          lines: baseLines.map((l, i) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            // Only an EXPLICITLY built plate declares its type. An auto-minted
            // one takes createPlates' inference from the destination, which for
            // a warehouse ROOT (slot_kind always NULL) is the 'pallet' default —
            // meaningless, and feeding it here would both steer the line to
            // bulk/reserve levels and claim a whole position for it. Undefined
            // keeps the pre-00078 per-unit treatment for those lines.
            hu_type: lines[i].plate_key ? typeByKey.get(lines[i].plate_key!) : undefined,
            hu_id: (platedLines[i] as any)?.handling_unit_id as number | undefined,
            // The header flag sets every line; a line may opt itself out by
            // saying false explicitly (mig 00101). `?? ` and not `||`, so an
            // explicit false on the line is honoured rather than swallowed.
            quarantine: lines[i].quarantine ?? receipt?.quarantine ?? false,
          })),
          actorId: auth.userId,
          goodsReceiptId: (result as any)?.receipt_id as number | undefined,
        })
      } catch (_e) {
        putaway = null
      }
    }

    return new Response(
      JSON.stringify({ ok: true, result, putaway }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
