// The body order-pick-tasks answers with, built from a database handle so it can be
// tested with a fake one (the function's index.ts is Deno-only and cannot be imported).
//
// An ordinary order gets what it always got: the reserved per-bin tasks, now with
// `imported: false` and an empty `closedShortLineIds`, and nothing else is read.
//
// An imported order (orders.qb_invoice_number set, NX-0029) can be picked beyond its
// reservation and can have lines closed short, so it also gets:
//   - the lines closed short (the `short` rows of pick_differences). They own no
//     reservation: reserved tasks are built from the OPEN lines only, so a bin's
//     allocation is never attributed to a line that renders no tasks while the open
//     line of the same product is left with none;
//   - fallback tasks: bins with FREE stock of the lines' still-open products under the
//     warehouses the order is fulfilled from, for the part no reservation or pick
//     covers. Held (quarantine) locations are never offered: allocation skips them
//     (mig 00101), so a picker must not be sent to goods that are not for sale;
//   - the found quantity of every line (what has been picked, LINE units).
//
// Warehouse membership comes from inv_warehouse_draw_locations, the one definition
// inv_reserve_order draws by, and "held" from v_held_locations, the one definition it
// skips by. Neither is rebuilt here as a materialized-path prefix (CLAUDE.md, "A
// WAREHOUSE id is not a place stock sits").

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

export interface LoadOptions {
  /** Rows per stock request. PostgREST answers at most 1000, so this must not exceed that. */
  pageSize?: number
  /** Pages read per bin chunk before the read stops and says so. */
  maxPages?: number
  /** Ids per `in (...)` filter, to keep a request line short on a warehouse with thousands of bins. */
  chunkSize?: number
}

const DEFAULT_PAGE_SIZE = 1000
/** A ceiling on pages per chunk, so a runaway read cannot loop. */
const DEFAULT_MAX_PAGES = 50
const DEFAULT_CHUNK_SIZE = 200

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (result.error) throw new EdgeFunctionError('INTERNAL', `${what} load failed: ${result.error.message}`)
  return result.data
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Free-stock rows of the given products at the given locations, one chunk of locations at a
 *  time, a page at a time. When a chunk is still returning full pages at the ceiling, that is
 *  logged: fewer offers is survivable, a silent cut-off is not. */
async function readStockRows(
  db: Db,
  productIds: number[],
  locationIds: number[],
  limits: Required<LoadOptions>,
): Promise<StockRow[]> {
  const perChunk = await Promise.all(
    chunks(locationIds, limits.chunkSize).map(async (chunk) => {
      const rows: StockRow[] = []
      for (let page = 0; page < limits.maxPages; page++) {
        const from = page * limits.pageSize
        const got = (must(
          await db
            .from('inventory_balances')
            .select('product_id, location_id, on_hand, allocated')
            .in('product_id', productIds)
            .in('location_id', chunk)
            .gt('on_hand', 0)
            .order('id')
            .range(from, from + limits.pageSize - 1) as any,
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
        if (got.length < limits.pageSize) return rows
      }
      console.error(
        `[order-pick-tasks] stock read stopped at ${limits.maxPages} pages of ${limits.pageSize} rows ` +
          `for ${productIds.length} product(s); the offers for this order may be incomplete`,
      )
      return rows
    }),
  )
  return perChunk.flat()
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

/** Which of these locations sit under a hold zone (v_held_locations, mig 00101). Fails CLOSED:
 *  an unreadable answer must not read as "nothing is held". */
async function loadHeld(db: Db, locationIds: number[], chunkSize: number): Promise<Set<number>> {
  const held = new Set<number>()
  for (const chunk of chunks(locationIds, chunkSize)) {
    const rows = (must(
      await db.from('v_held_locations').select('location_id').in('location_id', chunk) as any,
      'hold state',
    ) ?? []) as any[]
    for (const r of rows) held.add(Number(r.location_id))
  }
  return held
}

/** Name the bins that have stock. Codes are fetched for those only. */
async function withBinCodes(db: Db, rows: StockRow[], chunkSize: number): Promise<StockRow[]> {
  const wanted = [...new Set(rows.map((r) => r.locationId))]
  const codeOf = new Map<number, string>()
  for (const chunk of chunks(wanted, chunkSize)) {
    const locs = (must(await db.from('locations').select('id, code').in('id', chunk) as any, 'bins') ?? []) as any[]
    for (const l of locs) codeOf.set(Number(l.id), String(l.code))
  }
  return rows.map((r) => ({ ...r, code: codeOf.get(r.locationId) ?? String(r.locationId) }))
}

function foundQuantities(lines: OrderLine[], picks: PickRecord[]): Record<string, number> {
  const found: Record<string, number> = {}
  for (const l of lines) found[String(l.orderItemId)] = 0
  for (const p of picks) found[String(p.orderItemId)] = (found[String(p.orderItemId)] ?? 0) + p.pickedQty
  return found
}

/** The part of an imported order no reservation covers, offered at bins with free stock. */
async function loadFallback(
  db: Db,
  orderId: string,
  lines: OrderLine[],
  reserved: PickTask[],
  picks: PickRecord[],
  closed: number[],
  limits: Required<LoadOptions>,
): Promise<PickTask[]> {
  const pickedByLine = new Map<number, number>()
  for (const p of picks) pickedByLine.set(p.orderItemId, (pickedByLine.get(p.orderItemId) ?? 0) + p.pickedQty)
  const closedSet = new Set(closed)
  const openProductIds = [
    ...new Set(
      lines
        .filter((l) => !closedSet.has(l.orderItemId) && (pickedByLine.get(l.orderItemId) ?? 0) < l.quantity)
        .map((l) => l.productId),
    ),
  ]
  if (openProductIds.length === 0) return []

  const draws = await loadDraws(db, orderId)
  if (draws.length === 0) return []

  const locationIds = [...new Set(draws.flatMap((d) => d.locationIds))]
  const rows = await readStockRows(db, openProductIds, locationIds, limits)
  if (rows.length === 0) return []

  const held = await loadHeld(db, [...new Set(rows.map((r) => r.locationId))], limits.chunkSize)
  const named = await withBinCodes(db, rows, limits.chunkSize)
  return buildFallbackTasks(lines, reserved, stockBinsInWarehouses(named, draws, held), picks, closed)
}

export async function loadOrderPickTasks(
  db: Db,
  orderId: string,
  options: LoadOptions = {},
): Promise<OrderPickTasksBody> {
  const limits: Required<LoadOptions> = {
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
  }

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

  if (!imported) {
    return { tasks: buildPickTasks(allocBins, orderLines, picks), imported: false, closedShortLineIds: [] }
  }

  const shortRows = (must(
    await db.from('pick_differences').select('order_item_id').eq('order_id', orderId).eq('kind', 'short') as any,
    'differences',
  ) ?? []) as any[]
  const closedShortLineIds = [...new Set(shortRows.map((r) => Number(r.order_item_id)))].sort((a, b) => a - b)
  const closed = new Set(closedShortLineIds)

  // A closed line needs nothing, so it must not be handed an allocation: attribution walks
  // a product's lines by ascending id, and an earlier closed line would take the bin the
  // open line is waiting for.
  const openLines = orderLines.filter((l) => !closed.has(l.orderItemId))
  const reserved = buildPickTasks(allocBins, openLines, picks)
  const fallback = await loadFallback(db, orderId, orderLines, reserved, picks, closedShortLineIds, limits)

  return {
    tasks: [...reserved, ...fallback],
    imported: true,
    closedShortLineIds,
    foundByLine: foundQuantities(orderLines, picks),
  }
}
