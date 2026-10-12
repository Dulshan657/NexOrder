// qr-unlock Edge Function
//
// The PUBLIC door of the HoReCa QR reorder flow. A venue's sticker carries an
// opaque token; this function turns "token + a staff member's PIN" into a real
// Supabase session for that staff member's hidden login, good for 2 hours.
//
//   resolve  { token }       -> { horecaId, horecaName, logoUrl, companyName, phone }
//   unlock   { token, pin }  -> { tokenHash, expiresAt, staffName, horecaId }
//
// `verify_jwt = false` (supabase/config.toml): the caller has no session yet,
// that is the whole point. So this function gates ITSELF, in four layers:
//
//   1. the module gate (`shop`) -- a commercial control, not a security one;
//   2. a per-IP rate limit on each action (cross-isolate, Postgres-backed);
//   3. the per-CODE backoff inside `qr_verify_pin()` (mig 00129): 5 wrong PINs
//      -> 1 min, 10 -> 15 min, 15 -> 1 h, 20 -> locked until a human resets it.
//      This one holds against an attacker rotating IPs, which the first cannot;
//   4. the PIN itself, compared only as HMAC-SHA256(QR_PIN_PEPPER, venue:pin).
//
// The client turns `tokenHash` into a session with
// `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` -- the same
// mechanism ResetPasswordView uses for recovery links. No email is sent.
//
// ── WHAT A STRANGER MAY LEARN ───────────────────────────────────────────────
//
// Everything here is reachable by anyone holding a photograph of the sticker.
// `qrUnlockPolicy.ts` decides what the wire says: one fixed "Incorrect PIN",
// never an attempt count, and an unknown token indistinguishable from a
// regenerated one. `resolve` returns the venue's name and the operator's public
// identity (logo, company, phone) -- what is printed on the poster anyway.
//
// ── KNOWN TRADE-OFF ─────────────────────────────────────────────────────────
//
// The lock is per CODE, not per person, because the sticker is public and the
// attacker is anonymous. That means anyone with the sticker can lock a venue
// out by guessing wrongly 20 times. The cost of the alternative -- a lock that
// a guesser cannot trigger -- is a lock that does not stop a guesser. The
// approvers are told the moment it happens, and `mutate-qr-access`
// `unlock_code` clears it.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit, clientIp } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { loadCompanyIdentity } from '../_shared/companyIdentity.ts'
import { hmacPin, isQrToken } from '../_shared/qrPin.ts'
import { interpretVerifyResult } from '../_shared/qrUnlockPolicy.ts'
import { notifyHorecaApprovers } from '../_shared/qrNotify.ts'

// Per IP. `resolve` runs every time a sticker is scanned, `unlock` only when a
// PIN is typed; 30 PIN attempts per 10 minutes is far above a fumbling cook and
// far below a guessing script. The per-code backoff is the real brake.
const RESOLVE_LIMIT = { windowMs: 60_000, max: 60 }
const UNLOCK_LIMIT = { windowMs: 10 * 60_000, max: 30 }

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('resolve'),
    token: z.string().min(1).max(256),
  }),
  z.object({
    action: z.literal('unlock'),
    token: z.string().min(1).max(256),
    // Length-capped, not format-checked here: a malformed PIN is answered
    // below without touching the database or the attempt counter.
    pin: z.string().max(32),
  }),
])
type Input = z.infer<typeof inputSchema>

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  })
}

async function findVenueByToken(
  service: SupabaseClient,
  token: string,
): Promise<{ horecaId: number } | null> {
  const { data, error } = await service
    .from('qr_codes')
    .select('horeca_id')
    .eq('token', token)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not look up the code')
  return data ? { horecaId: (data as { horeca_id: number }).horeca_id } : null
}

async function handleResolve(
  req: Request,
  service: SupabaseClient,
  input: Extract<Input, { action: 'resolve' }>,
): Promise<Response> {
  const venue = isQrToken(input.token) ? await findVenueByToken(service, input.token) : null
  if (!venue) throw new EdgeFunctionError('QR_UNKNOWN_CODE', 'This QR code is not valid.')

  const [{ data: horeca, error }, company] = await Promise.all([
    service.from('horecas').select('name').eq('id', venue.horecaId).maybeSingle(),
    loadCompanyIdentity(service),
  ])
  if (error || !horeca) throw new EdgeFunctionError('QR_UNKNOWN_CODE', 'This QR code is not valid.')

  return json(req, {
    // The id lets the entry screen tell "this venue" from another one when a
    // session already exists on the phone (lib/qr/qrEntryDecision.ts). It is a
    // plain row id, and the caller already holds the token that names it.
    horecaId: venue.horecaId,
    horecaName: (horeca as { name: string }).name,
    logoUrl: company.logoUrl,
    companyName: company.name,
    phone: company.phone,
  })
}

async function handleUnlock(
  req: Request,
  service: SupabaseClient,
  input: Extract<Input, { action: 'unlock' }>,
): Promise<Response> {
  // Misconfiguration first, before any attempt could be counted against it.
  const pepper = Deno.env.get('QR_PIN_PEPPER')
  if (!pepper) {
    console.error('[qr-unlock] QR_PIN_PEPPER is not set on this project')
    throw new EdgeFunctionError('INTERNAL', 'Kitchen access is not configured.')
  }

  if (!/^[0-9]{4,6}$/.test(input.pin)) {
    // Not a wrong PIN, just not a PIN: nothing to count.
    throw new EdgeFunctionError('INVALID_INPUT', 'Enter your 4 to 6 digit PIN.')
  }

  const venue = isQrToken(input.token) ? await findVenueByToken(service, input.token) : null
  if (!venue) throw new EdgeFunctionError('QR_UNKNOWN_CODE', 'This QR code is not valid.')

  const pinHmac = await hmacPin(pepper, venue.horecaId, input.pin)
  const { data, error } = await service.rpc('qr_verify_pin', {
    p_token: input.token,
    p_pin_hmac: pinHmac,
  })
  if (error) {
    console.error('[qr-unlock] qr_verify_pin failed:', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not check the PIN. Try again.')
  }

  const outcome = interpretVerifyResult(data)

  if (outcome.kind === 'malformed') {
    console.error('[qr-unlock] qr_verify_pin returned an unreadable result')
    throw new EdgeFunctionError('INTERNAL', 'Could not check the PIN. Try again.')
  }

  if (outcome.kind === 'refused') {
    if (outcome.permanentLockReached) {
      await announcePermanentLock(service, venue.horecaId, req)
    }
    throw new EdgeFunctionError(outcome.code, outcome.message, outcome.details)
  }

  // ── Correct PIN ──────────────────────────────────────────────────────────
  // Mint the link BEFORE ending the old sessions: generateLink is the step that
  // can fail on a transient fault, and ending sessions first would then leave a
  // phone signed out with nothing to replace it.
  const { data: userRes, error: userErr } = await service.auth.admin.getUserById(outcome.authUserId)
  const email = userRes?.user?.email
  if (userErr || !email) {
    console.error('[qr-unlock] staff auth user unreadable:', userErr?.message ?? 'no email')
    throw new EdgeFunctionError('INTERNAL', 'Could not start your session. Try again.')
  }

  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    console.error('[qr-unlock] generateLink failed:', linkErr?.message ?? 'no hashed_token')
    throw new EdgeFunctionError('INTERNAL', 'Could not start your session. Try again.')
  }

  // One live session per staff member: unlocking on a second phone ends the
  // first. A PIN is a person, and a person is in one place.
  const { error: endErr } = await service.rpc('qr_end_sessions', { p_user: outcome.authUserId })
  if (endErr) {
    console.error('[qr-unlock] qr_end_sessions failed:', endErr.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not start your session. Try again.')
  }

  await logAuditEvent(service, {
    actorId: outcome.authUserId,
    actorRole: 'QR Staff',
    action: 'update',
    resource: 'qr_unlock',
    resourceId: outcome.staffId,
    metadata: { horecaId: outcome.horecaId, unlockedUntil: outcome.unlockedUntil },
  })

  return json(req, {
    ok: true,
    tokenHash,
    expiresAt: outcome.unlockedUntil,
    staffName: outcome.name,
    horecaId: outcome.horecaId,
  })
}

/**
 * The 20th wrong PIN locks the code until a human resets it. Tell the people
 * who can do that.
 *
 * There is no audit_events row for this, and that is a limit rather than an
 * oversight: `audit_events.actor_id` is NOT NULL and references auth.users, and
 * an anonymous guesser is nobody. Attributing it to some staff member or to an
 * approver would put a false name in the log. The notification rows are the
 * durable record, and the structured warning below carries the venue.
 */
async function announcePermanentLock(
  service: SupabaseClient,
  horecaId: number,
  req: Request,
): Promise<void> {
  console.warn(`[qr-unlock] venue ${horecaId} QR code locked after repeated wrong PINs`, {
    ip: clientIp(req),
  })
  const venue = await service.from('horecas').select('name').eq('id', horecaId).maybeSingle()
  const name = (venue.data as { name?: string } | null)?.name ?? `venue ${horecaId}`
  await notifyHorecaApprovers(service, horecaId, {
    type: 'qr_code_locked',
    message:
      `The kitchen QR code for ${name} has been locked after too many incorrect PINs. ` +
      `Check nobody is guessing, then unlock it from QR & PINs.`,
  })
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'Method not allowed', undefined, 405, req)
  }

  try {
    requireModule('shop')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request', parsed.error.flatten())
    }
    const input = parsed.data

    const ip = clientIp(req)
    const limit = input.action === 'resolve' ? RESOLVE_LIMIT : UNLOCK_LIMIT
    const rl = await checkRateLimit(`qr-${input.action}:ip:${ip}`, limit)
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Too many attempts. Try again in ${Math.max(1, Math.ceil(rl.resetMs / 1000))}s.`,
      )
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    return input.action === 'resolve'
      ? await handleResolve(req, service, input)
      : await handleUnlock(req, service, input)
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[qr-unlock] unexpected error:', e)
    // Never echo internals to an anonymous caller.
    return errorResponse('INTERNAL', 'Unexpected error', undefined, 500, req)
  }
})
