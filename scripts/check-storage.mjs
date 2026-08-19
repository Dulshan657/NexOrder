// Assert that every Storage bucket has the visibility it is supposed to have,
// and that no client-facing role holds more on storage.objects than it should.
//
//   npm run check:storage:dev
//   npm run check:storage:amadiya
//   node scripts/check-storage.mjs --env=dev
//
// Exits 1 and names every offender.
//
// WHY THIS EXISTS. Security-audit findings STOR-1 and STOR-2. Risk-register
// R-02 recorded "closed by making the buckets private and issuing access
// through audited signed URLs" while no migration in the repository made that
// change, and CLAUDE.md described storage as "public read, authenticated write"
// while `FOR ALL TO authenticated` let any customer login list and delete every
// object in five buckets. Both claims were prose. This asks the database.
//
// It runs the security audit's own Appendix A step 4 queries — the two that
// reported the defect — and asserts they now come back clean.
//
// THIS IS AN OPS CHECK, NOT A CI GATE, and deliberately so: it needs a Supabase
// access token for a specific project, which CI does not have. It sits beside
// `check:grants`, `secrets:check` and `auth:config:check` for the same reason.
// The pure half is covered in the verify job by
// __tests__/storageExpectations.test.ts.

import { resolveTarget, orExit } from './lib/env.mjs'
import { runSql, SqlError } from './lib/managementApi.mjs'
import { findStorageViolations, formatStorageFindings, expectedBucketIds } from './lib/storageExpectations.mjs'
import { CLIENT_FACING_ROLES } from '../config/storageBuckets.mjs'

const args = process.argv.slice(2)
const target = orExit(() => resolveTarget({ argv: args, require: ['SUPABASE_ACCESS_TOKEN'] }))

// Two result sets folded into one shape, one round trip. `roles` is cast to
// text because the Management API renders a Postgres name[] inconsistently;
// it is parsed back below rather than guessed at.
const SQL = `
SELECT 'bucket' AS kind,
       b.id      AS name,
       b.public::text AS a,
       NULL      AS b,
       NULL      AS c
  FROM storage.buckets b
UNION ALL
SELECT 'policy' AS kind,
       p.policyname,
       p.cmd,
       p.roles::text,
       COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')
  FROM pg_policies p
 WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
`

console.error(`[check:storage] target ${target.name} (${target.config.projectRef})`)

let rows
try {
  rows = await runSql(target, SQL)
} catch (e) {
  if (e instanceof SqlError) {
    console.error(`[check:storage] ${e.message}`)
    process.exit(1)
  }
  throw e
}

if (!Array.isArray(rows)) {
  console.error('[check:storage] The Management API returned something other than rows:')
  console.error(rows)
  process.exit(1)
}

/** `{authenticated,anon}` -> ['authenticated','anon']. */
function parseRoles(text) {
  if (Array.isArray(text)) return text
  if (typeof text !== 'string') return []
  return text.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

const buckets = rows
  .filter((r) => r.kind === 'bucket')
  .map((r) => ({ id: r.name, public: r.a === 'true' || r.a === true }))

const policies = rows
  .filter((r) => r.kind === 'policy')
  .map((r) => ({ policyname: r.name, cmd: r.a, roles: parseRoles(r.b), qual: r.c ?? '' }))

const findings = findStorageViolations(buckets, policies)

console.log(
  `Checked ${expectedBucketIds().length} declared buckets (${buckets.length} present) and ` +
    `${policies.length} storage.objects policies against roles ${CLIENT_FACING_ROLES.join(', ')}.`,
)
console.log(formatStorageFindings(findings))

if (findings.length > 0) {
  console.error(
    `\n[check:storage] ${findings.length} problem${findings.length === 1 ? '' : 's'} on ` +
      `${target.name}. A bucket holding personal information must be private AND carry no ` +
      'client-facing policy — see mig 00113 for the shape. Flipping the bucket flag alone ' +
      'leaves a FOR SELECT TO public policy still serving the object API.',
  )
  process.exit(1)
}
