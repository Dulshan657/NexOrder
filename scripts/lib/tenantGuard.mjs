// scripts/lib/tenantGuard.mjs
//
// The inverted sibling of fixtureGuard.mjs, for the small number of scripts
// that MUST write to a paying client's database — bootstrapping its first
// admin, setting its identity, tearing the demo out of it.
//
// fixtureGuard is the wrong shape twice over and must not be widened to cover
// this. Its allow-list is `fixtureTargets()`, which by construction excludes
// every tenant, and its third guard asserts the LITERAL 'dev' precisely so it
// cannot be parameterised — that independence from the registry is what makes
// it a third guard rather than a restatement of the first.
//
// The guards here are:
//
//   1. resolveTarget({ allow: tenant names }) — the registry says this target
//      is a tenant, and the credentials loaded belong to it.
//   2. environment_marker matches the registry's markerName AND tenantKey. The
//      database itself agrees about who it is. An unstamped marker is refused,
//      not treated as permission.
//   3. --confirm=<projectRef> must be typed and must match. Every other
//      tenant-writing path in this repo is protected by being impossible to
//      run; these scripts are meant to run, so the protection has to be that
//      you cannot run one by pressing Up and Enter.
//
// Note guard 2 compares against the registry, where fixtureGuard's compares
// against a literal. That is not an inconsistency: fixtureGuard is protecting
// against a mis-edited registry, while here the registry is the thing declaring
// which client this is, and the marker is what corroborates it.

import { tenantTargets } from '../../config/environments.mjs'
import { resolveTarget, TargetError } from './env.mjs'
import { runSql } from './managementApi.mjs'

const MARKER_SQL = `SELECT name, tenant_key FROM public.environment_marker WHERE id = 1`

/**
 * Resolve a tenant target, verify the database agrees, and require a typed
 * confirmation of the project ref.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {string[]} [options.require] credential names the caller needs
 * @param {string} [options.action] shown in the refusal, e.g. 'purge the demo data'
 * @returns {Promise<{ name: string, config: any, env: Record<string,string>, marker: {name:string, tenant_key:string} }>}
 */
export async function requireTenantTarget(options = {}) {
  const argv = options.argv ?? process.argv.slice(2)
  const allow = tenantTargets().map((c) => c.name)

  if (allow.length === 0) {
    throw new TargetError(
      'No tenant targets exist in config/environments.mjs. There is nothing this script could run against.',
    )
  }

  // Guards #1 and #2 (registry membership + credential assertion).
  const target = resolveTarget({ ...options, argv, allow })

  // Guard #3: the database agrees it is this tenant.
  let rows
  try {
    rows = await runSql(target, MARKER_SQL)
  } catch (e) {
    throw new TargetError(
      `Could not read environment_marker on "${target.name}": ${e.message}\n` +
        `Refusing to write to a database that cannot identify itself.`,
    )
  }

  const marker = Array.isArray(rows) ? rows[0] : null
  if (!marker?.name) {
    throw new TargetError(
      `environment_marker is empty on "${target.name}".\n` +
        `Stamp it first: node supabase/migrate.mjs --env=${target.name} --stamp-only`,
    )
  }

  const expected = { name: target.config.markerName, tenant_key: target.config.tenantKey }
  if (marker.name !== expected.name || marker.tenant_key !== expected.tenant_key) {
    throw new TargetError(
      `The database at ${target.config.supabaseUrl} says it is ` +
        `"${marker.name}/${marker.tenant_key}", but the registry says target ` +
        `"${target.name}" should be "${expected.name}/${expected.tenant_key}".\n` +
        `Nothing was written. One of the two is wrong and guessing which is not this script's job.`,
    )
  }

  // Guard #4: typed confirmation.
  const confirm = argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length)
  if (confirm !== target.config.projectRef) {
    throw new TargetError(
      `This writes to ${target.config.label} — ${target.config.supabaseUrl}\n` +
        (options.action ? `Action: ${options.action}\n` : '') +
        `\nRe-run with the project ref typed out:\n` +
        `  --confirm=${target.config.projectRef}\n` +
        (confirm ? `\nYou passed --confirm=${confirm}, which is not it.\n` : ''),
    )
  }

  return { ...target, marker }
}
