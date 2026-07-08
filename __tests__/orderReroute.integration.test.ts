/**
 * Order re-route (operator "Override primary warehouse") — live RPC integration tests.
 *
 * Regression cover for the P1 fulfilment-orphan bug: when an order is re-routed
 * at the Process step, the origin reservation is released and re-reserved at the
 * target. inv_order_fulfilment_warehouses MUST then return only warehouses with a
 * positive NET reservation (allocate − deallocate), so the origin — now net-zero —
 * is dropped and no phantom 'processed' fulfilment row is created (which would
 * freeze orders.status at 'processed' forever).
 *
 * Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`, so production data
 * is never mutated. Run with `npm run test:integration` (needs .env.local creds).
 */
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { hasDbCreds, withRollbackTx } from './support/pgTestClient';

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
  const sku = `TEST-RR-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.products), $1, $2, 9.99, 'Other', 'EA', 12, $3, 0)
     RETURNING id`,
    [sku, `Sentinel ${sku}`, supplierId],
  );
  return res.rows[0].id;
}

async function seedWarehouse(client: pg.Client): Promise<number> {
  const code = `RR-BULK-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $1, 'bulk') RETURNING id`,
    [code],
  );
  return res.rows[0].id;
}

async function stockAt(client: pg.Client, productId: number, locationId: number, qty: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [productId, locationId, qty],
  );
}

/**
 * A real order + single line. inv_release_reservation derives the reserved
 * remainder from order_items, so a release is a no-op without these rows.
 */
async function seedOrder(client: pg.Client, productId: number, qty: number): Promise<string> {
  const orderId = `TEST-RR-ORD-${uniq()}`;
  const horecaId = await firstId(client, 'horecas');
  const profile = await client.query<{ id: string }>('SELECT id FROM public.profiles ORDER BY id LIMIT 1');
  if (!profile.rows[0]) throw new Error('Seed data missing in profiles');
  await client.query(
    `INSERT INTO public.orders (id, horeca_id, submitted_by, total, status)
     VALUES ($1, $2, $3, $4, 'processing')`,
    [orderId, horecaId, profile.rows[0].id, 9.99 * qty],
  );
  await client.query(
    `INSERT INTO public.order_items (order_id, product_id, quantity, pack_size, unit_price, product_name, product_sku)
     VALUES ($1, $2, $3, 1, 9.99, 'RRTEST', $4)`,
    [orderId, productId, qty, `RRTEST-${orderId}`],
  );
  return orderId;
}

async function reserve(client: pg.Client, orderId: string, productId: number, qty: number, pref: number[]): Promise<void> {
  await client.query(
    `SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], NULL, true)`,
    [orderId, JSON.stringify([{ product_id: productId, quantity: qty }]), pref],
  );
}

async function fulfilmentWarehouses(client: pg.Client, orderId: string): Promise<number[]> {
  const r = await client.query<{ warehouse_id: number }>(
    'SELECT warehouse_id FROM public.inv_order_fulfilment_warehouses($1) ORDER BY warehouse_id',
    [orderId],
  );
  return r.rows.map((x) => x.warehouse_id);
}

describe.skipIf(!hasDbCreds())('order re-route — fulfilment warehouses reflect NET reservation', () => {
  it('drops the origin warehouse after a full release + re-reserve elsewhere', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client);
      const w2 = await seedWarehouse(client);
      await stockAt(client, productId, w1, 100);
      await stockAt(client, productId, w2, 100);

      const orderId = await seedOrder(client, productId, 10);
      // Original reservation at W1.
      await reserve(client, orderId, productId, 10, [w1]);
      expect(await fulfilmentWarehouses(client, orderId)).toEqual([w1]);

      // Operator override: release everything, re-reserve at W2.
      await client.query('SELECT public.inv_release_reservation($1, NULL, NULL)', [orderId]);
      await reserve(client, orderId, productId, 10, [w2]);

      // Only W2 should now be a fulfilment site. Pre-fix this returned [w1, w2].
      expect(await fulfilmentWarehouses(client, orderId)).toEqual([w2]);
    });
  });

  it('keeps both warehouses when a re-route only partially moves stock', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client);
      const w2 = await seedWarehouse(client);
      await stockAt(client, productId, w1, 100);
      await stockAt(client, productId, w2, 100);

      const orderId = await seedOrder(client, productId, 10);
      await reserve(client, orderId, productId, 10, [w1]);

      // Release only W1, then re-reserve 4 back at W1 and the rest at W2 (closest-first
      // from W1). Net reservation now spans both, so both remain fulfilment sites.
      await client.query('SELECT public.inv_release_reservation($1, $2, NULL)', [orderId, w1]);
      await reserve(client, orderId, productId, 4, [w1]);
      await reserve(client, orderId, productId, 6, [w2]);

      expect(await fulfilmentWarehouses(client, orderId)).toEqual([w1, w2].sort((a, b) => a - b));
    });
  });

  it('excludes a warehouse whose reservation is fully released', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const w1 = await seedWarehouse(client);
      await stockAt(client, productId, w1, 50);

      const orderId = await seedOrder(client, productId, 10);
      await reserve(client, orderId, productId, 10, [w1]);
      expect(await fulfilmentWarehouses(client, orderId)).toEqual([w1]);

      await client.query('SELECT public.inv_release_reservation($1, NULL, NULL)', [orderId]);
      // Net reservation is now zero everywhere → no fulfilment warehouses.
      expect(await fulfilmentWarehouses(client, orderId)).toEqual([]);
    });
  });
});
