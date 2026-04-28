// invite-user Edge Function
//
// Admin-only. Sends an invitation email via supabase.auth.admin.inviteUserByEmail
// and finalises the corresponding profile row (the on_auth_user_created
// trigger creates the basic profile from user_metadata; this function then
// fills in horeca_id and avatar_url which the trigger doesn't know about).
//
// Direct INSERT on profiles is denied to all clients; this function
// (running as the service role) is the only way to provision a user.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeaders } from '../_shared/cors.ts'

type Role =
  | 'Admin'
  | 'Manager'
  | 'Field Sales Rep'
  | 'Office Sales Rep'
  | 'Restaurant/Hotel Customer'

const VALID_ROLES: Role[] = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Restaurant/Hotel Customer',
]

interface InviteUserRequest {
  email: string
  name: string
  role: Role
  hoReCaId?: number | null
  avatarUrl?: string | null
}

interface InviteUserResponse {
  userId: string
  email: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(code: string, message: string, status = 400): Response {
  return jsonResponse({ error: { code, message } }, status)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function loadCallerProfile(userClient: SupabaseClient, userId: string) {
  const { data, error } = await userClient
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('Profile not found')
  return data as { id: string; role: string }
}

serve(async (req: Request) => {
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

  let body: InviteUserRequest
  try {
    body = await req.json()
  } catch {
    return errorResponse('INVALID_JSON', 'Body must be JSON')
  }

  // Validate input
  const email = String(body.email ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim()
  const role = body.role
  const hoReCaId = body.hoReCaId ?? null

  if (!isValidEmail(email)) return errorResponse('INVALID_EMAIL', 'Email is not valid')
  if (!name) return errorResponse('INVALID_NAME', 'Name is required')
  if (!VALID_ROLES.includes(role)) {
    return errorResponse('INVALID_ROLE', `role must be one of: ${VALID_ROLES.join(', ')}`)
  }
  if (role === 'Restaurant/Hotel Customer' && (typeof hoReCaId !== 'number' || hoReCaId <= 0)) {
    return errorResponse('HORECA_REQUIRED', 'Customer role requires hoReCaId')
  }
  if (role !== 'Restaurant/Hotel Customer' && hoReCaId != null) {
    return errorResponse('HORECA_NOT_ALLOWED', 'Only customer role may set hoReCaId')
  }

  // Caller authorisation
  const { data: authUser } = await userClient.auth.getUser()
  if (!authUser?.user) return errorResponse('UNAUTHORIZED', 'Invalid session', 401)

  let caller: { id: string; role: string }
  try {
    caller = await loadCallerProfile(userClient, authUser.user.id)
  } catch {
    return errorResponse('NO_PROFILE', 'Caller profile not found', 403)
  }

  if (caller.role !== 'Admin') {
    return errorResponse('FORBIDDEN', 'Only Admin can invite users', 403)
  }

  // If the customer's HoReCa is named, verify it exists
  if (hoReCaId != null) {
    const { data: horeca, error: horecaError } = await serviceClient
      .from('horecas')
      .select('id')
      .eq('id', hoReCaId)
      .single()
    if (horecaError || !horeca) {
      return errorResponse('HORECA_NOT_FOUND', `HoReCa ${hoReCaId} not found`, 404)
    }
  }

  // Send invite. Supabase creates the auth.users row immediately and the
  // on_auth_user_created trigger inserts a profile from raw_user_meta_data.
  const { data: invite, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { name, role },
  })
  if (inviteError) {
    if (inviteError.message?.toLowerCase().includes('already')) {
      return errorResponse('ALREADY_REGISTERED', 'A user with this email already exists', 409)
    }
    return errorResponse('INVITE_FAILED', inviteError.message, 500)
  }
  if (!invite.user) {
    return errorResponse('INVITE_FAILED', 'Invite did not return a user', 500)
  }

  // Trigger has created a basic profile. Fill in the columns the trigger
  // doesn't set (horeca_id, avatar_url). Use UPDATE rather than UPSERT so we
  // never accidentally overwrite an admin's role with stale metadata.
  const profileUpdate: Record<string, unknown> = {}
  if (hoReCaId != null) profileUpdate.horeca_id = hoReCaId
  if (body.avatarUrl) profileUpdate.avatar_url = body.avatarUrl

  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await serviceClient
      .from('profiles')
      .update(profileUpdate)
      .eq('id', invite.user.id)
    if (profileError) {
      console.warn('Profile finalisation failed; auth user created without horeca_id/avatar:', profileError.message)
    }
  }

  const response: InviteUserResponse = {
    userId: invite.user.id,
    email,
  }
  return jsonResponse(response, 201)
})
