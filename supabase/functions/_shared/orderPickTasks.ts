// The body order-pick-tasks answers with, built from a database handle so it can be
// tested with a fake one (the function's index.ts is Deno-only and cannot be imported).
//
// An ordinary order gets what it always got: the reserved per-bin tasks, now with
// `imported: false` and an empty `closedShortLineIds`, and nothing else is read.
//
// An imported order (orders.qb_invoice_number set, NX-0029) can be picked beyond its
// reservation and can have lines closed short, so it also gets:
//   - the lines closed short (the `short` rows of pick_differences);
//   - fallback tasks: bins with FREE stock of the lines' still-open products under the
//     warehouses the order is fulfilled from, for the part no reservation or pick covers;
//   - the found quantity of every line (what has been picked, LINE units).
//
// Warehouse membership comes from inv_warehouse_draw_locations, the one definition
// inv_reserve_order draws by. It is never rebuilt as a materialized-path prefix here
// (CLAUDE.md, "A WAREHOUSE id is not a place stock sits").

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import {
  buildFallbackTasks,
  buildPickTasks,
  stockBinsInWarehouses,
  type AllocBin,
  type OrderLine,
  type PickRecord,
  type PickTask,
  type StockRow,
  type WarehouseDraw,
} from './wie/pickTasks.ts'

type Db = Pick<SupabaseClient, 'from' | 'rpc'>

export interface OrderPickTasksBody {
  tasks: PickTask[]
  imported: boolean
  closedShortLineIds: number[]
  /** Imported orders only: order_item_id -> found quantity, LINE units, for every line. */
  foundByLine?: Record<string, number>
}

/** PostgREST returns at most 1000 rows a request, so stock rows are read a page at a time. */
const DEFAULT_PAGE_SIZE = 1000
/** A ceiling on pages, so a runaway read cannot loop. 50 pages is 50 000 balance rows. */
const MAX_PAGES = 50

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (result.error) throw new EdgeFunctionError('INTERNAL', `${what} load failed: ${result.error.message}`)
  return result.data
}

async function readStockRows(db: Db, productIds: number[], pageSize: number): Promise<StockRow[]> {
  const rows: StockRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize
    const got = (must(
      await db
        .from('inventory_balances')
        .select('product_id, location_id, on_hand, allocated')
        .in('product_id', productIds)
        .gt('on_hand', 0)
        .order('id')
        .range(from, from + pageSize - 1) as any,
      'stock',
    ) ?? []) as any[]
    for (const r of got) {
      rows.push({
        productId: r.product_id,
        locationId: r.location_id,
        code: '',
        graphNodeId: null,
        onHand: Number(r.on_hand) || 0,
        allocated: Number(r.allocated) || 0,
      })
    }
    if (got.length < pageSize) break
  }
  return rows
}

/** The order's fulfilment warehouses, each with the locations stock may be drawn from. */
async function loadDraws(db: Db, orderId: string): Promise<WarehouseDraw[]> {
  const fulfilments = (must(
    await db.from('order_fulfillments').select('location_id').eq('order_id', orderId) as any,
    'fulfilments',
  ) ?? []) as any[]
  const warehouseIds = [...new Set(fulfilments.map((f) => Number(f.location_id)))].sort((a, b) => a - b)
  if (warehouseIds.length === 0) return []

  const codes = (must(
    await db.from('locations').select('id, code').in('id', warehouseIds) as any,
    'warehouses',
  ) ?? []) as any[]
  const codeOf = new Map<number, string>(codes.map((c) => [Number(c.id), String(c.code)]))

  return Promise.all(
    warehouseIds.map(async (warehouseId) => {
      const res = await db.rpc('inv_warehouse_draw_locations', { p_warehouse_id: warehouseId })
      const ids = ((must(res as any, 'warehouse locations') ?? []) as any[]).map((r) => Number(r.location_id))
      // A warehouse always draws from itself, even when the expansion came back empty.
      return {
        warehouseId,
        warehouseCode: codeOf.get(warehouseId) ?? String(warehouseId),
        locationIds: ids.includes(warehouseId) ? ids : [...ids, warehouseId],
      }
    }),
  )
}

/** Name the bins that survived the warehouse filter. Codes are fetched for those only. */
async function withBinCodes(db: Db, rows: StockRow[], draws: WarehouseDraw[]): Promise<StockRow[]> {
  const inDraw = new Set(draws.flatMap((d) => d.locationIds))
  const wanted = [...new Set(rows.filter((r) => inDraw.has(r.locationId)).map((r) => r.locationId))]
  if (wanted.length === 0) return []
  const locs = (must(await db.from('locations').select('id, code').in('id', wanted) as any, 'bins') ?? []) as any[]
  const codeOf = new Map<number, string>(locs.map((l) => [Number(l.id), String(l.code)]))
  return rows
    .filter((r) => inDraw.has(r.locationId))
    .map((r) => ({ ...r, code: codeOf.get(r.locationId) ?? String(r.locationId) }))
}

function foundQuantities(lines: OrderLine[], picks: PickRecord[]): Record<string, number> {
  const found: Record<string, number> = {}
  for (const l of lines) found[String(l.orderItemId)] = 0
  for (const p of picks) found[String(p.orderItemId)] = (found[String(p.orderItemId)] ?? 0) + p.pickedQty
  return found
}

export async function loadOrderPickTasks(
  db: Db,
  orderId: string,
  options: { pageSize?: number } = {},
): Promise<OrderPickTasksBody> {
  const order = must(
    await db.from('orders').select('qb_invoice_number').eq('id', orderId).maybeSingle() as any,
    'order',
  ) as { qb_invoice_number: string | null } | null
  const imported = (order?.qb_invoice_number ?? null) !== null

  const binRows = must(await db.rpc('wie_order_pick_tasks', { p_order_id: orderId }) as any, 'allocation')
  const lineRows = must(
    await db.from('order_items').select('id, product_id, quantity, pack_size').eq('order_id', orderId) as any,
    'order lines',
  )
  const pickRows = must(
    await db.from('pick_progress').select('order_item_id, location_id, picked_qty').eq('order_id', orderId) as any,
    'pick progress',
  )

  const allocBins: AllocBin[] = ((binRows ?? []) as any[]).map((r) => ({
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    locationId: r.location_id,
    code: r.code,
    graphNodeId: r.graph_node_id ?? null,
    qtyBase: Number(r.qty_base) || 0,
  }))
  const orderLines: OrderLine[] = ((lineRows ?? []) as any[]).map((r) => ({
    orderItemId: r.id,
    productId: r.product_id,
    quantity: Number(r.quantity) || 0,
    packSize: Number(r.pack_size) || 1,
  }))
  const picks: PickRecord[] = ((pickRows ?? []) as any[]).map((r) => ({
    orderItemId: r.order_item_id,
    locationId: r.location_id,
    pickedQty: Number(r.picked_qty) || 0,
  }))

  const reserved = buildPickTasks(allocBins, orderLines, picks)
  if (!imported) return { tasks: reserved, imported: false, closedShortLineIds: [] }

  const shortRows = (must(
    await db.from('pick_differences').select('order_item_id').eq('order_id', orderId).eq('kind', 'short') as any,
    'differences',
  ) ?? []) as any[]
  const closedShortLineIds = [...new Set(shortRows.map((r) => Number(r.order_item_id)))].sort((a, b) => a - b)

  const pickedByLine = new Map<number, number>()
  for (const p of picks) pickedByLine.set(p.orderItemId, (pickedByLine.get(p.orderItemId) ?? 0) + p.pickedQty)
  const closed = new Set(closedShortLineIds)
  const openProductIds = [
    ...new Set(
      orderLines
        .filter((l) => !closed.has(l.orderItemId) && (pickedByLine.get(l.orderItemId) ?? 0) < l.quantity)
        .map((l) => l.productId),
    ),
  ]

  let fallback: PickTask[] = []
  if (openProductIds.length > 0) {
    const draws = await loadDraws(db, orderId)
    if (draws.length > 0) {
      const rows = await readStockRows(db, openProductIds, options.pageSize ?? DEFAULT_PAGE_SIZE)
      const named = await withBinCodes(db, rows, draws)
      fallback = buildFallbackTasks(orderLines, reserved, stockBinsInWarehouses(named, draws), picks, closedShortLineIds)
    }
  }

  return {
    tasks: [...reserved, ...fallback],
    imported: true,
    closedShortLineIds,
    foundByLine: foundQuantities(orderLines, picks),
  }
}
