// List every product home bin that putaway cannot actually use.
//
//   npm run check:home-bins -- --target dev
//   npm run check:home-bins -- --target <tenant>
//   (--env=<name> and NEXORDER_ENV work too, as everywhere else)
//
// One line per problem on stdout, then a summary on stderr. Exits 0 when there
// are no problems, 1 when there are any, 2 when the check itself could not run
// (no credentials, a read failed): a pre-release gate must never read "could not
// look" as "all clear".
//
// WHY THIS EXISTS. Since NX-0032 putaway must send a product to its home bin while
// the home has room (mig 00142). A home bin putaway can never use -- retired, in a
// hold zone, on a level that takes no cartons, off the published layout, with no
// route from a dock, refused by a slotting rule, full, or in another warehouse --
// would strand the floor: the app says "put it there" and the planner would never
// have offered it. The Replenishment setup panel shows the same list; this is the
// copy to run before a release.
//
// READ-ONLY. It calls wie_home_bin_facts (a STABLE function) and a few SELECTs,
// judged by the same code as the panel (_shared/homeBinHealthLoad.ts and
// _shared/wie/homeBinHealth.ts). It writes nothing.
//
// TypeScript from .mjs: this imports the shared TS modules directly, so it runs
// under `tsx` (see the package.json script), the way warehouse-main/seed.mjs
// imports its pure engine modules. Plain `node` cannot load them: slottingLoad.ts
// carries a remote type-only import that only a TypeScript-aware loader erases.
//
// Credentials come from scripts/lib/env.mjs via config/environments.mjs: the
// target is always named, never defaulted, and the credentials loaded must belong
// to that target.

import { createClient } from '@supabase/supabase-js'

import { resolveTarget } from './lib/env.mjs'
import {
  couldNotRunMessage,
  exitCodeFor,
  exitCodeForError,
  formatProblem,
  normaliseTargetArgs,
} from './lib/homeBinsCli.mjs'
import { loadHomeBinHealth } from '../supabase/functions/_shared/homeBinHealthLoad.ts'

async function main() {
  // Not orExit: that exits 1 on a TargetError, and 1 means "problems found".
  // A target or credential problem is "could not run" (2), like a failed read.
  const argv = normaliseTargetArgs(process.argv.slice(2))
  const target = resolveTarget({ argv, require: ['SUPABASE_SERVICE_ROLE_KEY'] })

  console.error(`[check:home-bins] target ${target.name} (${target.config.projectRef})`)

  const admin = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: warehouses, error: warehouseError } = await admin
    .from('locations')
    .select('id, code, name')
    .eq('kind', 'WAREHOUSE')
    .eq('is_active', true)
    .order('id')
  if (warehouseError) throw new Error(`warehouse list failed: ${warehouseError.message}`)

  let checked = 0
  let problems = 0
  for (const warehouse of warehouses ?? []) {
    const report = await loadHomeBinHealth(admin, warehouse.id)
    checked += report.checked
    for (const row of report.rows) {
      for (const problem of row.problems) {
        problems += 1
        console.log(formatProblem(warehouse, row, problem))
      }
    }
  }

  console.error(
    `[check:home-bins] ${(warehouses ?? []).length} warehouse(s), ${checked} home bin(s) checked, ` +
      `${problems} problem(s)`,
  )
  return exitCodeFor(problems)
}

try {
  process.exitCode = await main()
} catch (e) {
  console.error(couldNotRunMessage(e))
  process.exitCode = exitCodeForError(e)
}
