// Seed the WIE demo warehouse — one idempotent command that gives the read-only
// Warehouse viewer real, overlay-lit data to show on day one:
//   • a published, multi-floor grid layout (docks, corridors, a lift, ~48 bins)
//   • stock scattered with varied fill (empty → over-capacity)
//   • 90 days of skewed pick history → A/B/C velocity + a congestion hotspot
//   • a few re-slotting suggestions and one allocated order for the pick route
//
//   npm run demo:wie:seed     (runs reset first, then seeds)
//   npm run demo:wie:reset    (tear down)
//
// Dev-only: lib.mjs resolves the target and refuses anything but dev. All codes are namespaced
// WIEDEMO- / WIE-DEMO so teardown is exact and nothing collides.

import { pathToFileURL } from 'node:url'
import {
  supa, WH_CODE, WH_NAME, CODE_PREFIX, GRID, PRODUCTS,
  buildDemoLayout, buildGraphPayload,
} from './lib.mjs'
import { resetDemo } from './reset.mjs'

const ORDER_ID = `${CODE_PREFIX}-ORD-1`
const PICK_HIST_REF = `${CODE_PREFIX}-PICKHIST`

const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString()

async function insertReturning(table, rows, cols = 'id') {
  const { data, error } = await supa.from(table).insert(rows).select(cols)
  if (error) throw new Error(`${table} insert: ${error.message}`)
  return data
}

// suppliers / products / locations were seeded with explicit ids and their
// sequences were never advanced, so inserts without an id collide on the pkey.
// Assign ids from MAX(id)+1 (same approach as the WIE integration test).
async function maxId(table) {
  const { data, error } = await supa.from(table).select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`${table} maxId: ${error.message}`)
  return data?.id ?? 0
}

async function main() {
  console.log('▶ Seeding WIE demo warehouse…\n')
  await resetDemo({ verbose: true })
  console.log('')

  // Prereqs from the base seed.
  const { data: adminProfile } = await supa.from('profiles').select('id').eq('role', 'Admin').limit(1).maybeSingle()
  const adminId = adminProfile?.id ?? (await supa.from('profiles').select('id').limit(1).maybeSingle()).data?.id
  if (!adminId) throw new Error('no profiles found — run the base seed first (npx tsx supabase/seed.ts)')
  const { data: horeca } = await supa.from('horecas').select('id').order('id').limit(1).maybeSingle()
  if (!horeca) throw new Error('no horecas found — run the base seed first')

  // Zone profiles (pre-seeded, mig 00047) keyed by zone_type.
  const { data: profiles } = await supa.from('zone_profiles').select('id, zone_type')
  const profileByType = new Map((profiles ?? []).map((p) => [p.zone_type, p.id]))

  // 1. Supplier + products (explicit ids — see maxId()).
  const supplierIdNew = (await maxId('suppliers')) + 1
  const [supplier] = await insertReturning('suppliers', [{ id: supplierIdNew, name: 'WIE Demo Supplies', contact_person: '', email: `${CODE_PREFIX.toLowerCase()}@demo.local`, phone: '' }])
  let nextProductId = (await maxId('products')) + 1
  const productRows = PRODUCTS.map((p) => ({
    id: nextProductId++, sku: p.sku, name: p.name, price: 10, category: p.category, unit: 'EA',
    carton_size: 12, supplier_id: supplier.id, inventory: 0, size_factor: p.sizeFactor,
  }))
  const products = await insertReturning('products', productRows, 'id, sku')
  const productBySku = new Map(products.map((p) => [p.sku, p.id]))
  console.log(`· ${products.length} products, supplier ${supplier.id}`)

  // 2. Warehouse root (racked). Locations need explicit ids too — one running
  //    counter across every level so parent links stay valid.
  let nextLocId = (await maxId('locations')) + 1
  const [wh] = await insertReturning('locations', [{
    id: nextLocId++, parent_id: null, kind: 'WAREHOUSE', code: WH_CODE, name: WH_NAME,
    materialized_path: WH_CODE, is_active: true, location_type: 'racked',
  }])
  const whId = wh.id

  // 3. Zone/aisle/rack/bin hierarchy.
  const geo = buildDemoLayout()
  const zoneRows = geo.zones.map((z) => ({
    id: nextLocId++, parent_id: whId, kind: 'ZONE', code: z.code, name: z.name, materialized_path: z.path,
    is_active: true, zone_profile_id: profileByType.get(z.zoneType) ?? null,
  }))
  const zones = await insertReturning('locations', zoneRows, 'id, code')
  const zoneId = new Map(zones.map((z) => [z.code, z.id]))

  const aisleRows = geo.aisles.map((a) => ({
    id: nextLocId++, parent_id: zoneId.get(a.zoneCode), kind: 'AISLE', code: a.code, name: a.name, materialized_path: a.path, is_active: true,
  }))
  const aisles = await insertReturning('locations', aisleRows, 'id, code')
  const aisleId = new Map(aisles.map((a) => [a.code, a.id]))

  const rackRows = geo.racks.map((r) => ({
    id: nextLocId++, parent_id: aisleId.get(r.aisleCode), kind: 'RACK', code: r.code, name: r.name, materialized_path: r.path, is_active: true,
  }))
  const racks = await insertReturning('locations', rackRows, 'id, code')
  const rackId = new Map(racks.map((r) => [r.code, r.id]))

  const binRows = geo.bins.map((b) => ({
    id: nextLocId++, parent_id: rackId.get(b.rackCode), kind: 'BIN', code: b.code, name: b.name, materialized_path: b.path,
    is_active: true, capacity_slots: 10, slot_kind: 'pallet',
  }))
  const binsInserted = await insertReturning('locations', binRows, 'id, code')
  const binId = new Map(binsInserted.map((b) => [b.code, b.id]))
  const bins = geo.bins.map((b) => ({ ...b, id: binId.get(b.code) }))
  console.log(`· ${zones.length} zones, ${aisles.length} aisles, ${racks.length} racks, ${bins.length} bins`)

  // 4. Draft layout + geometry.
  const [layout] = await insertReturning('warehouse_layouts', [{
    warehouse_id: whId, name: 'Demo layout', status: 'draft',
    grid_width: GRID.width, grid_height: GRID.height, cell_size_m: GRID.cellSize, floor_count: GRID.floorCount,
  }])
  const layoutId = layout.id

  await insertReturning('layout_objects', geo.objects.map((o) => ({
    layout_id: layoutId, object_type: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
  })), 'id')

  await insertReturning('layout_placements', bins.map((b) => ({
    layout_id: layoutId, location_id: b.id, floor: b.floor, x: b.x, y: b.y, w: 1, h: 1, rotation: 0,
  })), 'id')

  // 5. Build the routing graph in JS and publish atomically.
  const payload = buildGraphPayload(
    geo.objects,
    bins.map((b) => ({ locationId: b.id, floor: b.floor, x: b.x, y: b.y, w: 1, h: 1 })),
    GRID.cellSize,
  )
  const { error: pubErr } = await supa.rpc('wie_publish_layout_tx', {
    p_layout_id: layoutId, ...payload, p_actor: adminId,
  })
  if (pubErr) throw new Error(`publish: ${pubErr.message}`)
  console.log(`· layout ${layoutId} published (${payload.p_nodes.length} nodes, ${payload.p_edges.length} edges)`)

  // 6. Stock + pick history. Fast movers (P01-P03) live + get picked heavily in
  //    Zone A → they classify A AND their bins become the congestion hotspot.
  const poolByZone = {
    fast_moving: [`${CODE_PREFIX}-P01`, `${CODE_PREFIX}-P02`, `${CODE_PREFIX}-P03`],
    cold: [`${CODE_PREFIX}-P04`, `${CODE_PREFIX}-P05`, `${CODE_PREFIX}-P06`, `${CODE_PREFIX}-P07`],
    overflow: [`${CODE_PREFIX}-P08`, `${CODE_PREFIX}-P09`, `${CODE_PREFIX}-P10`],
  }
  const pickIntensity = { fast_moving: 8, cold: 3, overflow: 1 }
  const onHandCycle = [10, 4, 7, 12] // r=1..4; r=0 → empty

  const balances = []
  const picks = []
  const occupied = []
  const empties = []
  const zoneCount = {}
  for (const b of bins) {
    const j = (zoneCount[b.zoneType] = (zoneCount[b.zoneType] ?? 0)) // running index per zone
    zoneCount[b.zoneType] += 1
    const r = j % 5
    if (r === 0) { empties.push(b); continue }
    const pool = poolByZone[b.zoneType]
    const sku = pool[j % pool.length]
    const pid = productBySku.get(sku)
    const onHand = onHandCycle[r - 1]
    balances.push({ product_id: pid, location_id: b.id, batch_id: null, on_hand: onHand, allocated: 0 })
    occupied.push({ b, pid })
    // Demo-only: pick movements aren't matched by balance decrements (a real
    // ledger would), so a balance-vs-ledger audit will flag this warehouse. Fine
    // for a demo — the overlays only read movement history, not net balance.
    const n = pickIntensity[b.zoneType]
    for (let k = 0; k < n; k++) {
      picks.push({
        product_id: pid, location_id: b.id, batch_id: null, qty_delta: -1, movement_type: 'pick',
        ref_type: 'order', ref_id: PICK_HIST_REF, created_at: daysAgoIso((k * 3 + j) % 28),
      })
    }
  }
  await insertReturning('inventory_balances', balances, 'product_id')
  // Chunk movements to keep payloads modest.
  for (let i = 0; i < picks.length; i += 500) {
    await insertReturning('inventory_movements', picks.slice(i, i + 500), 'id')
  }
  console.log(`· stock in ${balances.length} bins (${empties.length} left empty), ${picks.length} historical picks`)

  // 7. A couple of re-slotting suggestions: move a far occupied bin's product to
  //    a near-dock empty bin.
  const nearEmpties = empties.filter((b) => b.zoneType === 'fast_moving').slice(0, 2)
  const farOccupied = occupied.filter((o) => o.b.zoneType === 'overflow').slice(0, 2)
  const suggestions = []
  for (let i = 0; i < Math.min(nearEmpties.length, farOccupied.length); i++) {
    suggestions.push({
      warehouse_id: whId, product_id: farOccupied[i].pid,
      from_location_id: farOccupied[i].b.id, to_location_id: nearEmpties[i].id,
      qty: 4, expected_gain_m: 12 + i * 6, reason: { note: 'demo suggestion' }, status: 'suggested',
    })
  }
  if (suggestions.length) await insertReturning('wie_slotting_suggestions', suggestions, 'id')
  console.log(`· ${suggestions.length} slotting suggestions`)

  // 8. One allocated order so the pick-route dry-run has a real target.
  const p01 = productBySku.get(`${CODE_PREFIX}-P01`)
  const p04 = productBySku.get(`${CODE_PREFIX}-P04`)
  await insertReturning('orders', [{
    id: ORDER_ID, horeca_id: horeca.id, submitted_by: adminId, total: 90,
    order_date: daysAgoIso(0), status: 'processed', status_history: [],
  }], 'id')
  let nextItemId = (await maxId('order_items')) + 1
  await insertReturning('order_items', [
    { id: nextItemId++, order_id: ORDER_ID, product_id: p01, quantity: 6, unit_price: 10, product_name: 'Demo Fast Mover A', product_sku: `${CODE_PREFIX}-P01` },
    { id: nextItemId++, order_id: ORDER_ID, product_id: p04, quantity: 3, unit_price: 10, product_name: 'Demo Mid Mover D', product_sku: `${CODE_PREFIX}-P04` },
  ], 'id')
  const { error: resErr } = await supa.rpc('inv_reserve_order', {
    p_order_id: ORDER_ID, p_items: [{ product_id: p01, quantity: 6 }, { product_id: p04, quantity: 3 }],
    p_location_pref: [whId], p_actor: adminId, p_allow_partial: true,
  })
  if (resErr) throw new Error(`inv_reserve_order: ${resErr.message}`)
  const { data: fulfil } = await supa.from('order_fulfillments').select('id').eq('order_id', ORDER_ID).limit(1)
  if (!fulfil || fulfil.length === 0) {
    await insertReturning('order_fulfillments', [{ order_id: ORDER_ID, location_id: whId, status: 'processed' }], 'id')
  }
  console.log(`· order ${ORDER_ID} placed + allocated (pick-route target)`)

  // 9. Rebuild the analytics rollups (velocity + traffic).
  const rv = await supa.rpc('wie_refresh_velocity')
  if (rv.error) throw new Error(`wie_refresh_velocity: ${rv.error.message}`)
  const rt = await supa.rpc('wie_refresh_location_traffic')
  if (rt.error) throw new Error(`wie_refresh_location_traffic: ${rt.error.message}`)

  console.log('\n✅ WIE demo ready.')
  console.log(`   Warehouse: ${WH_NAME} (${WH_CODE}) · id ${whId}`)
  console.log(`   Layout:    ${layoutId} (published, ${GRID.floorCount} floors)`)
  console.log(`   Order:     ${ORDER_ID} (try it in the pick-route test bench)`)
  console.log('   Open the app → Inventory & Dispatch → Warehouse → select "WIE Demo DC".')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('\n✗', e.message); process.exit(1) })
}
