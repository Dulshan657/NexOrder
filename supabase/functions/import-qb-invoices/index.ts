// import-qb-invoices Edge Function
//
// Admin and Manager upload a QuickBooks invoice export as text; the browser turns
// Excel into the same text. `preview` says what would happen and writes nothing.
// `commit` works it all out again from the text and acts invoice by invoice.
//
// THE DECISIONS ARE NOT MADE HERE. `_shared/qbImport/runImport.ts` holds them, with
// its database calls passed in from `_shared/qbImport/importDeps.ts`.
//
// A new order moves to `processed` with a fulfilment, as update-order-status does,
// so it appears in the Pick Queue. This function creates no invoice row, because
// QuickBooks holds the invoice, and it sends no customer email.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { buildImportDeps } from '../_shared/qbImport/importDeps.ts'
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '../_shared/qbImport/parseInvoices.ts'
import { runImport, type ImportOk, type InvoiceOutcome } from '../_shared/qbImport/runImport.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

/** JSON escapes every quote and line break, so the body can outgrow the text it holds. */
const MAX_BODY_BYTES = MAX_IMPORT_BYTES * 2 + 1024 * 1024

const TOO_LARGE = `The file is over the ${MAX_IMPORT_BYTES / (1024 * 1024)} MB limit.`

const inputSchema = z.object({
  action: z.enum(['preview', 'commit']),
  csvText: z.string().max(MAX_IMPORT_BYTES, TOO_LARGE),
  applyChanges: z.array(z.string().max(200)).max(MAX_IMPORT_ROWS).optional(),
})

async function readBody(req: Request): Promise<z.infer<typeof inputSchema>> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new EdgeFunctionError('INVALID_INPUT', TOO_LARGE)
  }
  const body = await req.json().catch(() => {
    throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
  })
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
  }
  if (new TextEncoder().encode(parsed.data.csvText).length > MAX_IMPORT_BYTES) {
    throw new EdgeFunctionError('INVALID_INPUT', TOO_LARGE)
  }
  return parsed.data
}

const numbersWith = (result: ImportOk, outcome: InvoiceOutcome): string[] =>
  (result.results ?? []).filter((entry) => entry.outcome === outcome).map((entry) => entry.invoiceNumber)

/** Counts and invoice numbers only: nothing about the customers. */
function auditSummary(result: ImportOk) {
  return {
    counts: result.resultCounts,
    invoices: {
      added: numbersWith(result, 'added'),
      updated: numbersWith(result, 'updated'),
      flagged: numbersWith(result, 'flagged'),
      finished: numbersWith(result, 'finished'),
      refused: numbersWith(result, 'refused'),
      failed: numbersWith(result, 'failed'),
    },
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('sales_orders')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // A preview and a commit per file, with room to fix a file and try again. Each
    // call can be thousands of rows, so this sits well below the routine functions.
    const rl = await checkRateLimit(`import-qb-invoices:${auth.userId}`, { windowMs: 60_000, max: 20 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`)
    }

    const { action, csvText, applyChanges } = await readBody(req)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const result = await runImport(
      { action, csvText, applyChanges, actorRole: auth.role },
      buildImportDeps(admin, auth.profile.id),
    )
    if (result.status === 'forbidden') throw new EdgeFunctionError('FORBIDDEN', result.message)

    if (action === 'commit' && result.results) {
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'qb_invoice_import',
        metadata: auditSummary(result),
      })
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (isEdgeFunctionError(err)) return err.toResponse(req)
    console.error('[import-qb-invoices] unexpected error', err)
    return errorResponse('INTERNAL', 'The import could not be completed. Try again.', undefined, undefined, req)
  }
})
