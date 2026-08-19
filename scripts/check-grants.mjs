// Assert that no client-facing role can write directly to a locked table.
//
//   npm run check:grants:dev
//   npm run check:grants:amadiya
//   node scripts/check-grants.mjs --env=dev
//
// Exits 1 and names every offender if `anon` or `authenticated` holds INSERT,
// UPDATE or DELETE on any table config/lockedTables.mjs says is closed.
//
// WHY THIS EXISTS. Security-audit finding DB-1: CLAUDE.md stated twice that
// `orders` and `order_items` were locked to their Edge Functions, and they were
// not — 00009 and 00010 dropped policies and revoked nothing, leaving the
// 00001:1084 grants intact. The claim survived three audits because checking it
// meant reading 118 migrations and reasoning about the residue. This asks the
// database instead.
//
// It checks GRANTS, not policies, and that is the point. An absent policy denies
// a write only until somebody adds one back; a revoked grant denies it
// structurally. Both of DB-1's halves — three live policies AND two live grants
// — are visible as grants, so the grant listing is the sharper instrument.
//
// THIS IS AN OPS CHECK, NOT A CI GATE, and deliberately so: it needs a Supabase
// access token for a specific project, which CI does not have. It sits beside
// `secrets:check` and `auth:config:check`, which are not in ci.yml for the same
// reason. Do not "fix" that by adding it to the verify job — the pure half is
// already covered there by __tests__/grantExpectations.test.ts.

import { resolveTarget, orExit } from './lib/env.mjs'
import { runSql, SqlError } from './lib/managementApi.mjs'
import {
  fatalFindings,
  findGrantViolations,
  formatBaselined,
  formatFindings,
  lockedTableNames,
} from './lib/grantExpectations.mjs'
import { CLIENT_ROLES } from '../config/lockedTables.mjs'

const args = process.argv.slice(2)

const target = orExit(() => resolveTarget({ argv: args, require: ['SUPABASE_ACCESS_TOKEN'] }))

const tableList = lockedTableNames().map((t) => `'${t}'`).join(', ')
const roleList = CLIENT_ROLES.map((r) => `'${r}'`).join(', ')

// One round trip, two result sets folded into one shape: the grants that exist,
// and which of the expected tables exist at all. A locked table that is absent
// is a finding rather than a silent pass — see findGrantViolations.
const SQL = `
SELECT 'grant' AS kind,
       g.table_name,
       g.grantee,
       g.privilege_type
  FROM information_schema.role_table_grants g
 WHERE g.table_schema = 'public'
   AND g.grantee IN (${roleList})
   AND g.table_name IN (${tableList})
UNION ALL
SELECT 'table' AS kind,
       t.table_name,
       NULL,
       NULL
  FROM information_schema.tables t
 WHERE t.table_schema = 'public'
   AND t.table_name IN (${tableList})
`

console.error(`[check:grants] target ${target.name} (${target.config.projectRef})`)

let rows
try {
  rows = await runSql(target, SQL)
} catch (e) {
  if (e instanceof SqlError) {
    console.error(`[check:grants] ${e.message}`)
    process.exit(1)
  }
  throw e
}

if (!Array.isArray(rows)) {
  console.error('[check:grants] The Management API returned something other than rows:')
  console.error(rows)
  process.exit(1)
}

const grants = rows.filter((r) => r.kind === 'grant')
const tablesPresent = new Set(rows.filter((r) => r.kind === 'table').map((r) => r.table_name))

const findings = findGrantViolations(grants, tablesPresent)
const fatal = fatalFindings(findings)

console.log(
  `Checked ${lockedTableNames().length} locked tables ` +
    `(${tablesPresent.size} present) against roles ${CLIENT_ROLES.join(', ')}.`,
)
console.log(formatFindings(findings))

// Always printed, never suppressed: a baseline nobody sees stops being a record
// of debt and becomes a way of not noticing it.
const inherited = formatBaselined(findings)
if (inherited) console.log(`\n${inherited}`)

if (fatal.length > 0) {
  console.error(
    `\n[check:grants] ${fatal.length} NEW problem${fatal.length === 1 ? '' : 's'} on ` +
      `${target.name}. A table whose mutations route through an Edge Function needs BOTH ` +
      'its write policies dropped AND its grants revoked \u2014 see mig 00017 or 00112 for the shape. ' +
      'Do not add these to config/grantBaseline.mjs to make this pass; the migration that ' +
      'introduced them is the bug.',
  )
  process.exit(1)
}
