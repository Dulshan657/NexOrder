#!/usr/bin/env node
// Restore `demo-export/` into a rebuilt demo project. The mirror of
// export-demo.mjs, and the second half of the 2026-08-12 cutover.
//
//   node supabase/ops/import-demo.mjs --env=dev --check   # preflight + verify, writes nothing
//   node supabase/ops/import-demo.mjs --env=dev
//   node supabase/ops/import-demo.mjs --env=dev --only=products,product_uoms
//   node supabase/ops/import-demo.mjs --env=dev --skip-storage
//
// Runs behind the three fixture guards. Not paranoia about writes — it is what
// stops 92,000 rows of NexGen demo data being poured into a client's project.
//
// RUN `mint-demo-users.mjs` FIRST. Every table here references accounts by
// uuid, and the export carries no password hashes, so the accounts must exist
// with their ORIGINAL ids before any of this resolves.
//
// ── WHAT IS DELIBERATELY NOT RESTORED ───────────────────────────────────────
//
// See SKIP below. The short version: the ledger and the marker are written by
// migrate.mjs and restoring them would corrupt the two things every guard in
// the repo trusts; the rest is operational exhaust (cron output, deploy history,
// stack traces against bundles that no longer exist) that describes a database
// which no longer exists.
//
// ── WRITES GO THROUGH POSTGREST, NOT THE MANAGEMENT API ─────────────────────
//
// Everything else in this repo reaches the database as SQL text through
// `runSql`, because the direct DB host is unreachable from Windows. That is the
// wrong tool for 92,000 rows: it would mean generating and escaping SQL literals
// for every JSONB blob, vector and array in the export. PostgREST takes JSON,
// which is what the export already is, and `service_role` bypasses RLS so the
// Edge-Function lockdown is not in the way. `runSql` is still used for the three
// things PostgREST cannot do: introspection, counting, and setval.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { ROOT } from '../../scripts/lib/env.mjs'
import { requireDevTarget, orExitAsync } from '../../scripts/lib/fixtureGuard.mjs'
import { runSql } from '../../scripts/lib/managementApi.mjs'
import { planInsertOrder, rewriteProjectRef, contentTypeFor } from '../../scripts/lib/importPlan.mjs'

const CHUNK = 500

/** Tables the export holds but that must NOT be restored. See the header. */
const SKIP = new Map([
  ['schema_migrations', 'written by migrate.mjs — restoring it corrupts the ledger'],
  ['environment_marker', 'written by migrate.mjs --stamp — it IS fixture guard #3'],
  ['health_checks', 'cron output from a database that no longer exists'],
  ['audit_events', 'records acts performed in a database that no longer exists'],
  ['deployments', 'deploy history of the old project'],
  ['client_errors', 'stack traces against bundles that no longer exist'],
  ['rate_limit_counters', 'transient by design; a stale window would throttle a fresh project'],
  ['oauth_pending_states', 'transient — these expire in minutes and are already dead'],
])

const argv = process.argv.slice(2)
const checkOnly = argv.includes('--check')
const skipStorage = argv.includes('--skip-storage')
const onlyFlag = argv.find((a) => a.startsWith('--only='))
const only = onlyFlag ? new Set(onlyFlag.slice('--only='.length).split(',').map((s) => s.trim())) : null

const target = await orExitAsync(() =>
  requireDevTarget({ argv, require: ['SUPABASE_SERVICE_ROLE_KEY'] }),
)

const EXPORT_DIR = join(ROOT, 'demo-export')
const read = (rel) => JSON.parse(readFileSync(join(EXPORT_DIR, rel), 'utf8'))

if (!existsSync(join(EXPORT_DIR, 'manifest.json'))) {
  console.error(
    `\n[import] no manifest at ${join(EXPORT_DIR, 'manifest.json')}.\n` +
      `  demo-export/ is gitignored; the archived copy is ../backup/demo-export-2026-08-12/.\n`,
  )
  process.exit(1)
}

const manifest = read('manifest.json')
const OLD_REF = manifest.source?.projectRef ?? null
const NEW_REF = target.config.projectRef

const supa = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(
  `[import] ${target.name} (${NEW_REF}) — marker ${target.marker.name}/${target.marker.tenant_key}`,
)
console.log(`[import] export taken ${manifest.exportedAt} from ${OLD_REF}`)

if (OLD_REF === NEW_REF) {
  console.error(
    `\n[import] the export came FROM this project. Importing it into itself is not a restore.\n`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Preflight — the schema must be the one this data came out of
// ---------------------------------------------------------------------------

const ledger = await runSql(target, `SELECT filename FROM public.schema_migrations ORDER BY filename`)
const applied = new Set(ledger.map((r) => r.filename))
const onDisk = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'))
const pending = onDisk.filter((f) => !applied.has(f))

console.log(`[import] ledger: ${applied.size} applied, ${onDisk.length} on disk`)

if (pending.length) {
  console.error(
    `\n[import] ${pending.length} migration(s) are NOT applied: ${pending.slice(0, 5).join(', ')}` +
      `${pending.length > 5 ? ` (+${pending.length - 5} more)` : ''}\n` +
      `  Run \`npm run migrate:${target.name}\` first. Importing into a partial schema\n` +
      `  fails on whichever table the missing migration creates, halfway through.\n`,
  )
  process.exit(1)
}

// The export's own head must be present. The repo may legitimately be AHEAD —
// 00104 and 00105 landed after this export was taken and are policy-only — but
// it must never be BEHIND, or the data references columns that do not exist.
const exportHead = manifest.migrationLedgerHead?.filename
if (exportHead && !applied.has(exportHead)) {
  console.error(
    `\n[import] the export was taken at "${exportHead}", which is not in this ledger.\n` +
      `  This schema is older than the data. Refusing.\n`,
  )
  process.exit(1)
}
if (applied.size > manifest.migrationCount) {
  console.log(
    `[import]   schema is ${applied.size - manifest.migrationCount} migration(s) ahead of the export ` +
      `(head was ${exportHead}) — expected, and fine for additive migrations.`,
  )
}

// ---------------------------------------------------------------------------
// What to restore, and in what order
// ---------------------------------------------------------------------------

const wanted = manifest.tableOrder.filter((t) => {
  if (SKIP.has(t)) return false
  if (only && !only.has(t)) return false
  return true
})

if (only) {
  const unknown = [...only].filter((t) => !manifest.tableOrder.includes(t))
  if (unknown.length) {
    console.error(`\n[import] --only names table(s) not in the export: ${unknown.join(', ')}\n`)
    process.exit(1)
  }
  console.log(`[import] --only: ${wanted.length} table(s)`)
}

// Foreign keys and primary keys read from the LIVE schema, never assumed. The
// manifest's deferral list cannot be used — see importPlan.mjs for why.
const fks = await runSql(
  target,
  `SELECT ch.relname AS child, pa.relname AS parent, a.attname AS column, NOT a.attnotnull AS nullable
     FROM pg_constraint con
     JOIN pg_class ch ON ch.oid = con.conrelid
     JOIN pg_namespace nch ON nch.oid = ch.relnamespace AND nch.nspname = 'public'
     JOIN pg_class pa ON pa.oid = con.confrelid
     JOIN pg_namespace npa ON npa.oid = pa.relnamespace AND npa.nspname = 'public'
     JOIN unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = ch.oid AND a.attnum = k.attnum
    WHERE con.contype = 'f'`,
)

const pkRows = await runSql(
  target,
  `SELECT c.relname AS tbl, a.attname AS col, k.ord
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'p'
    ORDER BY c.relname, k.ord`,
)

/** table -> ['id'] or ['product_id','location_id'] */
const primaryKeys = new Map()
for (const r of pkRows) {
  if (!primaryKeys.has(r.tbl)) primaryKeys.set(r.tbl, [])
  primaryKeys.get(r.tbl).push(r.col)
}

// GENERATED ALWAYS columns must not be written. The export is a `SELECT *`, so
// it carries their VALUES — and Postgres rejects the insert outright rather
// than ignoring them:
//
//   cannot insert a non-DEFAULT value into column "available"
//
// Today that is only `inventory_balances.available` (on_hand - allocated), but
// it is read from the schema rather than hardcoded so a future generated column
// does not fail this the same way a year from now. Dropping the value loses
// nothing: Postgres recomputes it from the columns we do write.
const generatedRows = await runSql(
  target,
  `SELECT c.relname AS tbl, a.attname AS col
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND a.attgenerated <> ''`,
)

/** table -> Set(generated column) */
const generated = new Map()
for (const r of generatedRows) {
  if (!generated.has(r.tbl)) generated.set(r.tbl, new Set())
  generated.get(r.tbl).add(r.col)
}
if (generated.size) {
  console.log(
    `[import] stripping generated column(s): ` +
      [...generated].map(([t, cols]) => `${t}.${[...cols].join(', ')}`).join(' · '),
  )
}

let plan
try {
  plan = planInsertOrder(wanted, fks)
} catch (e) {
  console.error(`\n[import] cannot plan an insert order: ${e.message}\n`)
  process.exit(1)
}

const { order, deferred } = plan
if (deferred.size) {
  console.log(`[import] ${deferred.size} table(s) need a second pass for cyclic/self references:`)
  for (const [t, cols] of deferred) console.log(`           ${t}.${cols.join(', ')}`)
}

// ---------------------------------------------------------------------------
// Load and transform every table before writing anything
// ---------------------------------------------------------------------------

/** table -> rows, already rewritten */
const data = new Map()
let totalRows = 0
let totalRefRewrites = 0

for (const t of order) {
  const rows = read(join('data', `${t}.json`))
  const { rows: rewritten, replacements } = rewriteProjectRef(rows, OLD_REF, NEW_REF)
  if (replacements) {
    console.log(`[import]   ${t}: rewrote ${replacements} occurrence(s) of the old project ref`)
    totalRefRewrites += replacements
  }
  data.set(t, applyTableFixups(t, rewritten))
  totalRows += rewritten.length
}

console.log(
  `[import] ${order.length} table(s), ${totalRows} rows to write` +
    (totalRefRewrites ? `, ${totalRefRewrites} project-ref rewrite(s)` : ''),
)

/**
 * Per-table corrections that only make sense on a DIFFERENT project.
 *
 * Only `email_accounts` needs one. Its `oauth_refresh_token_encrypted` is
 * AES-256-GCM ciphertext under the OLD project's `PO_ENCRYPTION_KEY`, and that
 * key is deliberately never copied between projects — mailbox tokens cannot be
 * rotated without re-consenting every mailbox, so sharing one would entangle the
 * demo's mailboxes with any project it was copied to.
 *
 * Carrying the ciphertext across would therefore leave five rows that LOOK
 * connected, poll on a cron, and fail to decrypt at runtime. Instead each row is
 * put into exactly the state `disconnect-email-account` produces — token NULL,
 * status 'signed_out' — which is a state the product already knows how to show
 * and recover from. `00022` made the token nullable for precisely this shape.
 *
 * The rows are kept rather than skipped because `inbound_messages.
 * email_account_id` references them, and those 71 messages and 41 pending POs
 * ARE the PO Inbox demo.
 */
function applyTableFixups(table, rows) {
  const gen = generated.get(table)
  if (gen) {
    rows = rows.map((r) => {
      const copy = { ...r }
      for (const c of gen) delete copy[c]
      return copy
    })
  }

  if (table !== 'email_accounts') return rows
  const at = new Date().toISOString()
  return rows.map((r) => ({
    ...r,
    oauth_refresh_token_encrypted: null,
    status: 'signed_out',
    signed_out_at: r.signed_out_at ?? at,
    // Nulled rather than attributed: nobody signed these out, a rebuild did.
    signed_out_by: null,
    consecutive_failures: 0,
    next_retry_at: null,
  }))
}

// ---------------------------------------------------------------------------
// Report what is already there
// ---------------------------------------------------------------------------

const liveCounts = await countTables(order)
const nonEmpty = order.filter((t) => liveCounts[t] > 0)

if (nonEmpty.length) {
  console.log(`\n[import] ${nonEmpty.length} target table(s) already hold rows:`)
  for (const t of nonEmpty) {
    const expected = manifest.tableCounts[t] ?? 0
    console.log(`           ${t.padEnd(32)} ${String(liveCounts[t]).padStart(6)} live, ${expected} in the export`)
  }
  console.log(
    `[import]   These are migration seeds. They are DELETED before pass A, not merged:\n` +
      `[import]   the seed and the export disagree about surrogate ids for the same\n` +
      `[import]   natural key (storage_types.code, zone_profiles.name), so an upsert on\n` +
      `[import]   the primary key hits the OTHER unique constraint. A restore has one\n` +
      `[import]   right answer and it is the export. profiles is never deleted — its rows\n` +
      `[import]   belong to auth.users and no re-run could recreate them.`,
  )
}

if (checkOnly) {
  console.log(`\n[import] --check: preflight passed. Nothing written.`)
  await verify()
  await settle()
  process.exit(process.exitCode ?? 0)
}

// ---------------------------------------------------------------------------
// Clear — the export is the snapshot, so anything else in these tables is noise
// ---------------------------------------------------------------------------

// ── WHY UPSERT ON THE PRIMARY KEY IS NOT ENOUGH ────────────────────────────
//
// Seven tables arrive pre-seeded by migrations, and the first attempt at this
// import upserted onto the primary key expecting that to merge them. It does
// not, because reference tables carry a SECOND unique constraint on a natural
// key and the seed does not use the export's surrogate ids:
//
//   duplicate key value violates unique constraint "storage_types_code_key"
//   Key (code)=(AMD_RACK) already exists.
//
// The upsert saw no conflict on `id` — the export's id for AMD_RACK differs
// from the seeded one — so it tried a plain INSERT and hit `code`. Upserting on
// the natural key instead would be worse: it would rewrite a live row's PRIMARY
// KEY to the export's value, while other tables reference it.
//
// A restore has one right answer: the export is the snapshot, so the seed is
// discarded. Clearing also makes the whole import idempotent — a failed run is
// re-run rather than unpicked, which matters on a free project with no backups.
//
// `profiles` is the exception and is never deleted: its rows are owned by
// `auth.users` via `handle_new_user`, so deleting them orphans eleven logins
// that no re-run can recreate. Its deferred columns are nulled instead, which
// is the same treatment pass A gives them and is what lets `horecas` and
// `locations` be deleted underneath it.
const clearable = order.filter((t) => t !== 'profiles')

if (clearable.length) {
  const profileDeferred = deferred.get('profiles') ?? []
  const statements = []
  if (profileDeferred.length) {
    statements.push(
      `UPDATE public.profiles SET ${profileDeferred.map((c) => `"${c}" = NULL`).join(', ')};`,
    )
  }
  // Reverse insert order: children before the parents they point at.
  for (const t of [...clearable].reverse()) statements.push(`DELETE FROM public."${t}";`)

  const before = order.reduce((a, t) => a + (liveCounts[t] ?? 0), 0)
  console.log(`\n[import] clearing ${clearable.length} table(s) (${before} pre-existing row(s))`)
  try {
    await runSql(target, statements.join('\n'))
  } catch (e) {
    console.error(
      `\n[import] ✗ could not clear: ${e.message}\n` +
        `  Deletes run children-first in reverse insert order, so a foreign key\n` +
        `  failure here means the computed order is wrong, not the data.\n`,
    )
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Pass A — insert, with cyclic/self-referencing columns nulled
// ---------------------------------------------------------------------------

console.log(`\n[import] pass A — rows`)

for (const t of order) {
  const rows = data.get(t)
  if (!rows.length) {
    console.log(`  ${t.padEnd(32)} empty`)
    continue
  }
  const drop = deferred.get(t) ?? []
  const payload = drop.length
    ? rows.map((r) => ({ ...r, ...Object.fromEntries(drop.map((c) => [c, null])) }))
    : rows

  await writeRows(t, payload, drop.length ? ` (${drop.join(', ')} deferred)` : '')
}

// ---------------------------------------------------------------------------
// Pass B — put the deferred columns back
// ---------------------------------------------------------------------------

if (deferred.size) {
  console.log(`\n[import] pass B — deferred references`)
  for (const [t, cols] of deferred) {
    const rows = data.get(t)
    if (!rows?.length) continue
    await writeRows(t, rows, ` (restoring ${cols.join(', ')})`)
  }
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

// Every restored row carries an explicit id, so identity and serial sequences
// are untouched and still sitting at 1. Without this the FIRST row the app
// inserts collides with a restored one — and it does so hours later, in the UI,
// as a duplicate-key error with nothing pointing back at the import.
console.log(`\n[import] resyncing sequences`)

await runSql(
  target,
  `DO $$
   DECLARE r record; seq text; maxid bigint;
   BEGIN
     FOR r IN
       SELECT c.relname AS tbl, a.attname AS col
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.relkind = 'r'
          AND pg_get_serial_sequence(format('public.%I', c.relname), a.attname) IS NOT NULL
     LOOP
       seq := pg_get_serial_sequence(format('public.%I', r.tbl), r.col);
       EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM public.%I', r.col, r.tbl) INTO maxid;
       IF maxid > 0 THEN
         PERFORM setval(seq, maxid, true);
       ELSE
         PERFORM setval(seq, 1, false);
       END IF;
     END LOOP;
   END $$;`,
)

const seqs = await runSql(
  target,
  `SELECT sequencename, last_value FROM pg_sequences
    WHERE schemaname = 'public' AND last_value IS NOT NULL AND last_value > 1
    ORDER BY last_value DESC LIMIT 10`,
)
console.log(`[import]   ${seqs.length ? `top: ${seqs.map((s) => `${s.sequencename}=${s.last_value}`).join(', ')}` : 'none advanced'}`)

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

if (skipStorage) {
  console.log(`\n[import] --skip-storage: ${manifest.storageObjectCount} object(s) NOT uploaded`)
} else {
  await uploadStorage()
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

await verify()
await settle()

// ===========================================================================
// helpers
// ===========================================================================

async function countTables(names) {
  /** @type {Record<string, number>} */
  const out = {}
  // One statement, not N round trips — this runs twice and N is 60.
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40)
    const sql = batch
      .map((n) => `SELECT '${n}' AS t, count(*)::int AS n FROM public."${n}"`)
      .join(' UNION ALL ')
    for (const row of await runSql(target, sql)) out[row.t] = row.n
  }
  return out
}

/**
 * Upsert rows in chunks. Upsert rather than insert so the script is resumable
 * and so migration-seeded reference rows are overwritten rather than collided
 * with. A table with no primary key falls back to insert, and says so.
 */
async function writeRows(table, rows, note) {
  const pk = primaryKeys.get(table)
  let written = 0

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const query = pk
      ? supa.from(table).upsert(chunk, { onConflict: pk.join(','), defaultToNull: false })
      : supa.from(table).insert(chunk)
    const { error } = await query

    if (error) {
      console.error(
        `\n[import] ✗ ${table} rows ${i}–${i + chunk.length - 1}: ${error.message}` +
          `${error.details ? `\n    ${error.details}` : ''}` +
          `${error.hint ? `\n    hint: ${error.hint}` : ''}\n` +
          `  ${written} row(s) of this table were written. Re-run with\n` +
          `  --only=${table} once the cause is fixed; the upsert makes that safe.\n`,
      )
      process.exit(1)
    }
    written += chunk.length
  }

  console.log(
    `  ${table.padEnd(32)} ${String(written).padStart(6)}${pk ? '' : '  (no PK — inserted)'}${note ?? ''}`,
  )
}

async function uploadStorage() {
  const index = read(join('storage', 'index.json'))
  const buckets = read('storage-buckets.json')
  const allowed = new Map(buckets.map((b) => [b.id, b.allowed_mime_types]))

  // The buckets are created by migrations (00004, 00019, 00024, 00031, 00058,
  // 00074), not by this script. If one is missing, the migration that makes it
  // did not run, and uploading into a bucket that does not exist reports a
  // per-object error 223 times instead of one useful line.
  const live = await runSql(target, `SELECT id FROM storage.buckets ORDER BY id`)
  const liveIds = new Set(live.map((b) => b.id))
  const missing = buckets.map((b) => b.id).filter((id) => !liveIds.has(id))
  if (missing.length) {
    console.error(
      `\n[import] ✗ bucket(s) missing from the target: ${missing.join(', ')}\n` +
        `  These are created by migrations. Run \`npm run migrate:${target.name}\`.\n`,
    )
    process.exit(1)
  }

  console.log(`\n[import] storage — ${index.length} object(s) into ${liveIds.size} bucket(s)`)

  let uploaded = 0
  let downgraded = 0
  const failures = []

  for (const obj of index) {
    const type = contentTypeFor(obj.key, allowed.get(obj.bucket))
    if (!type) {
      failures.push({ ...obj, error: `no acceptable Content-Type for ${obj.bucket}` })
      continue
    }
    if (type.downgraded) downgraded += 1

    let body
    try {
      // `obj.file` is a SANITISED path; `obj.key` is the true storage key. Never
      // reconstruct one from the other — export-demo.mjs stripped characters
      // Windows refuses and disambiguated collisions with a hash suffix.
      body = readFileSync(join(EXPORT_DIR, 'storage', obj.file))
    } catch (e) {
      failures.push({ ...obj, error: `cannot read ${obj.file}: ${e.message}` })
      continue
    }

    const { error } = await supa.storage
      .from(obj.bucket)
      .upload(obj.key, body, { contentType: type.contentType, upsert: true })

    if (error) failures.push({ ...obj, error: error.message })
    else uploaded += 1
  }

  console.log(
    `[import]   ${uploaded}/${index.length} uploaded` +
      (downgraded ? `, ${downgraded} as application/octet-stream (bucket refuses the real type)` : ''),
  )

  if (failures.length) {
    console.error(`\n[import] ✗ ${failures.length} object(s) failed:`)
    for (const f of failures.slice(0, 20)) console.error(`    ${f.bucket}/${f.key} — ${f.error}`)
    if (failures.length > 20) console.error(`    (+${failures.length - 20} more)`)
    process.exitCode = 1
  }
}

/**
 * Re-count everything from the database and diff against the manifest.
 *
 * Independent of what this process believes it wrote — the same discipline
 * export-demo.mjs applies at its close, and for the same reason: a writer that
 * verifies against its own bookkeeping verifies nothing.
 */
async function verify() {
  console.log(`\n[import] verifying`)
  const live = await countTables(order)

  const short = []
  const over = []
  for (const t of order) {
    const want = manifest.tableCounts[t] ?? 0
    const got = live[t] ?? 0
    if (got < want) short.push({ t, want, got })
    else if (got > want) over.push({ t, want, got })
  }

  for (const o of over) {
    // Not an error on its own: a migration that seeds reference data a later
    // export never saw would land here, as would a row the product created
    // since. Reported so it is a decision rather than a silent difference.
    console.log(`[import]   ${o.t}: ${o.got} rows, export had ${o.want} (+${o.got - o.want})`)
  }

  if (short.length) {
    console.error(`\n[import] ✗ ${short.length} table(s) hold FEWER rows than the export:`)
    for (const s of short) console.error(`    ${s.t.padEnd(32)} ${s.got} of ${s.want}`)
    process.exitCode = 1
    return
  }

  // The rewrite is the one transformation with a right answer, so it is checked
  // against the database rather than against the count of edits made in memory.
  if (OLD_REF) {
    const stale = await runSql(
      target,
      `SELECT count(*)::int AS n FROM public.orders WHERE verification::text LIKE '%${OLD_REF}%'`,
    )
    const n = stale?.[0]?.n ?? 0
    if (n > 0) {
      console.error(`\n[import] ✗ ${n} orders row(s) still reference the old project ref.\n`)
      process.exitCode = 1
      return
    }
  }

  const total = order.reduce((a, t) => a + (live[t] ?? 0), 0)
  if (process.exitCode) {
    console.error(`\n[import] ✗ completed with errors — see above.\n`)
  } else {
    console.log(
      `\n[import] ✓ verified — ${order.length} tables, ${total} rows` +
        `${skipStorage ? '' : `, ${manifest.storageObjectCount} objects`}\n` +
        `[import]   Next: npm run deploy:dev (once the Vercel project exists).\n`,
    )
  }
}

/** undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync. */
async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
