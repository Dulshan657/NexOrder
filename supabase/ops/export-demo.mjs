#!/usr/bin/env node
// Export the whole demo database to disk, so it survives the project being
// re-badged as Amadiya's production system.
//
//   node supabase/ops/export-demo.mjs --env=dev
//   node supabase/ops/export-demo.mjs --env=dev --out=../nexorder-demo-export
//
// Read-only. Runs behind the three fixture guards (createDevClient), which is
// not paranoia about writes — it is what stops this being pointed at a tenant
// and dumping a client's database to an unencrypted folder on a laptop.
//
// This is the ONLY artefact standing between us and losing the Tridon / V2food
// / AYAM demos, WIE-DEMO and the MAIN warehouse. Copy the output off this
// machine before running purge-demo.mjs.
//
// What is NOT exported, deliberately:
//   - auth.users password hashes. They are bcrypt and portable in principle,
//     but a file of credential hashes on a laptop is a liability and the demo
//     accounts are seeded ones we can re-mint. The rebuild re-invites.
//   - Anything outside `public` and `storage`. The schema itself lives in
//     supabase/migrations/ and is rebuilt by migrate.mjs, not restored.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { createDevClient } from '../../scripts/lib/devClient.mjs'
import { ROOT } from '../../scripts/lib/env.mjs'
import { runSql } from '../../scripts/lib/managementApi.mjs'

const CHUNK = 2000

// Tables a cron writes to while the export is running. Their row count WILL
// move mid-run — `health-check` fires every 5 minutes and `rate_limit_hit()`
// on every gated request — so drift here is background noise, not evidence
// that someone is using the system. Drift on anything else still fails the
// run, because that would mean the snapshot is internally inconsistent.
const VOLATILE_TABLES = new Set(['health_checks', 'rate_limit_counters'])

const argv = process.argv.slice(2)
const outFlag = argv.find((a) => a.startsWith('--out='))
const OUT = resolve(ROOT, outFlag ? outFlag.slice('--out='.length) : 'demo-export')

const { supa, target } = await createDevClient({ argv })

console.log(`[export] destination ${OUT}`)

// ---------------------------------------------------------------------------
// Table discovery and FK ordering
// ---------------------------------------------------------------------------

// Ordinary tables only — views and matviews are derived, and restoring one
// would fail against the view's own definition.
const tables = (
  await runSql(
    target,
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY 1`,
  )
).map((r) => r.name)

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

/**
 * Kahn's algorithm, parents before children, so a future importer can insert in
 * file order without deferring every constraint.
 *
 * This schema genuinely contains FK cycles — `profiles.horeca_id` ↔
 * `horecas.created_by_user_id`, and `warehouse_layouts.warehouse_id` ↔
 * `locations.created_in_layout_id`. A naive "everything still unemitted is
 * cyclic" fallback reported FIFTY tables, because two real two-node cycles hold
 * back every table downstream of them. So when the frontier stalls, break the
 * smallest remaining node deterministically and record the EDGES that were
 * deferred — that short list is the actual instruction to an importer (insert
 * these columns null, then UPDATE), and it is what the manifest carries.
 *
 * Self-references are dropped up front: a tree table like `locations` orders
 * within itself and would otherwise never become ready.
 */
function topoSort(names, fkEdges) {
  const set = new Set(names)
  const deps = new Map(names.map((n) => [n, new Set()]))
  const dependents = new Map(names.map((n) => [n, new Set()]))

  for (const { child, parent } of fkEdges) {
    if (child === parent) continue
    if (!set.has(child) || !set.has(parent)) continue
    deps.get(child).add(parent)
    dependents.get(parent).add(child)
  }

  const ordered = []
  const emitted = new Set()
  const deferredEdges = []

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
    // Stalled: every remaining table sits in or behind a cycle. Emit the one
    // with the fewest unmet parents (alphabetical tie-break, so the order is
    // reproducible run to run) and record what that costs.
    const stuck = names.filter((n) => !emitted.has(n))
    stuck.sort((a, b) => deps.get(a).size - deps.get(b).size || a.localeCompare(b))
    const victim = stuck[0]
    for (const parent of [...deps.get(victim)].sort()) {
      deferredEdges.push({ child: victim, parent })
    }
    deps.get(victim).clear()
    release(victim)
  }

  return { ordered, deferredEdges }
}

const { ordered, deferredEdges } = topoSort(tables, edges)
console.log(`[export] ${ordered.length} tables, ordered parents-first`)
if (deferredEdges.length) {
  console.log(
    `[export]   ${deferredEdges.length} FK edge(s) deferred by a cycle: ` +
      deferredEdges.map((e) => `${e.child}→${e.parent}`).join(', '),
  )
}

// ---------------------------------------------------------------------------
// Table data
// ---------------------------------------------------------------------------

mkdirSync(join(OUT, 'data'), { recursive: true })

/** Pull one table in ctid order. Stable for a static snapshot, and needs no
 *  knowledge of which column is the primary key (several tables are composite,
 *  and `order by` on the wrong column silently reshuffles pages). */
async function readTable(name) {
  const rows = []
  for (let offset = 0; ; offset += CHUNK) {
    const res = await runSql(
      target,
      `SELECT coalesce(json_agg(t), '[]'::json) AS rows
         FROM (SELECT * FROM public."${name}" ORDER BY ctid LIMIT ${CHUNK} OFFSET ${offset}) t`,
    )
    const page = res?.[0]?.rows ?? []
    rows.push(...page)
    if (page.length < CHUNK) break
  }
  return rows
}

const tableCounts = {}
for (const name of ordered) {
  const rows = await readTable(name)
  writeFileSync(join(OUT, 'data', `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  tableCounts[name] = rows.length
}

const nonEmpty = Object.entries(tableCounts).filter(([, n]) => n > 0)
console.log(
  `[export] ${nonEmpty.length}/${ordered.length} tables hold data, ` +
    `${Object.values(tableCounts).reduce((a, b) => a + b, 0)} rows total`,
)

// ---------------------------------------------------------------------------
// auth.users — identities only, no secrets
// ---------------------------------------------------------------------------

const authUsers = await runSql(
  target,
  `SELECT id, email, raw_user_meta_data, created_at, last_sign_in_at, email_confirmed_at
     FROM auth.users ORDER BY created_at`,
)
writeFileSync(join(OUT, 'auth-users.json'), `${JSON.stringify(authUsers, null, 2)}\n`, 'utf8')
console.log(`[export] ${authUsers.length} auth users (identities only — no password hashes)`)

// ---------------------------------------------------------------------------
// Storage objects
// ---------------------------------------------------------------------------

// Object keys are not filenames. A Graph message id carries `/` and `=`, and a
// key may contain characters Windows refuses outright (`:` `?` `*` `|` `<` `>`
// `"`). So the on-disk path is sanitised for browsability and the TRUE key is
// recorded in index.json, which is what a restore reads. Never reconstruct a
// key from a path.
// The control-character range is the point here: these are bytes a filesystem
// refuses outright, not text to be matched.
// eslint-disable-next-line no-control-regex
const WINDOWS_UNSAFE = /[<>:"|?*\u0000-\u001f]/g

function safeRelPath(bucket, key) {
  const segments = key
    .split('/')
    .filter((s) => s.length && s !== '.' && s !== '..')
    .map((s) => s.replace(WINDOWS_UNSAFE, '_').replace(/[. ]+$/, '_'))
  return join(bucket, ...segments)
}

const objects = await runSql(
  target,
  `SELECT bucket_id, name, (metadata->>'size')::bigint AS size
     FROM storage.objects ORDER BY bucket_id, name`,
)

const buckets = await runSql(
  target,
  `SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id`,
)
writeFileSync(join(OUT, 'storage-buckets.json'), `${JSON.stringify(buckets, null, 2)}\n`, 'utf8')

const index = []
const usedPaths = new Set()
const failures = []

for (const obj of objects) {
  let rel = safeRelPath(obj.bucket_id, obj.name)
  if (usedPaths.has(rel)) {
    // Two distinct keys sanitised to the same path. Disambiguate rather than
    // overwrite — an overwrite loses a file and reports success.
    const tag = createHash('sha1').update(`${obj.bucket_id}/${obj.name}`).digest('hex').slice(0, 8)
    rel = `${rel}.${tag}`
  }
  usedPaths.add(rel)

  const { data, error } = await supa.storage.from(obj.bucket_id).download(obj.name)
  if (error || !data) {
    failures.push({ bucket: obj.bucket_id, name: obj.name, error: error?.message ?? 'no body' })
    continue
  }

  const abs = join(OUT, 'storage', rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, Buffer.from(await data.arrayBuffer()))
  index.push({ bucket: obj.bucket_id, key: obj.name, file: rel.replace(/\\/g, '/'), size: obj.size })
}

mkdirSync(join(OUT, 'storage'), { recursive: true })
writeFileSync(join(OUT, 'storage', 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`[export] ${index.length}/${objects.length} storage objects downloaded`)

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const ledger = await runSql(
  target,
  `SELECT filename, applied_at FROM public.schema_migrations ORDER BY applied_at DESC, filename DESC LIMIT 1`,
)

const manifest = {
  exportedAt: new Date().toISOString(),
  source: {
    target: target.name,
    projectRef: target.config.projectRef,
    supabaseUrl: target.config.supabaseUrl,
    marker: target.marker,
  },
  migrationLedgerHead: ledger?.[0] ?? null,
  migrationCount: (await runSql(target, `SELECT count(*)::int AS n FROM public.schema_migrations`))?.[0]?.n ?? null,
  tableOrder: ordered,
  // Insert in tableOrder leaving these child->parent references null, then
  // UPDATE once both sides exist. This is a conservative superset: when the
  // frontier stalls we defer ALL of the chosen table's remaining parents, not
  // just the one edge that closes the cycle. Nulling a few more columns and
  // filling them in afterwards is free; missing one is an import that fails
  // halfway.
  deferredForeignKeys: deferredEdges,
  tableCounts,
  authUserCount: authUsers.length,
  storageObjectCount: index.length,
  storageFailures: failures,
  notes: [
    'Password hashes are NOT included. Rebuilding the demo re-invites every user.',
    'Schema is not included — it is supabase/migrations/, applied by migrate.mjs.',
    'Storage keys live in storage/index.json; on-disk paths are sanitised and are not keys.',
  ],
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

// ---------------------------------------------------------------------------
// Verify: independently re-count every table and compare against what we wrote
// ---------------------------------------------------------------------------

const countSql = ordered
  .map((n) => `SELECT '${n}' AS t, count(*)::int AS n FROM public."${n}"`)
  .join(' UNION ALL ')
const live = await runSql(target, countSql)

const allDrift = live.filter((r) => tableCounts[r.t] !== r.n)
const drift = allDrift.filter((r) => !VOLATILE_TABLES.has(r.t))
const noise = allDrift.filter((r) => VOLATILE_TABLES.has(r.t))

for (const d of noise) {
  console.log(`[export]   ${d.t} moved ${tableCounts[d.t]} → ${d.n} during the run (cron churn, expected)`)
}

if (drift.length) {
  console.error('\n[export] ✗ row counts moved during the export:')
  for (const d of drift) console.error(`    ${d.t}: exported ${tableCounts[d.t]}, live ${d.n}`)
  console.error('  Something is writing to the database. Re-run against a quiet system.\n')
  process.exitCode = 1
} else if (failures.length) {
  console.error(`\n[export] ✗ ${failures.length} storage object(s) failed to download:`)
  for (const f of failures) console.error(`    ${f.bucket}/${f.name} — ${f.error}`)
  process.exitCode = 1
} else {
  console.log(`\n[export] ✓ verified — ${ordered.length} tables, ${index.length} objects, manifest written`)
  console.log(`[export]   COPY ${OUT} OFF THIS MACHINE before running purge-demo.mjs.\n`)
}

// undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync.
await new Promise((r) => setTimeout(r, 100))
