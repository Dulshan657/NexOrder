// mutate-wie-rule Edge Function
//
// Admin authoring of the optimizer's config: putaway/picking/slotting RULES
// (wie_rules) and the global category-compatibility matrix (category_compatibility).
// Rule definitions are validated to the engine's structured shape. Direct writes
// to both tables are RLS-blocked; this service-role function is the sole path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

const conditionSchema = z.object({
  subject: z.enum(['product', 'bin', 'zone']),
  attr: z.string().min(1).max(60),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists']),
  value: z.unknown().optional(),
})

const actionSchema = z.object({
  effect: z.enum(['require', 'forbid', 'boost', 'penalty']),
  target: z.object({
    scope: z.enum(['bin', 'zone']),
    attr: z.string().min(1).max(60),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists']),
    value: z.unknown().optional(),
  }).optional(),
  delta: z.number().optional(),
})

const ruleDefinitionSchema = z.object({
  conditions: z.array(conditionSchema).max(20),
  conditionLogic: z.enum(['and', 'or']).optional(),
  action: actionSchema,
})

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  warehouse_id: z.number().int().positive().nullable().optional(),
  rule_type: z.enum(['putaway', 'picking', 'slotting']),
  enforcement: z.enum(['hard', 'soft']),
  priority: z.number().int().min(0).max(1000).optional(),
  definition: ruleDefinitionSchema,
  is_active: z.boolean().optional(),
})

// category_compatibility is stored normalized (a <= b). We normalize server-side.
const compatSchema = z.object({
  category_a: z.string().min(1).max(120),
  category_b: z.string().min(1).max(120),
  level: z.enum(['forbidden', 'restricted', 'allowed']),
  note: z.string().max(500).optional(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert_rule'), id: z.number().int().positive().optional(), data: ruleSchema }),
  z.object({ action: z.literal('delete_rule'), id: z.number().int().positive() }),
  z.object({ action: z.literal('set_compatibility'), data: compatSchema }),
  z.object({ action: z.literal('delete_compatibility'), category_a: z.string(), category_b: z.string() }),
])

function normalizePair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-wie-rule:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'upsert_rule') {
      // Effect must match enforcement, and hard needs a target / soft a delta.
      const d = input.data
      const effect = d.definition.action.effect
      const hardEffect = effect === 'require' || effect === 'forbid'
      if (d.enforcement === 'hard' && !hardEffect) {
        throw new EdgeFunctionError('INVALID_INPUT', 'A hard rule must require or forbid')
      }
      if (d.enforcement === 'soft' && hardEffect) {
        throw new EdgeFunctionError('INVALID_INPUT', 'A soft rule must boost or penalize')
      }
      if (d.enforcement === 'hard' && !d.definition.action.target) {
        throw new EdgeFunctionError('INVALID_INPUT', 'A hard rule needs an action target')
      }
      if (d.enforcement === 'soft' && !d.definition.action.delta) {
        throw new EdgeFunctionError('INVALID_INPUT', 'A soft rule needs a non-zero delta')
      }
      const base = {
        name: d.name, warehouse_id: d.warehouse_id ?? null, rule_type: d.rule_type,
        enforcement: d.enforcement, priority: d.priority ?? 100, definition: d.definition,
        is_active: d.is_active ?? true,
      }
      let saved: unknown, error: { message: string } | null
      if (input.id) {
        // Preserve the original created_by on edits.
        const res = await admin.from('wie_rules').update(base as any).eq('id', input.id).select().maybeSingle()
        saved = res.data; error = res.error
        if (!res.error && !res.data) throw new EdgeFunctionError('NOT_FOUND', `Rule ${input.id} not found`)
      } else {
        const res = await admin.from('wie_rules').insert({ ...base, created_by: auth.userId } as any).select().single()
        saved = res.data; error = res.error
      }
      if (error || !saved) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to save rule')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: input.id ? 'update' : 'create',
        resource: 'wie_rules', resourceId: String((saved as any).id), after: saved as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, rule: saved }), {
        status: input.id ? 200 : 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'delete_rule') {
      const { error } = await admin.from('wie_rules').delete().eq('id', input.id)
      if (error) throw new EdgeFunctionError('INTERNAL', error.message)
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'wie_rules',
        resourceId: String(input.id), after: null,
      })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'set_compatibility') {
      const [a, b] = normalizePair(input.data.category_a, input.data.category_b)
      const { data: saved, error } = await admin.from('category_compatibility').upsert({
        category_a: a, category_b: b, level: input.data.level, note: input.data.note ?? null,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'category_a,category_b' }).select().single()
      if (error || !saved) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to save compatibility')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'category_compatibility',
        resourceId: `${a}|${b}`, after: saved as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, compatibility: saved }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // delete_compatibility
    const [a, b] = normalizePair(input.category_a, input.category_b)
    const { error } = await admin.from('category_compatibility').delete().eq('category_a', a).eq('category_b', b)
    if (error) throw new EdgeFunctionError('INTERNAL', error.message)
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'category_compatibility',
      resourceId: `${a}|${b}`, after: null,
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
