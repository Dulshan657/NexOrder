// Order placement, shared. The logic `place-order` has always run, lifted out
// so a second caller can run EXACTLY the same one.
//
// Two callers, one rulebook:
//   * `place-order`        — a live cart. `placeOrderCore(service, input)` prices,
//                            checks, inserts, reserves, invoices and emails.
//   * the QR approval flow — a held kitchen order. It previews with
//                            `{ dryRun: true }` and, on approval, calls the same
//                            function without it. Approval therefore gets HoReCa
//                            pricing, promotions, the stock/minimum/credit rules,
//                            reservation, the invoice and the confirmation email
//                            for free, instead of re-implementing a subset of
//                            them (which is the trap `approve-po` fell into).
//
// What stays OUTSIDE this function: authentication, the role gate, rate
// limiting, request-body validation and the module gate. Those belong to the
// caller — who is allowed to place an order for whom is not this module's
// question — and `input` already carries the verdict (`submittedBy`,
// `actorRole`, `hoReCaId`).
//
// ── MODES ───────────────────────────────────────────────────────────────────
//
// Live (default). Does what place-order did, in the same order, answering with
// the same codes and statuses — except that it THROWS an EdgeFunctionError where
// place-order used to build a Response, and the caller turns that into one. The
// first broken rule wins: stock, then minimum order, then credit.
//
// Dry run (`{ dryRun: true }`). Performs every READ and every check, writes
// NOTHING (no order, no items, no reservation, no invoice, no email), and
// instead of stopping at the first broken rule collects all of them into
// `problems`. Business-rule failures never throw in this mode; a database read
// that fails still does, exactly as it would live.
//
// ── THE PURE HALF ───────────────────────────────────────────────────────────
//
// The arithmetic and the rules are in `orderPricing.ts` (no I/O, unit-tested).
// This file adds only the reads, the writes and the sequencing between them.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import { orderedWarehousesFor } from './warehouseRouting.ts'
import type { HoReCa, Promotion, UserContext } from './pricing.ts'
import {
  aggregateOrderItems,
  baseUnitsByProduct,
  checkCreditLimit,
  checkMinimumOrder,
  collectAppliedPromotionIds,
  computeOrderTotals,
  findMissingProducts,
  findStockShortages,
  normalizeOrderItems,
  priceOrderLines,
  resolveCreditLimit,
  stockPositions,
  sumAvailableByProduct,
  toBogoFreeItems,
  toPricedLines,
  type OrderLineInput,
  type OrderPreview,
  type OrderProblem,
  type PlaceOrderResult,
  type PricedProduct,
} from './orderPricing.ts'

export type {
  OrderLineInput,
  OrderPreview,
  OrderProblem,
  PlaceOrderResult,
} from './orderPricing.ts'

/** Everything the core needs that is not read from the database. */
export interface PlaceOrderCoreInput {
  /** `orders.submitted_by` — the profile the order belongs to. */
  submittedBy: string
  /**
   * The profile performing the placement; recorded as the actor on the stock
   * reservation. Defaults to `submittedBy`. They differ when someone approves an
   * order on another person's behalf.
   */
  actorId?: string
  /** Role of the actor, passed to pricing's `UserContext`. */
  actorRole: string
  hoReCaId: number
  items: OrderLineInput[]
  notes?: string | null
  deliveryDate?: string | null
  deliveryTimeSlot?: 'AM' | 'PM' | null
  /** The captured signature / verification payload, stored as-is on the order. */
  verification?: Record<string, unknown> | null
}

export interface PlaceOrderCoreOptions {
  /** Read and check everything, write nothing, collect every problem. */
  dryRun?: boolean
}

// ── reads ───────────────────────────────────────────────────────────────────

async function loadHoReCa(
  service: SupabaseClient,
  hoReCaId: number,
): Promise<HoReCa & { credit_limit: number; name: string; lat?: number; lng?: number }> {
  const { data, error } = await service
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
  service: SupabaseClient,
  coords: { lat: number; lng: number } | null,
): Promise<number[]> {
  const { data } = await service
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

/**
 * Every location an order may draw from, for the given warehouses.
 *
 * Delegates to `inv_warehouse_draw_locations` per warehouse — one definition,
 * shared with `inv_reserve_order`, rather than a materialized-path prefix
 * rebuilt in TypeScript that would drift the first time the rule changed. The
 * list is one entry per active warehouse, so the fan-out is small and runs
 * concurrently.
 *
 * Returns [] when the preference is empty, which the caller reads as
 * "unscoped" exactly as before.
 */
async function expandDrawLocations(service: SupabaseClient, warehouseIds: number[]): Promise<number[]> {
  if (warehouseIds.length === 0) return []
  const results = await Promise.all(
    warehouseIds.map((id) => service.rpc('inv_warehouse_draw_locations', { p_warehouse_id: id })),
  )
  const ids = new Set<number>()
  for (const { data } of results) {
    for (const row of (data ?? []) as Array<{ location_id: number }>) {
      ids.add(Number(row.location_id))
    }
  }
  // A warehouse whose expansion came back empty (an RPC error, say) must not
  // silently narrow the check to nothing — fall back to the warehouse itself,
  // which is what the old code checked and is never wrong, only incomplete.
  for (const id of warehouseIds) if (!ids.has(id)) ids.add(id)
  return [...ids]
}

async function loadProducts(service: SupabaseClient, productIds: number[]): Promise<Map<number, PricedProduct>> {
  const { data, error } = await service
    .from('products')
    .select('id, sku, name, price, category, inventory, carton_size, product_uoms(id, factor_to_base, price, is_base)')
    .in('id', productIds)
  if (error) throw error

  const map = new Map<number, PricedProduct>()
  for (const row of (data ?? []) as Array<any>) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      sku: row.sku,
      price: Number(row.price),
      category: row.category,
      inventory: Number(row.inventory),
      cartonSize: row.carton_size ?? undefined,
      uoms: ((row.product_uoms ?? []) as Array<any>).map((u) => ({
        id: u.id,
        factorToBase: Number(u.factor_to_base),
        price: Number(u.price),
        isBase: u.is_base,
      })),
    })
  }
  return map
}

async function loadActivePromotions(service: SupabaseClient): Promise<Promotion[]> {
  const { data, error } = await service.from('promotions').select('*').eq('is_active', true)
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

async function loadAppSettings(service: SupabaseClient) {
  const { data } = await service.from('app_settings').select('*').eq('id', 1).single()
  return data as {
    order_id_prefix: string
    minimum_order_value: number | null
    default_credit_limit: number | null
    carton_discount_percent: number | null
  } | null
}

async function getOutstandingBalance(service: SupabaseClient, hoReCaId: number): Promise<number> {
  const { data, error } = await service
    .from('invoices')
    .select('amount')
    .eq('horeca_id', hoReCaId)
    // Only money still owed: a cancelled invoice (mig 00111) is not a debt.
    .in('status', ['pending', 'overdue'])
  if (error) throw error
  return (data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** A broken rule, as the error a live placement answers with. */
function problemToError(problem: OrderProblem): EdgeFunctionError {
  return new EdgeFunctionError(problem.code, problem.message)
}

/** Env read that also works where there is no `Deno` (the unit tests). */
function readEnv(name: string): string | undefined {
  const denoEnv = (globalThis as any).Deno?.env
  if (denoEnv?.get) return denoEnv.get(name)
  return (globalThis as any).process?.env?.[name]
}

/**
 * Fire-and-forget order confirmation email. Failure must never roll back the
 * placed order, so any error is logged and swallowed.
 */
function dispatchConfirmationEmail(orderId: string): void {
  try {
    const fnUrl = `${readEnv('SUPABASE_URL')}/functions/v1/send-email`
    void fetch(fnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template: 'order_confirmation', orderId }),
    }).catch((err) => console.warn('order_confirmation email dispatch failed:', err))
  } catch (e) {
    console.warn('order_confirmation email dispatch threw:', e)
  }
}

/** A dry run that found nothing it could price: a missing HoReCa, or only unknown products. */
function emptyPreview(problems: OrderProblem[], hoReCa: OrderPreview['hoReCa']): OrderPreview {
  return {
    ok: problems.length === 0,
    problems,
    lines: [],
    stock: [],
    subtotal: 0,
    cartDiscount: 0,
    total: 0,
    appliedPromotionIds: [],
    bogoFreeItems: [],
    creditLimit: 0,
    outstanding: 0,
    minimumOrderValue: 0,
    hoReCa,
  }
}

// ── the core ────────────────────────────────────────────────────────────────

export async function placeOrderCore(
  service: SupabaseClient,
  input: PlaceOrderCoreInput,
  opts: { dryRun: true },
): Promise<OrderPreview>
export async function placeOrderCore(
  service: SupabaseClient,
  input: PlaceOrderCoreInput,
  opts?: { dryRun?: false },
): Promise<PlaceOrderResult>
export async function placeOrderCore(
  service: SupabaseClient,
  input: PlaceOrderCoreInput,
  opts: PlaceOrderCoreOptions,
): Promise<PlaceOrderResult | OrderPreview>
export async function placeOrderCore(
  service: SupabaseClient,
  input: PlaceOrderCoreInput,
  opts: PlaceOrderCoreOptions = {},
): Promise<PlaceOrderResult | OrderPreview> {
  const dryRun = opts.dryRun === true
  const actorId = input.actorId ?? input.submittedBy

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new EdgeFunctionError('INVALID_INPUT', 'hoReCaId (number) and items[] (non-empty) required')
  }

  // Business rules broken so far. Live: the first one throws as soon as the
  // phase that found it ends. Dry run: they accumulate.
  const problems: OrderProblem[] = []
  const report = (found: ReadonlyArray<OrderProblem>): void => {
    if (found.length === 0) return
    if (!dryRun) throw problemToError(found[0])
    problems.push(...found)
  }

  // Load data via the service client (bypasses RLS, all reads needed for pricing).
  //
  // These five reads depend on nothing but the request, so they run together:
  // checkout used to make every one of them a sequential round-trip. Only the
  // location chain below genuinely waits — it needs the HoReCa's coordinates.
  // The outstanding balance is read here rather than just before the credit
  // check; that check was never transactional, so moving the read a few
  // milliseconds earlier changes nothing it guarantees.
  const productIds = [...new Set(input.items.map((i) => i.productId))]
  const HORECA_MISSING = Symbol('horeca-missing')
  const [hoReCaOrMissing, productMap, promotions, settings, outstanding] = await Promise.all([
    loadHoReCa(service, input.hoReCaId).catch(() => HORECA_MISSING),
    loadProducts(service, productIds),
    loadActivePromotions(service),
    loadAppSettings(service),
    getOutstandingBalance(service, input.hoReCaId),
  ])
  if (hoReCaOrMissing === HORECA_MISSING) {
    const missing: OrderProblem = {
      code: 'HORECA_NOT_FOUND',
      message: `HoReCa ${input.hoReCaId} not found`,
    }
    report([missing])
    return emptyPreview(problems, null) // dry run only: live threw above
  }
  const hoReCa = hoReCaOrMissing as Awaited<ReturnType<typeof loadHoReCa>>

  report(findMissingProducts(productIds, productMap))

  // Normalize each line's pack factor + UOM from the product's own UOM rows
  // BEFORE aggregation / stock-check / pricing, so all three agree. Aggregate so
  // duplicates in the cart count toward the stock check, and convert to BASE
  // units so the check — and the reservation below, which reuses the same map —
  // operate in the unit stock is counted in.
  const aggregated = aggregateOrderItems(normalizeOrderItems(input.items, productMap))
  const totalsByProduct = baseUnitsByProduct(aggregated)
  const hoReCaIdentity = { id: hoReCa.id, name: hoReCa.name }
  if (aggregated.length === 0) return emptyPreview(problems, hoReCaIdentity) // dry run only: every product was unknown

  // Closest-first warehouse preference from the customer's coordinates; the RPC
  // splits each line across sites nearest-first. Computed here (before the stock
  // check) because availability must be scoped to the same warehouses the RPC
  // will draw from. Falls back to the default warehouse when the HoReCa has no
  // coordinates or only one warehouse exists.
  const coords =
    typeof hoReCa.lat === 'number' && typeof hoReCa.lng === 'number'
      ? { lat: hoReCa.lat, lng: hoReCa.lng }
      : null
  const locationPref = await loadLocationPref(service, coords)

  // Check against AVAILABLE (on_hand − allocated) from inventory_balances, NOT
  // products.inventory (the on_hand cache). The reservation RPC reserves against
  // available, so checking on_hand here would let an order pass the pre-check and
  // then fail reservation with a misleading "Stock changed" race error when the
  // shortfall was really stock already allocated to other open orders. Scope to
  // the preferred warehouses so it matches exactly what the RPC will reserve.
  //
  // SCOPE TO THE DRAW LOCATIONS, NOT THE WAREHOUSE IDS. `locationPref` holds
  // WAREHOUSE rows, but stock that has been put away lives on the BIN, and a
  // bin's `location_id` is its own id — not its warehouse's. Filtering on the
  // warehouse ids alone therefore counted only what was still sitting at the
  // warehouse root, and answered "0 available" for a racked site with a full
  // rack. `inv_warehouse_draw_locations` is the same expansion
  // `inv_reserve_order` uses (mig 00040: racked ⇒ root + descendants, bulk ⇒
  // root), and it has to be THAT function rather than a path prefix rebuilt
  // here, or the check and the reservation can disagree again later.
  const pids = [...totalsByProduct.keys()]
  const drawLocations = await expandDrawLocations(service, locationPref)
  let balQuery = service.from('inventory_balances').select('product_id, available').in('product_id', pids)
  if (drawLocations.length > 0) balQuery = balQuery.in('location_id', drawLocations)
  const { data: balRows } = await balQuery
  const availByProduct = sumAvailableByProduct((balRows ?? []) as Array<{ product_id: number; available: number }>)
  report(findStockShortages(totalsByProduct, availByProduct, productMap))

  // Resolve prices. The carton discount (from settings) feeds per-line pricing.
  const cartonDiscountPercent = Number(settings?.carton_discount_percent ?? 5)
  const userContext: UserContext = { id: 0, role: input.actorRole } // numeric id only used by 'rep' targeting; safe to leave 0 for now
  const resolvedItems = priceOrderLines(aggregated, productMap, hoReCa, userContext, promotions, cartonDiscountPercent)
  const { subtotal, cartDiscount, total, bogoFreeItems, bundleDiscounts } = computeOrderTotals(
    resolvedItems,
    promotions,
    hoReCa,
    userContext,
    productMap,
  )

  // Minimum order value, then credit limit (`outstanding` was loaded with the
  // other reads above).
  const minOrderValue = Number(settings?.minimum_order_value ?? 0)
  const minimumProblem = checkMinimumOrder(total, minOrderValue)
  report(minimumProblem ? [minimumProblem] : [])

  const creditLimit = resolveCreditLimit(hoReCa.credit_limit, Number(settings?.default_credit_limit ?? 0))
  const creditProblem = checkCreditLimit(creditLimit, outstanding, total)
  report(creditProblem ? [creditProblem] : [])

  const appliedPromotionIds = collectAppliedPromotionIds(resolvedItems, bundleDiscounts, bogoFreeItems)
  const bogoFree = toBogoFreeItems(bogoFreeItems)

  if (dryRun) {
    return {
      ok: problems.length === 0,
      problems,
      lines: toPricedLines(resolvedItems),
      stock: stockPositions(totalsByProduct, availByProduct, productMap),
      subtotal: Math.round(subtotal * 100) / 100,
      cartDiscount,
      total,
      appliedPromotionIds,
      bogoFreeItems: bogoFree,
      creditLimit,
      outstanding,
      minimumOrderValue: minOrderValue,
      hoReCa: hoReCaIdentity,
    }
  }

  // ── from here on this writes; the dry run has returned ────────────────────

  // Insert order, items, invoice
  const orderIdPrefix = settings?.order_id_prefix ?? 'ORD'
  const orderId = `${orderIdPrefix}-${Date.now()}`
  const orderDate = new Date().toISOString()

  const { error: orderError } = await service.from('orders').insert({
    id: orderId,
    horeca_id: input.hoReCaId,
    submitted_by: input.submittedBy,
    total,
    order_date: orderDate,
    notes: input.notes ?? null,
    status: 'processing',
    status_history: [{ status: 'processing', timestamp: orderDate }] as any,
    delivery_date: input.deliveryDate ?? null,
    delivery_time_slot: input.deliveryTimeSlot ?? null,
    verification: (input.verification ?? null) as any,
    applied_promotions: bundleDiscounts.length > 0 ? (bundleDiscounts as any) : null,
  })
  if (orderError) {
    throw new EdgeFunctionError('DB_ORDER_INSERT_FAILED', orderError.message)
  }

  const itemRows = resolvedItems.map((i) => ({
    order_id: orderId,
    product_id: i.productId,
    quantity: i.quantity,
    pack_size: i.packSize,
    uom_id: i.uomId ?? null,
    unit_price: i.unitPrice,
    product_name: i.productName,
    product_sku: i.productSku,
  }))
  const { error: itemsError } = await service.from('order_items').insert(itemRows)
  if (itemsError) {
    // Best-effort rollback
    await service.from('orders').delete().eq('id', orderId)
    throw new EdgeFunctionError('DB_ITEMS_INSERT_FAILED', itemsError.message)
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
  // coords + locationPref were computed above (the stock pre-check is scoped to
  // these same warehouses). The RPC splits each line across sites nearest-first.
  const { error: reserveError } = await service.rpc('inv_reserve_order', {
    p_order_id: orderId,
    p_items: reserveItems,
    p_location_pref: locationPref.length > 0 ? locationPref : null,
    p_actor: actorId,
  })
  if (reserveError) {
    await service.from('order_items').delete().eq('order_id', orderId)
    await service.from('orders').delete().eq('id', orderId)
    const insufficient = reserveError.message.includes('INSUFFICIENT_STOCK')
    throw insufficient
      ? new EdgeFunctionError('INSUFFICIENT_STOCK', 'Stock changed — one or more items are no longer available')
      : new EdgeFunctionError('STOCK_RACE', reserveError.message)
  }

  // Invoice (pending, due in 30d)
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const invoiceId = `INV-${Date.now()}`
  const { error: invoiceError } = await service.from('invoices').insert({
    id: invoiceId,
    order_id: orderId,
    horeca_id: input.hoReCaId,
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

  dispatchConfirmationEmail(orderId)

  return { orderId, total, cartDiscount, appliedPromotionIds, bogoFreeItems: bogoFree }
}
