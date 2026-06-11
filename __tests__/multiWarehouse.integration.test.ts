/**
 * Multi-warehouse — live RPC integration tests (Phases 1–3).
 *
 * Exercises the warehouse-aware balancing RPCs against the real Supabase DB:
 * closest-first split reservation across warehouses, bin-aware reservation for
 * racked warehouses (allocation lands on the bin), bin→warehouse resolution, and
 * inv_transfer_stock conservation. Every test runs inside BEGIN … ROLLBACK via
 * `withRollbackTx`, so production data is never mutated.
 *
 * Run with: `npm run test:integration` (needs .env.local DB creds + network).
 * Skipped from the default `npm test`.
 */
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient';

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

async function firstId(client: pg.Client, table: string): Promise<number> {
  const r = await client.query<{ id: number }>(`SELECT id FROM public.${table} ORDER BY id LIMIT 1`);
  if (!r.rows[0]) throw new Error(`Seed data missing in ${table}`);
  return r.rows[0].id;
}

async function seedProduct(client: pg.Client, supplierId: number): Promise<number> {
  const sku = `TEST-MW-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.products), $1, $2, 9.99, 'Other', 'EA', 12, $3, 0)
     RETURNING id`,
    [sku, `Sentinel ${sku}`, supplierId],
  );
  return res.rows[0].id;
}

/** Create a WAREHOUSE-kind location of the given type. */
async function seedWarehouse(client: pg.Client, type: 'bulk' | 'racked'): Promise<number> {
  const code = `MW-${type.toUpperCase()}-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $1, $2) RETURNING id`,
    [code, type],
  );
  return res.rows[0].id;
}

async function seedBin(client: pg.Client, warehouseId: number): Promise<{ id: number; path: string }> {
  const wh = await client.query<{ code: string }>('SELECT code FROM public.locations WHERE id=$1', [warehouseId]);
  const code = `${wh.rows[0].code}-BIN-${uniq()}`;
  const path = `${wh.rows[0].code}/${code}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path)
     VALUES ($1, 'BIN', $2, $2, $3) RETURNING id`,
    [warehouseId, code, path],
  );
  return { id: res.rows[0].id, path };
}

/** Put untracked stock straight onto a location (receipt leg). */
async function stockAt(client: pg.Client, productId: number, locationId: number, qty: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [productId, locationId, qty],
  );
}

async function balanceAt(client: pg.Client, productId: number, locationId: number): Promise<{ on_hand: number; allocated: number }> {
  const r = await client.query<{ on_hand: number; allocated: number }>(
    `SELECT COALESCE(SUM(on_hand),0) AS on_hand, COALESCE(SUM(allocated),0) AS allocated
     FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2`,
    [productId, locationId],
  );
  return { on_hand: Number(r.rows[0].on_hand), allocated: Number(r.rows[0].allocated) };
}

describe.skipIf(!hasDbCreds())('multi-warehouse (live RPCs, rollback-isolated)', () => {
  it('reserves closest-first and SPLITS across warehouses when the first is short', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client, 'bulk');
      const w2 = await seedWarehouse(client, 'bulk');
      await stockAt(client, productId, w1, 4); // short
      await stockAt(client, productId, w2, 100);

      const orderId = `TEST-MW-ORD-${uniq()}`;
      await client.query(
        `SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], NULL, false)`,
        [orderId, JSON.stringify([{ product_id: productId, quantity: 10 }]), [w1, w2]],
      );

      // 4 from the (closer) first warehouse, remaining 6 from the second.
      expect((await balanceAt(client, productId, w1)).allocated).toBe(4);
      expect((await balanceAt(client, productId, w2)).allocated).toBe(6);
    });
  });

  it('raises INSUFFICIENT_STOCK (and rolls back) when no warehouse can cover and partial is off', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client, 'bulk');
      await stockAt(client, productId, w1, 3);

      const orderId = `TEST-MW-ORD-${uniq()}`;
      await expectRaise(
        client,
        `SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], NULL, false)`,
        [orderId, JSON.stringify([{ product_id: productId, quantity: 10 }]), [w1]],
        /INSUFFICIENT_STOCK/,
      );
      // No allocation persisted (the statement aborted).
      expect((await balanceAt(client, productId, w1)).allocated).toBe(0);
    });
  });

  it('reserving at a RACKED warehouse allocates on its BIN, resolvable back to the warehouse', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client, 'racked');
      const bin = await seedBin(client, wh);
      await stockAt(client, productId, bin.id, 50);

      const orderId = `TEST-MW-ORD-${uniq()}`;
      await client.query(
        `SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], NULL, false)`,
        [orderId, JSON.stringify([{ product_id: productId, quantity: 8 }]), [wh]],
      );

      // Allocation landed on the bin, not the warehouse root.
      expect((await balanceAt(client, productId, bin.id)).allocated).toBe(8);
      expect((await balanceAt(client, productId, wh)).allocated).toBe(0);

      // Bin resolves to its warehouse, and the order's fulfilment warehouse is it.
      const root = await client.query<{ r: number }>('SELECT public.inv_root_warehouse($1) AS r', [bin.id]);
      expect(root.rows[0].r).toBe(wh);
      const ffw = await client.query<{ warehouse_id: number }>(
        'SELECT warehouse_id FROM public.inv_order_fulfilment_warehouses($1)', [orderId],
      );
      expect(ffw.rows.map((x) => x.warehouse_id)).toContain(wh);

      // Reserved but not picked → not complete.
      const complete = await client.query<{ c: boolean }>(
        'SELECT public.inv_warehouse_pick_complete($1, $2) AS c', [orderId, wh],
      );
      expect(complete.rows[0].c).toBe(false);
    });
  });

  it('inv_transfer_stock conserves total on_hand and moves available stock between sites', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client, 'bulk');
      const w2 = await seedWarehouse(client, 'bulk');
      await stockAt(client, productId, w1, 40);

      await client.query('SELECT public.inv_transfer_stock($1, $2, $3, $4, NULL, $5)', [productId, w1, w2, 15, 'test']);

      expect((await balanceAt(client, productId, w1)).on_hand).toBe(25);
      expect((await balanceAt(client, productId, w2)).on_hand).toBe(15);
    });
  });

  it('inv_transfer_stock raises INSUFFICIENT_STOCK when the source lacks available stock', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client, 'bulk');
      const w2 = await seedWarehouse(client, 'bulk');
      await stockAt(client, productId, w1, 5);

      await expectRaise(
        client,
        'SELECT public.inv_transfer_stock($1, $2, $3, $4, NULL, NULL)',
        [productId, w1, w2, 20],
        /INSUFFICIENT_STOCK/,
      );
    });
  });
});
