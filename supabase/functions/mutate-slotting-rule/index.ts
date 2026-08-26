// mutate-slotting-rule Edge Function
//
// The sole write path for Slotting Rules (mig 00115): which products belong in
// which blocks of a warehouse. Direct writes are RLS-blocked and no client role
// holds INSERT/UPDATE/DELETE on any of the four tables, so everything comes
// through here as service_role.
//
// WHY A NEW FUNCTION RATHER THAN ACTIONS ON mutate-warehouse-location. That file
// is ~2000 lines with twelve actions and five rate buckets, and those buckets
// exist specifically to protect mass `locations` rewrites -- a paint or a recode
// touches 1100+ rows and must not be able to lock an operator out of the
// corrective action that repairs it. A slotting rule writes its own four small
// tables and never touches `locations` at all, so it belongs beside them rather
// than sharing a budget with the sweeps. Same reasoning CLAUDE.md gives for
// `set_code_pattern` living on mutate-warehouse.
//
// EVERY REFUSAL NAMES WHAT AN OPERATOR CAN POINT AT. Deleting a block a rule
// ranks reports the rules by name (the FK would otherwise surface as a bare
// 23503); a member outside the warehouse reports the count. `dry_run` returns
// before any write AND before the audit event, the recode_locations doctrine.

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
import { loadWarehouseSlotting } from '../_shared/slottingLoad.ts'
import { foldMatch } from '../_shared/wie/slotting.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

/** The recode_locations cap, for the same reason: one gesture on a large site
 *  can brush a lot of racking, and a payload has to have a ceiling somewhere. */
const MAX_MEMBERS = 500
/** Ranked homes. Twenty overflow blocks is already past what anyone can reason
 *  about on a floor; the limit exists so a bad client cannot post a thousand. */
const MAX_BLOCKS = 20

const memberSchema = z.object({
  location_id: z.number().int().positive(),
  unit_kind: z.enum(['bin', 'rack', 'level']),
})

// `.nullish()` everywhere a column is nullable, NEVER `.optional()`. `.optional()`
// accepts undefined and REJECTS null, the client sends `?? null` for every
// nullable column, and with `strict` off nothing surfaces the mismatch until an
// operator hits Save. This has already cost this repo a release.
const setBlockSchema = z.object({
  action: z.literal('set_block'),
  warehouse_id: z.number().int().positive(),
  id: z.number().int().positive().nullish(),
  name: z.string().min(1).max(60),
  source_kind: z.enum(['manual', 'area']).default('manual'),
  source_area_name: z.string().min(1).max(60).nullish(),
  members: z.array(memberSchema).max(MAX_MEMBERS),
  dry_run: z.boolean().optional(),
})

const setRuleSchema = z.object({
  action: z.literal('set_rule'),
  warehouse_id: z.number().int().positive(),
  id: z.number().int().positive().nullish(),
  name: z.string().min(1).max(60),
  match_product_id: z.number().int().positive().nullish(),
  match_brand: z.string().min(1).max(60).nullish(),
  match_category: z.string().min(1).max(60).nullish(),
  match_supplier_id: z.number().int().positive().nullish(),
  enforcement: z.enum(['hard', 'soft']),
  reserve_empty: z.boolean().default(false),
  is_active: z.boolean().default(true),
  /** ARRAY ORDER IS THE RANK. There is no rank field on the wire, so a reorder
   *  is a full replace and the two can never disagree. */
  block_ids: z.array(z.number().int().positive()).max(MAX_BLOCKS),
  dry_run: z.boolean().optional(),
})

const inputSchema = z.discriminatedUnion('action', [
  setBlockSchema,
  z.object({
    action: z.literal('delete_block'),
    warehouse_id: z.number().int().positive(),
    id: z.number().int().positive(),
  }),
  setRuleSchema,
  z.object({
    action: z.literal('delete_rule'),
    warehouse_id: z.number().int().positive(),
    id: z.number().int().positive(),
  }),
])

/**
 * Zod issue paths, NOT `error.flatten()`.
 *
 * flatten() collapses every nested path onto its top-level key, so a bad
 * `members[412].unit_kind` would reach the operator as the single word
 * "members" — or, worse, as a bare "Invalid request body". The path is the
 * whole diagnosis. Capped so a 500-member payload cannot return a wall of text.
 */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

/** Products this rule's conditions match. Counting, never ranking — the
 *  specificity ladder has one implementation, in _shared/wie/slotting.ts. */
async function countMatches(admin: any, input: z.infer<typeof setRuleSchema>): Promise<number> {
  let q = admin.from('products').select('id, brand, category', { count: 'exact', head: false }).eq('is_active', true)
  if (input.match_product_id != null) q = q.eq('id', input.match_product_id)
  if (input.match_supplier_id != null) {
    const { data: ps } = await admin.from('product_suppliers')
      .select('product_id').eq('supplier_id', input.match_supplier_id)
    const ids = ((ps ?? []) as any[]).map((r) => r.product_id)
    if (ids.length === 0) return 0
    q = q.in('id', ids)
  }
  const { data } = await q
  const wantBrand = foldMatch(input.match_brand ?? null)
  const wantCat = foldMatch(input.match_category ?? null)
  return ((data ?? []) as any[]).filter((p) =>
    (wantBrand === null || foldMatch(p.brand) === wantBrand)
    && (wantCat === null || foldMatch(p.category) === wantCat)).length
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`mutate-slotting-rule:${auth.userId}`, { windowMs: 60_000, max: 30 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // ── set_block ────────────────────────────────────────────────────────────
    if (input.action === 'set_block') {
      // Its own bucket: a block edit can carry 500 members, and it must not
      // spend the budget the rule edits need.
      const brl = await checkRateLimit(`mutate-slotting-rule:block:${auth.userId}`, { windowMs: 60_000, max: 10 })
      if (!brl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Too many block edits; wait a minute')

      if (input.source_kind === 'area' && !input.source_area_name) {
        throw new EdgeFunctionError('INVALID_INPUT', 'An area-sourced block must name its area')
      }

      if (input.dry_run) {
        const { data: before } = input.id
          ? await admin.from('slotting_block_members').select('location_id').eq('block_id', input.id)
          : { data: [] as any[] }
        const had = new Set(((before ?? []) as any[]).map((r) => Number(r.location_id)))
        const now = new Set(input.members.map((m) => m.location_id))
        return new Response(JSON.stringify({
          dryRun: true,
          added: [...now].filter((id) => !had.has(id)).length,
          removed: [...had].filter((id) => !now.has(id)).length,
          unchanged: [...now].filter((id) => had.has(id)).length,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: blockId, error } = await admin.rpc('wie_set_slotting_block_tx', {
        p_warehouse_id: input.warehouse_id,
        p_block_id: input.id ?? null,
        p_name: input.name,
        p_source_kind: input.source_kind,
        p_source_area_name: input.source_area_name ?? null,
        p_members: input.members,
      })
      if (error) throw new EdgeFunctionError('CONFLICT', error.message)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: input.id ? 'update' : 'create',
        resource: 'slotting_blocks', resourceId: String(blockId),
        metadata: { warehouseId: input.warehouse_id, name: input.name, members: input.members.length },
      })
      return new Response(JSON.stringify({ id: blockId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── delete_block ─────────────────────────────────────────────────────────
    if (input.action === 'delete_block') {
      // The FK is ON DELETE RESTRICT, so this WOULD refuse on its own -- as a
      // bare 23503 naming a constraint. Reporting the rules by name is the
      // difference between "you cannot" and "you cannot, because these two
      // rules send stock here". The wie_level_role_usage pattern.
      const { data: users } = await admin.from('slotting_rule_blocks')
        .select('rule_id, slotting_rules(name)').eq('block_id', input.id)
      const names = ((users ?? []) as any[]).map((r) => r.slotting_rules?.name).filter(Boolean)
      if (names.length > 0) {
        throw new EdgeFunctionError('CONFLICT',
          `This block is used by ${names.length} rule(s): ${names.join(', ')}. `
          + 'Remove it from them first.')
      }

      const { error } = await admin.from('slotting_blocks').delete()
        .eq('id', input.id).eq('warehouse_id', input.warehouse_id)
      if (error) throw new EdgeFunctionError('CONFLICT', error.message)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'slotting_blocks',
        resourceId: String(input.id), metadata: { warehouseId: input.warehouse_id },
      })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── set_rule ─────────────────────────────────────────────────────────────
    if (input.action === 'set_rule') {
      const axes = [input.match_product_id, input.match_brand, input.match_category, input.match_supplier_id]
      if (axes.every((a) => a === null || a === undefined)) {
        throw new EdgeFunctionError('INVALID_INPUT',
          'A rule needs at least one of: product, brand, category or supplier.')
      }

      const matchCount = await countMatches(admin, input)

      // A rule matching nothing is legal but almost never intended, and because
      // match_category has no FK (categories are free text since 00069) a
      // category rename silently produces exactly this. Reported, never refused
      // -- an operator may well be setting a rule up before the catalogue lands.
      const warnings: string[] = []
      if (matchCount === 0) warnings.push('This rule currently matches no products.')
      if (input.block_ids.length === 0) warnings.push('This rule has no blocks, so it will do nothing.')

      // A tie is deterministic (specificity, then id) but arbitrary, so it is
      // worth saying out loud at the moment it is created rather than leaving it
      // to be discovered when a pallet goes to the wrong aisle.
      const slotting = await loadWarehouseSlotting(admin, input.warehouse_id)
      const rival = slotting.rules.find((r) =>
        r.id !== (input.id ?? -1)
        && r.specificity === ((input.match_product_id != null ? 8 : 0)
          + (input.match_brand != null ? 4 : 0)
          + (input.match_category != null ? 2 : 0)
          + (input.match_supplier_id != null ? 1 : 0))
        && r.matchProductId === (input.match_product_id ?? null)
        && foldMatch(r.matchBrand) === foldMatch(input.match_brand ?? null)
        && foldMatch(r.matchCategory) === foldMatch(input.match_category ?? null)
        && r.matchSupplierId === (input.match_supplier_id ?? null))
      if (rival) {
        warnings.push(`"${rival.name}" matches exactly the same products at the same `
          + 'specificity; whichever was created first will win.')
      }

      if (input.dry_run) {
        return new Response(JSON.stringify({ dryRun: true, matchCount, warnings }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: ruleId, error } = await admin.rpc('wie_set_slotting_rule_tx', {
        p_warehouse_id: input.warehouse_id,
        p_rule_id: input.id ?? null,
        p_name: input.name,
        p_match_product_id: input.match_product_id ?? null,
        p_match_brand: input.match_brand ?? null,
        p_match_category: input.match_category ?? null,
        p_match_supplier_id: input.match_supplier_id ?? null,
        p_enforcement: input.enforcement,
        p_reserve_empty: input.reserve_empty,
        p_is_active: input.is_active,
        p_block_ids: input.block_ids,
      })
      if (error) throw new EdgeFunctionError('CONFLICT', error.message)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: input.id ? 'update' : 'create',
        resource: 'slotting_rules', resourceId: String(ruleId),
        metadata: {
          warehouseId: input.warehouse_id, name: input.name,
          enforcement: input.enforcement, reserveEmpty: input.reserve_empty,
          blocks: input.block_ids.length, matchCount,
        },
      })
      return new Response(JSON.stringify({ id: ruleId, matchCount, warnings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── delete_rule ──────────────────────────────────────────────────────────
    const { error: delErr } = await admin.from('slotting_rules').delete()
      .eq('id', input.id).eq('warehouse_id', input.warehouse_id)
    if (delErr) throw new EdgeFunctionError('CONFLICT', delErr.message)

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'slotting_rules',
      resourceId: String(input.id), metadata: { warehouseId: input.warehouse_id },
    })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
