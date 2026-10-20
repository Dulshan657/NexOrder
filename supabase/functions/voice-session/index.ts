// voice-session Edge Function
//
// Nex Assistant: mints the short-lived OpenAI Realtime key the browser connects
// with (`start`), and closes the session's ledger row (`end`). Owned by the
// `voice_assistant` module (`config/moduleOwnership.mjs`), which requires
// `sales_orders`. The four sales roles only; everyone else gets 403.
//
// start: burst limit (START_BURST_PER_HOUR per user) -> daily budget from the
//   user's voice_sessions rows in the last 24 h (budget.ts; an open row counts
//   at the full session cap) -> open a ledger row -> mint the client secret
//   with the role's instructions and tools -> audit -> return the key.
//   The instructions are built here and sent only to OpenAI; they are never
//   in a response. If the mint fails the open row is deleted, so a failed
//   start does not cost the user budget, and OpenAI's error body is logged
//   (truncated) and never forwarded.
// end: idempotent. Closes the caller's own row on the SERVER clock (a client
//   cannot shorten its own session), stores the reported usage and its cost.
//   cost_usd is INFORMATIONAL: it is computed from token counts the client
//   reports, so it is only as honest as the client. The budget never reads it;
//   it uses started_at / ended_at, both written by this function's clock.
//
// Concurrent starts. The first budget check, the insert and the mint are
// separate statements with no lock, so N simultaneous starts would all see the
// same ledger. After inserting, start therefore re-reads the ledger and charges
// itself only for the rows that sort strictly BEFORE its own (earlier
// started_at, tie-break by id: budget.ts rowsBefore), open rows at the full
// 900 s cap. Of two racing starts exactly one sees the other, so the later one
// is refused (its row deleted) rather than both being granted. The residual
// bound is the burst limit: at most START_BURST_PER_HOUR (10) starts an hour,
// and that limit degrades to per-isolate counting if the rate_limit_hit() DB
// call fails (_shared/rateLimit.ts fails open), so in that degraded state a
// burst spread over isolates is bounded only by the ledger re-check above.
//
// The daily window is a ledger rather than a rate_limit_counters bucket
// because that table's cleanup cron deletes rows after an hour.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type AuthContext, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { MODULE_SLUGS, isModuleEnabled, requireModule } from '../_shared/modules.ts'
import { toolsForRole } from '../_shared/voice/toolSchemas.ts'
import { buildInstructions } from '../_shared/voice/instructions.ts'
import {
  REALTIME_MODEL,
  REALTIME_VOICE,
  buildClientSecretRequest,
  type ClientSecretRequest,
} from '../_shared/voice/sessionRequest.ts'
import {
  DAILY_SECONDS,
  MIN_START_SECONDS,
  START_BURST_PER_HOUR,
  maxSecondsForNewSession,
  remainingSeconds,
  rowsBefore,
  secondsUsedToday,
  type IdentifiedLedgerRow,
  type LedgerRow,
} from '../_shared/voice/budget.ts'
import { MAX_REPORTED_TOKENS, computeRealtimeCostUsd } from '../_shared/voice/cost.ts'

// Literal on purpose: __tests__/voice/voiceSessionContract.test.ts reads it with
// the TypeScript parser and asserts it equals VOICE_ROLES in toolSchemas.ts.
const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep']

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'
const MINT_TIMEOUT_MS = 20_000
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const END_PER_MINUTE = 30
const LOGGED_ERROR_CHARS = 300
/** "Today" in the prompt is the operator's calendar day, not UTC's. */
const APP_TIME_ZONE = 'Australia/Sydney'

type Cors = Record<string, string>

const usageSchema = z.object({
  inputTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  outputTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  inputAudioTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  inputTextTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  cachedInputTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  outputAudioTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
  outputTextTokens: z.number().int().min(0).max(MAX_REPORTED_TOKENS),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('end'),
    sessionId: z.string().uuid(),
    usage: usageSchema.optional(),
    reason: z.enum(['user', 'cap', 'silence', 'hidden', 'channel', 'error', 'unmount']).optional(),
  }),
])

type EndInput = Extract<z.infer<typeof inputSchema>, { action: 'end' }>

const mintResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number(),
})

type MintedSecret = z.infer<typeof mintResponseSchema>

interface LedgerDbRow {
  id: string
  started_at: string
  ended_at: string | null
}

interface SessionRow {
  id: string
  started_at: string
  ended_at: string | null
}

function json(cors: Cors, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function enforceRateLimit(key: string, windowMs: number, max: number, what: string): Promise<void> {
  const rl = await checkRateLimit(key, { windowMs, max })
  if (!rl.ok) {
    throw new EdgeFunctionError(
      'TOO_MANY_REQUESTS',
      `${what}; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
    )
  }
}

/** The caller's sessions started in the last 24 hours, inclusive (as budget.ts counts). */
async function loadLedger(service: SupabaseClient, userId: string, now: Date): Promise<IdentifiedLedgerRow[]> {
  const { data, error } = await service
    .from('voice_sessions')
    .select('id, started_at, ended_at')
    .eq('user_id', userId)
    .gte('started_at', new Date(now.getTime() - DAY_MS).toISOString())
  if (error) {
    console.error('[voice-session] ledger read failed', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not read the voice usage ledger')
  }
  return ((data ?? []) as LedgerDbRow[]).map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at }))
}

/** Seconds left today, or a DAILY_BUDGET refusal naming when the oldest session ages out. */
function assertBudgetLeft(rows: readonly LedgerRow[], now: Date): number {
  const remaining = remainingSeconds(rows, now)
  if (remaining >= MIN_START_SECONDS) return remaining
  const oldest = Math.min(...rows.map((r) => Date.parse(r.startedAt)))
  throw new EdgeFunctionError(
    'TOO_MANY_REQUESTS',
    `You've used today's ${DAILY_SECONDS / 60} minutes of assistant time.`,
    { code: 'DAILY_BUDGET', resetAt: new Date(oldest + DAY_MS).toISOString() },
  )
}

async function loadName(auth: AuthContext): Promise<string> {
  const { data, error } = await auth.userClient
    .from('profiles')
    .select('name')
    .eq('id', auth.userId)
    .single()
  if (error) {
    // Not fatal: the prompt addresses "the user" instead of a name.
    console.warn('[voice-session] profile name lookup failed', error.message)
    return ''
  }
  const name = (data as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : ''
}

function todayIso(now: Date): string {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(now)
}

async function buildMintRequest(auth: AuthContext, now: Date): Promise<ClientSecretRequest> {
  const modules = MODULE_SLUGS.filter(isModuleEnabled)
  const name = await loadName(auth)
  return buildClientSecretRequest({
    instructions: buildInstructions({ role: auth.role, name, todayIso: todayIso(now), modules }),
    tools: toolsForRole(auth.role, modules),
    safetyIdentifier: auth.userId,
  })
}

/** POST to OpenAI. Returns null on any failure, having logged it server-side only. */
async function mintClientSecret(apiKey: string, request: ClientSecretRequest): Promise<MintedSecret | null> {
  const { body, headersExtra } = request
  try {
    const res = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headersExtra },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error('[voice-session] mint failed', res.status, text.slice(0, LOGGED_ERROR_CHARS))
      return null
    }
    const parsed = mintResponseSchema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error('[voice-session] mint failed', res.status, 'unexpected response shape')
      return null
    }
    return parsed.data
  } catch (e) {
    console.error('[voice-session] mint failed', 'network', e instanceof Error ? e.message : String(e))
    return null
  }
}

async function openLedgerRow(service: SupabaseClient, auth: AuthContext): Promise<string> {
  const sessionId = crypto.randomUUID()
  const { error } = await service.from('voice_sessions').insert({
    id: sessionId,
    user_id: auth.userId,
    role: auth.role,
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
  })
  if (error) {
    console.error('[voice-session] ledger insert failed', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not open a voice session')
  }
  return sessionId
}

async function deleteOpenRow(service: SupabaseClient, sessionId: string): Promise<void> {
  const { error } = await service.from('voice_sessions').delete().eq('id', sessionId)
  if (error) {
    console.error('[voice-session] could not delete the unminted session row', sessionId, error.message)
  }
}

interface VerifiedBudget {
  /** The caller's rows that sort before the new one: what it is charged for. */
  before: LedgerRow[]
  now: Date
}

/**
 * Re-read the ledger with the new row in it and charge the new session only for
 * the rows sorting before it (budget.ts rowsBefore). Deletes the row and throws
 * the DAILY_BUDGET refusal if a concurrent start already took the allowance.
 */
async function verifyBudgetAfterInsert(
  service: SupabaseClient, auth: AuthContext, sessionId: string,
): Promise<VerifiedBudget> {
  const now = new Date()
  const rows = await loadLedger(service, auth.userId, now)
  const mine = rows.find((r) => r.id === sessionId)
  if (!mine) {
    console.error('[voice-session] inserted session row not found on re-read', sessionId)
    await deleteOpenRow(service, sessionId)
    throw new EdgeFunctionError('INTERNAL', 'Could not open a voice session')
  }
  const before = rowsBefore(rows, mine)
  try {
    assertBudgetLeft(before, now)
  } catch (e) {
    await deleteOpenRow(service, sessionId)
    throw e
  }
  return { before, now }
}

async function handleStart(auth: AuthContext, service: SupabaseClient, cors: Cors): Promise<Response> {
  await enforceRateLimit(
    `voice-session:start:${auth.userId}`, HOUR_MS, START_BURST_PER_HOUR, 'Too many sessions started',
  )
  const firstCheckAt = new Date()
  assertBudgetLeft(await loadLedger(service, auth.userId, firstCheckAt), firstCheckAt)
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new EdgeFunctionError('INTERNAL', 'OPENAI_API_KEY is not configured')

  // Built BEFORE the row exists, so a throw here cannot leave an open row behind.
  const request = await buildMintRequest(auth, firstCheckAt)
  const sessionId = await openLedgerRow(service, auth)
  const { before, now } = await verifyBudgetAfterInsert(service, auth, sessionId)
  const remaining = remainingSeconds(before, now)
  const minted = await mintClientSecret(apiKey, request)
  if (!minted) {
    await deleteOpenRow(service, sessionId)
    throw new EdgeFunctionError('INTERNAL', 'Voice service unavailable')
  }

  await logAuditEvent(service, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'create',
    resource: 'voice_session',
    resourceId: sessionId,
    metadata: { model: REALTIME_MODEL, voice: REALTIME_VOICE, remainingSeconds: remaining },
  })
  return json(cors, {
    ok: true,
    sessionId,
    clientSecret: minted.value,
    expiresAt: minted.expires_at,
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
    maxSeconds: maxSecondsForNewSession(before, now),
    budget: { usedSeconds: secondsUsedToday(before, now), dailySeconds: DAILY_SECONDS },
  })
}

async function loadOwnSession(service: SupabaseClient, auth: AuthContext, sessionId: string): Promise<SessionRow> {
  const { data, error } = await service
    .from('voice_sessions')
    .select('id, started_at, ended_at')
    .eq('id', sessionId)
    .eq('user_id', auth.userId)
    .maybeSingle()
  if (error) {
    console.error('[voice-session] session read failed', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not read the voice session')
  }
  if (!data) throw new EdgeFunctionError('NOT_FOUND', 'Voice session not found')
  return data as SessionRow
}

/** Close the row if still open. False when a concurrent `end` closed it first. */
async function closeSession(
  service: SupabaseClient,
  userId: string,
  sessionId: string,
  input: EndInput,
  endedAt: Date,
  costUsd: number | null,
): Promise<boolean> {
  const { data, error } = await service
    .from('voice_sessions')
    .update({
      ended_at: endedAt.toISOString(),
      ended_reason: input.reason ?? null,
      usage: input.usage ?? null,
      input_tokens: input.usage?.inputTokens ?? null,
      output_tokens: input.usage?.outputTokens ?? null,
      cost_usd: costUsd,
    })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .is('ended_at', null)
    .select('id')
  if (error) {
    console.error('[voice-session] session close failed', error.message)
    throw new EdgeFunctionError('INTERNAL', 'Could not close the voice session')
  }
  return Array.isArray(data) && data.length > 0
}

async function handleEnd(auth: AuthContext, service: SupabaseClient, input: EndInput, cors: Cors): Promise<Response> {
  await enforceRateLimit(`voice-session:end:${auth.userId}`, MINUTE_MS, END_PER_MINUTE, 'Rate limit exceeded')
  const session = await loadOwnSession(service, auth, input.sessionId)
  if (session.ended_at !== null) return json(cors, { ok: true, alreadyEnded: true })

  const endedAt = new Date() // the server clock, never the client's
  const costUsd = input.usage ? computeRealtimeCostUsd(input.usage) : null
  const closed = await closeSession(service, auth.userId, session.id, input, endedAt, costUsd)
  if (!closed) return json(cors, { ok: true, alreadyEnded: true })

  const durationSec = Math.max(0, Math.ceil((endedAt.getTime() - Date.parse(session.started_at)) / 1000))
  await logAuditEvent(service, {
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'update',
    resource: 'voice_session',
    resourceId: session.id,
    metadata: { reason: input.reason ?? null, durationSec, costUsd },
  })
  return json(cors, { ok: true, costUsd })
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('voice_assistant')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    const input = parsed.data
    if (input.action === 'start') return await handleStart(auth, service, corsHeaders)
    return await handleEnd(auth, service, input, corsHeaders)
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    console.error('[voice-session] unexpected error', e instanceof Error ? e.message : String(e))
    return errorResponse('INTERNAL', 'Unknown error', undefined, undefined, req)
  }
})
