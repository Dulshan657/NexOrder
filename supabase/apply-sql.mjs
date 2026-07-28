// Apply a .sql file (or inline --query) to a Supabase project via the
// Management API. Works on this Windows box where the direct DB host is
// unresolvable.
//
//   node supabase/apply-sql.mjs --env=dev supabase/migrations/00042_tenant_scoping.sql
//   node supabase/apply-sql.mjs --env=dev --query "SELECT tenant, count(*) FROM products GROUP BY 1"
//
// The target is mandatory. `--env prod` (space form) is REJECTED rather than
// tolerated: the SQL file is picked as the first non-`--` argument, so a
// space-separated value would be swallowed as a filename. scripts/lib/env.mjs
// raises that as an error instead of guessing.
//
// Credentials come from .env.dev.local / .env.prod.local and are asserted
// against config/environments.mjs.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveTarget, orExit } from '../scripts/lib/env.mjs'
import { runSql, SqlError } from '../scripts/lib/managementApi.mjs'

const args = process.argv.slice(2)

const target = orExit(() =>
  resolveTarget({ argv: args, require: ['SUPABASE_ACCESS_TOKEN'] }),
)

let query
const qIdx = args.indexOf('--query')
if (qIdx !== -1) {
  query = args[qIdx + 1]
  if (!query) {
    console.error('--query needs a SQL string.')
    process.exit(1)
  }
} else {
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('Usage: node supabase/apply-sql.mjs --env=<dev|prod> <file.sql> | --query "<sql>"')
    process.exit(1)
  }
  query = readFileSync(resolve(file), 'utf8')
}

console.error(`[apply-sql] target ${target.name} (${target.config.projectRef})`)

try {
  const result = await runSql(target, query)
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  console.log(text || '(ok, no rows returned)')
} catch (e) {
  if (e instanceof SqlError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}
