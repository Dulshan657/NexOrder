/**
 * Inventory balancing — live RPC integration tests.
 *
 * Verifies the Postgres inv_* RPCs (the entire balancing engine) against the real
 * Supabase database. Every test runs inside BEGIN … ROLLBACK via `withRollbackTx`,
 * so production data is NEVER mutated. A throwaway "sentinel" product/order is
 * created per test and rolled back.
 *
 * These exercise the actual SQL — FIFO allocation, allocate/pick/release math, the
 * generated `available = on_hand - allocated` column, the products.inventory cache,
 * and the error paths (INSUFFICIENT_STOCK / OVER_PICK) with atomicity guarantees.
 *
 * Run with: `npm run test:integration` (needs .env.local DB creds + network).
 * Excluded from the default `npm test`.
 */
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { hasDbCreds, withRollbackTx, expectRaise } from './support/pgTestClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

interface Refs {
  supplierId: number;
  horecaId: number;
  profileId: string;
}

async function getRefs(client: pg.Client): Promise<Refs> {
  const supplier = await client.query<{ id: number }>(
    'SELECT id FROM public.suppliers ORDER BY id LIMIT 1',
  );
  const horeca = await client.query<{ id: number }>(
    'SELECT id FROM public.horecas ORDER BY id LIMIT 1',
  );
  const profile = await client.query<{ id: string }>(
    'SELECT id FROM public.profiles ORDER BY id LIMIT 1',
  );
  if (!supplier.rows[0] || !horeca.rows[0] || !profile.rows[0]) {
    throw new Error('Seed data missing: need at least one supplier, horeca, and profile');
  }
  return {
    supplierId: supplier.rows[0].id,
    horecaId: horeca.rows[0].id,
    profileId: profile.rows[0].id,
  };
}

/**
 * Create a sentinel product (zero balance rows — a brand-new product).
 *
 * Uses an explicit MAX(id)+1 rather than the SERIAL default: the seed upserts
 * products with explicit ids, so `products_id_seq` lags behind MAX(id) and
 * nextval() would collide. (setval would heal it but persists past ROLLBACK, so
 * we avoid mutating the sequence.)
 */
async function seedProduct(client: pg.Client, refs: Refs): Promise<number> {
  const sku = `TEST-INV-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.products), $1, $2, 9.99, 'Other', 'EA', 12, $3, 0)
     RETURNING id`,
    [sku, `Sentinel ${sku}`, refs.supplierId],
  );
  return res.rows[0].id;
}

/** Receive two FIFO lots: L1 (100 @ expiry 2026-09-01), L2 (50 @ expiry 2026-12-01). */
async function receiveTwoLots(client: pg.Client, productId: number): Promise<void> {
  const lines = [
    { product_id: productId, quantity: 100, lot_code: `L1-${uniq()}`, expiry_date: '2026-09-01' },
    { product_id: productId, quantity: 50, lot_code: `L2-${uniq()}`, expiry_date: '2026-12-01' },
  ];
  await client.query('SELECT public.inv_receive_stock($1::jsonb, NULL)', [JSON.stringify(lines)]);
}

async function seedOrder(
  client: pg.Client,
  refs: Refs,
  productId: number,
  quantity: number,
): Promise<{ orderId: string; orderItemId: number }> {
  const orderId = `TEST-ORD-${uniq()}`;
  await client.query(
    `INSERT INTO public.orders (id, horeca_id, submitted_by, total, status)
     VALUES ($1, $2, $3, $4, 'processing')`,
    [orderId, refs.horecaId, refs.profileId, (quantity * 9.99).toFixed(2)],
  );
  const item = await client.query<{ id: number }>(
    `INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price, product_name, product_sku)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.order_items), $1, $2, $3, 9.99, 'Sentinel', 'SENT')
     RETURNING id`,
    [orderId, productId, quantity],
  );
  return { orderId, orderItemId: item.rows[0].id };
}

interface BalanceRow {
  batch_id: number | null;
  lot_code: string | null;
  on_hand: number;
  allocated: number;
  available: number;
}

/** Balance rows for a product, in FIFO order (earliest expiry first). */
async function getBalances(client: pg.Client, productId: number): Promise<BalanceRow[]> {
  const res = await client.query<BalanceRow>(
    `SELECT b.batch_id, bt.lot_code, b.on_hand, b.allocated, b.available
     FROM public.inventory_balances b
     LEFT JOIN public.batches bt ON bt.id = b.batch_id
     WHERE b.product_id = $1
     ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id`,
    [productId],
  );
  return res.rows;
}

async function getCache(client: pg.Client, productId: number): Promise<number> {
  const res = await client.query<{ inventory: number }>(
    'SELECT inventory FROM public.products WHERE id = $1',
    [productId],
  );
  return res.rows[0].inventory;
}

async function getMovements(
  client: pg.Client,
  productId: number,
  type: string,
): Promise<number[]> {
  const res = await client.query<{ qty_delta: number }>(
    `SELECT qty_delta FROM public.inventory_movements
     WHERE product_id = $1 AND movement_type = $2
     ORDER BY id`,
    [productId, type],
  );
  return res.rows.map((r) => r.qty_delta);
}

/** Assert the structural invariants that "balancing works" depends on. */
async function assertInvariants(client: pg.Client, productId: number): Promise<void> {
  const rows = await getBalances(client, productId);
  let sumOnHand = 0;
  for (const r of rows) {
    expect(r.available).toBe(r.on_hand - r.allocated);
    expect(r.allocated).toBeLessThanOrEqual(r.on_hand);
    expect(r.on_hand).toBeGreaterThanOrEqual(0);
    expect(r.allocated).toBeGreaterThanOrEqual(0);
    sumOnHand += r.on_hand;
  }
  expect(await getCache(client, productId)).toBe(sumOnHand);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDbCreds())('inventory balancing (live RPCs, rollback-isolated)', () => {
  it('1. receive: on_hand rises per batch, cache = SUM(on_hand), ledger records receipts', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);

      await receiveTwoLots(client, productId);

      const rows = await getBalances(client, productId);
      expect(rows).toHaveLength(2);
      // FIFO order: L1 (earlier expiry) first.
      expect(rows[0]).toMatchObject({ on_hand: 100, allocated: 0, available: 100 });
      expect(rows[1]).toMatchObject({ on_hand: 50, allocated: 0, available: 50 });
      expect(rows[0].batch_id).not.toBeNull();
      expect(rows[1].batch_id).not.toBeNull();

      expect(await getCache(client, productId)).toBe(150);
      expect(await getMovements(client, productId, 'receipt')).toEqual([100, 50]);
      await assertInvariants(client, productId);
    });
  });

  it('2. reserve (strict): allocates FIFO, raises allocated, leaves on_hand untouched', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId);
      const { orderId } = await seedOrder(client, refs, productId, 120);

      await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, false)', [
        orderId,
        JSON.stringify([{ product_id: productId, quantity: 120 }]),
      ]);

      const rows = await getBalances(client, productId);
      // FIFO: L1 fully allocated (100), L2 gets the remaining 20.
      expect(rows[0]).toMatchObject({ on_hand: 100, allocated: 100, available: 0 });
      expect(rows[1]).toMatchObject({ on_hand: 50, allocated: 20, available: 30 });

      const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
      const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
      expect(totalAllocated).toBe(120);
      expect(totalAvailable).toBe(30);
      // on_hand unchanged by a reservation; cache tracks on_hand only.
      expect(await getCache(client, productId)).toBe(150);
      expect(await getMovements(client, productId, 'allocate')).toEqual([100, 20]);
      await assertInvariants(client, productId);
    });
  });

  it('3. reserve insufficient (strict): raises INSUFFICIENT_STOCK and leaks no partial allocation', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId); // 150 available
      const { orderId } = await seedOrder(client, refs, productId, 200);

      await expectRaise(
        client,
        'SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, false)',
        [orderId, JSON.stringify([{ product_id: productId, quantity: 200 }])],
        /INSUFFICIENT_STOCK/,
      );

      // After the savepoint rollback, NOTHING should have been allocated (atomic).
      const rows = await getBalances(client, productId);
      expect(rows.reduce((s, r) => s + r.allocated, 0)).toBe(0);
      expect(rows.reduce((s, r) => s + r.available, 0)).toBe(150);
      await assertInvariants(client, productId);
    });
  });

  it('4. reserve partial (allow_partial): allocates all available, backorders the rest, no error', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId); // 150 available
      const { orderId } = await seedOrder(client, refs, productId, 200);

      await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, true)', [
        orderId,
        JSON.stringify([{ product_id: productId, quantity: 200 }]),
      ]);

      const rows = await getBalances(client, productId);
      expect(rows.reduce((s, r) => s + r.allocated, 0)).toBe(150);
      expect(rows.reduce((s, r) => s + r.available, 0)).toBe(0);
      // 50 backordered — not represented in balances; on_hand still 150.
      expect(await getCache(client, productId)).toBe(150);
      await assertInvariants(client, productId);
    });
  });

  it('5. pick: decrements on_hand + allocated FIFO, records pick, reports fully picked', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId);
      const { orderId, orderItemId } = await seedOrder(client, refs, productId, 120);
      await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, false)', [
        orderId,
        JSON.stringify([{ product_id: productId, quantity: 120 }]),
      ]);

      const pick = await client.query<{ inv_pick_order_line: { line_fully_picked: boolean; order_fully_picked: boolean } }>(
        'SELECT public.inv_pick_order_line($1, $2, NULL)',
        [orderItemId, 120],
      );
      expect(pick.rows[0].inv_pick_order_line).toEqual({
        line_fully_picked: true,
        order_fully_picked: true,
      });

      const rows = await getBalances(client, productId);
      // L1 fully drawn (100 on_hand + 100 alloc gone), L2 drops 20 on_hand + 20 alloc.
      expect(rows[0]).toMatchObject({ on_hand: 0, allocated: 0, available: 0 });
      expect(rows[1]).toMatchObject({ on_hand: 30, allocated: 0, available: 30 });
      expect(await getCache(client, productId)).toBe(30);
      expect(await getMovements(client, productId, 'pick')).toEqual([-100, -20]);

      const picks = await client.query<{ picked_qty: number }>(
        'SELECT picked_qty FROM public.pick_progress WHERE order_item_id = $1',
        [orderItemId],
      );
      expect(picks.rows.map((r) => r.picked_qty)).toEqual([120]);
      await assertInvariants(client, productId);
    });
  });

  it('6. over-pick guard: picking beyond the ordered qty raises OVER_PICK atomically', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId);
      const { orderId, orderItemId } = await seedOrder(client, refs, productId, 120);
      await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, false)', [
        orderId,
        JSON.stringify([{ product_id: productId, quantity: 120 }]),
      ]);
      await client.query('SELECT public.inv_pick_order_line($1, $2, NULL)', [orderItemId, 120]);

      // Line already fully picked — one more unit must be rejected.
      await expectRaise(
        client,
        'SELECT public.inv_pick_order_line($1, $2, NULL)',
        [orderItemId, 1],
        /OVER_PICK/,
      );

      // State unchanged after the failed over-pick.
      const rows = await getBalances(client, productId);
      expect(rows[1].on_hand).toBe(30);
      await assertInvariants(client, productId);
    });
  });

  it('7. release reservation: deallocates the unpicked remainder, restoring availability', async () => {
    await withRollbackTx(async (client) => {
      const refs = await getRefs(client);
      const productId = await seedProduct(client, refs);
      await receiveTwoLots(client, productId);
      const { orderId } = await seedOrder(client, refs, productId, 120);
      await client.query('SELECT public.inv_reserve_order($1, $2::jsonb, NULL::int[], NULL::uuid, false)', [
        orderId,
        JSON.stringify([{ product_id: productId, quantity: 120 }]),
      ]);

      await client.query('SELECT public.inv_release_reservation($1, NULL)', [orderId]);

      const rows = await getBalances(client, productId);
      expect(rows.reduce((s, r) => s + r.allocated, 0)).toBe(0);
      expect(rows.reduce((s, r) => s + r.available, 0)).toBe(150);
      expect(await getCache(client, productId)).toBe(150);
      const deallocs = await getMovements(client, productId, 'deallocate');
      expect(deallocs.reduce((s, d) => s + d, 0)).toBe(-120);
      await assertInvariants(client, productId);
    });
  });
});
