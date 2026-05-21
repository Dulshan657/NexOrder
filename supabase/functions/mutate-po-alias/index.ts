// mutate-po-alias Edge Function
//
// Create / update / delete on po_customer_aliases and po_product_aliases.
// These two tables are auto-populated by the AI extractor (aliasResolver at
// >=0.9 confidence) and by approval write-back (aliasDiff). This function
// gives admins/managers a way to fix a wrong learned alias in-app instead of
// dropping to SQL, plus a way to seed an alias manually before any PO has
// taught it.
//
// Lockdown: RLS on both tables already denies INSERT/UPDATE/DELETE to
// authenticated (no policies + no GRANT). Service role here bypasses RLS.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const sourceTypeSchema = z.enum(['sender_email', 'sender_domain', 'po_text'])

// Shared bounds — alias source values are operator-typed text; cap to keep
// payloads sane and pattern-friendly.
const sourceValueSchema = z.string().trim().min(1, 'source_value required').max(500)
const sourceCodeSchema = z.string().trim().min(1).max(120)
const sourceDescriptionSchema = z.string().trim().min(1).max(500)

const customerCreateSchema = z.object({
  resource: z.literal('customer_alias'),
  action: z.literal('create'),
  source_type: sourceTypeSchema,
  source_value: sourceValueSchema,
  horeca_id: z.number().int().positive(),
})

const customerUpdateSchema = z.object({
  resource: z.literal('customer_alias'),
  action: z.literal('update'),
  id: z.string().uuid(),
  source_type: sourceTypeSchema.optional(),
  source_value: sourceValueSchema.optional(),
  horeca_id: z.number().int().positive().optional(),
})

const customerDeleteSchema = z.object({
  resource: z.literal('customer_alias'),
  action: z.literal('delete'),
  id: z.string().uuid(),
})

const productCreateSchema = z
  .object({
    resource: z.literal('product_alias'),
    action: z.literal('create'),
    horeca_id: z.number().int().positive(),
    source_code: sourceCodeSchema.nullable().optional(),
    source_description: sourceDescriptionSchema.nullable().optional(),
    product_id: z.number().int().positive(),
    default_pack_size: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (v) =>
      (v.source_code != null && v.source_code !== '') ||
      (v.source_description != null && v.source_description !== ''),
    {
      message: 'At least one of source_code or source_description is required',
      path: ['source_code'],
    },
  )

const productUpdateSchema = z.object({
  resource: z.literal('product_alias'),
  action: z.literal('update'),
  id: z.string().uuid(),
  horeca_id: z.number().int().positive().optional(),
  source_code: sourceCodeSchema.nullable().optional(),
  source_description: sourceDescriptionSchema.nullable().optional(),
  product_id: z.number().int().positive().optional(),
  default_pack_size: z.number().int().positive().nullable().optional(),
})

const productDeleteSchema = z.object({
  resource: z.literal('product_alias'),
  action: z.literal('delete'),
  id: z.string().uuid(),
})

const inputSchema = z.union([
  customerCreateSchema,
  customerUpdateSchema,
  customerDeleteSchema,
  productCreateSchema,
  productUpdateSchema,
  productDeleteSchema,
])

type Input = z.infer<typeof inputSchema>

interface CustomerAliasRow {
  id: string
  source_type: 'sender_email' | 'sender_domain' | 'po_text'
  source_value: string
  horeca_id: number
  confidence_at_creation: number | null
  created_by: string | null
  created_at: string
  pending_po_id: string | null
}

interface ProductAliasRow {
  id: string
  horeca_id: number
  source_code: string | null
  source_description: string | null
  product_id: number
  default_pack_size: number | null
  confidence_at_creation: number | null
  created_by: string | null
  created_at: string
  pending_po_id: string | null
}

function tableFor(resource: 'customer_alias' | 'product_alias'): string {
  return resource === 'customer_alias' ? 'po_customer_aliases' : 'po_product_aliases'
}

function auditResourceFor(resource: 'customer_alias' | 'product_alias'): string {
  return resource === 'customer_alias' ? 'po_customer_alias' : 'po_product_alias'
}

function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === '23505'
}

async function loadCustomerAlias(
  admin: SupabaseClient,
  id: string,
): Promise<CustomerAliasRow | null> {
  const { data, error } = await admin
    .from('po_customer_aliases')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)
  return (data as CustomerAliasRow) ?? null
}

async function loadProductAlias(
  admin: SupabaseClient,
  id: string,
): Promise<ProductAliasRow | null> {
  const { data, error } = await admin
    .from('po_product_aliases')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)
  return (data as ProductAliasRow) ?? null
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`mutate-po-alias:${auth.userId}`, {
      windowMs: 60_000,
      max: 60,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError(
        'INVALID_INPUT',
        'Invalid request body',
        parsed.error.flatten(),
      )
    }
    const input: Input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // -----------------------------------------------------------------------
    // CUSTOMER alias
    // -----------------------------------------------------------------------
    if (input.resource === 'customer_alias') {
      if (input.action === 'create') {
        const insertPayload = {
          source_type: input.source_type,
          source_value: input.source_value,
          horeca_id: input.horeca_id,
          created_by: auth.userId,
          pending_po_id: null,
        }

        const { data: inserted, error } = await admin
          .from('po_customer_aliases')
          .insert(insertPayload as any)
          .select()
          .single()

        if (error) {
          if (isUniqueViolation(error)) {
            throw new EdgeFunctionError(
              'CONFLICT',
              `An alias already exists for ${input.source_type} "${input.source_value}"`,
              { field: 'source_value' },
            )
          }
          throw new EdgeFunctionError('INTERNAL', error.message)
        }

        await logAuditEvent(admin, {
          actorId: auth.userId,
          actorRole: auth.role,
          action: 'create',
          resource: auditResourceFor('customer_alias'),
          resourceId: String((inserted as CustomerAliasRow).id),
          after: inserted as Record<string, unknown>,
        })

        return new Response(JSON.stringify({ ok: true, alias: inserted, created: true }), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (input.action === 'update') {
        const existing = await loadCustomerAlias(admin, input.id)
        if (!existing) {
          throw new EdgeFunctionError(
            'NOT_FOUND',
            `Customer alias ${input.id} not found`,
          )
        }

        const updatePayload: Partial<CustomerAliasRow> = {}
        if (input.source_type !== undefined) updatePayload.source_type = input.source_type
        if (input.source_value !== undefined) updatePayload.source_value = input.source_value
        if (input.horeca_id !== undefined) updatePayload.horeca_id = input.horeca_id

        if (Object.keys(updatePayload).length === 0) {
          throw new EdgeFunctionError(
            'INVALID_INPUT',
            'At least one field (source_type, source_value, horeca_id) must be supplied',
          )
        }

        const { data: updated, error } = await admin
          .from('po_customer_aliases')
          .update(updatePayload as any)
          .eq('id', input.id)
          .select()
          .single()

        if (error) {
          if (isUniqueViolation(error)) {
            throw new EdgeFunctionError(
              'CONFLICT',
              'Another alias already uses that source_type / source_value',
              { field: 'source_value' },
            )
          }
          throw new EdgeFunctionError('INTERNAL', error.message)
        }

        await logAuditEvent(admin, {
          actorId: auth.userId,
          actorRole: auth.role,
          action: 'update',
          resource: auditResourceFor('customer_alias'),
          resourceId: input.id,
          before: existing as unknown as Record<string, unknown>,
          after: updated as Record<string, unknown>,
        })

        return new Response(JSON.stringify({ ok: true, alias: updated }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // delete
      const existing = await loadCustomerAlias(admin, input.id)
      if (!existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Customer alias ${input.id} not found`)
      }

      const { error: deleteErr } = await admin
        .from('po_customer_aliases')
        .delete()
        .eq('id', input.id)
      if (deleteErr) throw new EdgeFunctionError('INTERNAL', deleteErr.message)

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: auditResourceFor('customer_alias'),
        resourceId: input.id,
        before: existing as unknown as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, deletedId: input.id }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // -----------------------------------------------------------------------
    // PRODUCT alias
    // -----------------------------------------------------------------------
    if (input.action === 'create') {
      const insertPayload = {
        horeca_id: input.horeca_id,
        source_code: input.source_code ?? null,
        source_description: input.source_description ?? null,
        product_id: input.product_id,
        default_pack_size: input.default_pack_size ?? null,
        created_by: auth.userId,
        pending_po_id: null,
      }

      const { data: inserted, error } = await admin
        .from('po_product_aliases')
        .insert(insertPayload as any)
        .select()
        .single()

      if (error) {
        if (isUniqueViolation(error)) {
          throw new EdgeFunctionError(
            'CONFLICT',
            'An alias already exists for this customer + code/description',
            { field: 'source_code' },
          )
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: auditResourceFor('product_alias'),
        resourceId: String((inserted as ProductAliasRow).id),
        after: inserted as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, alias: inserted, created: true }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'update') {
      const existing = await loadProductAlias(admin, input.id)
      if (!existing) {
        throw new EdgeFunctionError('NOT_FOUND', `Product alias ${input.id} not found`)
      }

      const updatePayload: Partial<ProductAliasRow> = {}
      if (input.horeca_id !== undefined) updatePayload.horeca_id = input.horeca_id
      if (input.source_code !== undefined) updatePayload.source_code = input.source_code
      if (input.source_description !== undefined) {
        updatePayload.source_description = input.source_description
      }
      if (input.product_id !== undefined) updatePayload.product_id = input.product_id
      if (input.default_pack_size !== undefined) {
        updatePayload.default_pack_size = input.default_pack_size
      }

      if (Object.keys(updatePayload).length === 0) {
        throw new EdgeFunctionError('INVALID_INPUT', 'At least one field must be supplied')
      }

      // Enforce the CHECK at the app layer too — gives a friendlier error than
      // a raw postgres constraint violation.
      const finalSourceCode =
        updatePayload.source_code !== undefined ? updatePayload.source_code : existing.source_code
      const finalSourceDescription =
        updatePayload.source_description !== undefined
          ? updatePayload.source_description
          : existing.source_description
      if (finalSourceCode == null && finalSourceDescription == null) {
        throw new EdgeFunctionError(
          'INVALID_INPUT',
          'At least one of source_code or source_description must remain set',
        )
      }

      const { data: updated, error } = await admin
        .from('po_product_aliases')
        .update(updatePayload as any)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        if (isUniqueViolation(error)) {
          throw new EdgeFunctionError(
            'CONFLICT',
            'Another alias already uses that code/description for this customer',
            { field: 'source_code' },
          )
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: auditResourceFor('product_alias'),
        resourceId: input.id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, alias: updated }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // delete (product)
    const existing = await loadProductAlias(admin, input.id)
    if (!existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Product alias ${input.id} not found`)
    }

    const { error: deleteErr } = await admin
      .from('po_product_aliases')
      .delete()
      .eq('id', input.id)
    if (deleteErr) throw new EdgeFunctionError('INTERNAL', deleteErr.message)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      resource: auditResourceFor('product_alias'),
      resourceId: input.id,
      before: existing as unknown as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ ok: true, deletedId: input.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse(
      'INTERNAL',
      e instanceof Error ? e.message : 'Unknown error',
      undefined,
      undefined,
      req,
    )
  }
})
