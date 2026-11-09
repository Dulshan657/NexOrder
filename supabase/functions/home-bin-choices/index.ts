// home-bin-choices Edge Function
//
// Lists the bins a Manager or Admin may give a product as its home bin, for the
// Walk's "Give it a home" sheet (NX-0033). A homeless product has just been
// received and the person on the floor is deciding where it lives. Only a bin
// that putaway could actually use is offered, because since NX-0032 putaway MUST
// send the product to its home while the home has room:
//
//   not inactive, not in a hold zone, on a level that takes cartons and that the
//   product may use, on the published layout with a route from a dock, not
//   refused by a slotting rule, with room for at least one unit, in this
//   warehouse, and not already another product's home.
//
//   GET ?warehouseId=<id>&productId=<id>[&recommendationId=<id>]   Admin / Manager
//   -> { ok: true, warehouseId, productId, bins: [{ binId, binCode, binName }] }
//
// `recommendationId` is the putaway line on the stop the Manager is standing at.
// Its own promise to a bin is not counted against that bin (mig 00144): a
// homeless product's line is already assigned to the bin the planner chose, and
// a bin with room for exactly that line would otherwise read as full and never
// be offered. Any other open line to the bin still counts.
//
// `bins` is in code order and may be empty. Read-only: nothing is written, and
// nothing here sets a home. The home is set at completion, in the same
// transaction as the move (complete-putaway `make_home`), which asks the same
// question again (loadHomeChoiceRefusal) so a hand-made request cannot pick a
// bin this list would not have offered.
//
// The facts come from wie_home_bin_candidate_facts (mig 00143, 00144), judged by the
// pure _shared/wie/homeBinHealth.ts, with the slotting rules read through the
// same loader putaway uses (_shared/homeBinHealthLoad.ts).

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { assertMayActAtWarehouse } from '../_shared/receiveDestination.ts'
import { loadHomeBinChoices } from '../_shared/homeBinHealthLoad.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

/** Opened once per product on the Walk; a few a minute is plenty. */
const RATE = { windowMs: 60_000, max: 30 }

const LIST_FAILED = 'Could not list bins for a home, try again.'

const isPositiveWhole = (raw: string): boolean =>
  /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0

function parseId(req: Request, name: 'warehouseId' | 'productId'): number {
  const raw = new URL(req.url).searchParams.get(name)
  if (raw === null || !isPositiveWhole(raw)) {
    throw new EdgeFunctionError('INVALID_INPUT', `${name} must be a positive whole number`)
  }
  return Number(raw)
}

/** Optional: absent is fine, present must be a positive whole number. */
function parseRecommendationId(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get('recommendationId')
  if (raw === null) return null
  if (!isPositiveWhole(raw)) {
    throw new EdgeFunctionError('INVALID_INPUT', 'recommendationId must be a positive whole number')
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
    const warehouseId = parseId(req, 'warehouseId')
    const productId = parseId(req, 'productId')
    const recommendationId = parseRecommendationId(req)

    // Admin and Manager are not confined to a site, so this never fires today.
    // It stays so that widening ALLOWED later cannot let a Warehouse user list
    // another site's bins, the way every other putaway function is guarded.
    assertMayActAtWarehouse(
      { role: auth.role, homeWarehouseId: auth.profile.home_warehouse_id },
      warehouseId,
      'You can only list bins at your own warehouse',
    )

    const rl = await checkRateLimit(`home-bin-choices:${auth.userId}`, RATE)
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
      console.error('[home-bin-choices] warehouse read failed', whError)
      throw new EdgeFunctionError('INTERNAL', LIST_FAILED)
    }
    if (!warehouse) throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')

    // A missing product would otherwise read as "no bin can be its home".
    const { data: product, error: prodError } = await admin.from('products')
      .select('id').eq('id', productId).maybeSingle()
    if (prodError) {
      console.error('[home-bin-choices] product read failed', prodError)
      throw new EdgeFunctionError('INTERNAL', LIST_FAILED)
    }
    if (!product) throw new EdgeFunctionError('NOT_FOUND', 'Product not found')

    let bins
    try {
      bins = await loadHomeBinChoices(
        admin, warehouseId, productId, recommendationId === null ? [] : [recommendationId],
      )
    } catch (e) {
      // The detail goes to the server log; the operator gets a message they can act on.
      console.error('[home-bin-choices] load failed', e)
      throw new EdgeFunctionError('INTERNAL', LIST_FAILED)
    }

    return new Response(JSON.stringify({ ok: true, warehouseId, productId, bins }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[home-bin-choices] unexpected', e)
    return errorResponse('INTERNAL', LIST_FAILED, undefined, undefined, req)
  }
})
