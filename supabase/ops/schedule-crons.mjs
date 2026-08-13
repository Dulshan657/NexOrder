#!/usr/bin/env node
// The two pg_cron jobs that call Edge Functions, defined in version control.
//
//   node supabase/ops/schedule-crons.mjs --env=amadiya --list
//   node supabase/ops/schedule-crons.mjs --env=amadiya --dry-run
//   node supabase/ops/schedule-crons.mjs --env=amadiya
//
// PRODUCTION-LAUNCH-PLAN.md §A3.8. Until now these existed only as COMMENTED
// snippets in `00020_po_realtime_and_cron.sql:110` and
// `00059_health_monitoring.sql:119` — commented because both embed a bearer
// token and a migration is source control. The consequence was that the live
// schedule existed in exactly one place, the database, and nowhere else: a
// restore, a new project or an accidental `cron.unschedule` had no reference to
// rebuild from, and both snippets hardcode the dev project ref in their URL, so
// pasting one into another project silently points its cron at this one.
//
// Here the URL is derived from the registry and the token from the target's env
// file, so neither can be wrong for the target being scheduled.
//
// The OTHER FIVE jobs are created by migrations and are none of this script's
// business — `rate-limit-cleanup` (00026), `inventory-cache-reconcile`
// (00027/00041), `wie_refresh_velocity` and `wie_refresh_location_traffic`
// (00049), `health-checks-retention` (00059). They call SQL, not HTTP, so they
// need no URL and no secret. Gate A expects 7 jobs in total: those five plus
// these two.

import { resolveTarget, orExit } from '../../scripts/lib/env.mjs'
import { runSql } from '../../scripts/lib/managementApi.mjs'

const JOBS = [
  {
    name: 'po-poll-inbox',
    schedule: '* * * * *',
    fn: 'poll-inbox',
    tokenEnv: 'POLL_INBOX_CRON_TOKEN',
    note: 'Polls every connected mailbox. The token only proves the call is a real cron tick — poll-inbox reads its own service-role key for database access.',
  },
  {
    name: 'health-check',
    schedule: '*/5 * * * *',
    fn: 'health',
    tokenEnv: 'HEALTH_CRON_TOKEN',
    note: 'Do not schedule before the target domain serves /version.json, or the first ticks log false `degraded` alerts.',
  },
]

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const dryRun = argv.includes('--dry-run')

const target = orExit(() =>
  resolveTarget({
    argv,
    require: listOnly ? ['SUPABASE_ACCESS_TOKEN'] : ['SUPABASE_ACCESS_TOKEN', ...JOBS.map((j) => j.tokenEnv)],
  }),
)
const { config, env } = target

console.log(`[crons] ${target.name} (${config.projectRef})\n`)

const live = await runSql(
  target,
  `SELECT jobname, schedule, active FROM cron.job ORDER BY jobname`,
)
console.log(`  ${live.length} job(s) currently scheduled:`)
for (const j of live) {
  console.log(`    ${j.active ? ' ' : '!'} ${j.jobname.padEnd(30)} ${j.schedule}`)
}

if (listOnly) {
  await settle()
  process.exit(0)
}

// `net.http_post` needs pg_net, and cron.schedule needs pg_cron. Both are
// enabled by 00020 on a migrated database, but a project where the Management
// API refused to create an extension gets a comprehensible error here rather
// than a cryptic "schema net does not exist" three statements later.
const exts = await runSql(
  target,
  `SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY 1`,
)
const missing = ['pg_cron', 'pg_net'].filter((e) => !exts.some((r) => r.extname === e))
if (missing.length) {
  console.error(`\n[crons] ✗ missing extension(s): ${missing.join(', ')}`)
  console.error('  Enable them in Dashboard → Database → Extensions and re-run.')
  await settle()
  process.exit(1)
}

console.log()
for (const job of JOBS) {
  const url = `${config.supabaseUrl}/functions/v1/${job.fn}`
  const token = env[job.tokenEnv]

  if (dryRun) {
    console.log(`  would schedule ${job.name.padEnd(20)} ${job.schedule}  -> ${url}`)
    continue
  }

  // Unschedule-then-schedule, guarded, so a re-run replaces rather than
  // duplicates. cron.schedule() with an existing name updates in place on
  // recent pg_cron, but not on every version, and a duplicated poll job means
  // every mailbox is polled twice a minute.
  const sql = `
DO $ops$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${lit(job.name)}) THEN
        PERFORM cron.unschedule(${lit(job.name)});
    END IF;
END
$ops$;

SELECT cron.schedule(
    ${lit(job.name)},
    ${lit(job.schedule)},
    $cron$
        SELECT net.http_post(
            url := ${lit(url)},
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ${token.replace(/'/g, "''")}'
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 50000
        );
    $cron$
);`

  try {
    await runSql(target, sql)
    console.log(`  ✓ ${job.name.padEnd(20)} ${job.schedule}  -> ${url}`)
  } catch (e) {
    console.error(`  ✗ ${job.name}: ${e.message}`)
    process.exitCode = 1
  }
}

if (!dryRun) {
  const after = await runSql(target, `SELECT count(*)::int AS n FROM cron.job`)
  console.log(`\n[crons] ${after[0].n} job(s) scheduled. Gate A expects 7.`)
  console.log('[crons]   Runs: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;')
}

await settle()

/** Single-quote a SQL literal. Values here are registry- and env-sourced, never
 *  user input, but a token containing a quote would otherwise break the job
 *  body in a way that only shows up as a cron that never fires. */
function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync. */
async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
