/**
 * Seeding and reading helpers for the NX-0026 import transaction tests. Everything
 * here runs on the caller's client, inside the caller's rolled-back transaction.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'

const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '00139_qb_invoice_import.sql')

let seq = 0
export const uniq = (): string => `${Date.now()}-${++seq}`

export interface Line {
  product_id: number
  quantity: number
  pack_size: number | null
  unit_price: number
  qb_product_name: string
}

export interface Scene {
  actor: string
  horecaId: number
  otherHorecaId: number
  warehouseId: number
  supplierId: number
  binA: number
  binB: number
}

export async function ensureMigration(client: pg.Client): Promise<void> {
  const r = await client.query<{ t: string | null }>("SELECT to_regclass('public.qb_product_map') AS t")
  if (r.rows[0].t === null) await client.query(readFileSync(MIGRATION, 'utf-8'))
}

export async function newProduct(client: pg.Client, supplierId: number): Promise<number> {
  const token = uniq()
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [`QBT-${token}`, `QB Test Product ${token}`, supplierId],
  )
  return r.rows[0].id
}

export async function seed(client: pg.Client): Promise<Scene> {
  await ensureMigration(client)
  const token = uniq()
  const actor = await client.query<{ id: string }>('SELECT id FROM public.profiles LIMIT 1')
  const customer = async (name: string): Promise<number> => {
    const h = await client.query<{ id: number }>(
      "INSERT INTO public.horecas (name, address) VALUES ($1, '1 Test Street') RETURNING id",
      [`${name} ${token}`],
    )
    return h.rows[0].id
  }
  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '') RETURNING id`,
    [`QB Test Supplier ${token}`, `qb-${token}@test.local`],
  )
  const whPath = `QBWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`QBWH-${token}`, whPath],
  )
  const bin = async (suffix: string): Promise<number> => {
    const code = `QB-${suffix}-${token}`
    const b = await client.query<{ id: number }>(
      `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
       VALUES ($1, 'BIN', $2, $2, $3, true, 100) RETURNING id`,
      [wh.rows[0].id, code, `${whPath}/${code}`],
    )
    return b.rows[0].id
  }
  return {
    actor: actor.rows[0].id,
    horecaId: await customer('QB Test Cafe'),
    otherHorecaId: await customer('QB Test Bistro'),
    warehouseId: wh.rows[0].id,
    supplierId: supplier.rows[0].id,
    binA: await bin('A'),
    binB: await bin('B'),
  }
}

export async function receive(
  client: pg.Client, productId: number, binId: number, qty: number,
  o: { batchId?: number; huId?: number } = {},
): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, $3, $4, 0, 'receipt', NULL, 'test', NULL, NULL, NULL, $5)`,
    [productId, binId, o.batchId ?? null, qty, o.huId ?? null],
  )
}

export const line = (productId: number, quantity: number, unitPrice = 10, packSize: number | null = null): Line => ({
  product_id: productId,
  quantity,
  pack_size: packSize,
  unit_price: unitPrice,
  qb_product_name: `QB name ${productId}`,
})

export const newInvoice = (): string => `QBT-${uniq()}`

export type Verdict = { status: string; order_id?: string; reason?: string }

const CALL_ARGS = '($1, $2, $3::date, $4::jsonb, $5, $6::int[]) AS r'

export async function callImport(
  client: pg.Client, s: Scene, number: string, lines: unknown, date = '2026-10-01',
  pref: number[] | null = [s.warehouseId],
): Promise<Verdict> {
  const r = await client.query<{ r: Verdict }>(
    `SELECT public.qb_import_invoice_tx${CALL_ARGS}`,
    [number, s.horecaId, date, JSON.stringify(lines), s.actor, pref],
  )
  return r.rows[0].r
}

export async function callUpdate(
  client: pg.Client, s: Scene, number: string, lines: unknown,
  o: { horecaId?: number; date?: string; pref?: number[] | null } = {},
): Promise<Verdict> {
  const r = await client.query<{ r: Verdict }>(
    `SELECT public.qb_update_invoice_tx${CALL_ARGS}`,
    [number, o.horecaId ?? s.horecaId, o.date ?? '2026-10-01', JSON.stringify(lines), s.actor,
      o.pref === undefined ? [s.warehouseId] : o.pref],
  )
  return r.rows[0].r
}

/** A plain order, as place-order would leave it, holding `qty` of a product if `reserve`. */
export async function plainOrder(
  client: pg.Client, s: Scene, productId: number, qty: number, reserve = true,
): Promise<{ orderId: string; itemId: number }> {
  const orderId = `ORD-QBT-${uniq()}`
  await client.query(
    `INSERT INTO public.orders (id, horeca_id, submitted_by, total, status) VALUES ($1, $2, $3, 100, 'processing')`,
    [orderId, s.horecaId, s.actor],
  )
  const item = await client.query<{ id: number }>(
    `INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, product_name, product_sku)
     VALUES ($1, $2, $3, 10, 'Test', 'TEST') RETURNING id`,
    [orderId, productId, qty],
  )
  if (reserve) {
    await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, false)', [
      orderId, JSON.stringify([{ product_id: productId, quantity: qty }]), [s.warehouseId], s.actor,
    ])
  }
  return { orderId, itemId: item.rows[0].id }
}

export async function allocatedAt(client: pg.Client, productId: number, binId?: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    `SELECT COALESCE(SUM(allocated),0)::numeric AS q FROM public.inventory_balances
      WHERE product_id=$1 AND ($2::int IS NULL OR location_id=$2)`,
    [productId, binId ?? null],
  )
  return r.rows[0].q
}

export async function onHandOf(client: pg.Client, productId: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    'SELECT COALESCE(SUM(on_hand),0)::numeric AS q FROM public.inventory_balances WHERE product_id=$1',
    [productId],
  )
  return r.rows[0].q
}

/** What this order's own ledger nets to for a product, optionally in one bin. */
export async function netOf(client: pg.Client, orderId: string, productId: number, binId?: number): Promise<number> {
  const r = await client.query<{ q: number }>(
    `SELECT COALESCE(SUM(qty_delta),0)::numeric AS q FROM public.inventory_movements
      WHERE ref_type='order' AND ref_id=$1 AND product_id=$2
        AND movement_type IN ('allocate','deallocate')
        AND ($3::int IS NULL OR location_id=$3)`,
    [orderId, productId, binId ?? null],
  )
  return r.rows[0].q
}

export async function itemsOf(client: pg.Client, orderId: string): Promise<Array<Record<string, unknown>>> {
  const r = await client.query(
    `SELECT product_id, quantity, pack_size, unit_price, product_name, product_sku
       FROM public.order_items WHERE order_id=$1 ORDER BY product_id`,
    [orderId],
  )
  return r.rows
}

export async function orderRow(client: pg.Client, orderId: string): Promise<Record<string, any>> {
  const r = await client.query('SELECT * FROM public.orders WHERE id=$1', [orderId])
  return r.rows[0]
}

export async function importRow(client: pg.Client, number: string): Promise<Record<string, any>> {
  const r = await client.query(
    "SELECT *, invoice_date::text AS date_text FROM public.qb_invoice_imports WHERE invoice_number=$1",
    [number],
  )
  return r.rows[0]
}

/** Everything a refused call must leave alone, for a before-and-after comparison. */
export async function snapshot(client: pg.Client, orderId: string, number: string, productId: number): Promise<unknown> {
  const balances = await client.query(
    'SELECT id, on_hand, allocated, updated_at FROM public.inventory_balances WHERE product_id=$1 ORDER BY id',
    [productId],
  )
  const movements = await client.query(
    'SELECT count(*)::int AS n FROM public.inventory_movements WHERE product_id=$1',
    [productId],
  )
  const items = await client.query('SELECT * FROM public.order_items WHERE order_id=$1 ORDER BY id', [orderId])
  return {
    order: await orderRow(client, orderId),
    importRow: await importRow(client, number),
    items: items.rows,
    balances: balances.rows,
    movements: movements.rows[0].n,
  }
}

/** A second warehouse with one bin, for moving a reservation between sites. */
export async function newWarehouse(client: pg.Client): Promise<{ warehouseId: number; bin: number }> {
  const token = uniq()
  const whPath = `QBWH${token}`
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $2, true, 'racked') RETURNING id`,
    [`QBWH-${token}`, whPath],
  )
  const code = `QB-Z-${token}`
  const b = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots)
     VALUES ($1, 'BIN', $2, $2, $3, true, 100) RETURNING id`,
    [wh.rows[0].id, code, `${whPath}/${code}`],
  )
  return { warehouseId: wh.rows[0].id, bin: b.rows[0].id }
}

export async function newBatch(client: pg.Client, productId: number, expiry: string): Promise<number> {
  const r = await client.query<{ id: number }>(
    'INSERT INTO public.batches (product_id, lot_code, expiry_date) VALUES ($1, $2, $3::date) RETURNING id',
    [productId, `LOT-${uniq()}`, expiry],
  )
  return r.rows[0].id
}

export async function newPlate(client: pg.Client, s: Scene, binId: number): Promise<number> {
  const r = await client.query<{ id: number }>(
    `INSERT INTO public.handling_units (hu_type, warehouse_id, location_id) VALUES ('pallet', $1, $2) RETURNING id`,
    [s.warehouseId, binId],
  )
  return r.rows[0].id
}

/** Run the real rack conversion on a bin and return its new level 1. */
export async function convertRack(client: pg.Client, s: Scene, binId: number): Promise<number> {
  const layout = await client.query<{ id: number }>(
    `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
     VALUES ($1, 'Test', 'published', 2) RETURNING id`,
    [s.warehouseId],
  )
  await client.query(
    `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, 0, 0, 1, 1, 0, NULL, 0)`,
    [layout.rows[0].id, binId],
  )
  const role = await client.query<{ key: string }>('SELECT key FROM public.level_roles WHERE is_active ORDER BY key LIMIT 1')
  await client.query('SELECT public.wie_convert_rack_to_levels_tx($1, $2, $3::jsonb, $4)', [
    binId, layout.rows[0].id, JSON.stringify([{ role: role.rows[0].key, capacity_slots: 100 }]), s.actor,
  ])
  const l1 = await client.query<{ id: number }>(
    'SELECT id FROM public.locations WHERE parent_id=$1 AND level_index=1', [binId])
  return l1.rows[0].id
}

export async function fulfilmentsOf(
  client: pg.Client, orderId: string,
): Promise<Array<{ location_id: number; status: string; status_history: Array<Record<string, unknown>> }>> {
  const r = await client.query(
    'SELECT location_id, status, status_history FROM public.order_fulfillments WHERE order_id=$1 ORDER BY location_id',
    [orderId],
  )
  return r.rows
}
