// Undo `npm run warehouse:main:seed`: pull every unit back to the warehouse root
// and restore the previous published layout.
//
//   npm run warehouse:main:reset
//
// Refuses to run unless MAIN's active layout is the one the seed published, so it
// can never demote a real layout an operator has since published.
//
// The seeded bins are DEACTIVATED, not deleted. `inventory_movements.location_id`
// is ON DELETE NO ACTION and the ledger is append-only — the transfer legs that
// ran through those bins really happened, and erasing them would be a lie. Their
// codes are suffixed so the next seed can reuse the canonical names.
//
// `wie_product_velocity` is left in place: the seed overwrote rows we cannot
// restore, and stale ABC classes are harmless. Recompute any time with
// `SELECT wie_refresh_velocity();`.

import { pathToFileURL } from 'node:url'

import { supa, invokeAdmin, getWarehouse, COLD_ZONE, STORAGE_FORMS, RULES, LAYOUT_NAME, fmt } from './lib.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** transfer-stock is capped at 60/min/user. */
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

async function descendants(warehouse) {
  const { data } = await supa.from('locations').select('id, kind, code, is_active, created_in_layout_id')
    .like('materialized_path', `${warehouse.materialized_path}/%`)
  return data ?? []
}

async function layoutsOf(warehouseId) {
  const { data } = await supa.from('warehouse_layouts')
    .select('id, name, status, version').eq('warehouse_id', warehouseId).order('version', { ascending: false })
  return data ?? []
}

/**
 * Refuse to touch anything unless MAIN is demonstrably in the state the seed left
 * it in. Without this, `findPreviousLayout` would happily demote and republish
 * whatever layout is currently live.
 */
function assertSeeded(warehouse, layouts) {
  const active = layouts.find((l) => l.id === warehouse.active_layout_id)
  if (!active || active.name !== LAYOUT_NAME) {
    throw new Error(
      `${warehouse.code}'s active layout is ${active ? `"${active.name}" (${active.id})` : 'unset'}, ` +
      `not "${LAYOUT_NAME}". Nothing to reset — refusing to touch a layout this tool did not publish.`,
    )
  }
}

/** Reserved units cannot leave their balance row (inv_transfer_stock moves only
 *  available stock), so a bin holding them can never be drained. Fail before we
 *  archive anything rather than half-way through the teardown. */
async function assertNoReservedBinStock(binIds) {
  if (!binIds.length) return
  const { data, error } = await supa.from('inventory_balances')
    .select('location_id, product_id, allocated').in('location_id', binIds).gt('allocated', 0)
  if (error) throw new Error(`reservation check failed: ${error.message}`)
  if (data?.length) {
    throw new Error(
      `${data.length} bin balance(s) hold stock reserved against open orders, which inv_transfer_stock ` +
      'cannot move. Pick or release those orders first, then re-run reset.',
    )
  }
}

/** Move every unit sitting in a seeded bin back to the warehouse root. */
async function drainBins(warehouse, binIds) {
  if (!binIds.length) return 0
  const { data: balances, error } = await supa.from('inventory_balances')
    .select('location_id, product_id, available').in('location_id', binIds).gt('available', 0)
  if (error) throw new Error(`balance read failed: ${error.message}`)
  if (!balances?.length) return 0

  const gate = makeGate(50, 60_000)
  let units = 0
  for (const b of balances) {
    await gate()
    await invokeAdmin('transfer-stock', {
      productId: b.product_id,
      fromLocationId: b.location_id,
      toLocationId: warehouse.id,
      qty: Number(b.available),
      reason: 'warehouse-main reset',
    })
    units += Number(b.available)
  }
  console.log(`  · returned ${fmt(units)} units from ${balances.length} bin balance(s) to the root`)
  return units
}

/** The newest non-seed layout that actually has geometry — what we restore. */
async function findPreviousLayout(layouts) {
  for (const l of layouts) {
    if (l.name === LAYOUT_NAME) continue
    const { count } = await supa.from('layout_placements')
      .select('id', { count: 'exact', head: true }).eq('layout_id', l.id)
    if (count) return l
  }
  return null
}

export async function resetMainWarehouse() {
  const warehouse = await getWarehouse()
  const layouts = await layoutsOf(warehouse.id)
  assertSeeded(warehouse, layouts)

  console.log(`\nResetting ${warehouse.name} (id ${warehouse.id})`)

  const locations = await descendants(warehouse)
  const seedLayoutIds = new Set(layouts.filter((l) => l.name === LAYOUT_NAME).map((l) => l.id))
  const seededBins = locations.filter((l) => l.kind === 'BIN' && seedLayoutIds.has(l.created_in_layout_id))
  const seededBinIds = seededBins.map((b) => b.id)

  await assertNoReservedBinStock(seededBinIds)

  // Archive first: while the seeded layout is still active, every transfer-stock
  // leg would fire generatePutawayTasks and persist a recommendation for the very
  // stock we are pulling out. Archiving drops the warehouse to 'bulk', where
  // putaway short-circuits to legacy mode.
  console.log('\n1. Layout')
  for (const l of layouts) {
    if (!seedLayoutIds.has(l.id) || l.status === 'archived') continue
    await invokeAdmin('mutate-layout', { action: 'archive_layout', layout_id: l.id })
    console.log(`  · archived seeded layout ${l.id}`)
  }

  console.log('\n2. Stock')
  await drainBins(warehouse, seededBinIds)

  console.log('\n3. Engine state')
  // Scoped to the seed's own rows: an operator's recommendations and home bins for
  // this warehouse are real data and must survive.
  if (seedLayoutIds.size) {
    await supa.from('wie_putaway_recommendations').delete().in('layout_id', [...seedLayoutIds])
  }
  if (seededBinIds.length) {
    await supa.from('product_home_bins').delete().in('bin_id', seededBinIds)
  }
  await supa.from('wie_rules').delete().eq('warehouse_id', warehouse.id).in('name', RULES.map((r) => r.name))
  console.log('  · cleared seeded putaway recommendations, home bins and rules')

  console.log('\n4. Bins')
  for (const bin of seededBins) {
    const code = /-X\d+$/.test(bin.code) ? bin.code : `${bin.code}-X${bin.id}`
    const { error } = await supa.from('locations').update({ is_active: false, code }).eq('id', bin.id)
    if (error) throw new Error(`could not retire bin ${bin.code}: ${error.message}`)
  }
  if (seededBins.length) console.log(`  · retired ${seededBins.length} seeded bin(s) and freed their codes`)

  const previous = await findPreviousLayout(layouts)
  if (!previous) {
    console.warn('  !! no earlier layout with geometry — MAIN is left in bulk mode')
  } else {
    // Reactivate only the bins the restored layout actually places, so bins left
    // over from even older layouts stay retired.
    const { data: placed } = await supa.from('layout_placements')
      .select('location_id').eq('layout_id', previous.id)
    const restoreIds = (placed ?? []).map((p) => p.location_id)
    if (restoreIds.length) await supa.from('locations').update({ is_active: true }).in('id', restoreIds)

    // publish-layout only accepts drafts, so demote before republishing. Safe: the
    // seeded layout is archived by now, so the one-published-per-warehouse partial
    // unique index has nothing to collide with.
    const { error } = await supa.from('warehouse_layouts').update({ status: 'draft' }).eq('id', previous.id)
    if (error) throw new Error(`could not demote layout ${previous.id}: ${error.message}`)
    await invokeAdmin('publish-layout', { layout_id: previous.id })
    console.log(`  · republished layout ${previous.id} ("${previous.name}" v${previous.version}) with ${restoreIds.length} bins`)
  }

  console.log('\n5. Catalogue')
  for (const form of STORAGE_FORMS) {
    const { data } = await supa.from('storage_types').select('id, is_active').eq('code', form.code).maybeSingle()
    if (data?.is_active) await invokeAdmin('mutate-storage-type', { action: 'deactivate', id: data.id })
  }
  await supa.from('zone_profiles').update({ is_active: false })
    .eq('name', COLD_ZONE.name).eq('zone_type', COLD_ZONE.zone_type)
  console.log('  · deactivated seeded storage forms and the cold zone profile')

  const { data: root } = await supa.from('inventory_balances')
    .select('on_hand').eq('location_id', warehouse.id).gt('on_hand', 0)
  const rootUnits = (root ?? []).reduce((n, r) => n + Number(r.on_hand), 0)
  console.log(`\nDone. ${fmt(rootUnits)} units back at the ${warehouse.code} root.`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetMainWarehouse().catch((err) => { console.error(`\n${err.message}`); process.exit(1) })
}
