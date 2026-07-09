// Build a realistic floor plan for the MAIN warehouse and let the WIE putaway
// engine slot every SKU into it, leaving zero stock at the warehouse root.
//
//   npm run warehouse:main:seed
//
// Every privileged write goes through the shipped Edge Functions, so this seed
// exercises the same validation, audit trail and putaway scoring the app does.
// Undo with `npm run warehouse:main:reset`.

import { pathToFileURL } from 'node:url'

import {
  supa, invokeAdmin, getWarehouse,
  COLD_ZONE, STORAGE_FORMS, RULES, LAYOUT_NAME, fmt,
} from './lib.mjs'
import { buildMainLayout, CANDIDATE_LIMIT } from './layout.mjs'
import { classifyAbc, demandByProduct } from './velocity.mjs'
import { evaluatePublishReadiness } from '../supabase/functions/_shared/wie/publishReadiness.ts'

/** SKUs per putaway round. Each round is recommended, then fully accepted, before
 *  the next is recommended — so the engine sees real `used_slots` /
 *  `has_same_product` rather than relying on the in-call fill overlay, and we stay
 *  well under decide-putaway's 120/min rate limit. */
const ROUND_SIZE = 40

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Sliding-window gate so a burst of Edge Function calls never trips a 429. */
function makeGate(max, windowMs) {
  const hits = []
  return async () => {
    for (;;) {
      const now = Date.now()
      while (hits.length && now - hits[0] > windowMs) hits.shift()
      if (hits.length < max) { hits.push(now); return }
      const waitMs = windowMs - (now - hits[0]) + 250
      console.log(`   · rate limit: pausing ${Math.ceil(waitMs / 1000)}s`)
      await sleep(waitMs)
    }
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

async function assertCleanStart(warehouse) {
  if (warehouse.location_type !== 'racked') {
    throw new Error(`${warehouse.code} is '${warehouse.location_type}', expected 'racked'.`)
  }

  // A live seeded layout means the bin codes are already taken; save_geometry
  // would 23505 on the first bay.
  const { data: live } = await supa.from('warehouse_layouts').select('id')
    .eq('warehouse_id', warehouse.id).eq('name', LAYOUT_NAME).eq('status', 'published').maybeSingle()
  if (live) {
    throw new Error(`Layout ${live.id} ("${LAYOUT_NAME}") is already published. Run \`npm run warehouse:main:reset\` first.`)
  }

  const { data: descendants } = await supa.from('locations').select('id')
    .like('materialized_path', `${warehouse.materialized_path}/%`)
  const ids = (descendants ?? []).map((l) => l.id)
  if (!ids.length) return

  const { data: stocked, error } = await supa.from('inventory_balances')
    .select('location_id, on_hand').in('location_id', ids).gt('on_hand', 0)
  if (error) throw new Error(`balance check failed: ${error.message}`)
  if (stocked?.length) {
    throw new Error(
      `${stocked.length} bin(s) under ${warehouse.code} already hold stock. ` +
      'Run `npm run warehouse:main:reset` first — re-seeding would double-move stock.',
    )
  }
}

async function upsertStorageForms() {
  const ids = {}
  for (const form of STORAGE_FORMS) {
    const { key, code, ...fields } = form
    const { data: existing } = await supa.from('storage_types').select('id').eq('code', code).maybeSingle()
    if (existing) {
      await invokeAdmin('mutate-storage-type', {
        action: 'update', id: existing.id, data: { ...fields, is_active: true }, apply_to_existing: true,
      })
      ids[key] = existing.id
    } else {
      const res = await invokeAdmin('mutate-storage-type', { action: 'create', data: { code, ...fields } })
      ids[key] = res.storageType?.id ?? res.storage_type?.id ?? res.id
      if (!ids[key]) throw new Error(`could not read new storage_type id from ${JSON.stringify(res)}`)
    }
  }
  console.log(`  · storage forms: ${STORAGE_FORMS.map((f) => f.code).join(', ')}`)
  return ids
}

async function resolveZoneProfiles() {
  // The four workhorse profiles are global and have allowed_categories = NULL, so
  // they are reused untouched. Cold is ours alone: mutating the shared 'Cold
  // Storage' profile would gate WIE-DEMO's chilled zone.
  const pick = async (zoneType) => {
    const { data } = await supa.from('zone_profiles').select('id')
      .eq('zone_type', zoneType).eq('is_active', true).order('id').limit(1).maybeSingle()
    if (!data) throw new Error(`no zone_profile with zone_type='${zoneType}'`)
    return data.id
  }

  let { data: cold } = await supa.from('zone_profiles').select('id')
    .eq('name', COLD_ZONE.name).eq('zone_type', COLD_ZONE.zone_type).maybeSingle()
  if (cold) {
    // A previous reset deactivated it; restore the whole definition in case the
    // allowed-categories gate was edited by hand.
    const { error } = await supa.from('zone_profiles').update({ ...COLD_ZONE, is_active: true }).eq('id', cold.id)
    if (error) throw new Error(`cold zone profile update failed: ${error.message}`)
  } else {
    const { data, error } = await supa.from('zone_profiles').insert(COLD_ZONE).select('id').single()
    if (error) throw new Error(`cold zone profile insert failed: ${error.message}`)
    cold = data
  }

  const zoneProfiles = {
    fast: await pick('fast_moving'),
    slow: await pick('slow_moving'),
    bulk: await pick('bulk'),
    overflow: await pick('overflow'),
    cold: cold.id,
  }
  console.log(`  · zone profiles: ${JSON.stringify(zoneProfiles)}`)
  return zoneProfiles
}

/** Reuse an empty draft if one exists, else cut a new version. Either way the
 *  layout ends up named LAYOUT_NAME — reset.mjs identifies our layout by name. */
async function getDraftLayout(warehouse, geometry) {
  const shape = {
    name: LAYOUT_NAME,
    grid_width: geometry.gridWidth,
    grid_height: geometry.gridHeight,
    cell_size_m: geometry.cellSizeM,
    floor_count: geometry.floors,
  }

  // Only ever adopt a draft this tool created. An admin's half-started draft for
  // MAIN would otherwise get its name and grid silently overwritten.
  const { data: drafts } = await supa.from('warehouse_layouts')
    .select('id').eq('warehouse_id', warehouse.id).eq('status', 'draft').eq('name', LAYOUT_NAME)
    .order('id', { ascending: false })

  for (const draft of drafts ?? []) {
    const { count } = await supa.from('layout_placements')
      .select('id', { count: 'exact', head: true }).eq('layout_id', draft.id)
    if (count) continue
    const { error } = await supa.from('warehouse_layouts').update(shape).eq('id', draft.id)
    if (error) throw new Error(`could not restamp draft ${draft.id}: ${error.message}`)
    return draft.id
  }

  const res = await invokeAdmin('mutate-layout', { action: 'create_layout', data: { warehouse_id: warehouse.id, ...shape } })
  const id = res.layout?.id ?? res.id
  if (!id) throw new Error(`could not read new layout id from ${JSON.stringify(res)}`)
  return id
}

/** Run the four publish gates locally so a bad floor plan never reaches the DB. */
function assertPublishable(geometry) {
  const result = evaluatePublishReadiness({
    objects: geometry.objects.map((o) => ({ objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
    placements: geometry.placements.map((p) => ({ id: p.client_ref, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
    cellSizeM: geometry.cellSizeM,
  })
  if (!result.ready) {
    const failed = result.checks.filter((c) => c.status !== 'pass').map((c) => `${c.code}: ${c.message}`)
    throw new Error(`layout would be rejected at publish:\n  ${failed.join('\n  ')}`)
  }
  if (geometry.placements.length > CANDIDATE_LIMIT) {
    throw new Error(
      `${geometry.placements.length} bays exceeds the ${CANDIDATE_LIMIT}-candidate ceiling in putawayTasks.ts; ` +
      'the farthest bays would never be offered to the engine.',
    )
  }
}

/** Retire the bins the old placeholder layout created. publish-layout deliberately
 *  never deactivates bins (Phase-1 decision), so they would otherwise stay active
 *  and leak into inv_warehouse_draw_locations. */
async function retireLegacyBins(warehouse, keepIds) {
  const { data: bins } = await supa.from('locations').select('id, code')
    .like('materialized_path', `${warehouse.materialized_path}/%`)
    .eq('kind', 'BIN').eq('is_active', true)
  const stale = (bins ?? []).filter((b) => !keepIds.has(b.id))
  if (!stale.length) return 0

  const { error } = await supa.from('locations').update({ is_active: false }).in('id', stale.map((b) => b.id))
  if (error) throw new Error(`could not retire legacy bins: ${error.message}`)
  return stale.length
}

async function seedVelocity(warehouseId, productIds) {
  const { data: items, error } = await supa.from('order_items').select('product_id, quantity')
  if (error) throw new Error(`order_items read failed: ${error.message}`)

  const classified = classifyAbc(demandByProduct(items ?? [], productIds))
  const rows = classified.map((r) => ({
    warehouse_id: warehouseId,
    product_id: r.productId,
    // Only velocity_class feeds scoring.ts; the pick counters stay 0 because we
    // are deriving from order demand, not from the (near-empty) pick ledger.
    picks_7d: 0, picks_30d: 0, picks_90d: 0, qty_30d: 0,
    velocity_class: r.velocityClass,
  }))
  const { error: upErr } = await supa.from('wie_product_velocity')
    .upsert(rows, { onConflict: 'warehouse_id,product_id' })
  if (upErr) throw new Error(`velocity upsert failed: ${upErr.message}`)

  const count = (c) => classified.filter((r) => r.velocityClass === c).length
  console.log(`  · velocity: A=${count('A')} B=${count('B')} C=${count('C')}`)
  return new Map(classified.map((r) => [r.productId, r]))
}

async function seedRules(warehouseId) {
  await supa.from('wie_rules').delete().eq('warehouse_id', warehouseId)
    .in('name', RULES.map((r) => r.name))
  const { error } = await supa.from('wie_rules')
    .insert(RULES.map((r) => ({ ...r, warehouse_id: warehouseId, is_active: true })))
  if (error) throw new Error(`rule insert failed: ${error.message}`)
  console.log(`  · rules: ${RULES.map((r) => `${r.name} (${r.enforcement})`).join(', ')}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function seedMainWarehouse() {
  const warehouse = await getWarehouse()
  console.log(`\nSeeding ${warehouse.name} (id ${warehouse.id})`)
  await assertCleanStart(warehouse)

  console.log('\n1. Catalogue')
  const storageTypes = await upsertStorageForms()
  const zoneProfiles = await resolveZoneProfiles()

  console.log('\n2. Floor plan')
  const geometry = buildMainLayout({ warehouseId: warehouse.id, zoneProfiles, storageTypes })
  assertPublishable(geometry)
  console.log(`  · ${geometry.placements.length} bays, ${geometry.objects.length} objects — passes all four publish gates`)

  const layoutId = await getDraftLayout(warehouse, geometry)
  const saved = await invokeAdmin('mutate-layout', {
    action: 'save_geometry',
    layout_id: layoutId,
    placements: geometry.placements,
    objects: geometry.objects,
  })
  const refToLocation = new Map((saved.ref_map ?? []).map((r) => [r.client_ref, r.location_id]))
  console.log(`  · saved ${refToLocation.size} bays into draft layout ${layoutId}`)

  await invokeAdmin('publish-layout', { layout_id: layoutId })
  console.log(`  · published layout ${layoutId}`)

  const retired = await retireLegacyBins(warehouse, new Set(refToLocation.values()))
  if (retired) console.log(`  · retired ${retired} placeholder bin(s) from the old layout`)

  console.log('\n3. Slotting inputs')
  const { data: stock, error: stockErr } = await supa.from('inventory_balances')
    .select('product_id, on_hand, allocated, available, products(sku, category)')
    .eq('location_id', warehouse.id).gt('on_hand', 0)
  if (stockErr) throw new Error(`root balance read failed: ${stockErr.message}`)
  if (!stock?.length) throw new Error('no stock at the warehouse root — nothing to slot')

  const velocity = await seedVelocity(warehouse.id, stock.map((s) => s.product_id))
  await seedRules(warehouse.id)

  // inv_transfer_stock moves AVAILABLE stock only — units already reserved
  // against an order cannot leave their balance row. Slotting on_hand would
  // fail with INSUFFICIENT_STOCK on every reserved SKU.
  const reserved = stock.reduce((n, s) => n + Number(s.allocated), 0)

  // planPutaway is greedy per line in input order, so whichever SKUs are offered
  // first claim the dock-adjacent bays. Slot the fast movers first, exactly as a
  // real DC would, or A-class stock ends up behind C-class stock.
  const rank = { A: 0, B: 1, C: 2 }
  const lines = stock
    .map((s) => ({ product_id: s.product_id, quantity: Number(s.available), sku: s.products?.sku }))
    .filter((l) => l.quantity > 0)
    .sort((a, b) => {
      const va = velocity.get(a.product_id)
      const vb = velocity.get(b.product_id)
      return rank[va.velocityClass] - rank[vb.velocityClass] || vb.demand - va.demand || a.product_id - b.product_id
    })
  console.log(`  · ${lines.length} SKUs / ${fmt(lines.reduce((n, l) => n + l.quantity, 0))} units to slot`)
  if (reserved > 0) {
    console.log(`  · ${fmt(reserved)} units stay at the root — reserved against open orders, so unmovable`)
  }

  console.log('\n4. Putaway')
  // Clear any 'suggested' rows a previous failed run left behind against THIS
  // layout, so we never accept a recommendation scored against older geometry.
  await supa.from('wie_putaway_recommendations').delete()
    .eq('layout_id', layoutId).eq('status', 'suggested')
  // decide-putaway allows 120/min, recommend-putaway 60/min. One gate per endpoint.
  const decideGate = makeGate(100, 60_000)
  const recommendGate = makeGate(50, 60_000)
  const placed = new Map() // productId -> the bin its best-scored allocation went to
  let accepted = 0
  const residuals = []

  for (let i = 0; i < lines.length; i += ROUND_SIZE) {
    const round = lines.slice(i, i + ROUND_SIZE)
    await recommendGate()
    const res = await invokeAdmin('recommend-putaway', {
      warehouse_id: warehouse.id,
      lines: round.map(({ product_id, quantity }) => ({ product_id, quantity })),
    })
    if (res.mode !== 'engine') throw new Error(`putaway ran in '${res.mode}' mode — the layout is not live`)

    for (const rec of res.recommendations ?? []) {
      if (rec.recommendedLocationId == null) {
        const line = round.find((l) => l.product_id === rec.productId)
        residuals.push({ sku: line?.sku ?? rec.productId, quantity: rec.quantity })
        continue
      }
      await decideGate()
      await invokeAdmin('decide-putaway', { recommendation_id: rec.recommendationId, decision: 'accept' })
      accepted += 1
      if (!placed.has(rec.productId)) placed.set(rec.productId, rec.recommendedLocationId)
    }
    console.log(`  · round ${Math.floor(i / ROUND_SIZE) + 1}: ${round.length} SKUs, ${accepted} placements accepted so far`)
  }

  if (residuals.length) {
    console.warn(`\n  !! ${residuals.length} allocation(s) had no legal bin and remain at the root:`)
    for (const r of residuals) console.warn(`     ${r.sku}: ${fmt(r.quantity)} units`)
  }

  console.log('\n5. Home bins')
  // Fixed slotting: record each SKU's bay. Written with the service role rather
  // than mutate-product-home-bin because that function is capped at 30 calls/min
  // and this is derived metadata, not a stock movement. Note that nothing in the
  // putaway engine reads product_home_bins today — it records the slot plan.
  const homeRows = [...placed].map(([productId, binId]) => ({
    product_id: productId, warehouse_id: warehouse.id, bin_id: binId,
  }))
  const { error: homeErr } = await supa.from('product_home_bins')
    .upsert(homeRows, { onConflict: 'product_id,warehouse_id' })
  if (homeErr) throw new Error(`home bin upsert failed: ${homeErr.message}`)
  console.log(`  · ${homeRows.length} home bins recorded`)

  await summarise(warehouse, layoutId, reserved)
}

async function summarise(warehouse, layoutId, reserved) {
  const { data: root } = await supa.from('inventory_balances')
    .select('on_hand').eq('location_id', warehouse.id).gt('on_hand', 0)
  const rootUnits = (root ?? []).reduce((n, r) => n + Number(r.on_hand), 0)

  const { data: bins } = await supa.from('layout_placements')
    .select('location_id, locations(code, capacity_slots)').eq('layout_id', layoutId)
  const binIds = (bins ?? []).map((b) => b.location_id)
  const { data: balances } = await supa.from('inventory_balances')
    .select('location_id, product_id, on_hand').in('location_id', binIds).gt('on_hand', 0)

  const occupied = new Set((balances ?? []).map((b) => b.location_id))
  const capacity = (bins ?? []).reduce((n, b) => n + Number(b.locations?.capacity_slots ?? 0), 0)
  const binUnits = (balances ?? []).reduce((n, b) => n + Number(b.on_hand), 0)

  console.log('\nDone.')
  console.log(`  bays           ${occupied.size} occupied / ${binIds.length}  (${Math.round(100 * occupied.size / binIds.length)}%)`)
  console.log(`  slot use       ${fmt(binUnits)} / ${fmt(capacity)}  (${Math.round(100 * binUnits / capacity)}%)`)
  console.log(`  units in bins  ${fmt(binUnits)}`)
  const expectedRoot = reserved
  const rootNote = rootUnits === expectedRoot
    ? (expectedRoot === 0 ? '' : '  (all reserved against open orders)')
    : `  <-- expected ${fmt(expectedRoot)}`
  console.log(`  units at root  ${fmt(rootUnits)}${rootNote}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedMainWarehouse().catch((err) => { console.error(`\n${err.message}`); process.exit(1) })
}
