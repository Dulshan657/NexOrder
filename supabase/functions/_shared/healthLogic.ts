// Pure health-check decision logic for the `health` Edge Function.
//
// No Deno APIs, no DB, no fetch — unit-tested via vitest from the root
// __tests__/ directory (same pattern as poInbox/pollDispatch.ts).

export type HealthStatus = 'ok' | 'degraded' | 'down'

/** client_errors rows in the last 10 minutes at/above which we call it a spike. */
export const ERROR_SPIKE_THRESHOLD = 10

export interface HealthSignals {
  /** Timed DB ping succeeded. */
  dbOk: boolean
  /** GET {APP_URL}/version.json returned parseable JSON in time. */
  frontendOk: boolean
  /** client_errors rows in the last 10 minutes. */
  errorCount: number
}

/**
 * Roll the raw signals up into one status. The DB is the backbone — if the
 * ping fails the system is down regardless of the frontend. A frontend
 * failure or a client-error spike degrades but doesn't kill the API.
 */
export function deriveStatus({ dbOk, frontendOk, errorCount }: HealthSignals): HealthStatus {
  if (!dbOk) return 'down'
  if (!frontendOk || errorCount >= ERROR_SPIKE_THRESHOLD) return 'degraded'
  return 'ok'
}

/**
 * Alert on TRANSITIONS only — a persistently-down system must not page every
 * 5 minutes, and a recovery back to ok is itself worth one alert. First tick
 * ever (prev === null) alerts only when unhealthy.
 */
export function shouldAlert(prev: HealthStatus | null, next: HealthStatus): boolean {
  if (prev === next) return false
  if (prev === null) return next !== 'ok'
  return true
}

export interface AlertContext {
  status: HealthStatus
  previous: HealthStatus | null
  dbOk: boolean
  dbLatencyMs: number | null
  frontendOk: boolean
  frontendVersion: string | null
  errorCount: number
  error: string | null
}

/** One-line human-readable alert body for the Admin bell + email. */
export function alertMessage(ctx: AlertContext): string {
  const from = ctx.previous ?? 'unknown'
  if (ctx.status === 'ok') {
    return `System recovered: ${from} -> ok (DB ${ctx.dbLatencyMs ?? '?'}ms, frontend ${ctx.frontendVersion ?? 'unknown'})`
  }
  const causes: string[] = []
  if (!ctx.dbOk) causes.push('DB ping failed')
  if (!ctx.frontendOk) causes.push('frontend unreachable')
  if (ctx.errorCount >= ERROR_SPIKE_THRESHOLD) {
    causes.push(`${ctx.errorCount} client errors in 10m`)
  }
  const cause = causes.length > 0 ? causes.join('; ') : (ctx.error ?? 'unknown cause')
  return `System ${ctx.status}: ${from} -> ${ctx.status} (${cause})`
}
