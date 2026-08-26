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
import { requireModule } from '../_shared/modules.ts'

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
    requireModule('inventory_dispatch')
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
      .select('id, codes, location_ids, label_kind, layout_id')
      .eq('job_id', jobId)
    if (sheetsError) throw new EdgeFunctionError('INTERNAL', sheetsError.message)
    if (!sheets || sheets.length === 0) {
      throw new EdgeFunctionError('NOT_FOUND', 'No printed sheets found for that job')
    }

    // Only location sheets carry a flag to set — a job could in principle mix
    // kinds, and handling units already flipped theirs at generation time.
    const locationSheets = (sheets as any[]).filter((s) => s.label_kind === 'location')

    // Resolve by ROW where the job recorded ids (mig 00124), by code only for
    // jobs printed before that column existed.
    //
    // The code match was justified as "a location renamed or retired since the
    // sheet was generated simply matches nothing, which is the correct outcome".
    // That holds for a rename. It does NOT hold for a code SWEEP:
    // wie_recode_locations_tx (00107) is a two-phase A→B/B→A write specifically
    // so codes can be SWAPPED between rows, and after a swap the string still
    // matches — a different row. Confirming a pre-sweep job then stamped
    // `label_printed` onto racking nobody had printed a sticker for, while the
    // rows that WERE printed stayed in the backlog. The sweep resets
    // `label_printed` on exactly those rows, so this is the moment a wrong
    // answer costs most.
    const ids = Array.from(
      new Set(
        locationSheets
          .filter((s) => Array.isArray(s.location_ids) && s.location_ids.length > 0)
          .flatMap((s) => s.location_ids as number[]),
      ),
    )
    const codes = Array.from(
      new Set(
        locationSheets
          .filter((s) => !Array.isArray(s.location_ids) || s.location_ids.length === 0)
          .flatMap((s) => (s.codes ?? []) as string[]),
      ),
    )

    const stampFields = undo
      ? { label_printed: false, label_printed_at: null, label_printed_by: null }
      : {
          label_printed: true,
          label_printed_at: new Date().toISOString(),
          label_printed_by: auth.userId,
        }

    let updated = 0
    if (ids.length > 0) {
      const { data: touched, error: updateError } = await admin
        .from('locations')
        .update(stampFields)
        .in('id', ids)
        .select('id')
      if (updateError) throw new EdgeFunctionError('INTERNAL', updateError.message)
      updated += (touched ?? []).length
    }
    if (codes.length > 0) {
      const { data: touched, error: updateError } = await admin
        .from('locations')
        .update(stampFields)
        .in('code', codes)
        .select('id')
      if (updateError) throw new EdgeFunctionError('INTERNAL', updateError.message)
      updated += (touched ?? []).length
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
