// Made-up world for the NX-0032 home-bin end-to-end spec (putaway-home-block).
//
// Everything here is invented: one racked warehouse with a published layout and
// a dock route, four pick bins, two products with no connection to any
// customer, and a UOM pair so "4 cartons" can be chosen on the receive screen.
// The spec seeds it before the browser starts and `tearDownWorld` removes every
// row it, or the browser's receipts, wrote -- so a failed run leaves nothing
// behind and a re-run starts clean (it sweeps first, by name).
//
// Why a seeded warehouse rather than the permanent "E2E RackLevels Test" one the
// sibling specs share: the home rule is arithmetic on room (max, capacity,
// on-hand, pending). The shared warehouse carries other specs' stock and open
// tasks, so the room in any of its bins is not a number this spec controls.
//
// Direct SQL, through the integration suite's guarded connection: it refuses a
// tenant's database outright (see __tests__/support/loadEnv.ts), which is the
// same promise playwright.config.ts makes for the browser side.
import type pg from 'pg'
import { connect } from '../../../__tests__/support/pgTestClient'

export const WORLD_NAMES = {
  warehouseCode: 'TST-HOME-E2E',
  warehouseName: 'TST-HOME E2E Warehouse',
  /** The product that gets a home bin. */
  homeSku: 'TST-HOME-200',
  /** A second product that has no home bin at all. */
  otherSku: 'TST-HOME-300',
  supplierName: 'E2E Test Supplier',
} as const

/** Base units in one carton of either made-up product. */
export const CARTON_SIZE = 6

export interface WorldBin {
  readonly id: number
  readonly code: string
}

export interface WorldProduct {
  readonly id: number
  readonly sku: string
  readonly name: string
  readonly barcode: string
  readonly cartonSize: number
}

export interface World {
  readonly warehouseId: number
  readonly warehouseCode: string
  readonly warehouseName: string
  readonly layoutId: number
  /** H: the home bin. X, Y, Z: ordinary bins. */
  readonly bins: { readonly h: WorldBin; readonly x: WorldBin; readonly y: WorldBin; readonly z: WorldBin }
  readonly home: WorldProduct
  readonly other: WorldProduct
}

export interface TaskRow {
  readonly id: number
  readonly status: string
  readonly quantity: number
  readonly recommendedLocationId: number | null
  readonly assignedLocationId: number | null
  readonly suggestionSource: string | null
  readonly overrideReason: string | null
  readonly explanation: unknown
}

export interface HomeRow {
  readonly binId: number
  readonly maxQty: number | null
}

async function withClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function one<T extends pg.QueryResultRow>(client: pg.Client, sql: string, params: unknown[]): Promise<T> {
  const result = await client.query<T>(sql, params)
  if (result.rows.length !== 1) throw new Error(`expected one row from: ${sql.trim().split('\n')[0]}`)
  return result.rows[0]
}

async function supplierId(client: pg.Client): Promise<number> {
  const found = await client.query<{ id: number }>('SELECT id FROM public.suppliers WHERE name = $1 LIMIT 1', [
    WORLD_NAMES.supplierName,
  ])
  if (found.rows[0]) return found.rows[0].id
  const made = await one<{ id: number }>(
    client,
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', '', '') RETURNING id`,
    [WORLD_NAMES.supplierName],
  )
  return made.id
}

async function insertProduct(client: pg.Client, supplier: number, sku: string, label: string): Promise<WorldProduct> {
  const name = `TST-HOME Product ${label}`
  const barcode = `TSTHOME${label}`
  const row = await one<{ id: number }>(
    client,
    `INSERT INTO public.products
       (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, barcode)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', $3, $4, 0, 1, $5)
     RETURNING id`,
    [sku, name, CARTON_SIZE, supplier, barcode],
  )
  // The receive screen can only pick "carton" when the product has real UOM rows;
  // the derived default pair shares id 0 and the select cannot tell them apart.
  await client.query(
    `INSERT INTO public.product_uoms (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable, sort_order)
     VALUES ($1, 'EA', 1, true, 5, true, true, 0),
            ($1, 'carton', $2, false, $3, true, true, 1)`,
    [row.id, CARTON_SIZE, 5 * CARTON_SIZE],
  )
  return { id: row.id, sku, name, barcode, cartonSize: CARTON_SIZE }
}

async function insertBin(
  client: pg.Client,
  w: { warehouseId: number; warehouseCode: string; layoutId: number; dockNodeId: number },
  letter: string,
  x: number,
  accessOffsetM: number,
): Promise<WorldBin> {
  const code = `${w.warehouseCode}-${letter}`
  const row = await one<{ id: number }>(
    client,
    `INSERT INTO public.locations
       (parent_id, kind, code, name, materialized_path, is_active, capacity_slots, level_role)
     VALUES ($1, 'BIN', $2, $2, $3, true, 100, 'pick') RETURNING id`,
    [w.warehouseId, code, `${w.warehouseCode}/${code}`],
  )
  await client.query(
    `INSERT INTO public.layout_placements
       (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, $3, 0, 1, 1, 0, $4, $5)`,
    [w.layoutId, row.id, x, w.dockNodeId, accessOffsetM],
  )
  return { id: row.id, code }
}

/** Build the world. Sweeps a previous run's leftovers first. */
export async function seedWorld(): Promise<World> {
  await tearDownWorld()
  return withClient(async (client) => {
    await client.query('BEGIN')
    try {
      const { warehouseCode, warehouseName } = WORLD_NAMES
      const wh = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $2, $1, true, 'racked') RETURNING id`,
        [warehouseCode, warehouseName],
      )
      const layout = await one<{ id: number }>(
        client,
        `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
         VALUES ($1, 'TST-HOME E2E', 'published', 1) RETURNING id`,
        [wh.id],
      )
      await client.query('UPDATE public.locations SET active_layout_id = $1 WHERE id = $2', [layout.id, wh.id])

      // One dock, and every bin reached from it: the smallest graph that gives a
      // bin a walking route from a dock (what the health check's no_dock_route asks).
      const dock = await one<{ id: number }>(
        client,
        `INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
         VALUES ($1, 0, 1, 0, 'dock') RETURNING id`,
        [layout.id],
      )
      await client.query(
        `INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m)
         VALUES ($1, $2, $2, 0)`,
        [layout.id, dock.id],
      )
      await client.query(
        `INSERT INTO public.layout_objects (layout_id, object_type, floor, x, y, w, h, meta)
         VALUES ($1, 'dock', 0, 1, 0, 1, 1, '{}'::jsonb)`,
        [layout.id],
      )

      const base = { warehouseId: wh.id, warehouseCode, layoutId: layout.id, dockNodeId: dock.id }
      // H is the nearest bin to the dock, so without the NX-0032 rule it is also
      // the first bin the planner would offer a product that has no home.
      const h = await insertBin(client, base, 'H', 0, 0.5)
      const x = await insertBin(client, base, 'X', 2, 1.0)
      const y = await insertBin(client, base, 'Y', 3, 1.5)
      const z = await insertBin(client, base, 'Z', 4, 2.0)

      const supplier = await supplierId(client)
      const home = await insertProduct(client, supplier, WORLD_NAMES.homeSku, '200')
      const other = await insertProduct(client, supplier, WORLD_NAMES.otherSku, '300')

      await client.query('COMMIT')
      return {
        warehouseId: wh.id,
        warehouseCode,
        warehouseName,
        layoutId: layout.id,
        bins: { h, x, y, z },
        home,
        other,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/**
 * Remove everything the world and the browser wrote, children first. Looked up by
 * name, so it works after a crash with no `World` in hand, and does nothing when
 * there is nothing to remove.
 */
export async function tearDownWorld(): Promise<void> {
  await withClient(async (client) => {
    const wh = await client.query<{ id: number }>(
      "SELECT id FROM public.locations WHERE kind = 'WAREHOUSE' AND code = $1",
      [WORLD_NAMES.warehouseCode],
    )
    const products = await client.query<{ id: number }>('SELECT id FROM public.products WHERE sku = ANY ($1)', [
      [WORLD_NAMES.homeSku, WORLD_NAMES.otherSku],
    ])
    const warehouseId = wh.rows[0]?.id ?? null
    const productIds = products.rows.map((p) => p.id)
    if (warehouseId === null && productIds.length === 0) return

    await client.query('BEGIN')
    try {
            await client.query('DELETE FROM public.wie_putaway_recommendations WHERE warehouse_id = $1 OR product_id = ANY ($2)', [
        warehouseId,
        productIds,
      ])
      for (const table of ['wie_replen_tasks', 'wie_slotting_suggestions', 'wie_offhome_tasks']) {
        await client.query(`DELETE FROM public.${table} WHERE warehouse_id = $1`, [warehouseId])
      }
      await client.query(
        `DELETE FROM public.inventory_movements WHERE product_id = ANY ($1)
          OR location_id IN (SELECT id FROM public.locations WHERE id = $2 OR materialized_path LIKE $3 || '/%')`,
        [productIds, warehouseId, WORLD_NAMES.warehouseCode],
      )
      await client.query('DELETE FROM public.inventory_balances WHERE product_id = ANY ($1)', [productIds])
      await client.query('DELETE FROM public.goods_receipts WHERE location_id = $1', [warehouseId])
      await client.query('DELETE FROM public.handling_units WHERE warehouse_id = $1', [warehouseId])
      await client.query('DELETE FROM public.product_home_bins WHERE warehouse_id = $1 OR product_id = ANY ($2)', [
        warehouseId,
        productIds,
      ])
      if (warehouseId !== null) {
        await client.query('UPDATE public.locations SET active_layout_id = NULL WHERE id = $1', [warehouseId])
        await client.query('DELETE FROM public.warehouse_layouts WHERE warehouse_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE parent_id = $1', [warehouseId])
        await client.query('DELETE FROM public.locations WHERE id = $1', [warehouseId])
      }
      await client.query('DELETE FROM public.products WHERE id = ANY ($1)', [productIds])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/** Rows left behind for the world's names. Zero everywhere means a clean teardown. */
export async function leftovers(): Promise<Record<string, number>> {
  return withClient(async (client) => {
    const count = async (sql: string, params: unknown[] = []): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, params)).rows[0].n)
    const names = [WORLD_NAMES.homeSku, WORLD_NAMES.otherSku]
    return {
      warehouses: await count("SELECT count(*) n FROM public.locations WHERE code = $1", [WORLD_NAMES.warehouseCode]),
      locationsUnder: await count("SELECT count(*) n FROM public.locations WHERE materialized_path LIKE $1", [
        `${WORLD_NAMES.warehouseCode}/%`,
      ]),
      products: await count('SELECT count(*) n FROM public.products WHERE sku = ANY ($1)', [names]),
      tasks: await count(
        'SELECT count(*) n FROM public.wie_putaway_recommendations r JOIN public.products p ON p.id = r.product_id WHERE p.sku = ANY ($1)',
        [names],
      ),
      balances: await count(
        'SELECT count(*) n FROM public.inventory_balances b JOIN public.products p ON p.id = b.product_id WHERE p.sku = ANY ($1)',
        [names],
      ),
      movements: await count(
        'SELECT count(*) n FROM public.inventory_movements m JOIN public.products p ON p.id = m.product_id WHERE p.sku = ANY ($1)',
        [names],
      ),
    }
  })
}

// ── Reads the spec asserts on ─────────────────────────────────────────────────

export function tasksOf(productId: number): Promise<TaskRow[]> {
  return withClient(async (client) => {
    const r = await client.query<{
      id: string
      status: string
      quantity: number
      recommended_location_id: number | null
      assigned_location_id: number | null
      suggestion_source: string | null
      override_reason: string | null
      explanation: unknown
    }>(
      `SELECT id, status, quantity, recommended_location_id, assigned_location_id,
              suggestion_source, override_reason, explanation
         FROM public.wie_putaway_recommendations WHERE product_id = $1 ORDER BY id`,
      [productId],
    )
    return r.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      quantity: Number(row.quantity),
      recommendedLocationId: row.recommended_location_id,
      assignedLocationId: row.assigned_location_id,
      suggestionSource: row.suggestion_source,
      overrideReason: row.override_reason,
      explanation: row.explanation,
    }))
  })
}

export function homeOf(w: World, productId: number): Promise<HomeRow | null> {
  return withClient(async (client) => {
    const r = await client.query<{ bin_id: number; max_qty: number | null }>(
      `SELECT bin_id, max_qty FROM public.product_home_bins
        WHERE product_id = $1 AND warehouse_id = $2 AND purpose = 'primary'`,
      [productId, w.warehouseId],
    )
    return r.rows[0] ? { binId: r.rows[0].bin_id, maxQty: r.rows[0].max_qty } : null
  })
}

export function onHandAt(productId: number, locationId: number): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ q: number }>(
      'SELECT COALESCE(SUM(on_hand), 0) AS q FROM public.inventory_balances WHERE product_id = $1 AND location_id = $2',
      [productId, locationId],
    )
    return Number(r.rows[0].q)
  })
}

/**
 * Take a bin out of use. SEEDED, not driven through the app: the app (rightly)
 * refuses to deactivate a bin that still holds stock, and this home holds some.
 */
export function deactivateBin(binId: number): Promise<void> {
  return withClient(async (client) => {
    await client.query('UPDATE public.locations SET is_active = false WHERE id = $1', [binId])
  })
}
