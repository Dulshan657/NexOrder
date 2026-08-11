#!/usr/bin/env node
// The migration ledger.
//
//   node supabase/migrate.mjs --env=dev --dry-run        # what would run, in order
//   node supabase/migrate.mjs --env=dev --baseline=00085 # record 00001..00085 as applied, run the rest
//   node supabase/migrate.mjs --env=dev                  # apply everything pending
//   node supabase/migrate.mjs --env=amadiya               # ditto, on the client's project
//   node supabase/migrate.mjs --env=dev --stamp-only      # just rewrite environment_marker
//
// Why this exists: until now "which migrations has this database had?" was
// answered by memory. That worked while there was one database. With two, the
// question becomes "do dev and prod have the same schema?", and memory cannot
// answer it — which is the whole reason the launch plan requires a schema
// digest comparison before going live.
//
// Design notes that took some working out:
//
//   * ORDERING is (numeric prefix, full filename). Two numeric prefixes are
//     duplicated — 00022 and 00081 — each as a pair of mutually independent
//     migrations, so either order within the pair is safe. DO NOT RENUMBER
//     them: the files are already applied on dev under their current names,
//     and renaming one makes it look unapplied forever.
//
//   * ATOMICITY. 62 of the 87 files already open with BEGIN; none has more
//     than one COMMIT; and none uses CREATE INDEX CONCURRENTLY. So the ledger
//     INSERT is spliced in before that single COMMIT where one exists, and the
//     remaining files are wrapped in BEGIN…COMMIT. Either way the migration and
//     the record of the migration commit together — a half-applied file that
//     the ledger claims succeeded is the one failure mode worth engineering
//     against, because every later run trusts the ledger.
//
//   * CHECKSUMS are sha256 over the file with line endings NORMALISED to LF.
//     Not over the raw bytes — `core.autocrlf` is true on the Windows box this
//     repo is developed on, so the working tree holds CRLF while the object
//     store holds LF. Hashing raw bytes made every migration read as drifted
//     the moment anyone ran `git checkout`, cloned the repo, or let CI check it
//     out on Linux. Normalising is what makes the ledger portable.
//
//     An applied file whose CONTENT changed is a hard error, not a re-run:
//     re-running is usually wrong and always surprising. Edit forward with a
//     new migration instead.
//
//   * TRANSPORT is the Management API. The direct DB host is unresolvable from
//     this Windows box, which is why supabase/run-migration.mjs never worked
//     here.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import os from 'node:os'

import { resolveTarget, orExit, ROOT } from '../scripts/lib/env.mjs'
import { runSql, SqlError } from '../scripts/lib/managementApi.mjs'

const MIGRATIONS_DIR = resolve(ROOT, 'supabase', 'migrations')

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const hit = argv.find((a) => a.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : null
}

const DRY_RUN = has('--dry-run')
// `--stamp` is accepted as a synonym: it is the name the error messages in
// scripts/lib/fixtureGuard.mjs used to suggest, and a flag that "does nothing
// silently" is worse than one spelled two ways.
const STAMP_ONLY = has('--stamp-only') || has('--stamp')
const BASELINE = has('--baseline') ? '' : valueOf('--baseline')

const target = orExit(() => resolveTarget({ argv, require: ['SUPABASE_ACCESS_TOKEN'] }))

// ── SQL literals ─────────────────────────────────────────────────────────────

/** Single-quoted SQL literal. Filenames and hex digests are plain ASCII, but
 *  escaping is cheap and the alternative is a quoting bug in a migration tool. */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.schema_migrations IS
  'Applied migrations, written by supabase/migrate.mjs. service_role only — no policies by design.';
`

// ── File discovery and ordering ──────────────────────────────────────────────

function sortKey(filename) {
  const m = filename.match(/^(\d+)/)
  return [m ? Number(m[1]) : Number.MAX_SAFE_INTEGER, filename]
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const [an, af] = sortKey(a)
      const [bn, bf] = sortKey(b)
      return an !== bn ? an - bn : af.localeCompare(bf)
    })
    .map((filename) => {
      const body = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8')
      // Hash the LF-normalised text; see the CHECKSUMS note in the header.
      const normalised = body.replace(/\r\n/g, '\n')
      return {
        filename,
        body,
        checksum: createHash('sha256').update(normalised, 'utf8').digest('hex'),
      }
    })
}

/**
 * Wrap one migration so that it and its ledger row commit together.
 *
 * The COMMIT is matched at the start of a line so a `COMMIT` appearing inside a
 * function body's dollar-quoted string is not mistaken for the statement. All
 * 87 current files have at most one, which is what makes "the last one" a safe
 * splice point.
 */
function buildStatement({ filename, body, checksum }, appliedBy) {
  const record =
    `INSERT INTO public.schema_migrations (filename, checksum, applied_by)\n` +
    `VALUES (${lit(filename)}, ${lit(checksum)}, ${lit(appliedBy)})\n` +
    `ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), applied_by = EXCLUDED.applied_by;`

  const commit = /^[ \t]*COMMIT[ \t]*;/gim
  const matches = [...body.matchAll(commit)]

  if (matches.length === 0) {
    return `BEGIN;\n${body}\n${record}\nCOMMIT;`
  }

  const last = matches[matches.length - 1]
  const at = last.index
  return `${body.slice(0, at)}${record}\n${body.slice(at)}`
}

// ── Environment marker ───────────────────────────────────────────────────────

async function stampMarker() {
  const { config } = target
  // `markerName`, NOT `name`. Migration 00086 constrains this column to
  // CHECK (name IN ('dev','prod')) and is applied and checksummed, so the
  // database's vocabulary is frozen at two values while target names are now
  // open-ended (`dev`, `amadiya`, …). Stamping the target name here would fail
  // the CHECK on the first production run — and nowhere earlier.
  const sql = `
INSERT INTO public.environment_marker (id, name, tenant_key)
VALUES (1, ${lit(config.markerName)}, ${lit(config.tenantKey)})
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tenant_key = EXCLUDED.tenant_key;
SELECT name, tenant_key FROM public.environment_marker WHERE id = 1;`

  try {
    const rows = await runSql(target, sql)
    const row = Array.isArray(rows) ? rows[rows.length - 1] : null
    console.log(
      `[migrate] environment_marker = ${JSON.stringify(row ?? { name: config.markerName, tenant_key: config.tenantKey })}`,
    )
  } catch (e) {
    if (e instanceof SqlError && /environment_marker/.test(e.body ?? '')) {
      console.warn(
        '[migrate] environment_marker does not exist yet (migration 00086 not applied) — skipping stamp.',
      )
      return
    }
    throw e
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { config } = target
  console.log(`[migrate] target ${target.name} — ${config.label} (${config.projectRef})`)

  if (STAMP_ONLY) {
    await stampMarker()
    return 0
  }

  const files = listMigrations()
  console.log(`[migrate] ${files.length} migration file(s) on disk`)

  await runSql(target, LEDGER_DDL)

  const appliedRows = await runSql(
    target,
    'SELECT filename, checksum FROM public.schema_migrations',
  )
  const applied = new Map(
    (Array.isArray(appliedRows) ? appliedRows : []).map((r) => [r.filename, r.checksum]),
  )

  // Drift check first, across every file — reporting one at a time would mean
  // several round trips to learn the same thing.
  const drifted = files.filter(
    (f) => applied.has(f.filename) && applied.get(f.filename) !== f.checksum,
  )
  if (drifted.length) {
    console.error(
      `\n[migrate] ${drifted.length} applied migration(s) have changed on disk:\n` +
        drifted.map((f) => `  - ${f.filename}`).join('\n') +
        `\n\nAn applied migration is history. Edit forward with a new file instead.\n` +
        `If a change was cosmetic (a comment), re-record it deliberately with --baseline.\n`,
    )
    return 1
  }

  const baselineLimit = BASELINE === null ? null : BASELINE
  const isBaselined = (filename) => {
    if (baselineLimit === null) return false
    if (baselineLimit === '') return true
    return sortKey(filename)[0] <= Number(baselineLimit)
  }

  const pending = files.filter((f) => !applied.has(f.filename))
  const toRecord = pending.filter((f) => isBaselined(f.filename))
  const toApply = pending.filter((f) => !isBaselined(f.filename))

  if (pending.length === 0) {
    console.log('[migrate] Nothing pending — the ledger matches the directory.')
    await stampMarker()
    return 0
  }

  console.log(
    `[migrate] ${applied.size} already recorded · ` +
      `${toRecord.length} to baseline (record, do not run) · ` +
      `${toApply.length} to apply`,
  )
  for (const f of toRecord) console.log(`  baseline  ${f.filename}`)
  for (const f of toApply) console.log(`  APPLY     ${f.filename}`)

  if (DRY_RUN) {
    console.log('\n[migrate] --dry-run: nothing was executed.')
    return 0
  }

  const appliedBy = os.userInfo().username

  if (toRecord.length) {
    const values = toRecord
      .map((f) => `(${lit(f.filename)}, ${lit(f.checksum)}, ${lit(appliedBy)})`)
      .join(',\n  ')
    await runSql(
      target,
      `INSERT INTO public.schema_migrations (filename, checksum, applied_by) VALUES\n  ${values}\n` +
        `ON CONFLICT (filename) DO NOTHING;`,
    )
    console.log(`[migrate] Baselined ${toRecord.length} file(s) without executing them.`)
  }

  for (const file of toApply) {
    process.stdout.write(`[migrate] applying ${file.filename} … `)
    try {
      await runSql(target, buildStatement(file, appliedBy))
      console.log('ok')
    } catch (e) {
      console.log('FAILED')
      console.error(`\n${e.message}\n`)
      console.error(
        `[migrate] Stopped at ${file.filename}. Nothing after it ran, and its ledger row was ` +
          `not written — the transaction took both or neither.\n`,
      )
      return 1
    }
  }

  await stampMarker()
  console.log('[migrate] Done.')
  return 0
}

try {
  process.exitCode = await main()
} catch (err) {
  console.error(err instanceof SqlError ? err.message : err)
  process.exitCode = 1
}
