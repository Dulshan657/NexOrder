// mutate-qr-access Edge Function
//
// Everything a venue's managers do to its kitchen QR: see the code, print it,
// regenerate it, and add / rename / reset / revoke the staff PINs behind it.
//
//   get             { horecaId? }                -> code, url, staff, lock state
//   regenerate_code { horecaId? }                -> a new token; every unlock ends
//   create_staff    { horecaId?, name, pin }     -> a hidden login + a PIN
//   rename_staff    { staffId, name }
//   reset_pin       { staffId, pin }             -> ends that person's unlock
//   revoke_staff    { staffId }                  -> never a hard delete
//   unlock_code     { horecaId? }                -> clear a wrong-PIN lock-out
//
// WHO: Admin, Manager, the reps ASSIGNED to the venue (`horeca_reps`), and the
// venue's own Customer logins (`canManageHoreca`, `_shared/qrAccess.ts`). A QR
// Staff login is deliberately not on the list: a kitchen phone must never be
// able to manage the PINs that let it in. A Customer may omit `horecaId`.
//
// ── A PIN IS A PERSON'S LOGIN ───────────────────────────────────────────────
//
// Each staff member is a real Supabase auth user (`qr-<uuid>@qr.nexorder.invalid`,
// role 'QR Staff', a random password nobody is ever told) so that RLS, realtime
// and every audit row can name them. `qr-unlock` mints their session from the
// PIN; this function is the only thing that creates, renames or retires one.
//
// Revoking is a soft delete on purpose: orders a revoked person submitted keep
// a resolvable name. It sets `revoked_at`, clears the unlock, bans the auth user
// (no refresh, no new link) and deletes their sessions. The database half is the
// control -- `user_horeca_id()` and `requireAuth` both read `qr_staff` -- and the
// ban and session delete are belt and braces on a phone already mid-session.
//
// PINs and their HMACs are never logged, audited, or returned. The audit rows
// say WHO changed WHOSE access, not what the secret was.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type AuthContext, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { requireAppUrl } from '../_shared/appUrl.ts'
import { canManageHoreca, requireManageHoreca } from '../_shared/qrAccess.ts'
import { describePinProblem, generateQrToken, hmacPin, validatePin } from '../_shared/qrPin.ts'
import { lockInfo } from '../_shared/qrUnlockPolicy.ts'

const ALLOWED: ReadonlyArray<UserRole> = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Restaurant/Hotel Customer',
]

// A century. GoTrue has no "ban forever"; this is how Phase A probed it.
const BAN_FOREVER = '876000h'
const QR_EMAIL_DOMAIN = 'qr.nexorder.invalid'

const horecaIdField = z.number().int().positive()
const staffIdField = z.string().uuid()
// Trim first so "  " is empty. The database CHECKs 1..80 on the trimmed value.
const nameField = z.string().trim().min(1).max(80)
// Length guard only; `validatePin` (the shared module the form also uses) judges it.
const pinField = z.string().max(32)

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'), horecaId: horecaIdField.optional() }),
  z.object({ action: z.literal('regenerate_code'), horecaId: horecaIdField.optional() }),
  z.object({
    action: z.literal('create_staff'),
    horecaId: horecaIdField.optional(),
    name: nameField,
    pin: pinField,
  }),
  z.object({ action: z.literal('rename_staff'), staffId: staffIdField, name: nameField }),
  z.object({ action: z.literal('reset_pin'), staffId: staffIdField, pin: pinField }),
  z.object({ action: z.literal('revoke_staff'), staffId: staffIdField }),
  z.object({ action: z.literal('unlock_code'), horecaId: horecaIdField.optional() }),
])
type Input = z.infer<typeof inputSchema>

interface Ctx {
  req: Request
  service: SupabaseClient
  auth: AuthContext
}

interface StaffRow {
  id: string
  horeca_id: number
  auth_user_id: string
  name: string
  revoked_at: string | null
}

interface CodeRow {
  token: string
  failed_attempts: number
  locked_until: string | null
}

// ── small helpers ───────────────────────────────────────────────────────────

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  })
}

async function limit(key: string, max: number, what: string): Promise<void> {
  const rl = await checkRateLimit(key, { windowMs: 60_000, max })
  if (!rl.ok) {
    throw new EdgeFunctionError(
      'TOO_MANY_REQUESTS',
      `Too many ${what}; try again in ${Math.max(1, Math.ceil(rl.resetMs / 1000))}s`,
    )
  }
}

function appOrigin(): string {
  try {
    return requireAppUrl()
  } catch {
    // The message names the secret; the caller is staff, and an unset APP_URL
    // is a deployment fault they need to be able to report precisely.
    throw new EdgeFunctionError('INTERNAL', 'APP_URL is not configured on this project')
  }
}

function requirePepper(): string {
  const pepper = Deno.env.get('QR_PIN_PEPPER')
  if (!pepper) {
    console.error('[mutate-qr-access] QR_PIN_PEPPER is not set on this project')
    throw new EdgeFunctionError('INTERNAL', 'Kitchen PINs are not configured on this project')
  }
  return pepper
}

/** The venue an action is about: the body's, or a Customer's own. */
function venueFor(auth: AuthContext, requested: number | undefined): number {
  const id =
    requested ??
    (auth.role === 'Restaurant/Hotel Customer' ? (auth.profile.horeca_id ?? undefined) : undefined)
  if (id === undefined) throw new EdgeFunctionError('INVALID_INPUT', 'horecaId is required')
  return id
}

async function loadVenue(service: SupabaseClient, horecaId: number): Promise<{ id: number; name: string }> {
  const { data, error } = await service.from('horecas').select('id, name').eq('id', horecaId).maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not load the venue')
  if (!data) throw new EdgeFunctionError('NOT_FOUND', 'Venue not found')
  return data as { id: number; name: string }
}

/**
 * The venue's code row, created on first use. Lazy so that printing "just
 * works" the first time anyone opens QR & PINs, with no separate "enable"
 * step to forget.
 */
async function ensureCode(
  service: SupabaseClient,
  horecaId: number,
): Promise<{ row: CodeRow; created: boolean }> {
  const cols = 'token, failed_attempts, locked_until'
  const existing = await service.from('qr_codes').select(cols).eq('horeca_id', horecaId).maybeSingle()
  if (existing.error) throw new EdgeFunctionError('INTERNAL', 'Could not load the QR code')
  if (existing.data) return { row: existing.data as CodeRow, created: false }

  const inserted = await service
    .from('qr_codes')
    .insert({ horeca_id: horecaId, token: generateQrToken() })
    .select(cols)
    .single()
  if (!inserted.error && inserted.data) return { row: inserted.data as CodeRow, created: true }

  // Lost a race with another first `get` for the same venue: theirs is the row.
  const again = await service.from('qr_codes').select(cols).eq('horeca_id', horecaId).maybeSingle()
  if (again.data) return { row: again.data as CodeRow, created: false }
  throw new EdgeFunctionError('INTERNAL', 'Could not create the QR code')
}

async function findStaff(ctx: Ctx, staffId: string): Promise<StaffRow> {
  const { data, error } = await ctx.service
    .from('qr_staff')
    .select('id, horeca_id, auth_user_id, name, revoked_at')
    .eq('id', staffId)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not load the staff member')
  // Unknown id and someone else's venue answer the same, so ids cannot be probed.
  if (!data || !(await canManageHoreca(ctx.service, ctx.auth, (data as StaffRow).horeca_id))) {
    throw new EdgeFunctionError('NOT_FOUND', 'Staff member not found')
  }
  return data as StaffRow
}

/** The refusal a form needs: weak is a QR_WEAK_PIN, a malformed one is plain input. */
function assertAcceptablePin(pin: string): void {
  const check = validatePin(pin)
  if (check.ok) return
  throw check.reason === 'weak'
    ? new EdgeFunctionError('QR_WEAK_PIN', describePinProblem('weak'))
    : new EdgeFunctionError('INVALID_INPUT', describePinProblem('format'))
}

async function assertPinFree(
  service: SupabaseClient,
  horecaId: number,
  pinHmac: string,
  exceptStaffId?: string,
): Promise<void> {
  let q = service
    .from('qr_staff')
    .select('id')
    .eq('horeca_id', horecaId)
    .eq('pin_hmac', pinHmac)
    .is('revoked_at', null)
  if (exceptStaffId) q = q.neq('id', exceptStaffId)
  const { data, error } = await q.limit(1)
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not check the PIN')
  if (data && data.length > 0) {
    throw new EdgeFunctionError('QR_PIN_TAKEN', 'Another person here already uses that PIN. Choose a different one.')
  }
}

// The kitchen phone finds its own unlock row by name (auth_user_id is not
// client-readable), so two active staff at one venue must never share a name.
async function assertNameFree(
  service: SupabaseClient,
  horecaId: number,
  name: string,
  exceptStaffId?: string,
): Promise<void> {
  let q = service.from('qr_staff').select('id, name').eq('horeca_id', horecaId).is('revoked_at', null)
  if (exceptStaffId) q = q.neq('id', exceptStaffId)
  const { data, error } = await q
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not check the name')
  const wanted = name.trim().toLowerCase()
  if ((data ?? []).some((r: { name: string }) => r.name.trim().toLowerCase() === wanted)) {
    throw new EdgeFunctionError('CONFLICT', 'Someone here already has that name. Add a surname or initial.')
  }
}

function randomPassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function endSessions(service: SupabaseClient, authUserId: string): Promise<boolean> {
  const { error } = await service.rpc('qr_end_sessions', { p_user: authUserId })
  if (error) console.error('[mutate-qr-access] qr_end_sessions failed:', error.message)
  return !error
}

async function deleteAuthUserQuietly(service: SupabaseClient, authUserId: string): Promise<void> {
  const { error } = await service.auth.admin.deleteUser(authUserId)
  if (error) {
    // An orphan login nobody can reach: harmless to access, but worth a named log.
    console.error(`[mutate-qr-access] could not remove half-created auth user ${authUserId}:`, error.message)
  }
}

function audit(
  ctx: Ctx,
  action: 'create' | 'update',
  resource: 'qr_code' | 'qr_staff',
  resourceId: string,
  metadata: Record<string, unknown>,
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): Promise<void> {
  return logAuditEvent(ctx.service, {
    actorId: ctx.auth.userId,
    actorRole: ctx.auth.role,
    action,
    resource,
    resourceId,
    before: before ?? null,
    after: after ?? null,
    metadata,
  })
}

// ── actions ─────────────────────────────────────────────────────────────────

async function actGet(ctx: Ctx, input: Extract<Input, { action: 'get' }>): Promise<Response> {
  const horecaId = venueFor(ctx.auth, input.horecaId)
  await requireManageHoreca(ctx.service, ctx.auth, horecaId)
  const venue = await loadVenue(ctx.service, horecaId)
  const { row, created } = await ensureCode(ctx.service, horecaId)

  if (created) {
    // The token is never audited -- it is the entry URL.
    await audit(ctx, 'create', 'qr_code', String(horecaId), { horecaId, lazy: true })
  }

  const { data: staff, error } = await ctx.service
    .from('qr_staff')
    .select('id, name, unlocked_until, last_unlocked_at, created_at')
    .eq('horeca_id', horecaId)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not load the staff list')

  const lock = lockInfo(row.locked_until)
  const stillLocked = lock.permanent || (lock.lockedUntil !== null && new Date(lock.lockedUntil) > new Date())

  return json(ctx.req, {
    ok: true,
    horecaId,
    horecaName: venue.name,
    token: row.token,
    url: `${appOrigin()}/?qr=${row.token}`,
    staff: ((staff ?? []) as Array<Record<string, string | null>>).map((s) => ({
      id: s.id,
      name: s.name,
      unlockedUntil: s.unlocked_until,
      lastUnlockedAt: s.last_unlocked_at,
      createdAt: s.created_at,
    })),
    locked: stillLocked,
    // Null for an expired timed lock (nothing to wait for) and for a permanent one.
    lockedUntil: stillLocked ? lock.lockedUntil : null,
    permanent: lock.permanent,
    failedAttempts: row.failed_attempts,
  })
}

async function actRegenerate(
  ctx: Ctx,
  input: Extract<Input, { action: 'regenerate_code' }>,
): Promise<Response> {
  const horecaId = venueFor(ctx.auth, input.horecaId)
  await requireManageHoreca(ctx.service, ctx.auth, horecaId)
  await limit(`qr-access:regen:${ctx.auth.userId}`, 10, 'code changes')
  await loadVenue(ctx.service, horecaId)
  await ensureCode(ctx.service, horecaId)

  // Unlocks first: that is the part that must hold. Rotating the token after
  // means a failure in between leaves staff re-entering a PIN, not a dead
  // sticker with live phones behind it.
  const { data: cleared, error: clearErr } = await ctx.service
    .from('qr_staff')
    .update({ unlocked_until: null })
    .eq('horeca_id', horecaId)
    .is('revoked_at', null)
    .select('auth_user_id')
  if (clearErr) throw new EdgeFunctionError('INTERNAL', 'Could not end the current unlocks')

  const token = generateQrToken()
  const { error: rotateErr } = await ctx.service
    .from('qr_codes')
    .update({
      token,
      rotated_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
    })
    .eq('horeca_id', horecaId)
  if (rotateErr) throw new EdgeFunctionError('INTERNAL', 'Could not replace the QR code')

  const users = ((cleared ?? []) as Array<{ auth_user_id: string }>).map((r) => r.auth_user_id)
  const results = await Promise.all(users.map((u) => endSessions(ctx.service, u)))
  const sessionsEnded = results.filter(Boolean).length

  await audit(ctx, 'update', 'qr_code', String(horecaId), {
    horecaId,
    operation: 'regenerate',
    staffUnlocksEnded: users.length,
    sessionsEnded,
  })

  return json(ctx.req, {
    ok: true,
    horecaId,
    token,
    url: `${appOrigin()}/?qr=${token}`,
    // Sessions that failed to end are inert anyway (unlocked_until is cleared,
    // which is what RLS and requireAuth read) -- reported so it is not silent.
    sessionsEnded,
    sessionsFailed: users.length - sessionsEnded,
  })
}

async function actCreateStaff(
  ctx: Ctx,
  input: Extract<Input, { action: 'create_staff' }>,
): Promise<Response> {
  const horecaId = venueFor(ctx.auth, input.horecaId)
  await requireManageHoreca(ctx.service, ctx.auth, horecaId)
  await limit(`qr-access:pin:${ctx.auth.userId}`, 10, 'PIN changes')
  assertAcceptablePin(input.pin)
  const pepper = requirePepper()
  await loadVenue(ctx.service, horecaId)

  const pinHmac = await hmacPin(pepper, horecaId, input.pin)
  await assertPinFree(ctx.service, horecaId, pinHmac)
  await assertNameFree(ctx.service, horecaId, input.name)
  await ensureCode(ctx.service, horecaId)

  const { data: created, error: createErr } = await ctx.service.auth.admin.createUser({
    email: `qr-${crypto.randomUUID()}@${QR_EMAIL_DOMAIN}`,
    email_confirm: true,
    password: randomPassword(),
    user_metadata: { role: 'QR Staff', name: input.name },
  })
  const authUserId = created?.user?.id
  if (createErr || !authUserId) {
    console.error('[mutate-qr-access] createUser failed:', createErr?.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not create the kitchen login')
  }

  // From here every failure removes the login again: a QR Staff user with no
  // qr_staff row (or with no venue) is an account nothing can ever retire.
  try {
    const { data: profile, error: profileErr } = await ctx.service
      .from('profiles')
      .update({ horeca_id: horecaId, name: input.name })
      .eq('id', authUserId)
      .select('id')
      .maybeSingle()
    if (profileErr || !profile) {
      throw new EdgeFunctionError('INTERNAL', 'Could not attach the login to the venue')
    }

    const { data: staff, error: staffErr } = await ctx.service
      .from('qr_staff')
      .insert({
        horeca_id: horecaId,
        auth_user_id: authUserId,
        name: input.name,
        pin_hmac: pinHmac,
        created_by: ctx.auth.userId,
      })
      .select('id, name, created_at')
      .single()
    if (staffErr || !staff) {
      // 23505: a concurrent create took the same PIN between the check and here.
      if ((staffErr as { code?: string } | null)?.code === '23505') {
        throw new EdgeFunctionError('QR_PIN_TAKEN', 'Another person here already uses that PIN. Choose a different one.')
      }
      throw new EdgeFunctionError('INTERNAL', 'Could not save the staff member')
    }

    const row = staff as { id: string; name: string; created_at: string }
    await audit(ctx, 'create', 'qr_staff', row.id, { horecaId }, undefined, {
      id: row.id,
      name: row.name,
      horecaId,
    })

    return json(
      ctx.req,
      {
        ok: true,
        staff: {
          id: row.id,
          name: row.name,
          unlockedUntil: null,
          lastUnlockedAt: null,
          createdAt: row.created_at,
        },
      },
      201,
    )
  } catch (e) {
    await deleteAuthUserQuietly(ctx.service, authUserId)
    throw e
  }
}

async function actRename(ctx: Ctx, input: Extract<Input, { action: 'rename_staff' }>): Promise<Response> {
  const staff = await findStaff(ctx, input.staffId)
  if (staff.revoked_at) throw new EdgeFunctionError('CONFLICT', 'That staff member has been removed')
  await assertNameFree(ctx.service, staff.horeca_id, input.name, staff.id)

  const { error } = await ctx.service.from('qr_staff').update({ name: input.name }).eq('id', staff.id)
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not rename the staff member')
  // The profile name is what an Admin sees in logs; keep the two agreeing.
  const { error: profErr } = await ctx.service
    .from('profiles')
    .update({ name: input.name })
    .eq('id', staff.auth_user_id)
  if (profErr) console.warn('[mutate-qr-access] profile rename failed:', profErr.message)

  await audit(
    ctx,
    'update',
    'qr_staff',
    staff.id,
    { horecaId: staff.horeca_id, operation: 'rename' },
    { name: staff.name },
    { name: input.name },
  )
  return json(ctx.req, { ok: true, staff: { id: staff.id, name: input.name } })
}

async function actResetPin(ctx: Ctx, input: Extract<Input, { action: 'reset_pin' }>): Promise<Response> {
  await limit(`qr-access:pin:${ctx.auth.userId}`, 10, 'PIN changes')
  assertAcceptablePin(input.pin)
  const pepper = requirePepper()
  const staff = await findStaff(ctx, input.staffId)
  if (staff.revoked_at) throw new EdgeFunctionError('CONFLICT', 'That staff member has been removed')

  const pinHmac = await hmacPin(pepper, staff.horeca_id, input.pin)
  await assertPinFree(ctx.service, staff.horeca_id, pinHmac, staff.id)

  // Clearing the unlock and ending sessions together: the old PIN may be known
  // to someone who should no longer have it, and what they hold is a live phone.
  const { error } = await ctx.service
    .from('qr_staff')
    .update({ pin_hmac: pinHmac, unlocked_until: null })
    .eq('id', staff.id)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new EdgeFunctionError('QR_PIN_TAKEN', 'Another person here already uses that PIN. Choose a different one.')
    }
    throw new EdgeFunctionError('INTERNAL', 'Could not change the PIN')
  }
  const sessionsEnded = await endSessions(ctx.service, staff.auth_user_id)

  await audit(ctx, 'update', 'qr_staff', staff.id, {
    horecaId: staff.horeca_id,
    operation: 'reset_pin',
    sessionsEnded,
  })
  return json(ctx.req, { ok: true, sessionsEnded })
}

async function actRevoke(ctx: Ctx, input: Extract<Input, { action: 'revoke_staff' }>): Promise<Response> {
  const staff = await findStaff(ctx, input.staffId)

  // Idempotent: revoking someone already revoked skips the row update and
  // re-runs the clean-up, which is what lets a half-finished revoke be retried.
  if (!staff.revoked_at) {
    const { error } = await ctx.service
      .from('qr_staff')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.auth.userId,
        unlocked_until: null,
      })
      .eq('id', staff.id)
      .is('revoked_at', null)
    if (error) throw new EdgeFunctionError('INTERNAL', 'Could not remove the staff member')
  }

  const { error: banErr } = await ctx.service.auth.admin.updateUserById(staff.auth_user_id, {
    ban_duration: BAN_FOREVER,
  })
  if (banErr) console.error('[mutate-qr-access] ban failed:', banErr.message)
  const sessionsEnded = await endSessions(ctx.service, staff.auth_user_id)

  await audit(ctx, 'update', 'qr_staff', staff.id, {
    horecaId: staff.horeca_id,
    operation: 'revoke',
    alreadyRevoked: staff.revoked_at !== null,
    banned: !banErr,
    sessionsEnded,
  })

  if (banErr || !sessionsEnded) {
    throw new EdgeFunctionError(
      'INTERNAL',
      'Access was removed, but ending their login did not finish. Remove them again to retry.',
    )
  }
  return json(ctx.req, { ok: true })
}

async function actUnlockCode(
  ctx: Ctx,
  input: Extract<Input, { action: 'unlock_code' }>,
): Promise<Response> {
  const horecaId = venueFor(ctx.auth, input.horecaId)
  await requireManageHoreca(ctx.service, ctx.auth, horecaId)
  const { row } = await ensureCode(ctx.service, horecaId)

  const { error } = await ctx.service
    .from('qr_codes')
    .update({ failed_attempts: 0, locked_until: null })
    .eq('horeca_id', horecaId)
  if (error) throw new EdgeFunctionError('INTERNAL', 'Could not unlock the code')

  await audit(ctx, 'update', 'qr_code', String(horecaId), {
    horecaId,
    operation: 'unlock_code',
    failedAttemptsCleared: row.failed_attempts,
  })
  return json(ctx.req, { ok: true })
}

// ── entry ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'Method not allowed', undefined, 405, req)
  }

  try {
    requireModule('shop')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    await limit(`qr-access:${auth.userId}`, 30, 'requests')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
    const ctx: Ctx = { req, service, auth }

    switch (input.action) {
      case 'get':
        return await actGet(ctx, input)
      case 'regenerate_code':
        return await actRegenerate(ctx, input)
      case 'create_staff':
        return await actCreateStaff(ctx, input)
      case 'rename_staff':
        return await actRename(ctx, input)
      case 'reset_pin':
        return await actResetPin(ctx, input)
      case 'revoke_staff':
        return await actRevoke(ctx, input)
      case 'unlock_code':
        return await actUnlockCode(ctx, input)
    }

    // Unreachable while the schema and this switch agree.
    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[mutate-qr-access] unexpected error:', e)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
