#!/usr/bin/env node
// Empty this database down to Amadiya's warehouse, so the project can be
// re-badged as their production system.
//
//   node supabase/ops/purge-demo.mjs --env=dev --dry-run
//   node supabase/ops/purge-demo.mjs --env=dev --confirm=<projectRef>
//
// IRREVERSIBLE. Run `npm run export:demo` first and copy the output off this
// machine; the daily Supabase backup is the second net, and it is up to 24
// hours old because Pro does not include PITR.
//
// ── WHY A PURGE AND NOT A NEW PROJECT ───────────────────────────────────────
//
// Decided 2026-08-12. `lsgkznyiabqitqfpveey` is already in ap-southeast-2, its
// org is already on Pro, and Amadiya's 134-location warehouse is already drawn
// in it — the only thing in here worth keeping. The demo moves to a separate
// Vercel + Supabase account later, rebuilt from `demo-export/`.
//
// ── THE HISTORY GOES TOO, AND THAT IS NOT OPTIONAL ──────────────────────────
//
// `profiles` has 36 inbound foreign keys, 35 of them NO ACTION. There is no
// ordering in which `alice@nexorder.com.au` — a live Admin on a password that
// has been in the repo's docs for months — can be deleted while her audit
// events, ledger movements and orders exist. So either the demo accounts stay
// in a client's production user list forever, or the history goes. It goes.
//
// One row blocks even that: Amadiya's own `warehouse_layouts.created_by` is
// alice. It is re-pointed at the surviving admin first. That is the single
// hand-written exception in this script and it is why step 1 exists.
//
// ── WHAT SURVIVES ───────────────────────────────────────────────────────────
//
//   AMADIYA's location subtree, its 2 warehouse_layouts and everything the
//   layout tables hang off them; the seeded config vocabularies; app_settings
//   (rewritten with Amadiya's identity afterwards, not deleted); the migration
//   ledger; the environment marker; one admin.

import { createClient } from '@supabase/supabase-js'

import { requireDevTarget, orExitAsync } from '../../scripts/lib/fixtureGuard.mjs'
import { runSql } from '../../scripts/lib/managementApi.mjs'

const WAREHOUSE = 'AMADIYA'
const KEEP_ADMIN = 'dulshan37gt@gmail.com'

// Created by migrations or rewritten afterwards. Never touched here.
//
// `app_settings` is on this list because it is a singleton with id = 1 that the
// whole app reads; deleting it and re-inserting would be a different row and a
// pointless risk. Phase 2 step 13 UPDATEs it.
const KEEP_WHOLE = new Set([
  'schema_migrations',
  'environment_marker',
  'app_settings',
  'storage_types',
  'zone_profiles',
  'level_roles',
  'rate_limit_counters',
])

// Emptied only of rows that are not Amadiya's. Everything else in `public` is
// wiped outright.
const SCOPED = new Set(['locations', 'warehouse_layouts', 'profiles'])

// Cascade from `warehouse_layouts` / `locations`, so deleting the demo
// warehouses and layouts takes them. Listing them here keeps them out of the
// explicit wipe, where a DELETE would race the cascade for no benefit.
const CASCADES_FROM_LAYOUT = new Set([
  'layout_objects',
  'layout_placements',
  'layout_graph_nodes',
  'layout_graph_edges',
  'layout_travel_distances',
  'wie_location_traffic',
  'warehouse_setup_acknowledgements',
])

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const confirm = argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length)

// The three fixture guards. This runs while the project is still `dev` — the
// re-badge to ('prod','amadiya') is the LAST thing the cutover does, so until
// then this really is the demo project and the demo guard is the right one.
const target = await orExitAsync(() =>
  requireDevTarget({ argv, require: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN'] }),
)

if (!dryRun && confirm !== target.config.projectRef) {
  console.error(
    `\nThis DELETES almost everything in ${target.config.supabaseUrl}.\n` +
      `Re-run with the project ref typed out:\n` +
      `  --confirm=${target.config.projectRef}\n` +
      (confirm ? `\nYou passed --confirm=${confirm}, which is not it.\n` : '\nOr use --dry-run.\n'),
  )
  process.exit(1)
}

const supa = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(`[purge] ${target.name} (${target.config.projectRef})`)
console.log(`[purge] keeping warehouse ${WAREHOUSE} and admin ${KEEP_ADMIN}`)
console.log(dryRun ? '[purge] DRY RUN — nothing will be written\n' : '[purge] LIVE\n')

// ---------------------------------------------------------------------------
// Classify every table, from the catalogue rather than a hand-written list, so
// a table added by a later migration cannot be silently skipped.
// ---------------------------------------------------------------------------

const allTables = (
  await runSql(
    target,
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
  )
).map((r) => r.name)

// Children before parents: the reverse of the export's parents-first order,
// computed the same way so the two can never disagree about the shape of the
// schema.
const edges = await runSql(
  target,
  `SELECT ch.relname AS child, pa.relname AS parent
     FROM pg_constraint c
     JOIN pg_class ch ON ch.oid = c.conrelid
     JOIN pg_namespace nch ON nch.oid = ch.relnamespace
     JOIN pg_class pa ON pa.oid = c.confrelid
     JOIN pg_namespace npa ON npa.oid = pa.relnamespace
    WHERE c.contype = 'f' AND nch.nspname = 'public' AND npa.nspname = 'public'`,
)

const wipeOrder = childrenFirst(allTables, edges).filter(
  (t) => !KEEP_WHOLE.has(t) && !SCOPED.has(t) && !CASCADES_FROM_LAYOUT.has(t),
)

const counts = Object.fromEntries(
  (
    await runSql(
      target,
      allTables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM public."${t}"`).join(' UNION ALL '),
    )
  ).map((r) => [r.t, r.n]),
)

console.log('  KEEP WHOLE')
for (const t of allTables.filter((t) => KEEP_WHOLE.has(t))) console.log(`    ${t.padEnd(34)} ${counts[t]}`)
console.log('\n  SCOPED to ' + WAREHOUSE)
for (const t of allTables.filter((t) => SCOPED.has(t))) console.log(`    ${t.padEnd(34)} ${counts[t]}`)
console.log('\n  VIA CASCADE')
for (const t of allTables.filter((t) => CASCADES_FROM_LAYOUT.has(t))) console.log(`    ${t.padEnd(34)} ${counts[t]}`)
console.log('\n  WIPED')
for (const t of wipeOrder.filter((t) => counts[t] > 0)) console.log(`    ${t.padEnd(34)} ${counts[t]}`)
const emptyAlready = wipeOrder.filter((t) => counts[t] === 0)
console.log(`    (${emptyAlready.length} more already empty)`)

const objectCount = (await runSql(target, `SELECT count(*)::int AS n FROM storage.objects`))[0].n
const authCount = (await runSql(target, `SELECT count(*)::int AS n FROM auth.users`))[0].n
console.log(`\n  storage objects  ${objectCount}\n  auth users       ${authCount} (keeping 1)`)

if (dryRun) {
  console.log('\n[purge] --dry-run: nothing was written.\n')
  await settle()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 1. Re-point Amadiya's layouts off the admin about to be deleted
// ---------------------------------------------------------------------------

const keeper = (await runSql(target, `SELECT id FROM public.profiles WHERE email = ${lit(KEEP_ADMIN)}`))[0]
if (!keeper) {
  console.error(`\n[purge] ✗ ${KEEP_ADMIN} has no profile. Refusing to delete every user.\n`)
  await settle()
  process.exit(1)
}

const repointed = await runSql(
  target,
  `UPDATE public.warehouse_layouts w SET created_by = ${lit(keeper.id)}
     FROM public.locations l
    WHERE l.id = w.warehouse_id AND l.code = ${lit(WAREHOUSE)} AND w.created_by <> ${lit(keeper.id)}
    RETURNING w.id`,
)
console.log(`[purge] 1. re-pointed ${repointed.length} Amadiya layout(s) onto the surviving admin`)

// ---------------------------------------------------------------------------
// 2. Wipe, children first
// ---------------------------------------------------------------------------

// The topological order is a HEURISTIC here, not a guarantee. Two real FK
// cycles (profiles↔horecas, warehouse_layouts↔locations) mean the sort has to
// break edges to finish, and a broken edge is exactly a pair the order no
// longer describes correctly — `orders` lands before `order_items` in this
// schema for that reason. Rather than hand-tune a list that a future migration
// would invalidate, retry until no further progress is possible: any ordering
// mistake costs one extra pass instead of a half-purged database.
let wiped = 0
let remaining = wipeOrder.filter((t) => counts[t] > 0)
const blocked = new Map()

for (let pass = 1; remaining.length; pass += 1) {
  const stillBlocked = []
  for (const t of remaining) {
    try {
      await runSql(target, `DELETE FROM public."${t}"`)
      wiped += counts[t]
      blocked.delete(t)
    } catch (e) {
      stillBlocked.push(t)
      blocked.set(t, e.message)
    }
  }
  if (stillBlocked.length === remaining.length) {
    console.error(`\n[purge] ✗ ${stillBlocked.length} table(s) cannot be emptied — no progress on pass ${pass}:`)
    for (const t of stillBlocked) console.error(`    ${t}: ${(blocked.get(t) ?? '').slice(0, 240)}`)
    console.error('\n  Something references them that this script does not know to delete.')
    console.error('  The database is PARTLY PURGED. Fix the classification and re-run — the wipe is idempotent.\n')
    await settle()
    process.exit(1)
  }
  if (stillBlocked.length) {
    console.log(`[purge]    pass ${pass}: ${remaining.length - stillBlocked.length} emptied, ${stillBlocked.length} blocked, retrying`)
  }
  remaining = stillBlocked
}
console.log(`[purge] 2. wiped ${wiped} rows across ${wipeOrder.filter((t) => counts[t] > 0).length} tables`)

// ---------------------------------------------------------------------------
// 3. Demo layouts (cascades every layout_* child)
// ---------------------------------------------------------------------------

const layoutsGone = await runSql(
  target,
  `DELETE FROM public.warehouse_layouts w
    USING public.locations l
    WHERE l.id = w.warehouse_id AND l.code <> ${lit(WAREHOUSE)}
    RETURNING w.id`,
)
console.log(`[purge] 3. deleted ${layoutsGone.length} demo layout(s) and their geometry`)

// ---------------------------------------------------------------------------
// 4. Demo locations, leaves first
//
// `locations.parent_id` is RESTRICT, not NO ACTION, so it is enforced per-row
// rather than at end of statement: a single DELETE over a whole subtree fails
// on the first parent it reaches. Peel leaves until none are left.
// ---------------------------------------------------------------------------

const NOT_AMADIYA = `(materialized_path <> ${lit(WAREHOUSE)} AND materialized_path NOT LIKE ${lit(WAREHOUSE + '/%')})`
let locationsGone = 0
for (let pass = 1; ; pass += 1) {
  const gone = await runSql(
    target,
    `DELETE FROM public.locations
      WHERE ${NOT_AMADIYA}
        AND id NOT IN (SELECT parent_id FROM public.locations WHERE parent_id IS NOT NULL)
      RETURNING id`,
  )
  locationsGone += gone.length
  if (gone.length === 0) break
  if (pass > 40) {
    console.error('[purge] ✗ location tree did not drain in 40 passes — a cycle or a blocked FK.')
    await settle()
    process.exit(1)
  }
}
console.log(`[purge] 4. deleted ${locationsGone} demo location(s)`)

// ---------------------------------------------------------------------------
// 5. Users. Profile first, then the auth row — deleting the auth user cascades
//    into profiles anyway, but doing it in this order means a failure leaves a
//    login without a profile (harmless, refused by requireAuth) rather than a
//    profile without a login (a ghost in the user list).
// ---------------------------------------------------------------------------

const doomed = await runSql(target, `SELECT id, email FROM public.profiles WHERE email <> ${lit(KEEP_ADMIN)}`)
for (const p of doomed) {
  await runSql(target, `DELETE FROM public.profiles WHERE id = ${lit(p.id)}`)
  const { error } = await supa.auth.admin.deleteUser(p.id)
  if (error) console.error(`[purge]    ⚠ auth user ${p.email} not deleted: ${error.message}`)
}
console.log(`[purge] 5. deleted ${doomed.length} user(s); kept ${KEEP_ADMIN}`)

// ---------------------------------------------------------------------------
// 6. Storage. Every object in every bucket — the export holds them all, and an
//    orphaned signature or PO archive in a client's bucket is demo residue that
//    nothing in the app will ever reference again.
// ---------------------------------------------------------------------------

const buckets = await runSql(target, `SELECT DISTINCT bucket_id FROM storage.objects ORDER BY 1`)
let objectsGone = 0
for (const { bucket_id } of buckets) {
  const keys = (
    await runSql(target, `SELECT name FROM storage.objects WHERE bucket_id = ${lit(bucket_id)} ORDER BY name`)
  ).map((r) => r.name)
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100)
    const { error } = await supa.storage.from(bucket_id).remove(batch)
    if (error) console.error(`[purge]    ⚠ ${bucket_id}: ${error.message}`)
    else objectsGone += batch.length
  }
}
console.log(`[purge] 6. deleted ${objectsGone} storage object(s)`)

// ---------------------------------------------------------------------------
// 7. Verify
// ---------------------------------------------------------------------------

const after = await runSql(
  target,
  `SELECT
     (SELECT count(*)::int FROM public.locations)                                       AS locations,
     (SELECT count(*)::int FROM public.locations WHERE ${NOT_AMADIYA})                  AS stray_locations,
     (SELECT count(*)::int FROM public.warehouse_layouts)                               AS layouts,
     (SELECT count(*)::int FROM public.profiles)                                        AS profiles,
     (SELECT count(*)::int FROM auth.users)                                             AS auth_users,
     (SELECT count(*)::int FROM storage.objects)                                        AS objects,
     (SELECT count(*)::int FROM public.products)                                        AS products,
     (SELECT count(*)::int FROM public.horecas)                                         AS horecas,
     (SELECT count(*)::int FROM public.orders)                                          AS orders,
     (SELECT count(*)::int FROM public.audit_events)                                    AS audit_events,
     (SELECT count(*)::int FROM public.inventory_balances)                              AS stock,
     (SELECT count(*)::int FROM public.storage_types)                                   AS storage_types,
     (SELECT count(*)::int FROM public.zone_profiles)                                   AS zone_profiles,
     (SELECT count(*)::int FROM public.level_roles)                                     AS level_roles,
     (SELECT count(*)::int FROM public.schema_migrations)                               AS migrations`,
)
const a = after[0]
console.log('\n[purge] after:')
for (const [k, v] of Object.entries(a)) console.log(`    ${k.padEnd(18)} ${v}`)

const problems = []
if (a.stray_locations !== 0) problems.push(`${a.stray_locations} non-${WAREHOUSE} location(s) survived`)
if (a.profiles !== 1) problems.push(`${a.profiles} profiles remain, expected 1`)
if (a.objects !== 0) problems.push(`${a.objects} storage object(s) remain`)
if (a.products || a.horecas || a.orders || a.stock) problems.push('business data survived')
if (a.storage_types === 0 || a.zone_profiles === 0 || a.level_roles === 0) {
  problems.push('a seeded config vocabulary was deleted — Amadiya\'s layout depends on these')
}
if (a.migrations === 0) problems.push('the migration ledger is gone')

console.log(
  problems.length
    ? `\n[purge] ✗ ${problems.length} problem(s):\n    ${problems.join('\n    ')}\n`
    : `\n[purge] ✓ down to ${WAREHOUSE} (${a.locations} locations, ${a.layouts} layouts) and one admin.` +
        `\n[purge]   Next: stamp the marker — node supabase/migrate.mjs --env=amadiya --stamp-only\n`,
)
if (problems.length) process.exitCode = 1

await settle()

/**
 * Reverse topological order. Cycles are broken deterministically; see
 * export-demo.mjs for why the naive "everything left is cyclic" version reports
 * fifty tables when there are two real cycles.
 */
function childrenFirst(names, fkEdges) {
  const set = new Set(names)
  const deps = new Map(names.map((n) => [n, new Set()]))
  const dependents = new Map(names.map((n) => [n, new Set()]))
  for (const { child, parent } of fkEdges) {
    if (child === parent || !set.has(child) || !set.has(parent)) continue
    deps.get(child).add(parent)
    dependents.get(parent).add(child)
  }
  const ordered = []
  const emitted = new Set()
  const release = (n) => {
    ordered.push(n)
    emitted.add(n)
    for (const d of dependents.get(n)) deps.get(d).delete(n)
  }
  while (emitted.size < names.length) {
    const ready = names.filter((n) => !emitted.has(n) && deps.get(n).size === 0).sort()
    if (ready.length) {
      for (const n of ready) release(n)
      continue
    }
    const stuck = names
      .filter((n) => !emitted.has(n))
      .sort((x, y) => deps.get(x).size - deps.get(y).size || x.localeCompare(y))
    deps.get(stuck[0]).clear()
    release(stuck[0])
  }
  return ordered.reverse()
}

function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
