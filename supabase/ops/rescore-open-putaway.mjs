#!/usr/bin/env node
// Re-score every OPEN putaway task at a warehouse, against the current engine.
//
//   node supabase/ops/rescore-open-putaway.mjs --env=dev --warehouse=2873 --dry-run
//   node supabase/ops/rescore-open-putaway.mjs --env=dev --warehouse=2873
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Migrations 00122 and 00123 changed what the planner believes about space:
//
//   00122  a plate is ONE position in a plate-denominated bay, whatever kind of
//          plate it is. Before it, a carton plate was charged qty × size_factor
//          against AMD_BULK's ceiling of 1, so one physical plate was split into
//          one task per bay — twelve packets became twelve destinations.
//   00123  an OPEN task holds the space it was promised. Before it, assigning
//          moved no stock (00080, correctly), `v_bin_fill` read only
//          `inventory_balances`, and so a one-position bay read EMPTY however
//          many tasks already named it. Three plates were sent to one pallet
//          cell, under the same name and the same barcode.
//
// Neither migration can repair the rows the old engine already wrote: the
// scoring lives in TypeScript (deliberately — see 00116), so re-scoring means
// re-running the engine, not an UPDATE. That is what this does.
//
// ── HOW ─────────────────────────────────────────────────────────────────────
//
// Through the real Edge Functions, with a real Admin session, so every role
// gate, rate limit and audit event applies exactly as it would to an operator:
//
//   1. `decide-putaway` with `unassign` returns an ASSIGNED task to the queue.
//      This moves NO stock — assignment never did (00080) — it only releases
//      the bay it was holding.
//   2. `recommend-putaway` with `replaces_recommendation_id` re-scores it. That
//      function expires the row it supersedes BEFORE calling the engine, so a
//      task can never block its own bay, and the queue never shows two live
//      rows for the same stock.
//
// A line the engine can no longer place comes back with a NULL location — a
// manual-placement residual. That is the honest answer for a full site, and it
// is the answer the old engine was unable to give: it double-booked instead.
//
// IDEMPOTENT. Re-running it re-scores the (already correct) rows to the same
// bays; a second run should report no destination changes. That is the check
// that the repair is complete rather than partway.
//
// Nothing here is fixture-guarded: re-scoring is an ordinary operation a tenant
// needs after this release, not demo seeding. It is `--env=`-gated like every
// other script, and `--dry-run` reports without writing.

import { createClient } from '@supabase/supabase-js'
import { resolveTarget, orExit } from '../../scripts/lib/env.mjs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const dryRun = argv.includes('--dry-run')
const warehouseId = Number(flag('warehouse'))
const adminEmail = flag('admin')

if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
  console.error('\nRequired: --warehouse=<locations.id of the WAREHOUSE root>\n')
  process.exit(1)
}

const { name, config, env } = orExit(() =>
  resolveTarget({ require: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] }),
)

// The engine runs behind Edge Functions that require an ADMIN/MANAGER JWT — a
// service-role key is not a user and `requireAuth` will refuse it. So this needs
// a real login. On dev that is the seeded admin; on a tenant, pass --admin= and
// the password on stdin via ADMIN_PASSWORD.
const email = adminEmail ?? env.OPS_ADMIN_EMAIL ?? 'alice@nexorder.com.au'
const password = env.ADMIN_PASSWORD ?? env.SEED_USER_PASSWORD
if (!password) {
  console.error(
    `\nNo admin password available for target "${name}".\n` +
      `Set ADMIN_PASSWORD in the environment (or SEED_USER_PASSWORD in ${config.envFile} on a demo).\n`,
  )
  process.exit(1)
}

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error: authErr } = await sb.auth.signInWithPassword({ email, password })
if (authErr) {
  console.error(`\nSign-in failed for ${email} on "${name}": ${authErr.message}\n`)
  process.exit(1)
}
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: wh } = await admin
  .from('locations').select('id, code, kind').eq('id', warehouseId).maybeSingle()
if (!wh || wh.kind !== 'WAREHOUSE') {
  console.error(`\nLocation ${warehouseId} is not a WAREHOUSE root on "${name}".\n`)
  process.exit(1)
}

const { data: rows, error } = await admin
  .from('wie_putaway_recommendations')
  .select('id, status, product_id, quantity, handling_unit_id, goods_receipt_id, recommended_location_id, assigned_location_id')
  .eq('warehouse_id', warehouseId)
  .in('status', ['suggested', 'assigned'])
  .order('id')
if (error) throw error

console.log(`\n[rescore] target ${name} (${config.projectRef}) · warehouse ${wh.code} (${warehouseId})`)
console.log(`[rescore] ${rows.length} open task(s): ` +
  `${rows.filter((r) => r.status === 'assigned').length} assigned, ` +
  `${rows.filter((r) => r.status === 'suggested').length} suggested`)

if (dryRun) {
  // SHARING A BAY IS NOT THE DEFECT. A 36-carton bay holding three tasks of
  // twelve is the planner using real headroom. The defect is a bay booked past
  // its CEILING, which is what v_bin_pending_putaway (00123) can now answer —
  // so report that, not a task count that looks alarming and is not.
  const byBay = new Map()
  for (const r of rows) {
    const bay = r.assigned_location_id ?? r.recommended_location_id
    if (bay == null) continue
    byBay.set(bay, (byBay.get(bay) ?? 0) + 1)
  }
  const ids = [...byBay.keys()]
  const { data: bays } = ids.length
    ? await admin.from('locations').select('id, code, capacity_slots, slot_kind').in('id', ids)
    : { data: [] }
  const { data: fill } = ids.length
    ? await admin.from('v_bin_fill').select('location_id, used_slots').in('location_id', ids)
    : { data: [] }
  const { data: pend } = ids.length
    ? await admin.from('v_bin_pending_putaway').select('location_id, pending_slots').in('location_id', ids)
    : { data: [] }

  const over = []
  for (const b of bays ?? []) {
    if (b.capacity_slots == null) continue
    const used = Number((fill ?? []).find((f) => f.location_id === b.id)?.used_slots ?? 0)
    const promised = Number((pend ?? []).find((p) => p.location_id === b.id)?.pending_slots ?? 0)
    if (used + promised > Number(b.capacity_slots)) {
      over.push({ ...b, used, promised, tasks: byBay.get(b.id) })
    }
  }

  console.log(`[rescore] --dry-run: nothing written.`)
  console.log(`[rescore] ${byBay.size} bay(s) named by an open task; ${over.length} booked past the ceiling:`)
  for (const b of over) {
    console.log(`  ${b.code} (${b.slot_kind}, cap ${b.capacity_slots}) ` +
      `← ${b.tasks} task(s), stock ${b.used} + promised ${b.promised}`)
  }
  if (over.length === 0) console.log('  none — every open task fits where it is pointed.')
  process.exit(0)
}

// 1. Release every assigned bay. Moves no stock.
for (const r of rows.filter((x) => x.status === 'assigned')) {
  const { error: e } = await sb.functions.invoke('decide-putaway', {
    body: { recommendation_id: r.id, decision: 'unassign' },
  })
  if (e) throw new Error(`unassign ${r.id} failed: ${e.message}`)
  console.log(`  unassigned ${r.id}`)
}

// 2. Re-score each line. One call per row; each expires the row it supersedes.
let rescored = 0
let unplaceable = 0
for (const r of rows) {
  const { data: cur } = await admin
    .from('wie_putaway_recommendations')
    .select('id, status, product_id, quantity, handling_unit_id, goods_receipt_id')
    .eq('id', r.id).maybeSingle()
  if (!cur || cur.status !== 'suggested') {
    console.log(`  skip ${r.id} (${cur?.status ?? 'gone'})`)
    continue
  }
  const { data: hu } = cur.handling_unit_id
    ? await admin.from('handling_units').select('id, hu_type').eq('id', cur.handling_unit_id).maybeSingle()
    : { data: null }

  const { data, error: e } = await sb.functions.invoke('recommend-putaway', {
    body: {
      warehouse_id: warehouseId,
      goods_receipt_id: cur.goods_receipt_id ?? undefined,
      replaces_recommendation_id: r.id,
      lines: [{
        product_id: cur.product_id,
        quantity: Number(cur.quantity),
        hu_id: hu?.id ?? undefined,
        hu_type: hu?.hu_type ?? undefined,
      }],
    },
  })
  if (e) throw new Error(`rescore ${r.id} failed: ${e.message}`)
  const recs = data?.recommendations ?? []
  const placed = recs.filter((x) => x.recommendedLocationId != null)
  if (placed.length < recs.length) unplaceable += recs.length - placed.length
  console.log(`  rescored ${r.id} → ${recs.length} row(s) [${recs.map((x) => x.recommendedLocationId ?? 'manual').join(', ')}]`)
  rescored += 1
}

console.log(`\n[rescore] re-scored ${rescored} task(s)` +
  (unplaceable ? `, ${unplaceable} line(s) need manual placement (the site is full)` : ''))
console.log(`[rescore] Verify: no bay may be booked past its ceiling —`)
console.log(`  SELECT l.code, l.capacity_slots, f.used_slots, p.pending_slots`)
console.log(`    FROM public.locations l`)
console.log(`    LEFT JOIN public.v_bin_fill f            ON f.location_id = l.id`)
console.log(`    LEFT JOIN public.v_bin_pending_putaway p ON p.location_id = l.id`)
console.log(`   WHERE l.capacity_slots IS NOT NULL`)
console.log(`     AND COALESCE(f.used_slots,0) + COALESCE(p.pending_slots,0) > l.capacity_slots;`)
