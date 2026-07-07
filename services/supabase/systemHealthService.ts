// Read-only access to health_checks + deployments (+ client_errors count).
// All three tables enforce Admin-only SELECT via RLS, so this service is
// effectively a no-op for non-Admin callers — Supabase returns zero rows
// rather than an error. Writes happen server-side only (health function,
// deploy script) via service_role.

import { supabase } from '@/lib/supabase'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface HealthCheckRow {
  id: string
  checked_at: string
  status: HealthStatus
  db_latency_ms: number | null
  frontend_ok: boolean | null
  frontend_version: string | null
  error_count_10m: number
  error: string | null
  metadata: Record<string, unknown>
}

export interface DeploymentRow {
  id: string
  deployed_at: string
  commit_sha: string
  branch: string | null
  deployer: string | null
  url: string | null
  verified: boolean
  verified_at: string | null
  notes: string | null
}

export async function getLatestHealthCheck(): Promise<HealthCheckRow | null> {
  const { data, error } = await supabase
    .from('health_checks')
    .select('*')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as HealthCheckRow) ?? null
}

export async function getHealthChecks(since: string, limit = 500): Promise<HealthCheckRow[]> {
  const { data, error } = await supabase
    .from('health_checks')
    .select('*')
    .gte('checked_at', since)
    .order('checked_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as HealthCheckRow[]
}

export async function getDeployments(limit = 20): Promise<DeploymentRow[]> {
  const { data, error } = await supabase
    .from('deployments')
    .select('*')
    .order('deployed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as DeploymentRow[]
}

export async function getRecentClientErrorCount(minutes = 60): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { count, error } = await supabase
    .from('client_errors')
    .select('id', { count: 'exact', head: true })
    .gte('occurred_at', since)
  if (error) throw error
  return count ?? 0
}
