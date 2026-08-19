// Compare what a database actually grants against what config/lockedTables.mjs
// says it should.
//
// PURE. Takes rows, returns findings. No database, no filesystem, no argv — so
// the interesting half of `check:grants` is unit-testable without credentials,
// which matters because the script itself can only ever run where a Supabase
// access token exists.

import { CLIENT_ROLES, CLIENT_WRITE_PRIVILEGES, LOCKED_TABLES } from '../../config/lockedTables.mjs'
import { GRANT_BASELINE } from '../../config/grantBaseline.mjs'

/**
 * @typedef {object} GrantRow
 * @property {string} table_name
 * @property {string} grantee
 * @property {string} privilege_type
 */

/**
 * @typedef {object} Finding
 * @property {'unexpected_grant'|'missing_table'|'baselined'} kind
 * @property {string} table
 * @property {string} [grantee]
 * @property {string} [privilege]
 * @property {string} fn
 * @property {string} migration
 * @property {string} message
 */

/**
 * Every write privilege a client-facing role holds on a locked table, minus the
 * ones that table's entry declares as deliberate.
 *
 * `tablesPresent` is the set of tables the database actually has. A locked table
 * that is absent is reported separately rather than passing silently: the two
 * ways this check can lull someone are an unexpected grant it fails to see, and
 * a table name that has been renamed out from under the expectation so nothing
 * is ever compared. Both are findings.
 *
 * @param {readonly GrantRow[]} rows
 * @param {ReadonlySet<string>} tablesPresent
 * @returns {Finding[]}
 */
export function findGrantViolations(rows, tablesPresent) {
  const findings = []

  for (const entry of LOCKED_TABLES) {
    if (!tablesPresent.has(entry.table)) {
      findings.push({
        kind: 'missing_table',
        table: entry.table,
        fn: entry.fn,
        migration: entry.migration,
        message:
          `public.${entry.table} is listed in config/lockedTables.mjs but does not ` +
          'exist on this target. Either the table was renamed and the expectation ' +
          'was not, or this database is behind the migration that creates it — ' +
          'both mean the lockdown on it is currently unverified.',
      })
      continue
    }

    const allowed = new Set(entry.except ?? [])

    for (const row of rows) {
      if (row.table_name !== entry.table) continue
      if (!CLIENT_ROLES.includes(row.grantee)) continue
      if (!CLIENT_WRITE_PRIVILEGES.includes(row.privilege_type)) continue
      if (allowed.has(row.privilege_type)) continue

      // Known-bad and already recorded (audit finding DB-3). Reported and
      // counted, but NOT fatal -- see config/grantBaseline.mjs, including the
      // rule that it is a record of debt and never a suppression list.
      const baselined = (GRANT_BASELINE[entry.table]?.[row.grantee] ?? []).includes(
        row.privilege_type,
      )

      findings.push({
        kind: baselined ? 'baselined' : 'unexpected_grant',
        table: entry.table,
        grantee: row.grantee,
        privilege: row.privilege_type,
        fn: entry.fn,
        migration: entry.migration,
        message:
          `${row.grantee} holds ${row.privilege_type} on public.${entry.table}. ` +
          `Mutations are supposed to go through ${entry.fn} (mig ${entry.migration}). ` +
          'Dropping the RLS policy is not enough — the grant has to be revoked too.',
      })
    }
  }

  // Stable ordering so a diff between two runs is about the grants, not about
  // whatever order PostgREST happened to answer in.
  findings.sort(
    (a, b) =>
      a.table.localeCompare(b.table) ||
      (a.grantee ?? '').localeCompare(b.grantee ?? '') ||
      (a.privilege ?? '').localeCompare(b.privilege ?? ''),
  )
  return findings
}

/** The tables this check cares about, for the WHERE clause. */
export function lockedTableNames() {
  return LOCKED_TABLES.map((e) => e.table)
}

/** Findings that must fail the run: everything not already in the baseline. */
export function fatalFindings(findings) {
  return findings.filter((f) => f.kind !== 'baselined')
}

/** One line per fatal finding, for a terminal. */
export function formatFindings(findings) {
  const fatal = fatalFindings(findings)
  if (fatal.length === 0) return 'No new write grants. Every locked table is locked, or baselined.'
  return fatal.map((f) => `  \u2717 ${f.message}`).join('\n')
}

/**
 * A one-line-per-table summary of the inherited DB-3 grants.
 *
 * Printed on every run rather than hidden behind a flag: a baseline nobody sees
 * stops being a record of debt and becomes a way of not noticing it.
 */
export function formatBaselined(findings) {
  const baselined = findings.filter((f) => f.kind === 'baselined')
  if (baselined.length === 0) return null
  const byTable = new Map()
  for (const f of baselined) {
    if (!byTable.has(f.table)) byTable.set(f.table, [])
    byTable.get(f.table).push(`${f.grantee}:${f.privilege}`)
  }
  const lines = [...byTable]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([table, items]) => `  \u00b7 ${table} \u2014 ${items.sort().join(', ')}`)
  return (
    `${baselined.length} inherited grant${baselined.length === 1 ? '' : 's'} across ` +
    `${byTable.size} table${byTable.size === 1 ? '' : 's'} (audit finding DB-3, ` +
    `config/grantBaseline.mjs):\n${lines.join('\n')}`
  )
}
