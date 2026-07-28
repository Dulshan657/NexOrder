#!/usr/bin/env node
// Exercise the replenishment loop end to end, which is the documented GATE on
// applying migration 00083 (order allocation prefers the pick zone):
//
//   "configure min/max on two or three SKUs, watch one replenishment task go
//    suggested -> assigned -> accepted with the stock actually moving, THEN apply."
//
// Runs against WIE-DEMO (warehouse 2), the standalone demo DC with its own
// seed/reset scripts — not MAIN, which holds real stock, and not E2ERACKLVL,
// which an E2E run can clobber.
//
//   node supabase/exercise-replen-gate.mjs --env=dev          # run the gate
//   node supabase/exercise-replen-gate.mjs --env=dev --report # just print current state
//
// Dev-only: the import below pulls in warehouse-main/lib.mjs, which resolves the
// target through the three fixture guards and refuses anything but dev.
//
// Everything goes through the real Edge Functions as an Admin (warehouse-main/
// lib.mjs `invokeAdmin`), not raw SQL, so the auth, validation and audit layers
// are exercised too.
import { supa, invokeAdmin } from '../warehouse-main/lib.mjs'

const WAREHOUSE_ID = 2
const LAYOUT_ID = 6
// A WIE-DEMO bin holding a single SKU, converted to a two-level rack below.
const BIN_ID = 33
const PRODUCT_ID = 205
const SUPPLIER_ID = 1 // receive-stock refuses a receipt with no supplier

const log = (...a) => console.log(...a)
const step = (n, s) => log(`\n[${n}] ${s}`)

async function levelsOf(parentId) {
  const { data } = await supa
    .from('locations')
    .select('id, code, level_index, level_role, is_active')
    .eq('parent_id', parentId)
    .order('level_index')
  return (data ?? []).filter((l) => l.level_index != null && l.is_active)
}

async function balancesAt(locationIds) {
  const { data } = await supa
    .from('inventory_balances')
    .select('location_id, product_id, on_hand, available')
    .in('location_id', locationIds)
    .gt('on_hand', 0)
  return data ?? []
}

async function tasks() {
  // Note the source-side audit trio (mig 00082): the DESTINATION is the task —
  // it is the pick slot that is low — so what varies is which reserve bin was
  // recommended, assigned and actually pulled from.
  const { data, error } = await supa
    .from('wie_replen_tasks')
    .select('id, status, product_id, to_location_id, recommended_from_location_id, ' +
            'assigned_from_location_id, chosen_from_location_id, quantity, explanation')
    .eq('warehouse_id', WAREHOUSE_ID)
    .order('id')
  if (error) throw new Error(`reading wie_replen_tasks: ${error.message}`)
  return data ?? []
}

async function report() {
  const levels = await levelsOf(BIN_ID)
  log('levels under bin', BIN_ID, JSON.stringify(levels, null, 2))
  if (levels.length) log('balances', JSON.stringify(await balancesAt(levels.map((l) => l.id)), null, 2))
  log('replen tasks', JSON.stringify(await tasks(), null, 2))
}

async function main() {
  if (process.argv.includes('--report')) return report()

  step(1, 'Convert the bin into a levelled rack: L1 = pick zone, L2 = reserve')
  let levels = await levelsOf(BIN_ID)
  if (levels.length === 0) {
    // convert_to_levels is the only action that MOVES LIVE STOCK — the bin's
    // existing quantity lands on L1, i.e. in the pick zone. That is what we
    // want: the pick face starts stocked, and we create the shortfall by
    // setting min_qty above it in step 3.
    await invokeAdmin('mutate-warehouse-location', {
      action: 'convert_to_levels',
      id: BIN_ID,
      layout_id: LAYOUT_ID,
      levels: [
        { level_index: 1, role: 'pick', capacity_slots: 48 },
        { level_index: 2, role: 'reserve', capacity_slots: 48 },
      ],
    })
    levels = await levelsOf(BIN_ID)
  }
  const pick = levels.find((l) => l.level_role === 'pick')
  const reserve = levels.find((l) => l.level_role === 'reserve')
  if (!pick || !reserve) throw new Error(`expected a pick and a reserve level, got ${JSON.stringify(levels)}`)
  log('   pick   ', pick.id, pick.code)
  log('   reserve', reserve.id, reserve.code)

  step(2, 'Receive stock, then transfer it into the RESERVE level')
  const before = await balancesAt([pick.id, reserve.id])
  const reserveQty = Number(before.find((b) => b.location_id === reserve.id)?.available ?? 0)
  if (reserveQty < 24) {
    // receive-stock always lands at the warehouse ROOT (putaway is what moves
    // goods to a bin), so seeding a specific level takes a second hop.
    await invokeAdmin('receive-stock', {
      receipt: { location_id: WAREHOUSE_ID, reference: 'replen-gate', supplier_id: SUPPLIER_ID },
      lines: [{ product_id: PRODUCT_ID, quantity: 48 }],
    })
    await invokeAdmin('transfer-stock', {
      productId: PRODUCT_ID,
      fromLocationId: WAREHOUSE_ID,
      toLocationId: reserve.id,
      qty: 48,
      reason: 'replen-gate: seed the reserve level',
    })
  }
  log('   balances', JSON.stringify(await balancesAt([pick.id, reserve.id])))

  step(3, 'Set a home bin on the PICK level with min above what it currently holds')
  const pickQty = Number((await balancesAt([pick.id])).find((b) => b.location_id === pick.id)?.available ?? 0)
  log(`   pick currently holds ${pickQty}; setting min=24 max=36 -> short by ${Math.max(0, 24 - pickQty)}`)
  await invokeAdmin('mutate-product-home-bin', {
    action: 'set',
    productId: PRODUCT_ID,
    warehouseId: WAREHOUSE_ID,
    binId: pick.id,
    minQty: 24,
    maxQty: 36,
    replenEnabled: true,
  })

  step(4, 'detect-replenishment')
  const detected = await invokeAdmin('detect-replenishment', { warehouse_id: WAREHOUSE_ID, product_id: PRODUCT_ID })
  log('   ->', JSON.stringify(detected))
  const all = await tasks()
  const suggested = all.filter((t) => t.status === 'suggested')
  const accepted = all.filter((t) => t.status === 'accepted' && t.to_location_id === pick.id)
  if (suggested.length === 0 && accepted.length > 0) {
    // Re-run against an already-topped-up pick face. Raising nothing here is
    // CORRECT, not a failure — the slot is at or above min. Verify the task
    // that already completed instead of forcing a redundant second move.
    log('   pick face is already at/above min, so nothing raised — as designed.')
    log('   verifying the previously accepted task instead.')
    return verifyMoved(accepted[accepted.length - 1], pick, reserve)
  }
  if (suggested.length === 0) {
    // The queue MUST be able to explain a no-task outcome; sizing is from
    // `available`, never on_hand, so fully-allocated reserve stock raises none.
    throw new Error(`no task suggested. detector said: ${JSON.stringify(detected)}`)
  }
  const task = suggested[suggested.length - 1]
  log('   suggested task', task.id, `qty=${task.quantity}`, JSON.stringify(task.explanation))

  step(5, 'assign-replenishment (no stock should move yet)')
  await invokeAdmin('assign-replenishment', { task_id: task.id, from_location_id: reserve.id })
  const midway = await balancesAt([pick.id, reserve.id])
  log('   status  ', (await tasks()).find((t) => t.id === task.id)?.status)
  log('   balances', JSON.stringify(midway), '<- must be unchanged from step 3')

  step(6, 'complete-replenishment with both scans (this is where stock moves)')
  await invokeAdmin('complete-replenishment', {
    task_id: task.id,
    actual_from_location_id: reserve.id,
    scan: { fromLocationCode: reserve.code, toLocationCode: pick.code },
  })
  const done = (await tasks()).find((t) => t.id === task.id)
  log('   status  ', done?.status)
  log('   balances', JSON.stringify(await balancesAt([pick.id, reserve.id])))

  return verifyMoved(task, pick, reserve)
}

async function verifyMoved(task, pick, reserve) {
  step(7, 'Prove the stock actually moved (the real gate condition)')
  // TRACEABILITY GAP, worth knowing: complete-replenishment moves stock through
  // inv_transfer_stock, which writes GENERIC legs — ref_type 'transfer' and a
  // NULL ref_id. Nothing on the ledger names the replenishment task, so "which
  // task moved this stock?" is not answerable from inventory_movements alone;
  // you have to correlate on (product, from, to, qty, time). Hence the match
  // below is on the leg pair rather than on a task id.
  const { data: legs } = await supa
    .from('inventory_movements')
    .select('id, movement_type, location_id, qty_delta, ref_type, ref_id, handling_unit_id')
    .in('location_id', [pick.id, reserve.id])
    .eq('product_id', PRODUCT_ID)
    .order('id', { ascending: false })
    .limit(6)
  log(JSON.stringify(legs, null, 2))

  const out = (legs ?? []).find((l) => l.location_id === reserve.id && Number(l.qty_delta) < 0)
  const into = (legs ?? []).find((l) => l.location_id === pick.id && Number(l.qty_delta) > 0)
  const moved = !!out && !!into && Number(into.qty_delta) === -Number(out.qty_delta)
  if (moved) {
    log(`   matched pair: ${out.qty_delta} at reserve -> +${into.qty_delta} at pick, plate ${into.handling_unit_id}`)
  }

  const status = (await tasks()).find((t) => t.id === task.id)?.status
  const passed = moved && status === 'accepted'
  log(`\nGATE ${passed ? 'PASSED' : 'FAILED'} — task ${task.id}: ` +
    `suggested -> assigned -> ${status}, matched ledger legs: ${moved}`)
  if (!passed) process.exit(1)
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
