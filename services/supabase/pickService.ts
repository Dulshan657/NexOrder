import { supabase } from '@/lib/supabase'
import { toPickCallError } from '@/lib/pickRefusal'

export interface PickQueueLine {
  orderItemId: number
  productId: number
  productName: string
  productSku: string
  /** Supplier EAN/UPC (mig 00074), so a carton barcode scanned at the rack
   *  validates in the browser instead of only at the server. */
  productBarcode: string | null
  quantity: number
  picked: number
}

export interface PickQueueOrder {
  orderId: string
  status: string
  orderDate: string | null
  deliveryDate: string | null
  horecaName: string
  horecaAddress: string
  lines: PickQueueLine[]
  /** Warehouses this order is fulfilled from (for per-site scoping). */
  fulfilmentWarehouseIds: number[]
}

export interface GenerateDocResult {
  storagePath: string
  signedUrl: string | null
}

/** One directed, per-bin pick task — the actionable unit the pick workspace
 *  renders and records picks against (see order-pick-tasks Edge Function). */
export interface PickTask {
  orderItemId: number
  productId: number
  warehouseId: number
  warehouseCode: string
  locationId: number
  code: string
  graphNodeId: number | null
  allocatedQty: number
  pickedQty: number
  remaining: number
  /** An imported order's offer at a bin the order holds no reservation on (NX-0029). */
  unreserved?: boolean
}

/** Everything order-pick-tasks answers with. */
export interface OrderPickTasks {
  tasks: PickTask[]
  /** True for an order imported from an invoice: it can be finished short and picked
   *  beyond its reservation. False for every other order, and for a function that
   *  predates the field. */
  imported: boolean
  /** Order lines closed short. Always empty for an order that is not imported. */
  closedShortLineIds: number[]
  /** order_item_id -> found quantity (what has been picked), LINE units. */
  foundByLine: Record<number, number>
}

// Orders that the warehouse acts on: processed (ready to pick), picked, packed.
export async function getPickQueue(): Promise<PickQueueOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, order_date, delivery_date, horecas(name, address), order_fulfillments(location_id), ' +
      'order_items(id, product_id, product_name, product_sku, quantity, products(barcode), pick_progress(picked_qty))',
    )
    .in('status', ['processed', 'picked', 'packed'])
    .order('order_date', { ascending: true })
  if (error) throw error

  return ((data ?? []) as any[]).map((o) => ({
    orderId: o.id,
    status: o.status,
    orderDate: o.order_date ?? null,
    deliveryDate: o.delivery_date ?? null,
    horecaName: o.horecas?.name ?? '—',
    horecaAddress: o.horecas?.address ?? '',
    fulfilmentWarehouseIds: ((o.order_fulfillments ?? []) as any[]).map((f) => f.location_id),
    lines: (o.order_items ?? []).map((it: any) => ({
      orderItemId: it.id,
      productId: it.product_id,
      productName: it.product_name,
      productSku: it.product_sku,
      productBarcode: it.products?.barcode ?? null,
      quantity: Number(it.quantity),
      picked: (it.pick_progress ?? []).reduce((s: number, p: any) => s + Number(p.picked_qty), 0),
    })),
  }))
}

/** Scan evidence for a confirmed pick (Phase 3). The server re-validates every
 *  code — the browser check only exists to fail fast for the operator. */
export interface PickScanEvidence {
  locationCode?: string
  productCode?: string
  handlingUnitCode?: string
}

export async function recordPick(
  orderItemId: number,
  pickedQty: number,
  locationId?: number,
  scan?: PickScanEvidence,
): Promise<{ line_fully_picked: boolean; order_fully_picked: boolean; scanVerified?: boolean }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    line_fully_picked: boolean
    order_fully_picked: boolean
    scanVerified?: boolean
  }>(
    'record-pick',
    {
      body: {
        orderItemId,
        pickedQty,
        ...(locationId != null ? { locationId } : {}),
        ...(scan && (scan.locationCode || scan.productCode || scan.handlingUnitCode) ? { scan } : {}),
      },
    },
  )
  if (error) throw await toPickCallError(error, 'Could not record the pick.')
  return data!
}

/** What record-short-pick answers: `closed` the first time, `already_closed` on a retry,
 *  `already_picked` when the line was in fact complete. */
export interface ShortPickResult {
  status: 'closed' | 'already_closed' | 'already_picked'
  line_closed?: boolean
  order_fully_resolved?: boolean
}

/** Finish an open line of an imported order with what was found, including nothing.
 *  `locationId` is the bin that was checked, sent only when one is known: the server
 *  flags it for a recount and does not default it. */
export async function recordShortPick(orderItemId: number, locationId?: number): Promise<ShortPickResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & ShortPickResult>(
    'record-short-pick',
    { body: { orderItemId, ...(locationId != null ? { locationId } : {}) } },
  )
  if (error) throw await toPickCallError(error, 'Could not finish the line short.')
  return data!
}

// Directed per-bin pick tasks for one order — the same allocation netting the
// route and the pick slip use, split into per-line-per-bin tasks with a
// remaining qty (see order-pick-tasks Edge Function / _shared/wie/pickTasks.ts).
// For an imported order the answer also says which lines are closed short, how much
// of each was found, and offers the unreserved part at bins with free stock.
export async function getOrderPickTasks(orderId: string): Promise<OrderPickTasks> {
  const { data, error } = await supabase.functions.invoke<{
    ok: true
    tasks: PickTask[]
    imported?: boolean
    closedShortLineIds?: number[]
    foundByLine?: Record<string, number>
  }>('order-pick-tasks', { body: { orderId } })
  if (error) throw error
  return {
    tasks: data?.tasks ?? [],
    // Exactly true, so a function deployed before this field exists reads as "not imported".
    imported: data?.imported === true,
    closedShortLineIds: data?.closedShortLineIds ?? [],
    foundByLine: Object.fromEntries(Object.entries(data?.foundByLine ?? {}).map(([id, n]) => [Number(id), Number(n)])),
  }
}

export async function generatePickSlip(orderId: string): Promise<GenerateDocResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & GenerateDocResult>(
    'generate-pick-slip',
    { body: { orderId } },
  )
  if (error) throw error
  return { storagePath: data!.storagePath, signedUrl: data!.signedUrl }
}

export async function generateDispatchAdvice(orderId: string): Promise<GenerateDocResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & GenerateDocResult>(
    'generate-dispatch-advice',
    { body: { orderId } },
  )
  if (error) throw error
  return { storagePath: data!.storagePath, signedUrl: data!.signedUrl }
}
