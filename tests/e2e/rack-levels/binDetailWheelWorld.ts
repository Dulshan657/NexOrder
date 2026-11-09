// Made-up world for the NX-0033 Bin detail wheel spec (bin-detail-wheel).
//
// One racked warehouse with a published layout, ONE bin, and enough products
// stocked in that bin that its detail panel is taller than the panel is allowed
// to be. Everything is invented (TST-WALK-WHL-*) and `tearDownWorld` removes
// every row it wrote, by name, so a crashed run leaves nothing a re-run cannot
// sweep first.
//
// Deliberately small and local: the shared putaway-walk world (walkWorld.ts, Task
// 12) is not needed to prove a scroll box, and this file can be folded into it
// when that lands.
//
// Direct SQL, through the integration suite's guarded connection: it refuses a
// tenant's database outright (see __tests__/support/loadEnv.ts), which is the same
// promise playwright.config.ts makes for the browser side.
import type pg from 'pg'
import { connect } from '../../../__tests__/support/pgTestClient'

export const WHEEL_NAMES = {
  warehouseCode: 'TST-WALK-WHL',
  warehouseName: 'TST-WALK Wheel Warehouse',
  binCode: 'TST-WALK-WHL-B1',
  binName: 'TST-WALK Wheel Bin',
  /** `TST-WALK-WHL-P01` .. `TST-WALK-WHL-Pnn` */
  skuPrefix: 'TST-WALK-WHL-P',
  supplierName: 'E2E Test Supplier',
} as const

/** Enough rows that the detail overflows a 70svh panel at any laptop viewport. */
export const PRODUCT_COUNT = 40

export interface WheelWorld {
  readonly warehouseId: number
  readonly warehouseCode: string
  readonly warehouseName: string
  readonly binId: number
  readonly binCode: string
  readonly binName: string
  readonly productNames: readonly string[]
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
    WHEEL_NAMES.supplierName,
  ])
  if (found.rows[0]) return found.rows[0].id
  const made = await one<{ id: number }>(
    client,
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', '', '') RETURNING id`,
    [WHEEL_NAMES.supplierName],
  )
  return made.id
}

const productName = (n: number): string => `TST-WALK Wheel Product ${String(n).padStart(2, '0')}`

/** Build the world. Sweeps a previous run's leftovers first. */
export async function seedWheelWorld(): Promise<WheelWorld> {
  await tearDownWheelWorld()
  return withClient(async (client) => {
    await client.query('BEGIN')
    try {
      const { warehouseCode, warehouseName, binCode, binName, skuPrefix } = WHEEL_NAMES
      const wh = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
         VALUES (NULL, 'WAREHOUSE', $1, $2, $1, true, 'racked') RETURNING id`,
        [warehouseCode, warehouseName],
      )
      const layout = await one<{ id: number }>(
        client,
        `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
         VALUES ($1, 'TST-WALK wheel', 'published', 1) RETURNING id`,
        [wh.id],
      )
      await client.query('UPDATE public.locations SET active_layout_id = $1 WHERE id = $2', [layout.id, wh.id])

      const bin = await one<{ id: number }>(
        client,
        `INSERT INTO public.locations
           (parent_id, kind, code, name, materialized_path, is_active, capacity_slots, level_role)
         VALUES ($1, 'BIN', $2, $3, $4, true, 1000, 'pick') RETURNING id`,
        [wh.id, binCode, binName, `${warehouseCode}/${binCode}`],
      )
      await client.query(
        `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation)
         VALUES ($1, $2, 0, 0, 0, 1, 1, 0)`,
        [layout.id, bin.id],
      )

      const supplier = await supplierId(client)
      const products = await client.query<{ id: number }>(
        `INSERT INTO public.products
           (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor, barcode)
         SELECT (SELECT COALESCE(MAX(id),0) FROM public.products) + g,
                $1 || lpad(g::text, 2, '0'),
                'TST-WALK Wheel Product ' || lpad(g::text, 2, '0'),
                5, 'Other', 'EA', 1, $2, 0, 1,
                'TSTWALKWHL' || lpad(g::text, 2, '0')
           FROM generate_series(1, $3::int) g
         RETURNING id`,
        [skuPrefix, supplier, PRODUCT_COUNT],
      )
      await client.query(
        `INSERT INTO public.inventory_balances (product_id, location_id, on_hand)
         SELECT unnest($1::int[]), $2, 3`,
        [products.rows.map((r) => r.id), bin.id],
      )

      await client.query('COMMIT')
      return {
        warehouseId: wh.id,
        warehouseCode,
        warehouseName,
        binId: bin.id,
        binCode,
        binName,
        productNames: Array.from({ length: PRODUCT_COUNT }, (_, i) => productName(i + 1)),
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  })
}

/**
 * Remove everything the world wrote, children first. Looked up by name, so it
 * works after a crash with no `WheelWorld` in hand, and does nothing when there
 * is nothing to remove.
 */
export async function tearDownWheelWorld(): Promise<void> {
  await withClient(async (client) => {
    await client.query('BEGIN')
    try {
      const wh = await client.query<{ id: number }>(
        "SELECT id FROM public.locations WHERE kind = 'WAREHOUSE' AND code = $1",
        [WHEEL_NAMES.warehouseCode],
      )
      const warehouseId = wh.rows[0]?.id ?? null
      const locations = await client.query<{ id: number }>(
        "SELECT id FROM public.locations WHERE id = $1 OR materialized_path LIKE $2 || '/%'",
        [warehouseId, WHEEL_NAMES.warehouseCode],
      )
      const locationIds = locations.rows.map((r) => r.id)
      const products = await client.query<{ id: number }>('SELECT id FROM public.products WHERE sku LIKE $1', [
        `${WHEEL_NAMES.skuPrefix}%`,
      ])
      const productIds = products.rows.map((r) => r.id)

      await client.query('DELETE FROM public.inventory_movements WHERE product_id = ANY ($1) OR location_id = ANY ($2)', [
        productIds,
        locationIds,
      ])
      await client.query('DELETE FROM public.inventory_balances WHERE product_id = ANY ($1) OR location_id = ANY ($2)', [
        productIds,
        locationIds,
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

/** Rows of the world still on dev: all zero after a clean teardown. */
export function wheelLeftovers(): Promise<Record<string, number>> {
  return withClient(async (client) => {
    const count = async (sql: string, params: unknown[]): Promise<number> =>
      Number((await client.query<{ n: string }>(sql, params)).rows[0].n)
    return {
      locations: await count('SELECT count(*) n FROM public.locations WHERE code LIKE $1', [`${WHEEL_NAMES.warehouseCode}%`]),
      products: await count('SELECT count(*) n FROM public.products WHERE sku LIKE $1', [`${WHEEL_NAMES.skuPrefix}%`]),
      balances: await count(
        `SELECT count(*) n FROM public.inventory_balances b
           JOIN public.locations l ON l.id = b.location_id WHERE l.code LIKE $1`,
        [`${WHEEL_NAMES.warehouseCode}%`],
      ),
      layouts: await count(
        `SELECT count(*) n FROM public.warehouse_layouts WHERE name = 'TST-WALK wheel'`,
        [],
      ),
    }
  })
}
