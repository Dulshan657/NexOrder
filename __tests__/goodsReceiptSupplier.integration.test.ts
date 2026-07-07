/**
 * Goods-receipt supplier capture — live RPC integration tests.
 *
 * Verifies that inv_receive_stock records WHICH supplier supplied received goods
 * on EVERY receipt — including untracked (no lot) receipts, where the supplier
 * was previously dropped — and that a per-line supplier overrides the header.
 *
 * Like inventoryBalancing.integration.test.ts, every test runs inside
 * BEGIN … ROLLBACK via `withRollbackTx`, so production data is never mutated.
 *
 * Run with: `npm run test:integration` (needs .env.local DB creds + network).
 * Excluded from the default `npm test`.
 */
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { hasDbCreds, withRollbackTx } from './support/pgTestClient';

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

async function firstProfileId(client: pg.Client): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM public.profiles ORDER BY id LIMIT 1',
  );
  if (!res.rows[0]) throw new Error('Seed data missing: need at least one profile');
  return res.rows[0].id;
}

async function seedSupplier(client: pg.Client, label: string): Promise<number> {
  // Unique email per seed — suppliers.email has a UNIQUE constraint, so empty
  // strings collide with each other and with existing rows.
  const token = uniq();
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.suppliers), $1, '', $2, '')
     RETURNING id`,
    [`Sentinel Supplier ${label} ${token}`, `sentinel-${token}@test.local`],
  );
  return res.rows[0].id;
}

async function seedProduct(client: pg.Client, supplierId: number): Promise<number> {
  const sku = `TEST-GR-${uniq()}`;
  const res = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM public.products), $1, $2, 9.99, 'Other', 'EA', 12, $3, 0)
     RETURNING id`,
    [sku, `Sentinel ${sku}`, supplierId],
  );
  return res.rows[0].id;
}

interface ReceiptMovement {
  qty_delta: number;
  supplier_id: number | null;
  batch_id: number | null;
  ref_type: string | null;
  ref_id: string | null;
}

async function receiptMovements(client: pg.Client, productId: number): Promise<ReceiptMovement[]> {
  const res = await client.query<ReceiptMovement>(
    `SELECT qty_delta, supplier_id, batch_id, ref_type, ref_id
     FROM public.inventory_movements
     WHERE product_id = $1 AND movement_type = 'receipt'
     ORDER BY id`,
    [productId],
  );
  return res.rows;
}

describe.skipIf(!hasDbCreds())('goods-receipt supplier capture (live RPC, rollback-isolated)', () => {
  it('records the header supplier on an UNTRACKED (no-lot) receipt and links a goods_receipts header', async () => {
    await withRollbackTx(async (client) => {
      const actor = await firstProfileId(client);
      const supplierId = await seedSupplier(client, 'A');
      const productId = await seedProduct(client, supplierId);

      const { rows } = await client.query<{ inv_receive_stock: { lines_received: number; receipt_id: number } }>(
        'SELECT public.inv_receive_stock($1::jsonb, $2, $3::jsonb)',
        [
          JSON.stringify([{ product_id: productId, quantity: 10 }]), // no lot_code → untracked
          actor,
          JSON.stringify({ supplier_id: supplierId, reference: 'INV-123' }),
        ],
      );
      const receiptId = rows[0].inv_receive_stock.receipt_id;

      const moves = await receiptMovements(client, productId);
      expect(moves).toHaveLength(1);
      expect(moves[0].batch_id).toBeNull(); // untracked
      expect(moves[0].supplier_id).toBe(supplierId); // <-- the gap this fixes
      expect(moves[0].ref_type).toBe('goods_receipt');
      expect(moves[0].ref_id).toBe(String(receiptId));

      const header = await client.query<{ supplier_id: number; reference: string }>(
        'SELECT supplier_id, reference FROM public.goods_receipts WHERE id = $1',
        [receiptId],
      );
      expect(header.rows[0]).toMatchObject({ supplier_id: supplierId, reference: 'INV-123' });
    });
  });

  it('applies the header supplier to all lines, and a per-line supplier overrides it', async () => {
    await withRollbackTx(async (client) => {
      const actor = await firstProfileId(client);
      const supplierA = await seedSupplier(client, 'A');
      const supplierB = await seedSupplier(client, 'B');
      const productId = await seedProduct(client, supplierA);

      await client.query('SELECT public.inv_receive_stock($1::jsonb, $2, $3::jsonb)', [
        JSON.stringify([
          { product_id: productId, quantity: 5 }, // inherits header supplier A
          { product_id: productId, quantity: 7, supplier_id: supplierB }, // override → B
        ]),
        actor,
        JSON.stringify({ supplier_id: supplierA }),
      ]);

      const moves = await receiptMovements(client, productId);
      expect(moves).toHaveLength(2);
      expect(moves[0]).toMatchObject({ qty_delta: 5, supplier_id: supplierA });
      expect(moves[1]).toMatchObject({ qty_delta: 7, supplier_id: supplierB });
    });
  });

  it('stamps the supplier on a tracked (lot) receipt — onto both the batch and the movement', async () => {
    await withRollbackTx(async (client) => {
      const actor = await firstProfileId(client);
      const supplierId = await seedSupplier(client, 'A');
      const productId = await seedProduct(client, supplierId);

      await client.query('SELECT public.inv_receive_stock($1::jsonb, $2, $3::jsonb)', [
        JSON.stringify([
          { product_id: productId, quantity: 4, lot_code: `LOT-${uniq()}`, expiry_date: '2027-01-01' },
        ]),
        actor,
        JSON.stringify({ supplier_id: supplierId }),
      ]);

      const moves = await receiptMovements(client, productId);
      expect(moves).toHaveLength(1);
      expect(moves[0].batch_id).not.toBeNull();
      expect(moves[0].supplier_id).toBe(supplierId);

      const batch = await client.query<{ supplier_id: number }>(
        'SELECT supplier_id FROM public.batches WHERE id = $1',
        [moves[0].batch_id],
      );
      expect(batch.rows[0].supplier_id).toBe(supplierId);
    });
  });
});
