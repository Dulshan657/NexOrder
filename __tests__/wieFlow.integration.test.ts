/**
 * Warehouse Intelligence Engine — end-to-end flow (live RPCs, rollback-isolated).
 *
 * Builds a minimal PUBLISHED-layout scenario (warehouse → layout → dock+bin graph
 * → placement → travel distance → stock) directly in a BEGIN…ROLLBACK transaction,
 * then exercises the deployed WIE SQL surface the edge functions call:
 *   - wie_putaway_candidates  (stage-1 candidate loader)
 *   - inv_reserve_order       (allocate at the bin) → wie_order_pick_stops (pick route input)
 *   - wie_warehouse_report    (analytics rollup)
 *
 * Production data is never mutated (always ROLLBACK). Run with `npm run test:integration`.
 */
import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { hasDbCreds, withRollbackTx } from './support/pgTestClient';

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

interface Scenario {
  warehouseId: number;
  layoutId: number;
  binId: number;
  dockNode: number;
  binNode: number;
  productId: number;
}

async function seedScenario(client: pg.Client): Promise<Scenario> {
  const token = uniq();

  const supplier = await client.query<{ id: number }>(
    `INSERT INTO public.suppliers (id, name, contact_person, email, phone)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.suppliers), $1, '', $2, '')
     RETURNING id`,
    [`WIE Supplier ${token}`, `wie-${token}@test.local`],
  );
  const supplierId = supplier.rows[0].id;

  const product = await client.query<{ id: number }>(
    `INSERT INTO public.products (id, sku, name, price, category, unit, carton_size, supplier_id, inventory, size_factor)
     VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM public.products), $1, $2, 5, 'Other', 'EA', 12, $3, 0, 1)
     RETURNING id`,
    [`WIE-${token}`, `WIE Product ${token}`, supplierId],
  );
  const productId = product.rows[0].id;

  // Racked warehouse.
  const whPath = `WIEWH${token}`;
  const wh = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, location_type)
     VALUES (NULL, 'WAREHOUSE', $1, $2, $3, true, 'racked') RETURNING id`,
    [`WH-${token}`, `WIE WH ${token}`, whPath],
  );
  const warehouseId = wh.rows[0].id;

  // Published layout, marked active on the warehouse.
  const layout = await client.query<{ id: number }>(
    `INSERT INTO public.warehouse_layouts (warehouse_id, name, status, cell_size_m)
     VALUES ($1, 'Test', 'published', 1) RETURNING id`,
    [warehouseId],
  );
  const layoutId = layout.rows[0].id;
  await client.query('UPDATE public.locations SET active_layout_id=$1 WHERE id=$2', [layoutId, warehouseId]);

  // One bin under the warehouse (capacity 100 slots).
  const bin = await client.query<{ id: number }>(
    `INSERT INTO public.locations (parent_id, kind, code, name, materialized_path, is_active, capacity_slots, slot_kind)
     VALUES ($1, 'BIN', $2, 'Bin 1', $3, true, 100, 'pallet') RETURNING id`,
    [warehouseId, `BIN-${token}`, `${whPath}/BIN-${token}`],
  );
  const binId = bin.rows[0].id;

  // Walkway graph: dock node → bin node (5 m apart).
  const dock = await client.query<{ id: number }>(
    `INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
     VALUES ($1, 0, 0, 0, 'dock') RETURNING id`, [layoutId]);
  const dockNode = dock.rows[0].id;
  const walk = await client.query<{ id: number }>(
    `INSERT INTO public.layout_graph_nodes (layout_id, floor, x, y, node_type)
     VALUES ($1, 0, 5, 0, 'walk') RETURNING id`, [layoutId]);
  const binNode = walk.rows[0].id;
  await client.query(
    `INSERT INTO public.layout_graph_edges (layout_id, from_node, to_node, weight_m, bidirectional)
     VALUES ($1, $2, $3, 5, true)`, [layoutId, dockNode, binNode]);
  await client.query(
    `INSERT INTO public.layout_travel_distances (layout_id, from_node_id, to_node_id, distance_m)
     VALUES ($1, $2, $3, 5)`, [layoutId, dockNode, binNode]);

  // Placement snaps the bin to the walk node.
  await client.query(
    `INSERT INTO public.layout_placements (layout_id, location_id, floor, x, y, w, h, rotation, graph_node_id, access_offset_m)
     VALUES ($1, $2, 0, 5, 0, 1, 1, 0, $3, 0.5)`, [layoutId, binId, binNode]);

  // Stock sitting in the bin.
  await client.query(
    `INSERT INTO public.inventory_balances (product_id, location_id, batch_id, on_hand, allocated)
     VALUES ($1, $2, NULL, 100, 0)`, [productId, binId]);

  return { warehouseId, layoutId, binId, dockNode, binNode, productId };
}

const maybe = hasDbCreds() ? describe : describe.skip;

maybe('WIE end-to-end flow (live RPCs, rollback-isolated)', () => {
  it('wie_putaway_candidates returns the placed bin with its dock distance and capacity', async () => {
    await withRollbackTx(async (client) => {
      const s = await seedScenario(client);
      const res = await client.query(
        'SELECT * FROM public.wie_putaway_candidates($1, $2, 50)', [s.layoutId, s.productId],
      );
      expect(res.rows).toHaveLength(1);
      const c = res.rows[0];
      expect(c.location_id).toBe(s.binId);
      expect(Number(c.distance_from_dock_m)).toBe(5);
      expect(Number(c.capacity_slots)).toBe(100);
      expect(c.graph_node_id).toBe(s.binNode);
    });
  });

  it('reservation allocates at the bin and wie_order_pick_stops returns it as a stop', async () => {
    await withRollbackTx(async (client) => {
      const s = await seedScenario(client);
      const orderId = `WIE-ORD-${uniq()}`;
      await client.query(
        'SELECT public.inv_reserve_order($1, $2::jsonb, $3::int[], NULL::uuid, false)',
        [orderId, JSON.stringify([{ product_id: s.productId, quantity: 10 }]), [s.warehouseId]],
      );
      const stops = await client.query(
        'SELECT * FROM public.wie_order_pick_stops($1, $2)', [orderId, s.warehouseId],
      );
      expect(stops.rows).toHaveLength(1);
      expect(stops.rows[0].location_id).toBe(s.binId);
      expect(Number(stops.rows[0].qty_base)).toBe(10);
      expect(stops.rows[0].graph_node_id).toBe(s.binNode);
    });
  });

  it('wie_warehouse_report rolls up the bin count and utilization', async () => {
    await withRollbackTx(async (client) => {
      const s = await seedScenario(client);
      const res = await client.query<{ r: Record<string, unknown> }>(
        'SELECT public.wie_warehouse_report($1) AS r', [s.warehouseId],
      );
      const report = res.rows[0].r;
      expect(report.binCount).toBe(1);
      // 100 on_hand × size_factor 1 = 100 slots used of 100 capacity → 100%.
      expect(Number(report.utilizationPct)).toBeCloseTo(1, 4);
      expect(report.emptyBins).toBe(0);
    });
  });
});
