// Read-only access to audit_events + client_errors.
// Both tables enforce Admin-only SELECT via RLS, so this service is
// effectively a no-op for non-Admin callers — Supabase will return zero rows
// rather than an error.

import { supabase } from '@/lib/supabase'

// audit_events and client_errors are not in database.types.ts yet
// (the file was generated before those tables existed). We model the rows
// locally rather than regenerate the entire schema file.

export interface AuditEventRow {
  id: string
  occurred_at: string
  actor_id: string
  actor_role: string
  action: 'create' | 'update' | 'delete'
  resource: string
  resource_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  reason: string | null
  metadata: Record<string, unknown>
}

export interface ClientErrorRow {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_role: string | null
  message: string
  stack: string | null
  component_stack: string | null
  url: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
}

export type AuditAction = 'create' | 'update' | 'delete'

export interface AuditFilters {
  fromDate?: string         // ISO date (yyyy-mm-dd)
  toDate?: string           // ISO date (yyyy-mm-dd)
  actorId?: string          // UUID
  resource?: string
  action?: AuditAction
  search?: string
  limit: number
  offset: number
}

export interface ClientErrorFilters {
  fromDate?: string
  toDate?: string
  actorId?: string
  search?: string
  limit: number
  offset: number
}

export interface AuditPage<T> {
  rows: T[]
  total: number
}

// Escape % and _ from user search input so they don't act as ILIKE wildcards.
function escapeIlike(term: string): string {
  return term.replace(/[%_\\]/g, (m) => `\\${m}`)
}

export async function getAuditEvents(filters: AuditFilters): Promise<AuditPage<AuditEventRow>> {
  let query = supabase
    .from('audit_events')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })

  if (filters.fromDate) {
    query = query.gte('occurred_at', filters.fromDate)
  }
  if (filters.toDate) {
    // toDate is inclusive: include the entire day
    query = query.lte('occurred_at', `${filters.toDate}T23:59:59.999Z`)
  }
  if (filters.actorId) {
    query = query.eq('actor_id', filters.actorId)
  }
  if (filters.resource) {
    query = query.eq('resource', filters.resource)
  }
  if (filters.action) {
    query = query.eq('action', filters.action)
  }
  if (filters.search) {
    const term = `%${escapeIlike(filters.search)}%`
    query = query.or(`reason.ilike.${term},resource_id.ilike.${term}`)
  }

  const { data, count, error } = await query.range(
    filters.offset,
    filters.offset + filters.limit - 1,
  )
  if (error) throw error

  return {
    rows: (data ?? []) as unknown as AuditEventRow[],
    total: count ?? 0,
  }
}

export async function getClientErrors(filters: ClientErrorFilters): Promise<AuditPage<ClientErrorRow>> {
  let query = supabase
    .from('client_errors')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })

  if (filters.fromDate) {
    query = query.gte('occurred_at', filters.fromDate)
  }
  if (filters.toDate) {
    query = query.lte('occurred_at', `${filters.toDate}T23:59:59.999Z`)
  }
  if (filters.actorId) {
    query = query.eq('actor_id', filters.actorId)
  }
  if (filters.search) {
    const term = `%${escapeIlike(filters.search)}%`
    query = query.or(`message.ilike.${term},url.ilike.${term}`)
  }

  const { data, count, error } = await query.range(
    filters.offset,
    filters.offset + filters.limit - 1,
  )
  if (error) throw error

  return {
    rows: (data ?? []) as unknown as ClientErrorRow[],
    total: count ?? 0,
  }
}
