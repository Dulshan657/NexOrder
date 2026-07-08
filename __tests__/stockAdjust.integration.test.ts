/**
 * Stock adjustments — live RPC integration tests (Phase A).
 *
 * Exercises inv_adjust_stock (migration 00062) against the real Supabase DB:
 * positive/negative adjustments, a stocktake-variance set-count (computed the
 * same way the adjust-stock Edge Function computes it — delta = newCount -
 * currentOnHand), the reason-required and non-zero-delta guards, and the
 * ADJUSTMENT_BELOW_ALLOCATED guard when a negative delta would take on_hand
 * below what's already reserved. Every test runs inside BEGIN … ROLLBACK via
 * `withRollbackTx`, so production data is never mutated.
 *
 * Run with: `npm run test:integration` (needs .env.local DB creds + network,
 * AND migration 00062 applied). Skipped from the default `npm test` (matches
 * __tests__/multiWarehouse.integration.test.ts).
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
  const sku = `TEST-ADJ-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.products), $1, $2, 9.99, 'Other', 'EA', 12, $3, 0)
     RETURNING id`,
    [sku, `Sentinel ${sku}`, supplierId],
  );
  return res.rows[0].id;
}

/** Create a WAREHOUSE-kind location (bulk — stock lives at the root). */
async function seedWarehouse(client: pg.Client): Promise<number> {
  const code = `ADJ-WH-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, location_type, is_active)
     VALUES (NULL, 'WAREHOUSE', $1, $1, $1, 'bulk', true) RETURNING id`,
    [code],
  );
  return res.rows[0].id;
}

/** Put untracked stock straight onto a location (a receipt leg, bypassing
 * inv_adjust_stock so the "before" state is set up independently of the code
 * under test). */
async function stockAt(client: pg.Client, productId: number, locationId: number, qty: number): Promise<void> {
  await client.query(
    `SELECT public.inv_apply_leg($1, $2, NULL, $3, 0, 'receipt', NULL, 'test', NULL, NULL)`,
    [productId, locationId, qty],
  );
}

async function balanceAt(
  client: pg.Client,
  productId: number,
  locationId: number,
): Promise<{ on_hand: number; allocated: number }> {
  const r = await client.query<{ on_hand: number; allocated: number }>(
    `SELECT COALESCE(SUM(on_hand),0) AS on_hand, COALESCE(SUM(allocated),0) AS allocated
     FROM public.inventory_balances WHERE product_id=$1 AND location_id=$2`,
    [productId, locationId],
  );
  return { on_hand: Number(r.rows[0].on_hand), allocated: Number(r.rows[0].allocated) };
}

async function getCache(client: pg.Client, productId: number): Promise<number> {
  const res = await client.query<{ inventory: number }>('SELECT inventory FROM public.products WHERE id = $1', [productId]);
  return res.rows[0].inventory;
}

async function getMovementTypes(client: pg.Client, productId: number, locationId: number): Promise<string[]> {
  const res = await client.query<{ movement_type: string }>(
    `SELECT movement_type FROM public.inventory_movements
     WHERE product_id = $1 AND location_id = $2 AND ref_type = 'adjustment'
     ORDER BY id`,
    [productId, locationId],
  );
  return res.rows.map((r) => r.movement_type);
}

interface AdjustOpts {
  batchId?: number | null;
  movementType?: 'adjustment' | 'stocktake_variance';
}

async function adjustStock(
  client: pg.Client,
  productId: number,
  locationId: number,
  qtyDelta: number,
  reason: string | null,
  opts: AdjustOpts = {},
): Promise<{ before_on_hand: number; after_on_hand: number }> {
  const res = await client.query(
    `SELECT public.inv_adjust_stock($1, $2, $3, $4, NULL, $5, $6) AS r`,
    [productId, locationId, qtyDelta, reason, opts.batchId ?? null, opts.movementType ?? 'adjustment'],
  );
  return res.rows[0].r;
}

describe.skipIf(!hasDbCreds())('stock adjustments (live RPC, rollback-isolated)', () => {
  it('positive adjustment: raises on_hand, records an "adjustment" movement, recomputes the cache', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 20);

      const result = await adjustStock(client, productId, wh, 5, 'Found stock during cycle count');

      expect(result.before_on_hand).toBe(20);
      expect(result.after_on_hand).toBe(25);
      expect((await balanceAt(client, productId, wh)).on_hand).toBe(25);
      expect(await getCache(client, productId)).toBe(25);
      expect(await getMovementTypes(client, productId, wh)).toEqual(['adjustment']);
    });
  });

  it('negative adjustment (within bounds): lowers on_hand and the cache', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 20);

      const result = await adjustStock(client, productId, wh, -8, 'Damaged in transit');

      expect(result.after_on_hand).toBe(12);
      expect((await balanceAt(client, productId, wh)).on_hand).toBe(12);
      expect(await getCache(client, productId)).toBe(12);
    });
  });

  it('set-count mode: delta computed as newCount - currentOnHand records a stocktake_variance', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 50);

      // Mirrors what the adjust-stock Edge Function does in set_count mode:
      // load current on_hand, compute delta = newCount - onHand, force the
      // stocktake_variance movement type.
      const before = await balanceAt(client, productId, wh);
      const newCount = 47;
      const delta = newCount - before.on_hand;

      const result = await adjustStock(client, productId, wh, delta, 'Stocktake 2026-07', {
        movementType: 'stocktake_variance',
      });

      expect(result.after_on_hand).toBe(47);
      expect(await getMovementTypes(client, productId, wh)).toEqual(['stocktake_variance']);
    });
  });

  it('rejects a blank reason with a clean, catchable INVALID_ADJUSTMENT error', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 20);

      await expectRaise(
        client,
        `SELECT public.inv_adjust_stock($1, $2, $3, $4, NULL)`,
        [productId, wh, 5, '   '],
        /INVALID_ADJUSTMENT/,
      );
      // Nothing was written by the failed call.
      expect((await balanceAt(client, productId, wh)).on_hand).toBe(20);
    });
  });

  it('rejects a zero delta with INVALID_ADJUSTMENT', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 20);

      await expectRaise(
        client,
        `SELECT public.inv_adjust_stock($1, $2, $3, $4, NULL)`,
        [productId, wh, 0, 'no-op'],
        /INVALID_ADJUSTMENT/,
      );
    });
  });

  it('raises ADJUSTMENT_BELOW_ALLOCATED (not a raw 23514) when a negative delta would drop on_hand below allocated', async () => {
    await withRollbackTx(async (client) => {
      const supplierId = await firstId(client, 'suppliers');
      const productId = await seedProduct(client, supplierId);
      const wh = await seedWarehouse(client);
      await stockAt(client, productId, wh, 20);

      // Reserve 15 of the 20 on hand (allocated = 15), leaving 5 available.
      const orderId = `TEST-ADJ-ORD-${uniq()}`;
      await client.query(
        `SELECT public.inv_reserve_order($1, $2::jsonb, ARRAY[$3]::int[], NULL, false)`,
        [orderId, JSON.stringify([{ product_id: productId, quantity: 15 }]), wh],
      );
      expect((await balanceAt(client, productId, wh)).allocated).toBe(15);

      // Removing 10 would take on_hand to 10, below the 15 already allocated.
      await expectRaise(
        client,
        `SELECT public.inv_adjust_stock($1, $2, $3, $4, NULL)`,
        [productId, wh, -10, 'Shrinkage'],
        /ADJUSTMENT_BELOW_ALLOCATED/,
      );

      // Balance is untouched after the rejected adjustment (atomic).
      const after = await balanceAt(client, productId, wh);
      expect(after.on_hand).toBe(20);
      expect(after.allocated).toBe(15);
    });
  });
});
