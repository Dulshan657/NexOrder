// mutate-app-settings Edge Function
//
// Allows Admin-only UPDATE of the singleton app_settings row (id = 1).
// Validates numeric ranges before writing; logs an audit event after.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { buildSettingsDataSchema } from '../_shared/appSettingsBody.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']

const settingsDataSchema = buildSettingsDataSchema(z)

const inputSchema = z.object({
  action: z.literal('update'),
  data: settingsDataSchema.refine(
    (d) => Object.keys(d).length > 0,
    { message: 'At least one field must be provided for update' },
  ),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-app-settings:${auth.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

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

    // Read existing singleton row for before_data and to confirm it exists
    const { data: existingRow, error: fetchError } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single()

    if (fetchError || !existingRow) {
      throw new EdgeFunctionError('NOT_FOUND', 'app_settings row not found')
    }

    const beforeData = existingRow as Record<string, unknown>

    // Write the update
    const { data: updatedRow, error: updateError } = await admin
      .from('app_settings')
      .update(input.data as any)
      .eq('id', 1)
      .select()
      .single()

    if (updateError || !updatedRow) {
      throw new EdgeFunctionError(
        'INTERNAL',
        updateError?.message ?? 'Failed to update app_settings',
      )
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'app_settings',
      resourceId: '1',
      before: beforeData,
      after: updatedRow as Record<string, unknown>,
    })

    return new Response(
      JSON.stringify({ ok: true, settings: updatedRow }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
