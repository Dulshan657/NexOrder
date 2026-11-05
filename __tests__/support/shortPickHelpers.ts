/**
 * Seeding and reading helpers for the NX-0029 tests. Everything here runs on the
 * caller's client, inside the caller's rolled-back transaction, on made-up data.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'
import { callImport, line, newInvoice, seed, type Line, type Scene } from './qbImportTxHelpers'

const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '00140_pick_differences.sql')

export async function ensureShortPick(client: pg.Client): Promise<void> {
  const r = await client.query<{ t: string | null }>("SELECT to_regclass('public.pick_differences') AS t")
  if (r.rows[0].t === null) await client.query(readFileSync(MIGRATION, 'utf-8'))
}

export async function scene(client: pg.Client): Promise<Scene> {
  const s = await seed(client)
  await ensureShortPick(client)
  return s
}

export interface Imported {
  orderId: string
  number: string
  itemId: number
}

/** An imported order with one line, moved on to `processed` with its fulfilments. */
export async function importedOrder(
  client: pg.Client, s: Scene, productId: number, qty: number,
  o: { pack?: number | null; pref?: number[]; process?: boolean } = {},
): Promise<Imported> {
  const number = newInvoice()
  const orderId = `QB-${number}`
  const lines: Line[] = [line(productId, qty, 10, o.pack ?? null)]
  await callImport(client, s, number, lines, '2026-10-01', o.pref ?? [s.warehouseId])
  if (o.process !== false) await markProcessed(client, s, orderId)
  const item = await client.query<{ id: number }>('SELECT id FROM public.order_items WHERE order_id=$1', [orderId])
  return { orderId, number, itemId: item.rows[0].id }
}

export async function markProcessed(client: pg.Client, s: Scene, orderId: string): Promise<void> {
  await client.query("UPDATE public.orders SET status='processed' WHERE id=$1", [orderId])
  await client.query('SELECT public.qb_sync_fulfilments($1, $2)', [orderId, s.actor])
}

export async function setStatus(client: pg.Client, orderId: string, status: string): Promise<void> {
  await client.query('UPDATE public.orders SET status=$2 WHERE id=$1', [orderId, status])
}

/**
 * A second line of the same product on an order, reserving its base units as a real
 * order would. The import refuses a repeated product, but place-order makes these.
 */
export async function addLine(
  client: pg.Client, s: Scene, orderId: string, productId: number, qty: number, pack: number | null = null,
): Promise<number> {
  const item = await client.query<{ id: number }>(
    `INSERT INTO public.order_items (order_id, product_id, quantity, pack_size, unit_price, product_name, product_sku)
     VALUES ($1, $2, $3, $4, 10, 'Test', 'TEST') RETURNING id`,
    [orderId, productId, qty, pack],
  )
  await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], $4, true)', [
    orderId, JSON.stringify([{ product_id: productId, quantity: qty * (pack ?? 1) }]), [s.warehouseId], s.actor,
  ])
  return item.rows[0].id
}

export type CloseResult = { status: string; line_closed?: boolean; order_fully_resolved?: boolean }

export async function closeShort(
  client: pg.Client, s: Scene, itemId: number, locationId: number | null = null,
): Promise<CloseResult> {
  const r = await client.query<{ r: CloseResult }>(
    'SELECT public.inv_close_line_short($1, $2, $3) AS r', [itemId, locationId, s.actor])
  return r.rows[0].r
}

export type PickResult = { line_fully_picked: boolean; order_fully_picked: boolean; unrecorded_qty_base?: number }

export async function pick(
  client: pg.Client, s: Scene, itemId: number, qty: number, locationId: number,
): Promise<PickResult> {
  const r = await client.query<{ r: PickResult }>(
    'SELECT public.inv_pick_order_line($1, $2, $3, $4) AS r', [itemId, qty, locationId, s.actor])
  return r.rows[0].r
}

export async function release(
  client: pg.Client, s: Scene, orderId: string, locationId: number | null = null,
): Promise<void> {
  await client.query('SELECT public.inv_release_reservation($1, $2, $3)', [orderId, locationId, s.actor])
}

export async function cancel(client: pg.Client, s: Scene, orderId: string): Promise<{ ok: boolean; code?: string }> {
  const r = await client.query<{ r: { ok: boolean; code?: string } }>(
    "SELECT public.order_cancel_tx($1, $2, 'Test cancellation') AS r", [orderId, s.actor])
  return r.rows[0].r
}

export async function pickComplete(client: pg.Client, orderId: string, warehouseId: number): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    'SELECT public.inv_warehouse_pick_complete($1, $2) AS ok', [orderId, warehouseId])
  return r.rows[0].ok
}

export async function differences(client: pg.Client, orderId: string): Promise<Array<Record<string, any>>> {
  const r = await client.query('SELECT * FROM public.pick_differences WHERE order_id=$1 ORDER BY id', [orderId])
  return r.rows
}

export async function bin(
  client: pg.Client, productId: number, binId: number,
): Promise<{ onHand: number; allocated: number }> {
  const r = await client.query<{ on_hand: number; allocated: number }>(
    `SELECT COALESCE(SUM(on_hand),0)::numeric AS on_hand, COALESCE(SUM(allocated),0)::numeric AS allocated
       FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2`,
    [productId, binId],
  )
  return { onHand: r.rows[0].on_hand, allocated: r.rows[0].allocated }
}

export async function movementCount(client: pg.Client, productId: number): Promise<number> {
  const r = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM public.inventory_movements WHERE product_id=$1', [productId])
  return r.rows[0].n
}

export async function picksOf(client: pg.Client, orderId: string): Promise<Array<Record<string, any>>> {
  const r = await client.query('SELECT * FROM public.pick_progress WHERE order_id=$1 ORDER BY id', [orderId])
  return r.rows
}

/** What a balance row holds, found by its batch and plate. */
export async function row(
  client: pg.Client, productId: number, binId: number, batchId: number | null, huId: number | null = null,
): Promise<{ on_hand: number; allocated: number }> {
  const r = await client.query<{ on_hand: number; allocated: number }>(
    `SELECT on_hand, allocated FROM public.inventory_balances
      WHERE product_id=$1 AND location_id=$2
        AND COALESCE(batch_id,0)=COALESCE($3::int,0) AND COALESCE(handling_unit_id,0)=COALESCE($4::bigint,0)`,
    [productId, binId, batchId, huId],
  )
  return r.rows[0]
}

/** Collect RAISE WARNING text while `fn` runs. */
export async function warningsDuring(client: pg.Client, fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const listener = (n: pg.NoticeMessage): void => {
    if (n.severity === 'WARNING' && n.message) seen.push(n.message)
  }
  client.on('notice', listener)
  try {
    await fn()
  } finally {
    client.removeListener('notice', listener)
  }
  return seen
}
