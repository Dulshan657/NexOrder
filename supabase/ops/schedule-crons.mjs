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
// need no URL and no secret.
//
// ── A JOB CAN BELONG TO A MODULE, AND THEN IT IS UNSCHEDULED ────────────────
//
// `po-poll-inbox` calls `poll-inbox`, which `deploy-functions.mjs` does not
// deploy to a target without `po_inbox` — and which the operator is told to
// DELETE from a project that already had it. A cron pointed at a function that
// no longer exists fails once a minute, forever, and re-running this script
// would put it straight back. So a job whose module is off is unscheduled and
// skipped, which also makes that cleanup idempotent rather than a one-off
// hand-typed `cron.unschedule`.
//
// Gate A therefore expects 7 jobs on a target with `po_inbox` and 6 without.

import { resolveTarget, orExit } from '../../scripts/lib/env.mjs'
import { runSql } from '../../scripts/lib/managementApi.mjs'
import { TARGETS, canonicalTargetName } from '../../config/environments.mjs'

const JOBS = [
  {
    name: 'po-poll-inbox',
    schedule: '* * * * *',
    fn: 'poll-inbox',
    tokenEnv: 'POLL_INBOX_CRON_TOKEN',
    /** Off ⇒ unscheduled, never created. See the header. */
    module: 'po_inbox',
    note: 'Polls every connected mailbox. The token only proves the call is a real cron tick — poll-inbox reads its own service-role key for database access.',
  },
  {
    name: 'health-check',
    schedule: '*/5 * * * *',
    fn: 'health',
    tokenEnv: 'HEALTH_CRON_TOKEN',
    /** No module: `health` is core and every target is monitored. */
    note: 'Do not schedule before the target domain serves /version.json, or the first ticks log false `degraded` alerts.',
  },
]

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const dryRun = argv.includes('--dry-run')

// Resolved before the target so the token requirement can be narrowed to the
// jobs that will actually be scheduled — demanding POLL_INBOX_CRON_TOKEN from a
// target that will never poll a mailbox is a refusal with nothing behind it.
const targetNameArg = argv.find((a) => a.startsWith('--env='))?.slice('--env='.length)?.trim()
const plannedModules = (() => {
  try {
    return TARGETS[canonicalTargetName(targetNameArg ?? '')]?.modules ?? null
  } catch {
    return null
  }
})()
const jobIsEnabled = (job) =>
  !job.module || plannedModules === null || plannedModules.includes(job.module)

const target = orExit(() =>
  resolveTarget({
    argv,
    require: listOnly
      ? ['SUPABASE_ACCESS_TOKEN']
      : ['SUPABASE_ACCESS_TOKEN', ...JOBS.filter(jobIsEnabled).map((j) => j.tokenEnv)],
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

  // A job whose module the target does not have is REMOVED, not merely skipped.
  // Skipping alone would leave a live cron calling a function that is about to
  // be deleted, ticking and failing every minute.
  if (job.module && !config.modules.includes(job.module)) {
    if (dryRun) {
      console.log(`  would UNSCHEDULE ${job.name.padEnd(20)} (${job.module} not enabled)`)
      continue
    }
    try {
      await runSql(
        target,
        `DO $ops$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${lit(job.name)}) THEN
        PERFORM cron.unschedule(${lit(job.name)});
    END IF;
END
$ops$;`,
      )
      console.log(`  – ${job.name.padEnd(20)} unscheduled — ${job.module} not enabled here`)
    } catch (e) {
      console.error(`  ✗ ${job.name}: ${e.message}`)
      process.exitCode = 1
    }
    continue
  }

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
  // Five migration-created jobs, plus one per job above whose module this
  // target has. Printing a flat "expects 7" on a target that correctly has 6
  // reads as a failed run — which is exactly what it did on Amadiya.
  const expected = 5 + JOBS.filter((j) => !j.module || config.modules.includes(j.module)).length
  const verdict = after[0].n === expected ? 'as expected' : `EXPECTED ${expected}`
  console.log(`\n[crons] ${after[0].n} job(s) scheduled — ${verdict}.`)
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
