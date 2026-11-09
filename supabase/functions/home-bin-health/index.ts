// home-bin-health Edge Function
//
// Lists every product home bin in a warehouse that putaway cannot actually use
// (NX-0032): inactive, in a hold zone, on a level that does not take cartons,
// off the published layout, with no route from a dock, refused by a slotting
// rule, full, in another warehouse... Since NX-0032 putaway MUST send a product
// to its home while the home has room, so a home it can never use is a trap for
// the floor. The Replenishment setup panel shows this list; the same check runs
// from `npm run check:home-bins` before a release.
//
//   GET ?warehouseId=<id>        Admin / Manager
//   -> { ok: true, warehouseId, checked, rows: [{ productId, sku, binId, binCode,
//                                                 problems: [{ code, message }] }] }
//
// `rows` holds only the homes WITH problems; `checked` counts every home looked
// at, so "no problems" can say how many it checked. Read-only: nothing is written.
//
// The facts come from wie_home_bin_facts (mig 00142), judged by the pure
// _shared/wie/homeBinHealth.ts, with the slotting rules read through the same
// loader putaway uses (_shared/homeBinHealthLoad.ts).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { loadHomeBinHealth } from '../_shared/homeBinHealthLoad.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

/** The panel loads this once per visit; a few a minute is plenty. */
const RATE = { windowMs: 60_000, max: 20 }

function parseWarehouseId(req: Request): number {
  const raw = new URL(req.url).searchParams.get('warehouseId')
  if (raw === null || !/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new EdgeFunctionError('INVALID_INPUT', 'warehouseId must be a positive whole number')
  }
  return Number(raw)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    if (req.method !== 'GET') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Use GET')
    }
    const warehouseId = parseWarehouseId(req)

    const rl = await checkRateLimit(`home-bin-health:${auth.userId}`, RATE)
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const { data: warehouse, error: whError } = await admin.from('locations')
      .select('id').eq('id', warehouseId).eq('kind', 'WAREHOUSE').maybeSingle()
    if (whError) {
      console.error('[home-bin-health] warehouse read failed', whError)
      throw new EdgeFunctionError('INTERNAL', 'Could not check home bins, try again.')
    }
    if (!warehouse) throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')

    let report
    try {
      report = await loadHomeBinHealth(admin, warehouseId)
    } catch (e) {
      // The detail goes to the server log; the operator gets a message they can act on.
      console.error('[home-bin-health] load failed', e)
      throw new EdgeFunctionError('INTERNAL', 'Could not check home bins, try again.')
    }

    return new Response(JSON.stringify({ ok: true, ...report }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[home-bin-health] unexpected', e)
    return errorResponse('INTERNAL', 'Could not check home bins, try again.', undefined, undefined, req)
  }
})
