// Tear down the WIE demo warehouse. FK-safe: movements/balances → orders → wie_*
// analytics → layout graph → placements/objects → locations (deepest-first) →
// products → supplier. Safe to run when nothing exists (no-op). Also imported by
// seed.mjs so a re-seed starts clean.
//
//   npm run demo:wie:reset

import { pathToFileURL } from 'node:url'
import { supa, WH_CODE, CODE_PREFIX } from './lib.mjs'

const ORDER_PREFIX = `${CODE_PREFIX}-ORD`

async function del(table, apply) {
  const q = apply(supa.from(table).delete())
  const { error } = await q
  if (error && !/no rows/i.test(error.message)) {
    // Surface but don't abort — a missing table/row shouldn't wedge teardown.
    console.warn(`  · ${table}: ${error.message}`)
  }
}

export async function resetDemo({ verbose = true } = {}) {
  const log = (m) => { if (verbose) console.log(m) }

  // Prefix-based cleanup runs even when a prior seed failed part-way (orphan
  // products/supplier with no warehouse yet).
  const { data: products } = await supa.from('products').select('id').like('sku', `${CODE_PREFIX}-%`)
  const prodIds = (products ?? []).map((p) => p.id)

  const { data: wh, error: whErr } = await supa.from('locations').select('id, materialized_path').eq('code', WH_CODE).maybeSingle()
  if (whErr) console.warn(`  · warehouse lookup: ${whErr.message} (duplicate WIE-DEMO rows? delete manually)`)
  const whId = wh?.id ?? null
  const { data: descendants } = whId
    ? await supa.from('locations').select('id, kind, materialized_path').like('materialized_path', `${wh.materialized_path}/%`)
    : { data: [] }
  const locIds = (descendants ?? []).map((l) => l.id)
  const { data: layouts } = whId
    ? await supa.from('warehouse_layouts').select('id').eq('warehouse_id', whId)
    : { data: [] }
  const layoutIds = (layouts ?? []).map((l) => l.id)

  log(`· resetting WIE-DEMO (warehouse ${whId ?? 'none'}, ${locIds.length} sub-locations, ${prodIds.length} products)…`)

  // Ledger + orders first (they FK to locations/products). Include the warehouse
  // root id — bulk/staged stock lands there, not only on descendant bins.
  const ledgerLocIds = whId ? [whId, ...locIds] : locIds
  if (ledgerLocIds.length) await del('inventory_movements', (q) => q.in('location_id', ledgerLocIds))
  if (prodIds.length) await del('inventory_movements', (q) => q.in('product_id', prodIds))
  await del('inventory_movements', (q) => q.like('ref_id', `${ORDER_PREFIX}%`))
  if (ledgerLocIds.length) await del('inventory_balances', (q) => q.in('location_id', ledgerLocIds))
  if (prodIds.length) await del('inventory_balances', (q) => q.in('product_id', prodIds))
  await del('order_items', (q) => q.like('order_id', `${ORDER_PREFIX}%`))
  await del('order_fulfillments', (q) => q.like('order_id', `${ORDER_PREFIX}%`))
  await del('orders', (q) => q.like('id', `${ORDER_PREFIX}%`))

  // WIE analytics.
  if (whId) {
    await del('wie_slotting_suggestions', (q) => q.eq('warehouse_id', whId))
    await del('wie_product_velocity', (q) => q.eq('warehouse_id', whId))
    await del('wie_putaway_recommendations', (q) => q.eq('warehouse_id', whId))
  }
  if (layoutIds.length) {
    await del('wie_location_traffic', (q) => q.in('layout_id', layoutIds))
    await del('wie_simulations', (q) => q.in('layout_id', layoutIds))
    // Layout graph + geometry.
    await del('layout_travel_distances', (q) => q.in('layout_id', layoutIds))
    await del('layout_graph_edges', (q) => q.in('layout_id', layoutIds))
    await supa.from('layout_placements').update({ graph_node_id: null }).in('layout_id', layoutIds)
    await del('layout_graph_nodes', (q) => q.in('layout_id', layoutIds))
    await del('layout_placements', (q) => q.in('layout_id', layoutIds))
    await del('layout_objects', (q) => q.in('layout_id', layoutIds))
  }

  if (whId) {
    // Break the locations ↔ warehouse_layouts cycle, then drop layouts.
    await supa.from('locations').update({ active_layout_id: null }).eq('id', whId)
    await del('warehouse_layouts', (q) => q.eq('warehouse_id', whId))

    // Locations deepest-first: bins → racks → aisles → zones → warehouse.
    const byKind = { BIN: [], SHELF: [], BAY: [], RACK: [], AISLE: [], ZONE: [] }
    for (const l of descendants ?? []) (byKind[l.kind] ?? (byKind[l.kind] = [])).push(l.id)
    for (const kind of ['BIN', 'SHELF', 'BAY', 'RACK', 'AISLE', 'ZONE']) {
      if (byKind[kind]?.length) await del('locations', (q) => q.in('id', byKind[kind]))
    }
    await del('locations', (q) => q.eq('id', whId))
  }

  // Products + supplier last.
  if (prodIds.length) await del('products', (q) => q.in('id', prodIds))
  await del('suppliers', (q) => q.eq('name', 'WIE Demo Supplies'))

  log('· reset complete.')
}

// CLI entrypoint (skipped when imported by seed.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetDemo().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
