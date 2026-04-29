// Shared audit-log helper for Edge Functions.
//
// Every privileged mutation calls logAuditEvent() after a successful write.
// If the audit insert fails, a warning is logged to stderr and the function
// continues — audit-log failure must never block a user mutation.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface AuditLogInput {
  actorId: string
  actorRole: string
  action: 'create' | 'update' | 'delete'
  resource: string
  resourceId?: string | null
  before?: unknown | null
  after?: unknown | null
  reason?: string | null
  metadata?: Record<string, unknown>
}

export async function logAuditEvent(
  supa: SupabaseClient,
  input: AuditLogInput,
): Promise<void> {
  const { error } = await supa.from('audit_events').insert({
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    resource: input.resource,
    resource_id: input.resourceId ?? null,
    before_data: input.before ?? null,
    after_data: input.after ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.warn(
      `[audit] Failed to write audit event (${input.action} ${input.resource}):`,
      error.message,
    )
  }
}
