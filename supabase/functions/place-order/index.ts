// place-order Edge Function
//
// Authoritative order placement. The client sends only product IDs and
// quantities; the server resolves prices, applies promotions, checks stock
// and credit, and writes the order/items/invoice. Direct INSERT on `orders`
// and `order_items` is denied to all non-service-role connections by RLS.
//
// This file is the HTTP shell: CORS, authentication, the role gate, the rate
// limit, body validation and the module gate. The placement itself — pricing,
// stock / minimum / credit rules, insert, reservation, invoice, email — is
// `_shared/placeOrderCore.ts`, which the QR approval flow also runs so a held
// order is priced and validated by exactly the same rules as a live one.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { EdgeFunctionError } from '../_shared/errors.ts'
import { requireModule } from '../_shared/modules.ts'
import { findInvalidOrderItem, type OrderLineInput } from '../_shared/orderPricing.ts'
import { placeOrderCore } from '../_shared/placeOrderCore.ts'

interface PlaceOrderRequest {
  hoReCaId: number
  items: OrderLineInput[]
  notes?: string | null
  deliveryDate?: string | null
  deliveryTimeSlot?: 'AM' | 'PM' | null
  verification?: Record<string, unknown> | null
  orderIdPrefix?: string
}

// jsonResponse / errorResponse are defined inside `serve` so they close over
// the per-request CORS headers (echo of the inbound origin if allowlisted).

async function loadProfile(userClient: SupabaseClient, userId: string) {
  const { data, error } = await userClient
    .from('profiles')
    .select('id, role, horeca_id')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('Profile not found')
  return data as { id: string; role: string; horeca_id: number | null }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  const errorResponse = (code: string, message: string, status = 400): Response =>
    jsonResponse({ error: { code, message } }, status)

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  let body: PlaceOrderRequest
  try {
    requireModule('sales_orders')
    body = await req.json()
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be JSON')
  }

  if (typeof body.hoReCaId !== 'number' || !Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse('INVALID_INPUT', 'hoReCaId (number) and items[] (non-empty) required')
  }
  const invalidItem = findInvalidOrderItem(body.items)
  if (invalidItem) return errorResponse('INVALID_ITEM', invalidItem)

  const { data: authUser } = await userClient.auth.getUser()
  if (!authUser?.user) return errorResponse('UNAUTHORIZED', 'Invalid session', 401)

  let profile: { id: string; role: string; horeca_id: number | null }
  try {
    profile = await loadProfile(userClient, authUser.user.id)
  } catch {
    return errorResponse('NO_PROFILE', 'Profile not found for user', 403)
  }

  // Authorization
  const role = profile.role
  if (role === 'Restaurant/Hotel Customer') {
    if (profile.horeca_id !== body.hoReCaId) {
      return errorResponse('FORBIDDEN', 'Customers can only order for their own HoReCa', 403)
    }
  } else if (
    role !== 'Admin' && role !== 'Manager' &&
    role !== 'Field Sales Rep' && role !== 'Office Sales Rep'
  ) {
    return errorResponse('FORBIDDEN', 'Role not permitted to place orders', 403)
  }

  // Rate limit per authenticated user. 10 orders/min is well above any
  // realistic interactive pace and tight enough to slow down a hijacked
  // session firing through a script.
  const rl = await checkRateLimit(`place-order:${profile.id}`, { windowMs: 60_000, max: 10 })
  if (!rl.ok) {
    return errorResponse('TOO_MANY_REQUESTS', 'Rate limit exceeded — too many orders in a short period', 429)
  }

  try {
    const result = await placeOrderCore(serviceClient, {
      submittedBy: profile.id,
      actorRole: profile.role,
      hoReCaId: body.hoReCaId,
      items: body.items,
      notes: body.notes,
      deliveryDate: body.deliveryDate,
      deliveryTimeSlot: body.deliveryTimeSlot,
      verification: body.verification,
    })
    return jsonResponse(result, 201)
  } catch (err) {
    // A broken business rule or a failed write arrives as an EdgeFunctionError
    // carrying the code and status place-order has always answered with.
    // Anything else is a failed read the core never handled; it propagates, as
    // it did before the extraction, to the runtime's own 500.
    if (err instanceof EdgeFunctionError) return errorResponse(err.code, err.message, err.status)
    throw err
  }
})
