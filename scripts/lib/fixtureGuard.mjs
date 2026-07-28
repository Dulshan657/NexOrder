// scripts/lib/fixtureGuard.mjs
//
// The single entry point every seed / demo / reset script uses instead of
// rolling its own env loading. Applies all three guards from
// PRODUCTION-LAUNCH-PLAN.md §A2.3, in increasing order of cost:
//
//   1. resolveTarget({ allow: ['dev'] })  — argv/NEXORDER_ENV says dev.
//   2. the registry credential assertion  — the loaded creds really are dev's.
//   3. environment_marker.name !== 'prod' — the DATABASE ITSELF says dev.
//
// Three, because any one of them can be defeated by a single mistake. #3 is the
// only one that survives both a mis-set env file and a mis-edited registry: it
// asks the database it is about to write to what it is.
//
// There is no --force. A script that needs to write to production is not a
// fixture script.

import { resolveTarget, TargetError } from './env.mjs'
import { runSql } from './managementApi.mjs'

const MARKER_SQL = `SELECT name, tenant_key FROM public.environment_marker WHERE id = 1`

/**
 * Resolve a dev-only target and verify the database agrees it is dev.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {string[]} [options.require] credential names the caller needs
 * @returns {Promise<{ name: string, config: any, env: Record<string,string>, marker: {name:string, tenant_key:string} }>}
 */
export async function requireDevTarget(options = {}) {
  // Guards #1 and #2.
  const target = resolveTarget({ ...options, allow: ['dev'] })

  // Guard #3.
  let rows
  try {
    rows = await runSql(target, MARKER_SQL)
  } catch (e) {
    throw new TargetError(
      `Could not read environment_marker on "${target.name}": ${e.message}\n` +
        `The marker is created by migration 00086 and written by ` +
        `\`node supabase/migrate.mjs --env=${target.name} --stamp-only\`. ` +
        `Refusing to run fixtures against a database that cannot identify itself.`,
    )
  }

  const marker = Array.isArray(rows) ? rows[0] : null
  if (!marker?.name) {
    throw new TargetError(
      `environment_marker is empty on "${target.name}".\n` +
        `Run \`node supabase/migrate.mjs --env=${target.name} --stamp-only\` first. ` +
        `An unstamped database is treated as unsafe, not as dev.`,
    )
  }

  if (marker.name !== 'dev') {
    throw new TargetError(
      `The database at ${target.config.supabaseUrl} identifies itself as "${marker.name}".\n` +
        `Fixture scripts do not run there. Nothing was written.\n` +
        `If this is genuinely the dev project, its marker is wrong — fix the marker, not this guard.`,
    )
  }

  return { ...target, marker }
}

/**
 * Top-level wrapper: async-aware sibling of env.mjs's orExit().
 *
 * The brief pause before exiting is not superstition. Guard #3 has just made an
 * HTTPS call, so undici is holding a keep-alive socket; calling process.exit()
 * on top of one trips a libuv assertion on Windows
 * (`!(handle->flags & UV_HANDLE_CLOSING)`), which aborts the process instead of
 * exiting 1 — turning a clean refusal into what looks like a crash, and losing
 * the exit code a caller might be branching on. The same hazard is documented
 * in supabase/apply-auth-config.mjs. env.mjs's orExit() needs no such pause: it
 * runs before any network call.
 *
 * @template T
 * @param {() => Promise<T>} fn
 */
export async function orExitAsync(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`\n${e.message}\n`)
      process.exitCode = 1
      await new Promise((r) => setTimeout(r, 100))
      process.exit(1)
    }
    throw e
  }
}
