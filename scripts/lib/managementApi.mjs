// scripts/lib/managementApi.mjs
//
// Raw SQL against a Supabase project via the Management API. This is the only
// transport that works from this Windows box — the direct DB host
// (`db.<ref>.supabase.co:5432`) is unresolvable here, which is why
// `supabase/run-migration.mjs` has never worked locally.
//
// `SUPABASE_ACCESS_TOKEN` is a PERSONAL access token: it is account-scoped and
// reaches every organisation you belong to, dev and prod alike. It is not an
// isolation boundary. The isolation is resolveTarget() choosing the ref.

const ENDPOINT = (ref) => `https://api.supabase.com/v1/projects/${ref}/database/query`

export class SqlError extends Error {
  constructor(message, { status, body } = {}) {
    super(message)
    this.status = status
    this.body = body
  }
}

/**
 * Execute SQL against the resolved target.
 *
 * @param {{ config: any, env: Record<string,string> }} target from resolveTarget()
 * @param {string} sql
 * @returns {Promise<any>} the parsed response (usually an array of rows)
 */
export async function runSql(target, sql) {
  const token = target.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    throw new SqlError(
      `Missing SUPABASE_ACCESS_TOKEN for "${target.name ?? target.config.name}". ` +
        `Set it in ${target.config.envFile} (https://supabase.com/dashboard/account/tokens).`,
    )
  }

  const resp = await fetch(ENDPOINT(target.config.projectRef), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })

  const text = await resp.text()
  if (!resp.ok) {
    throw new SqlError(`HTTP ${resp.status} from the Management API: ${text}`, {
      status: resp.status,
      body: text,
    })
  }

  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Run SQL inside BEGIN … ROLLBACK so a SELECT can observe the effect of writes
 * that are then discarded. The verification pattern already used on this box
 * for checking RPCs against the live database without leaving a trace.
 *
 * @param {{ config: any, env: Record<string,string> }} target
 * @param {string} sql
 */
export async function runSqlRolledBack(target, sql) {
  return runSql(target, `BEGIN;\n${sql}\nROLLBACK;`)
}
