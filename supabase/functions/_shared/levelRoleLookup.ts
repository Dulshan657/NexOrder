// Server-side loader for the level_roles vocabulary (mig 00081).
//
// Deliberately OUTSIDE _shared/wie/: that directory is under the purity contract
// (__tests__/wie/purity.test.ts) and may not perform I/O. The pure helpers in
// wie/levelRoles.ts take roles as data; this is where that data comes from on
// the server.
//
// Every Edge Function that used to carry `const LEVEL_ROLES = ['pick',
// 'reserve','bulk'] as const` and a `z.enum(LEVEL_ROLES)` now validates against
// this instead, so an operator-created role is accepted the moment it exists.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import type { LevelRoleRecord } from './wie/levelRoles.ts'

function toRecord(r: any): LevelRoleRecord {
  return {
    key: r.key,
    displayName: r.display_name ?? r.key,
    description: r.description ?? null,
    colorFill: r.color_fill ?? '#e7e5e4',
    colorStroke: r.color_stroke ?? '#78716c',
    colorText: r.color_text ?? null,
    sortOrder: Number(r.sort_order ?? 100),
    huTypes: Array.isArray(r.hu_types) ? r.hu_types : [],
    isPickZone: Boolean(r.is_pick_zone),
    replenSourceRank: r.replen_source_rank != null ? Number(r.replen_source_rank) : null,
    isSystem: Boolean(r.is_system),
    isActive: r.is_active !== false,
  }
}

/**
 * Every active level role.
 *
 * Fails OPEN to an empty list rather than throwing. Callers use this for a
 * PREFERENCE (which roles suit a plate type); with nothing loaded the
 * preference simply does not apply and the SKU's own rule — the actual safety
 * gate, enforced in SQL — still does. A transient read error must not wedge
 * receiving.
 */
export async function loadLevelRoles(admin: SupabaseClient): Promise<LevelRoleRecord[]> {
  const { data } = await admin.from('level_roles').select('*').eq('is_active', true)
  return ((data ?? []) as any[]).map(toRecord)
}

/**
 * Keys of every active level role, for VALIDATING operator input.
 *
 * Fails CLOSED — it throws. This is the opposite posture to loadLevelRoles on
 * purpose: accepting an unvalidated role key would write a value that the FK
 * then rejects with an unreadable error, or worse, silently create a level no
 * putaway rule can reason about.
 */
export async function loadActiveRoleKeys(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from('level_roles').select('key').eq('is_active', true)
  if (error) throw new EdgeFunctionError('INTERNAL', `level role load failed: ${error.message}`)
  return ((data ?? []) as any[]).map((r) => r.key as string)
}

/**
 * Reject any role key that is not an active level role.
 *
 * `null`/`undefined` entries are skipped, not rejected: a NULL level_role means
 * "unconstrained", which is every legacy bin and a perfectly legal value.
 */
export function assertValidRoles(roles: ReadonlyArray<string | null | undefined>, valid: string[]): void {
  const bad = roles.filter((r): r is string => Boolean(r) && !valid.includes(r as string))
  if (bad.length > 0) {
    const unique = [...new Set(bad)]
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      `Unknown level role${unique.length === 1 ? '' : 's'}: ${unique.join(', ')}. Active roles are: ${valid.join(', ')}.`,
    )
  }
}
