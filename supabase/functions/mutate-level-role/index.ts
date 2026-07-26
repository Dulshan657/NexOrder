// mutate-level-role Edge Function
//
// Admin-only CRUD on `level_roles` (mig 00081) — the operator-managed rack level
// role vocabulary that replaced a hardcoded ('pick','reserve','bulk') scattered
// across a SQL CHECK, a plpgsql RAISE, two TS unions, three zod enums and four
// arrays. Direct writes are RLS-blocked; this service-role function is the sole
// write path.
//
// Four invariants live here because no constraint can express them:
//
//   1. `key` is IMMUTABLE, on every row. The FK carries ON UPDATE CASCADE as a
//      safety net, but actually using it would rewrite public.locations under a
//      lock. Renaming is what display_name is for.
//   2. A system role cannot be deleted. (is_system protects DELETION only —
//      invariant 3 covers its semantics.)
//   3. At least one ACTIVE role must keep is_pick_zone. Without one,
//      replenishment has no destination and every completion fails at the rack.
//   4. Delete requires zero usage across all four references. Two of them —
//      product_wms_attributes.allowed_level_roles (an array element) and
//      storage_types.level_template (a JSONB field) — can never have an FK, so
//      wie_level_role_usage is their only defence.
//
// Changing is_pick_zone / replen_source_rank / hu_types requires a `reason`,
// following the mutate-horeca sensitive-fields precedent: those three silently
// alter order allocation and the hard putaway gate company-wide. A rename does
// not, so it does not ask for one.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

// The handling-unit types a role may claim. This mirrors the HuType union in
// _shared/wie/capacity.ts, and is validated HERE rather than as a SQL CHECK on
// hu_types: a CHECK would re-introduce exactly the hardcoding mig 00081 removed,
// and this list is about what the INVENTORY MODEL supports, not about what an
// operator may name a role.
const HU_TYPES = ['pallet', 'carton'] as const

const HEX = /^#[0-9a-fA-F]{6}$/

const roleFields = {
  display_name: z.string().min(1).max(60),
  description: z.string().max(400).nullable().optional(),
  color_fill: z.string().regex(HEX, 'Must be a #rrggbb colour'),
  color_stroke: z.string().regex(HEX, 'Must be a #rrggbb colour'),
  color_text: z.string().regex(HEX).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999),
  hu_types: z.array(z.enum(HU_TYPES)),
  is_pick_zone: z.boolean(),
  replen_source_rank: z.number().int().positive().nullable(),
}

const createSchema = z.object({
  // Lowercase snake, like zone_type. The key is the stored value forever, so it
  // is normalised once here and never touched again.
  key: z.string().min(1).max(32),
  ...roleFields,
  description: roleFields.description,
})

const updateSchema = z
  .object({
    display_name: roleFields.display_name.optional(),
    description: roleFields.description,
    color_fill: roleFields.color_fill.optional(),
    color_stroke: roleFields.color_stroke.optional(),
    color_text: roleFields.color_text,
    sort_order: roleFields.sort_order.optional(),
    hu_types: roleFields.hu_types.optional(),
    is_pick_zone: roleFields.is_pick_zone.optional(),
    replen_source_rank: roleFields.replen_source_rank.optional(),
    is_active: z.boolean().optional(),
    // Present only so a client that echoes the whole row back gets a clear
    // error instead of a silent no-op. Invariant 1.
    key: z.string().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided for update',
  })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema, reason: z.string().max(400).optional() }),
  z.object({
    action: z.literal('update'),
    key: z.string().min(1).max(32),
    data: updateSchema,
    reason: z.string().max(400).optional(),
  }),
  z.object({ action: z.literal('delete'), key: z.string().min(1).max(32) }),
  z.object({ action: z.literal('usage'), key: z.string().min(1).max(32) }),
])

/** Fields whose change alters behaviour company-wide and therefore needs a
 *  stated reason on the audit trail. */
const SENSITIVE = ['is_pick_zone', 'replen_source_rank', 'hu_types'] as const

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

type UsageCounts = {
  locations: number
  sku_rules: number
  form_levels: number
  home_bins: number
}

async function loadUsage(admin: any, key: string): Promise<UsageCounts> {
  const { data, error } = await admin.rpc('wie_level_role_usage', { p_key: key })
  if (error) throw new EdgeFunctionError('INTERNAL', `usage check failed: ${error.message}`)
  const u = (data ?? {}) as Record<string, unknown>
  return {
    locations: Number(u.locations ?? 0),
    sku_rules: Number(u.sku_rules ?? 0),
    form_levels: Number(u.form_levels ?? 0),
    home_bins: Number(u.home_bins ?? 0),
  }
}

function describeUsage(u: UsageCounts): string {
  const parts: string[] = []
  if (u.locations) parts.push(`${u.locations} location${u.locations === 1 ? '' : 's'}`)
  if (u.sku_rules) parts.push(`${u.sku_rules} product rule${u.sku_rules === 1 ? '' : 's'}`)
  if (u.form_levels) parts.push(`${u.form_levels} storage form${u.form_levels === 1 ? '' : 's'}`)
  if (u.home_bins) parts.push(`${u.home_bins} home bin${u.home_bins === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/** Invariant 3: at least one ACTIVE role must remain a pick zone. Evaluated
 *  against the state the write WOULD produce, not the state before it. */
async function assertPickZoneSurvives(
  admin: any,
  changedKey: string,
  next: { is_pick_zone: boolean; is_active: boolean } | null,
): Promise<void> {
  const { data } = await admin.from('level_roles').select('key, is_pick_zone, is_active')
  const rows = ((data ?? []) as any[]).filter((r) => r.key !== changedKey)
  const survivors = rows.filter((r) => r.is_pick_zone && r.is_active).length
    + (next && next.is_pick_zone && next.is_active ? 1 : 0)
  if (survivors === 0) {
    throw new EdgeFunctionError(
      'CONFLICT',
      'At least one active level role must be a pick zone — replenishment and order allocation both need somewhere to point. Mark another role as the pick zone first.',
    )
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-level-role:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // ── usage (read-only; drives the UI's "in use by…" copy) ─────────────────
    if (input.action === 'usage') {
      const usage = await loadUsage(admin, input.key)
      return new Response(JSON.stringify({ ok: true, usage }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── create ───────────────────────────────────────────────────────────────
    if (input.action === 'create') {
      const key = normalizeKey(input.data.key)
      if (!key) throw new EdgeFunctionError('INVALID_INPUT', 'Key must contain a letter or digit')

      const row = {
        key,
        display_name: input.data.display_name,
        description: input.data.description ?? null,
        color_fill: input.data.color_fill,
        color_stroke: input.data.color_stroke,
        color_text: input.data.color_text ?? null,
        sort_order: input.data.sort_order,
        hu_types: input.data.hu_types,
        is_pick_zone: input.data.is_pick_zone,
        replen_source_rank: input.data.replen_source_rank,
        // Operator-created roles are never system roles — only 00081's seed is.
        is_system: false,
        is_active: true,
        updated_by: auth.userId,
      }

      const { data: created, error } = await admin
        .from('level_roles').insert(row as any).select().single()
      if (error) {
        if ((error as any).code === '23505') {
          throw new EdgeFunctionError('CONFLICT', `A level role with the key "${key}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'level_roles',
        resourceId: key, after: created as Record<string, unknown>,
        metadata: input.reason ? { reason: input.reason } : undefined,
      })
      return new Response(JSON.stringify({ ok: true, level_role: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: fetchErr } = await admin
      .from('level_roles').select('*').eq('key', input.key).single()
    if (fetchErr || !existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Level role "${input.key}" not found`)
    }
    const before = existing as any

    // ── delete ───────────────────────────────────────────────────────────────
    if (input.action === 'delete') {
      if (before.is_system) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `"${before.display_name}" is a built-in level role and cannot be deleted. Deactivate it instead if it is no longer used.`,
        )
      }
      const usage = await loadUsage(admin, input.key)
      const total = usage.locations + usage.sku_rules + usage.form_levels + usage.home_bins
      if (total > 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `"${before.display_name}" is still in use by ${describeUsage(usage)}. Reassign them before deleting it.`,
          usage,
        )
      }
      await assertPickZoneSurvives(admin, input.key, null)

      const { error: delErr } = await admin.from('level_roles').delete().eq('key', input.key)
      // The FK is the second net behind is_system: if anything still points here
      // that wie_level_role_usage does not count, Postgres refuses.
      if (delErr) {
        if ((delErr as any).code === '23503') {
          throw new EdgeFunctionError('CONFLICT', `"${before.display_name}" is still referenced and cannot be deleted.`)
        }
        throw new EdgeFunctionError('INTERNAL', delErr.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'level_roles',
        resourceId: input.key, before,
      })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── update ───────────────────────────────────────────────────────────────
    const patch = { ...input.data } as Record<string, unknown>

    // Invariant 1 — on EVERY row, system or not.
    if (patch.key !== undefined && normalizeKey(String(patch.key)) !== before.key) {
      throw new EdgeFunctionError(
        'CONFLICT',
        'A level role\'s key is permanent — it is the value stored on every level that uses it. Change the display name instead.',
      )
    }
    delete patch.key

    const touchedSensitive = SENSITIVE.filter((f) => {
      if (patch[f] === undefined) return false
      return JSON.stringify(patch[f]) !== JSON.stringify(before[f])
    })
    if (touchedSensitive.length > 0 && !input.reason?.trim()) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        `Changing ${touchedSensitive.join(', ')} changes how stock is put away and how every order allocates. Please give a reason.`,
      )
    }

    // Invariant 3, evaluated against the post-write state.
    if (patch.is_pick_zone !== undefined || patch.is_active !== undefined) {
      await assertPickZoneSurvives(admin, input.key, {
        is_pick_zone: (patch.is_pick_zone as boolean | undefined) ?? before.is_pick_zone,
        is_active: (patch.is_active as boolean | undefined) ?? before.is_active,
      })
    }

    // Deactivating a role that levels still carry would strip the putaway gate
    // from those levels silently. Blocked, mirroring mutate-zone-profile.
    if (patch.is_active === false && before.is_active) {
      const usage = await loadUsage(admin, input.key)
      if (usage.locations > 0 || usage.home_bins > 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `"${before.display_name}" is still assigned to ${describeUsage(usage)}. Reassign them before deactivating it.`,
          usage,
        )
      }
    }

    patch.updated_at = new Date().toISOString()
    patch.updated_by = auth.userId

    const { data: updated, error: updErr } = await admin
      .from('level_roles').update(patch as any).eq('key', input.key).select().single()
    if (updErr || !updated) {
      throw new EdgeFunctionError('INTERNAL', updErr?.message ?? 'Failed to update level role')
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'level_roles',
      resourceId: input.key, before, after: updated as Record<string, unknown>,
      metadata: {
        ...(input.reason ? { reason: input.reason } : {}),
        ...(touchedSensitive.length > 0 ? { sensitive_fields: touchedSensitive } : {}),
      },
    })
    return new Response(JSON.stringify({ ok: true, level_role: updated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
