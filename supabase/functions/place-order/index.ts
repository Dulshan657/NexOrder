// place-order Edge Function
//
// Authoritative order placement. The client sends only product IDs and
// quantities; the server resolves prices, applies promotions, checks stock
// and credit, and writes the order/items/invoice. Direct INSERT on `orders`
// and `order_items` is denied to all non-service-role connections by RLS.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import {
  applyCartPromotions,
  resolveLineUnitPrice,
  lineBaseUnits,
  type Product,
  type HoReCa,
  type Promotion,
  type ResolvedItem,
  type UserContext,
} from '../_shared/pricing.ts'
import { orderedWarehousesFor } from '../_shared/warehouseRouting.ts'

interface PlaceOrderItem {
  productId: number
  quantity: number
  packSize?: number | null
}

interface PlaceOrderRequest {
  hoReCaId: number
  items: PlaceOrderItem[]
  notes?: string | null
  deliveryDate?: string | null
  deliveryTimeSlot?: 'AM' | 'PM' | null
  verification?: Record<string, unknown> | null
  orderIdPrefix?: string
}

interface PlaceOrderResponse {
  orderId: string
  total: number
  cartDiscount: number
  appliedPromotionIds: string[]
  bogoFreeItems: Array<{ productId: number; freeQuantity: number; promoId: string }>
}

// jsonResponse / errorResponse are defined inside `serve` so they close over
// the per-request CORS headers (echo of the inbound origin if allowlisted).

async function loadProfile(userClient: SupabaseClient, userId: string) {
  const { data, error } = await userClient
    .from('profiles')
    .select('id, role, horeca_id')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('Profile not found')
  return data as { id: string; role: string; horeca_id: number | null }
}

async function loadHoReCa(serviceClient: SupabaseClient, hoReCaId: number): Promise<HoReCa & { credit_limit: number; name: string; lat?: number; lng?: number }> {
  const { data, error } = await serviceClient
    .from('horecas')
    .select('id, name, discount_percent, credit_limit, tier, lat, lng, horeca_pricing(product_id, custom_price)')
    .eq('id', hoReCaId)
    .single()
  if (error || !data) throw new Error('HoReCa not found')

  const row = data as {
    id: number
    name: string
    discount_percent: number | null
    credit_limit: number | null
    tier: string | null
    lat: number | null
    lng: number | null
    horeca_pricing: Array<{ product_id: number; custom_price: number }> | null
  }

  const pricing: Record<number, number> = {}
  for (const p of row.horeca_pricing ?? []) {
    pricing[p.product_id] = Number(p.custom_price)
  }

  return {
    id: row.id,
    name: row.name,
    credit_limit: Number(row.credit_limit ?? 0),
    discountPercent: row.discount_percent ?? undefined,
    tier: (row.tier as HoReCa['tier']) ?? null,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
    pricing,
  }
}

/**
 * Closest-first warehouse preference for this order's destination. Reads active
 * WAREHOUSE locations and orders them by distance from the HoReCa's coordinates;
 * the inv_reserve_order RPC walks this list, splitting a line across sites.
 */
async function loadLocationPref(
  serviceClient: SupabaseClient,
  coords: { lat: number; lng: number } | null,
): Promise<number[]> {
  const { data } = await serviceClient
    .from('locations')
    .select('id, lat, lng, is_active, location_type, kind')
    .eq('kind', 'WAREHOUSE')
  const warehouses = ((data ?? []) as Array<any>).map((w) => ({
    id: w.id as number,
    lat: w.lat != null ? Number(w.lat) : null,
    lng: w.lng != null ? Number(w.lng) : null,
    isActive: !!w.is_active,
    locationType: (w.location_type ?? 'bulk') as 'bulk' | 'racked',
  }))
  return orderedWarehousesFor(coords, warehouses)
}

async function loadProducts(serviceClient: SupabaseClient, productIds: number[]): Promise<Map<number, Product & { name: string; sku: string }>> {
  const { data, error } = await serviceClient
    .from('products')
    .select('id, sku, name, price, category, inventory, carton_size')
    .in('id', productIds)
  if (error) throw error

  const map = new Map<number, Product & { name: string; sku: string }>()
  for (const row of (data ?? []) as Array<any>) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      sku: row.sku,
      price: Number(row.price),
      category: row.category,
      inventory: Number(row.inventory),
      cartonSize: row.carton_size ?? undefined,
    })
  }
  return map
}

async function loadActivePromotions(serviceClient: SupabaseClient): Promise<Promotion[]> {
  const { data, error } = await serviceClient
    .from('promotions')
    .select('*')
    .eq('is_active', true)
  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    percentOff: row.percent_off != null ? Number(row.percent_off) : undefined,
    fixedPrice: row.fixed_price != null ? Number(row.fixed_price) : undefined,
    bogoConfig: row.bogo_config ?? null,
    bundleConfig: row.bundle_config ?? null,
    clearancePercent: row.clearance_percent != null ? Number(row.clearance_percent) : undefined,
    scope: row.scope,
    targeting: row.targeting,
    stackWithHoReCaPricing: !!row.stack_with_horeca_pricing,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: !!row.is_active,
    priority: Number(row.priority ?? 10),
  }))
}

async function loadAppSettings(serviceClient: SupabaseClient) {
  const { data } = await serviceClient.from('app_settings').select('*').eq('id', 1).single()
  return data as {
    order_id_prefix: string
    minimum_order_value: number | null
    default_credit_limit: number | null
    carton_discount_percent: number | null
  } | null
}

async function getOutstandingBalance(serviceClient: SupabaseClient, hoReCaId: number): Promise<number> {
  const { data, error } = await serviceClient
    .from('invoices')
    .select('amount')
    .eq('horeca_id', hoReCaId)
    .neq('status', 'paid')
  if (error) throw error
  return (data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  const errorResponse = (code: string, message: string, status = 400): Response =>
    jsonResponse({ error: { code, message } }, status)

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  let body: PlaceOrderRequest
  try {
    body = await req.json()
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be JSON')
  }

  if (typeof body.hoReCaId !== 'number' || !Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse('INVALID_INPUT', 'hoReCaId (number) and items[] (non-empty) required')
  }
  for (const it of body.items) {
    if (typeof it.productId !== 'number' || typeof it.quantity !== 'number' || it.quantity <= 0 || !Number.isInteger(it.quantity)) {
      return errorResponse('INVALID_ITEM', 'Each item needs integer productId and positive integer quantity')
    }
  }

  const { data: authUser } = await userClient.auth.getUser()
  if (!authUser?.user) return errorResponse('UNAUTHORIZED', 'Invalid session', 401)

  let profile: { id: string; role: string; horeca_id: number | null }
  try {
    profile = await loadProfile(userClient, authUser.user.id)
  } catch {
    return errorResponse('NO_PROFILE', 'Profile not found for user', 403)
  }

  // Authorization
  const role = profile.role
  if (role === 'Restaurant/Hotel Customer') {
    if (profile.horeca_id !== body.hoReCaId) {
      return errorResponse('FORBIDDEN', 'Customers can only order for their own HoReCa', 403)
    }
  } else if (
    role !== 'Admin' && role !== 'Manager' &&
    role !== 'Field Sales Rep' && role !== 'Office Sales Rep'
  ) {
    return errorResponse('FORBIDDEN', 'Role not permitted to place orders', 403)
  }

  // Rate limit per authenticated user. 10 orders/min is well above any
  // realistic interactive pace and tight enough to slow down a hijacked
  // session firing through a script.
  const rl = await checkRateLimit(`place-order:${profile.id}`, { windowMs: 60_000, max: 10 })
  if (!rl.ok) {
    return errorResponse('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many orders in a short period', 429)
  }

  // Load data via service client (bypasses RLS, all reads needed for pricing)
  let hoReCa: HoReCa & { credit_limit: number; name: string }
  try {
    hoReCa = await loadHoReCa(serviceClient, body.hoReCaId)
  } catch {
    return errorResponse('HORECA_NOT_FOUND', `HoReCa ${body.hoReCaId} not found`, 404)
  }

  const productIds = [...new Set(body.items.map(i => i.productId))]
  const productMap = await loadProducts(serviceClient, productIds)
  for (const id of productIds) {
    if (!productMap.has(id)) return errorResponse('PRODUCT_NOT_FOUND', `Product ${id} not found`, 404)
  }

  // Aggregate quantities so duplicates in the cart count toward stock check
  const aggregated = new Map<string, PlaceOrderItem>()
  for (const it of body.items) {
    const key = `${it.productId}:${it.packSize ?? ''}`
    const existing = aggregated.get(key)
    if (existing) existing.quantity += it.quantity
    else aggregated.set(key, { ...it })
  }

  // Stock check. Inventory (products.inventory / on_hand) is in BASE units, but a
  // carton line carries quantity = number of cartons + packSize = units per carton.
  // Convert to base units (quantity × packSize) so the check — and the reservation
  // below, which reuses totalsByProduct — operate in the same unit as stock.
  const totalsByProduct = new Map<number, number>()
  for (const it of aggregated.values()) {
    const baseUnits = lineBaseUnits(it.quantity, it.packSize)
    totalsByProduct.set(it.productId, (totalsByProduct.get(it.productId) ?? 0) + baseUnits)
  }
  for (const [pid, qty] of totalsByProduct) {
    const product = productMap.get(pid)!
    if (product.inventory < qty) {
      return errorResponse('INSUFFICIENT_STOCK', `${product.inventory} of "${product.name}" available, ${qty} requested`, 409)
    }
  }

  // Resolve prices. App settings are needed here (not just below) because the
  // carton discount feeds into per-line pricing, so load them before the loop.
  const promotions = await loadActivePromotions(serviceClient)
  const settings = await loadAppSettings(serviceClient)
  const cartonDiscountPercent = Number(settings?.carton_discount_percent ?? 5)
  const userContext: UserContext = { id: 0, role: profile.role } // numeric id only used by 'rep' targeting; safe to leave 0 for now

  const resolvedItems: ResolvedItem[] = []
  for (const it of aggregated.values()) {
    const product = productMap.get(it.productId)!
    // Carton lines price the whole carton; single-unit lines price per unit.
    const { unitPrice, appliedPromotionId } = resolveLineUnitPrice(
      product, hoReCa, userContext, promotions, it.packSize ?? null, cartonDiscountPercent,
    )
    resolvedItems.push({
      productId: it.productId,
      quantity: it.quantity,
      packSize: it.packSize ?? null,
      productName: product.name,
      productSku: product.sku,
      unitPrice,
      appliedPromotionId,
    })
  }

  const subtotal = resolvedItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const { bogoFreeItems, bundleDiscounts, cartDiscount } = applyCartPromotions(
    resolvedItems, promotions, hoReCa, userContext, productMap,
  )
  const total = Math.round((subtotal - cartDiscount) * 100) / 100

  // Minimum order value
  const minOrderValue = Number(settings?.minimum_order_value ?? 0)
  if (minOrderValue > 0 && total < minOrderValue) {
    return errorResponse('BELOW_MINIMUM', `Order total $${total} is below minimum $${minOrderValue}`, 422)
  }

  // Credit limit
  const outstanding = await getOutstandingBalance(serviceClient, body.hoReCaId)
  const creditLimit = hoReCa.credit_limit > 0 ? hoReCa.credit_limit : Number(settings?.default_credit_limit ?? 0)
  if (creditLimit > 0 && outstanding + total > creditLimit) {
    return errorResponse('CREDIT_EXCEEDED', `Credit limit $${creditLimit} would be exceeded ($${outstanding} outstanding + $${total} new)`, 422)
  }

  // Insert order, items, invoice
  const orderIdPrefix = settings?.order_id_prefix ?? 'ORD'
  const orderId = `${orderIdPrefix}-${Date.now()}`
  const orderDate = new Date().toISOString()

  const { error: orderError } = await serviceClient
    .from('orders')
    .insert({
      id: orderId,
      horeca_id: body.hoReCaId,
      submitted_by: profile.id,
      total,
      order_date: orderDate,
      notes: body.notes ?? null,
      status: 'processing',
      status_history: [{ status: 'processing', timestamp: orderDate }] as any,
      delivery_date: body.deliveryDate ?? null,
      delivery_time_slot: body.deliveryTimeSlot ?? null,
      verification: (body.verification ?? null) as any,
      applied_promotions: bundleDiscounts.length > 0 ? bundleDiscounts as any : null,
    })
  if (orderError) {
    return errorResponse('DB_ORDER_INSERT_FAILED', orderError.message, 500)
  }

  const itemRows = resolvedItems.map(i => ({
    order_id: orderId,
    product_id: i.productId,
    quantity: i.quantity,
    pack_size: i.packSize,
    unit_price: i.unitPrice,
    product_name: i.productName,
    product_sku: i.productSku,
  }))
  const { error: itemsError } = await serviceClient.from('order_items').insert(itemRows)
  if (itemsError) {
    // Best-effort rollback
    await serviceClient.from('orders').delete().eq('id', orderId)
    return errorResponse('DB_ITEMS_INSERT_FAILED', itemsError.message, 500)
  }

  // Reserve stock atomically (after order persisted). The inv_reserve_order RPC
  // raises `allocated` across FIFO balance rows in one transaction; available
  // drops but on_hand stays put until the goods are physically picked
  // (reserve-on-placement model). On any failure we roll back the order/items
  // so we never leave a phantom order against unreserved stock.
  const reserveItems = [...totalsByProduct.entries()].map(([productId, quantity]) => ({
    product_id: productId,
    quantity,
  }))
  // Closest-first warehouse preference from the customer's coordinates; the RPC
  // splits each line across sites nearest-first. Falls back to the default
  // warehouse when the HoReCa has no coordinates or only one warehouse exists.
  const coords =
    typeof hoReCa.lat === 'number' && typeof hoReCa.lng === 'number'
      ? { lat: hoReCa.lat, lng: hoReCa.lng }
      : null
  const locationPref = await loadLocationPref(serviceClient, coords)
  const { error: reserveError } = await serviceClient.rpc('inv_reserve_order', {
    p_order_id: orderId,
    p_items: reserveItems,
    p_location_pref: locationPref.length > 0 ? locationPref : null,
    p_actor: profile.id,
  })
  if (reserveError) {
    await serviceClient.from('order_items').delete().eq('order_id', orderId)
    await serviceClient.from('orders').delete().eq('id', orderId)
    const insufficient = reserveError.message.includes('INSUFFICIENT_STOCK')
    return errorResponse(
      insufficient ? 'INSUFFICIENT_STOCK' : 'STOCK_RACE',
      insufficient ? 'Stock changed — one or more items are no longer available' : reserveError.message,
      409,
    )
  }

  // Invoice (pending, due in 30d)
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const invoiceId = `INV-${Date.now()}`
  const { error: invoiceError } = await serviceClient.from('invoices').insert({
    id: invoiceId,
    order_id: orderId,
    horeca_id: body.hoReCaId,
    horeca_name: hoReCa.name,
    amount: total,
    status: 'pending',
    due_date: dueDate,
    created_date: orderDate.split('T')[0],
  })
  if (invoiceError) {
    // Order is already placed; surface invoice failure but don't roll back
    console.warn('Invoice creation failed, order placed without invoice:', invoiceError.message)
  }

  // Fire-and-forget order confirmation email. Failure must never roll back
  // the placed order, so any error is logged and swallowed.
  try {
    const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`
    void fetch(fnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template: 'order_confirmation', orderId }),
    }).catch((err) => console.warn('order_confirmation email dispatch failed:', err))
  } catch (e) {
    console.warn('order_confirmation email dispatch threw:', e)
  }

  const response: PlaceOrderResponse = {
    orderId,
    total,
    cartDiscount,
    appliedPromotionIds: [
      ...new Set([
        ...resolvedItems.map(i => i.appliedPromotionId).filter((x): x is string => !!x),
        ...bundleDiscounts.map(b => b.promoId),
        ...bogoFreeItems.map(b => b.promoId),
      ]),
    ],
    bogoFreeItems: bogoFreeItems.map(b => ({
      productId: b.productId,
      freeQuantity: b.freeQuantity,
      promoId: b.promoId,
    })),
  }
  return jsonResponse(response, 201)
})
