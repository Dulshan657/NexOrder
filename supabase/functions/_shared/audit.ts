// Shared audit-log helper for Edge Functions.
//
// Every privileged mutation calls logAuditEvent() after a successful write.
// If the audit insert fails, a warning is logged to stderr and the function
// continues — audit-log failure must never block a user mutation.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export interface AuditLogInput {
  actorId: string
  actorRole: string
  /**
   * `read` was added by mig 00113 and is deliberately rare: it is written only
   * when handing out access to something a client cannot otherwise reach, which
   * today means a signed URL for a private media object. Ordinary SELECTs are
   * not audited and must not be — RLS governs them, and logging every read
   * would bury the mutations this table exists for.
   *
   * `audit_events.action` carries no CHECK constraint (00012:11 documents the
   * vocabulary in a comment only), so widening this union needed no migration.
   */
  action: 'create' | 'update' | 'delete' | 'read'
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
