// Pure formatting/derivation helpers for the System Health tab.
// No React, no DB — unit-tested via vitest (__tests__/systemHealthFormat.test.ts).

import type { HealthCheckRow, HealthStatus } from '@/services/supabase/systemHealthService'

/**
 * Percentage of checks within the trailing `hours` window that were NOT down.
 * `degraded` counts as up (it's shown separately); `down` is the only outage.
 * Returns null when the window holds no checks (no data ≠ 100%).
 */
export function uptimePercent(rows: ReadonlyArray<HealthCheckRow>, hours: number): number | null {
  const since = Date.now() - hours * 3_600_000
  const windowRows = rows.filter((r) => new Date(r.checked_at).getTime() >= since)
  if (windowRows.length === 0) return null
  const up = windowRows.filter((r) => r.status !== 'down').length
  return (up / windowRows.length) * 100
}

export interface LatencyPoint {
  checkedAt: string
  latencyMs: number
}

/**
 * DB-latency series for the sparkline, oldest → newest, evenly downsampled to
 * at most `points` entries. Rows without a latency reading are skipped.
 */
export function latencySeries(rows: ReadonlyArray<HealthCheckRow>, points: number): LatencyPoint[] {
  const usable = rows
    .filter((r) => typeof r.db_latency_ms === 'number')
    .slice()
    .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
  if (usable.length <= points) {
    return usable.map((r) => ({ checkedAt: r.checked_at, latencyMs: r.db_latency_ms as number }))
  }
  const step = usable.length / points
  const sampled: LatencyPoint[] = []
  for (let i = 0; i < points; i++) {
    const r = usable[Math.min(Math.floor(i * step), usable.length - 1)]
    sampled.push({ checkedAt: r.checked_at, latencyMs: r.db_latency_ms as number })
  }
  return sampled
}

/** Short 7-char sha for display; passes through non-sha markers like 'dev'. */
export function formatSha(sha: string | null | undefined): string {
  if (!sha) return '—'
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

/** Tailwind tone classes per status for the banner + badges. */
export function statusTone(status: HealthStatus | null | undefined): { bg: string; text: string; dot: string } {
  switch (status) {
    case 'ok':
      return { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    case 'degraded':
      return { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' }
    case 'down':
      return { bg: 'bg-red-50 border-red-200', text: 'text-red-700', dot: 'bg-red-500' }
    default:
      return { bg: 'bg-stone-50 border-stone-200', text: 'text-stone-500', dot: 'bg-stone-400' }
  }
}
