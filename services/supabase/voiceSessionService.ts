// The browser's two calls to the `voice-session` Edge Function (Nex Assistant).
//
//   startVoiceSession()            mint a short-lived Realtime key and open a ledger row
//   endVoiceSession(input, opts)   close the row (idempotent server-side)
//
// A failure throws VoiceSessionError carrying the function's whole envelope
// (`code`, `message`, `details`), because the hook BRANCHES on it: a spent daily
// budget (`TOO_MANY_REQUESTS` + `details.code === 'DAILY_BUDGET'`) is shown
// differently from a burst limit, and a disabled module differently from a role
// refusal. `functions.invoke` on its own would only say "non-2xx status code"
// (see lib/functionError.ts).
//
// `keepalive` is for ending a session while the page goes away (tab hidden,
// unmount, pagehide): `functions.invoke` cannot set `keepalive`, so that path
// posts with fetch directly, with the signed-in user's access token.
//
// The client secret is returned to the caller and nowhere else: never logged,
// never stored.

import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { extractFunctionErrorEnvelope, extractFunctionErrorMessage } from '@/lib/functionError'
import type { RealtimeUsage } from '@/supabase/functions/_shared/voice/cost'

const FUNCTION_NAME = 'voice-session'
const START_FAILED = 'The assistant could not be started'
const END_FAILED = 'The assistant session could not be closed'

export type VoiceEndReason = 'user' | 'cap' | 'silence' | 'hidden' | 'channel' | 'error' | 'unmount'

const startSchema = z.object({
  sessionId: z.string().min(1),
  clientSecret: z.string().min(1),
  expiresAt: z.number(),
  model: z.string(),
  voice: z.string(),
  maxSeconds: z.number().int().positive(),
  budget: z.object({ usedSeconds: z.number(), dailySeconds: z.number() }),
})

export interface StartVoiceSession {
  sessionId: string
  /** The ephemeral Realtime key (~120 s). Pass it to connect() and drop it. */
  clientSecret: string
  /** Epoch seconds. */
  expiresAt: number
  model: string
  voice: string
  /** This session's cap, already reduced to what is left of today's budget. */
  maxSeconds: number
  budget: { usedSeconds: number; dailySeconds: number }
}

export interface EndVoiceSessionInput {
  sessionId: string
  usage?: RealtimeUsage
  reason?: VoiceEndReason
}

export interface EndVoiceSessionOptions {
  /** Post with `fetch(..., { keepalive: true })` so the request outlives the page. */
  keepalive?: boolean
}

export interface VoiceSessionErrorInit {
  status: number | null
  code: string | null
  details?: unknown
}

/** A failed voice-session call, with the Edge Function's envelope kept intact. */
export class VoiceSessionError extends Error {
  readonly status: number | null
  readonly code: string | null
  readonly details: unknown

  constructor(message: string, init: VoiceSessionErrorInit) {
    super(message)
    this.name = 'VoiceSessionError'
    this.status = init.status
    this.code = init.code
    this.details = init.details
  }
}

/** Turn whatever `functions.invoke` returned as `error` into a VoiceSessionError. */
async function toVoiceSessionError(error: unknown, fallback: string): Promise<VoiceSessionError> {
  const envelope = await extractFunctionErrorEnvelope(error)
  const message = envelope?.message ?? (await extractFunctionErrorMessage(error, fallback))
  return new VoiceSessionError(message, {
    status: envelope?.status ?? null,
    code: envelope?.code ?? null,
    details: envelope?.details,
  })
}

/** Mint a Realtime key for the signed-in user. Throws VoiceSessionError. */
export async function startVoiceSession(): Promise<StartVoiceSession> {
  const { data, error } = await supabase.functions.invoke<unknown>(FUNCTION_NAME, { body: { action: 'start' } })
  if (error) throw await toVoiceSessionError(error, START_FAILED)
  const parsed = startSchema.safeParse(data)
  if (!parsed.success) {
    throw new VoiceSessionError('The assistant service returned an unexpected response', { status: null, code: null })
  }
  const d = parsed.data
  return {
    sessionId: d.sessionId,
    clientSecret: d.clientSecret,
    expiresAt: d.expiresAt,
    model: d.model,
    voice: d.voice,
    maxSeconds: d.maxSeconds,
    budget: { usedSeconds: d.budget.usedSeconds, dailySeconds: d.budget.dailySeconds },
  }
}

function endBody(input: EndVoiceSessionInput): Record<string, unknown> {
  return {
    action: 'end',
    sessionId: input.sessionId,
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  }
}

async function endWithKeepalive(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.auth.getSession()
  const accessToken = data?.session?.access_token
  if (error || !accessToken) {
    throw new VoiceSessionError('Not signed in', { status: null, code: 'UNAUTHORIZED' })
  }
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
  const res = await fetch(`${baseUrl}/functions/v1/${FUNCTION_NAME}`, {
    method: 'POST',
    keepalive: true,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toVoiceSessionError({ context: res }, END_FAILED)
}

/** Close a session. Idempotent on the server. Throws VoiceSessionError. */
export async function endVoiceSession(input: EndVoiceSessionInput, options: EndVoiceSessionOptions = {}): Promise<void> {
  const body = endBody(input)
  if (options.keepalive) return endWithKeepalive(body)
  const { error } = await supabase.functions.invoke<unknown>(FUNCTION_NAME, { body })
  if (error) throw await toVoiceSessionError(error, END_FAILED)
}
