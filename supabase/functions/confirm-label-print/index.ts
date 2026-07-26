// confirm-label-print Edge Function
//
// Records that the stickers from one print job are physically on the floor, by
// setting locations.label_printed for every code on that job's sheets (mig
// 00084).
//
// Why this is a separate step from generating the PDF:
//
//   handling_units flips label_printed the moment its sheet renders, and that is
//   right for a plate — the sticker goes on at the same desk, in the same
//   minute. A rack label does not work that way. The PDF is generated at a
//   computer; the stickers go up later, on a ladder, often by someone else, and
//   sometimes not at all because the printer jammed or the tab got closed. If
//   generating flipped the flag, those locations would drop out of the backlog
//   having never been labelled — and a backlog you cannot trust is worse than no
//   backlog, because it stops anyone from looking.
//
// So the operator confirms, once, per job. Idempotent: confirming twice is a
// no-op, which matters because the obvious operator response to any uncertainty
// is to click it again.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Warehouse']

const inputSchema = z.object({
  jobId: z.string().uuid(),
  /** Undo — hand back to the backlog when a job was confirmed by mistake. */
  undo: z.boolean().default(false),
})

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const rl = await checkRateLimit(`confirm-label-print:${auth.userId}`, {
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
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid confirm request', parsed.error.flatten())
    }
    const { jobId, undo } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const { data: sheets, error: sheetsError } = await admin
      .from('label_print_log')
      .select('id, codes, label_kind, layout_id')
      .eq('job_id', jobId)
    if (sheetsError) throw new EdgeFunctionError('INTERNAL', sheetsError.message)
    if (!sheets || sheets.length === 0) {
      throw new EdgeFunctionError('NOT_FOUND', 'No printed sheets found for that job')
    }

    // Only location sheets carry a flag to set — a job could in principle mix
    // kinds, and handling units already flipped theirs at generation time.
    const codes = Array.from(
      new Set(
        (sheets as any[])
          .filter((s) => s.label_kind === 'location')
          .flatMap((s) => (s.codes ?? []) as string[]),
      ),
    )

    let updated = 0
    if (codes.length > 0) {
      // Matching on code, not id: label_print_log stores the codes exactly as
      // they were printed, and locations.code is globally unique. A location
      // renamed or retired since the sheet was generated simply matches nothing,
      // which is the correct outcome — that sticker names something that no
      // longer exists.
      const { data: touched, error: updateError } = await admin
        .from('locations')
        .update(
          undo
            ? { label_printed: false, label_printed_at: null, label_printed_by: null }
            : {
                label_printed: true,
                label_printed_at: new Date().toISOString(),
                label_printed_by: auth.userId,
              },
        )
        .in('code', codes)
        .select('id')
      if (updateError) throw new EdgeFunctionError('INTERNAL', updateError.message)
      updated = (touched ?? []).length
    }

    const { error: stampError } = await admin
      .from('label_print_log')
      .update(
        undo
          ? { confirmed_at: null, confirmed_by: null }
          : { confirmed_at: new Date().toISOString(), confirmed_by: auth.userId },
      )
      .eq('job_id', jobId)
    if (stampError) throw new EdgeFunctionError('INTERNAL', stampError.message)

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'update',
      resource: 'label_print_job',
      resourceId: jobId,
      after: {
        confirmed: !undo,
        sheets: sheets.length,
        locations_updated: updated,
        layout_id: (sheets as any[])[0]?.layout_id ?? null,
      },
    })

    return new Response(
      JSON.stringify({ ok: true, jobId, sheets: sheets.length, locationsUpdated: updated }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
