// Nex Assistant's session state machine: mic -> key -> WebRTC -> live -> ended.
//
//   idle -> requesting-mic -> minting -> connecting -> live -> ending -> ended
//                  \______________\___________\_____________________-> error
//
// start({ textOnly }) asks for the mic FIRST (unless text-only), because the key
// startVoiceSession() mints is valid for about two minutes and a slow permission
// prompt must not expire it. Text-only skips the mic entirely: no getUserMedia,
// the connection is receive-only and Mute does not apply.
//
// A 401 from the SDP exchange means the key expired before it was used: the
// session it opened is closed and ONE more is minted automatically. A second 401
// is reported as `expired`.
//
// Live, it answers the model's function calls (from response.done, which is
// authoritative, once per call_id), sums the usage, and ends itself on: the
// session cap (a warning a minute before), two minutes with no speech and no
// response, the tab hidden for a minute, page hide, or the data channel closing.
// end() is idempotent; it closes the connection, stops every mic track and tells
// the server, fire-and-forget (keepalive when the page is going away). A failed
// end is reported to lib/errorReporter, never shown: the server row is closed at
// the cap regardless.
//
// These are plain functions over `Handles`, the one mutable object the hook
// (hooks/useVoiceSession.ts) keeps in a single ref; what renders is ONE immutable
// `ViewState`, replaced through `setView`. The client secret is passed to
// connect() and not kept.

import { reportError } from '@/lib/errorReporter'
import { RealtimeClient, RealtimeConnectError } from './realtimeClient'
import type { RealtimeClientLike } from './realtimeClient'
import { functionOutputItem, responseCreate, userTextItem } from './realtimeEvents'
import type { ResponseOutputItem, ServerEvent } from './realtimeEvents'
import { INITIAL_TRANSCRIPT, reduceTranscript } from './transcript'
import type { TranscriptEntry, TranscriptState } from './transcript'
import { ZERO_USAGE, addUsage } from './realtimeUsage'
import { micError, startError, voiceError } from './voiceErrors'
import type { VoiceError } from './voiceErrors'
import type { VoiceToolResult } from './context'
import { endVoiceSession, startVoiceSession } from '@/services/supabase/voiceSessionService'
import type { StartVoiceSession, VoiceEndReason } from '@/services/supabase/voiceSessionService'
import type { RealtimeUsage } from '@/supabase/functions/_shared/voice/cost'

export type VoicePhase = 'idle' | 'requesting-mic' | 'minting' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'

export interface VoiceBudget {
  readonly usedSeconds: number
  readonly dailySeconds: number
}

export interface StartVoiceOptions {
  /** Type instead of speak: no mic is requested and Mute does not apply. */
  textOnly?: boolean
}

export interface UseVoiceSessionOptions {
  runTool: (name: string, args: unknown) => VoiceToolResult
  /** Shown as a toast, e.g. a minute before the session cap. */
  onWarning?: (message: string) => void
  /** Injected in tests; defaults to the real WebRTC client. */
  createClient?: () => RealtimeClientLike
}

export const CAP_WARNING = 'One minute of assistant time left'
const WARN_BEFORE_CAP_MS = 60_000
const SILENCE_MS = 120_000
const HIDDEN_MS = 60_000
const TICK_MS = 1_000
const BAD_ARGUMENTS: VoiceToolResult = { ok: false, error: 'Bad arguments' }
const TOOL_FAILED: VoiceToolResult = { ok: false, error: 'That lookup failed' }
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true } }

export interface ViewState {
  readonly phase: VoicePhase
  readonly transcript: TranscriptState
  readonly muted: boolean
  readonly textOnly: boolean
  readonly error: VoiceError | null
  readonly budget: VoiceBudget | null
  readonly maxSeconds: number | null
  readonly elapsedSec: number
}

export const INITIAL_VIEW: ViewState = Object.freeze({
  phase: 'idle',
  transcript: INITIAL_TRANSCRIPT,
  muted: false,
  textOnly: false,
  error: null,
  budget: null,
  maxSeconds: null,
  elapsedSec: 0,
})

type Timer = ReturnType<typeof setTimeout>

interface Timers {
  readonly cap: Timer | null
  readonly warn: Timer | null
  readonly silence: Timer | null
  readonly hidden: Timer | null
  readonly ticker: ReturnType<typeof setInterval> | null
}

const NO_TIMERS: Timers = Object.freeze({ cap: null, warn: null, silence: null, hidden: null, ticker: null })

export interface Handles {
  /** Bumped by every start and every end/fail; an async step from an older attempt bails out. */
  attempt: number
  /** A session is starting or live. */
  active: boolean
  live: boolean
  textOnly: boolean
  muted: boolean
  client: RealtimeClientLike | null
  mic: MediaStream | null
  sessionId: string | null
  maxSeconds: number | null
  usage: RealtimeUsage
  answered: ReadonlySet<string>
  timers: Timers
  startedAt: number
  textSeq: number
  removeListeners: (() => void) | null
  /** Why the last session ended; closes a key minted after its session was already ended. */
  endReason: VoiceEndReason
  mounted: boolean
  options: UseVoiceSessionOptions
  setView: (update: (view: ViewState) => ViewState) => void
  audioRef: { current: HTMLAudioElement | null }
}

// ── View ──────────────────────────────────────────────────────────────────────

function patchView(h: Handles, patch: Partial<ViewState>): void {
  if (h.mounted) h.setView((view) => ({ ...view, ...patch }))
}

function updateView(h: Handles, update: (view: ViewState) => ViewState): void {
  if (h.mounted) h.setView(update)
}

const isStale = (h: Handles, attempt: number): boolean => !h.active || h.attempt !== attempt

// ── Teardown ──────────────────────────────────────────────────────────────────

function clearTimers(h: Handles): void {
  const { cap, warn, silence, hidden, ticker } = h.timers
  for (const timer of [cap, warn, silence, hidden]) if (timer !== null) clearTimeout(timer)
  if (ticker !== null) clearInterval(ticker)
  h.timers = NO_TIMERS
}

function releaseMedia(h: Handles): void {
  h.removeListeners?.()
  h.removeListeners = null
  h.client?.close()
  h.client = null
  for (const track of h.mic?.getTracks() ?? []) track.stop()
  h.mic = null
}

/** Tell the server the session is over. Fire-and-forget; a failure is reported, not shown. */
function closeOnServer(sessionId: string | null, usage: RealtimeUsage, reason: VoiceEndReason, keepalive: boolean): void {
  if (sessionId === null) return
  endVoiceSession({ sessionId, usage, reason }, { keepalive }).catch((error: unknown) => {
    reportError({
      message: 'Nex Assistant: ending the voice session failed',
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { reason, error: error instanceof Error ? error.message : String(error) },
    })
  })
}

function shutDown(h: Handles, reason: VoiceEndReason): void {
  h.endReason = reason
  h.active = false
  h.live = false
  h.attempt += 1
  clearTimers(h)
  releaseMedia(h)
  closeOnServer(h.sessionId, h.usage, reason, reason === 'hidden' || reason === 'unmount')
  h.sessionId = null
}

export function endSession(h: Handles, reason: VoiceEndReason): void {
  if (!h.active) return
  patchView(h, { phase: 'ending' })
  shutDown(h, reason)
  patchView(h, { phase: 'ended', muted: false })
}

function fail(h: Handles, error: VoiceError): void {
  if (!h.active) return
  shutDown(h, 'error')
  patchView(h, { phase: 'error', error, muted: false })
}

// ── Live timers and page listeners ────────────────────────────────────────────

function setTimer(h: Handles, key: keyof Omit<Timers, 'ticker'>, ms: number | null, run: () => void): void {
  const current = h.timers[key]
  if (current !== null) clearTimeout(current)
  h.timers = { ...h.timers, [key]: ms === null ? null : setTimeout(run, ms) }
}

function resetSilence(h: Handles): void {
  if (h.live) setTimer(h, 'silence', SILENCE_MS, () => endSession(h, 'silence'))
}

function tick(h: Handles): void {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - h.startedAt) / 1000))
  updateView(h, (view) => (view.elapsedSec === elapsedSec ? view : { ...view, elapsedSec }))
}

function startLiveTimers(h: Handles): void {
  const capMs = (h.maxSeconds ?? 0) * 1000
  // The cap is scheduled before the silence watchdog, so at a tie it wins.
  setTimer(h, 'cap', capMs, () => endSession(h, 'cap'))
  setTimer(h, 'warn', Math.max(0, capMs - WARN_BEFORE_CAP_MS), () => h.options.onWarning?.(CAP_WARNING))
  h.timers = { ...h.timers, ticker: setInterval(() => tick(h), TICK_MS) }
  resetSilence(h)
}

function addPageListeners(h: Handles): void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (h.timers.hidden === null) setTimer(h, 'hidden', HIDDEN_MS, () => endSession(h, 'hidden'))
    } else {
      setTimer(h, 'hidden', null, () => undefined)
    }
  }
  const onPageHide = () => endSession(h, 'hidden')
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onPageHide)
  h.removeListeners = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('beforeunload', onPageHide)
  }
}

function goLive(h: Handles): void {
  if (h.live) return
  h.live = true
  h.startedAt = Date.now()
  patchView(h, { phase: 'live', elapsedSec: 0 })
  startLiveTimers(h)
}

// ── Tool calls ────────────────────────────────────────────────────────────────

function parseArguments(raw: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (raw === undefined || raw.trim().length === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

function runToolSafely(h: Handles, name: string, rawArguments: string | undefined): VoiceToolResult {
  const args = parseArguments(rawArguments)
  if (!args.ok) return BAD_ARGUMENTS
  try {
    return h.options.runTool(name, args.value)
  } catch (error) {
    reportError({
      message: `Nex Assistant: tool ${name} threw`,
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { tool: name },
    })
    return TOOL_FAILED
  }
}

/** Answer each function call not answered yet, then ask once for the model to go on. */
function answerCalls(h: Handles, output: readonly ResponseOutputItem[]): void {
  let answered = 0
  for (const item of output) {
    if (item.type !== 'function_call' || !item.call_id || !item.name || h.answered.has(item.call_id)) continue
    h.answered = new Set([...h.answered, item.call_id])
    const result = runToolSafely(h, item.name, item.arguments)
    h.client?.send(functionOutputItem(item.call_id, JSON.stringify(result)))
    answered += 1
  }
  if (answered > 0) h.client?.send(responseCreate())
}

function handleEvent(h: Handles, attempt: number, event: ServerEvent): void {
  if (isStale(h, attempt)) return
  updateView(h, (view) => ({ ...view, transcript: reduceTranscript(view.transcript, event) }))
  switch (event.type) {
    case 'session.created':
      goLive(h)
      return
    case 'input_audio_buffer.speech_started':
    case 'response.created':
      resetSilence(h)
      return
    case 'response.done':
      resetSilence(h)
      h.usage = addUsage(h.usage, event.response.usage)
      answerCalls(h, event.response.output)
      return
    case 'error':
      reportError({
        message: 'Nex Assistant: Realtime error event',
        metadata: { type: event.error.type ?? null, code: event.error.code ?? null, message: event.error.message ?? null },
      })
      return
    default:
      return
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function acquireMic(): Promise<{ stream: MediaStream } | { error: VoiceError }> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!devices || typeof devices.getUserMedia !== 'function') return { error: voiceError('no-mic') }
  try {
    return { stream: await devices.getUserMedia(MIC_CONSTRAINTS) }
  } catch (error) {
    return { error: micError(error) }
  }
}

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

async function connectClient(h: Handles, attempt: number, session: StartVoiceSession): Promise<RealtimeClientLike> {
  const client = h.options.createClient?.() ?? new RealtimeClient()
  h.client = client
  await client.connect({
    clientSecret: session.clientSecret,
    micStream: h.mic,
    audioEl: h.audioRef.current,
    onEvent: (event) => handleEvent(h, attempt, event),
    onClose: () => {
      if (!isStale(h, attempt)) endSession(h, 'channel')
    },
  })
  return client
}

async function mintAndConnect(h: Handles, attempt: number, retried: boolean): Promise<void> {
  patchView(h, { phase: 'minting' })
  let session: StartVoiceSession
  try {
    session = await startVoiceSession()
  } catch (error) {
    if (!isStale(h, attempt)) fail(h, startError(error, isOnline()))
    return
  }
  if (isStale(h, attempt)) {
    const reason = h.endReason
    return closeOnServer(session.sessionId, ZERO_USAGE, reason, reason === 'hidden' || reason === 'unmount')
  }
  h.sessionId = session.sessionId
  h.maxSeconds = session.maxSeconds
  patchView(h, { phase: 'connecting', budget: session.budget, maxSeconds: session.maxSeconds })
  try {
    await connectClient(h, attempt, session)
  } catch (error) {
    if (isStale(h, attempt)) return
    const kind = error instanceof RealtimeConnectError ? error.kind : 'connect-failed'
    if (kind !== 'expired' || retried) return fail(h, voiceError(kind))
    h.client = null
    closeOnServer(h.sessionId, h.usage, 'error', false)
    h.sessionId = null
    return mintAndConnect(h, attempt, true)
  }
}

function resetForStart(h: Handles, textOnly: boolean): number {
  h.active = true
  h.live = false
  h.attempt += 1
  h.textOnly = textOnly
  h.muted = false
  h.usage = ZERO_USAGE
  h.answered = new Set()
  h.sessionId = null
  h.maxSeconds = null
  h.textSeq = 0
  updateView(h, () => ({ ...INITIAL_VIEW, textOnly, phase: textOnly ? 'minting' : 'requesting-mic' }))
  addPageListeners(h)
  return h.attempt
}

export async function startSession(h: Handles, opts: StartVoiceOptions | undefined): Promise<void> {
  if (h.active) return
  const attempt = resetForStart(h, opts?.textOnly === true)
  if (!isOnline()) return fail(h, voiceError('offline'))
  if (!h.textOnly) {
    const mic = await acquireMic()
    if (isStale(h, attempt)) {
      if ('stream' in mic) for (const track of mic.stream.getTracks()) track.stop()
      return
    }
    if ('error' in mic) return fail(h, mic.error)
    h.mic = mic.stream
  }
  await mintAndConnect(h, attempt, false)
}

// ── Live controls ─────────────────────────────────────────────────────────────

export function sendText(h: Handles, text: string): void {
  const trimmed = text.trim()
  if (trimmed.length === 0 || !h.live || !h.client) return
  h.textSeq += 1
  const id = `nexu_${Date.now().toString(36)}_${h.textSeq}`
  h.client.send(userTextItem(trimmed, id))
  h.client.send(responseCreate())
  const entry: TranscriptEntry = { id, role: 'user', text: trimmed, final: true }
  updateView(h, (view) => ({
    ...view,
    transcript: { ...view.transcript, entries: [...view.transcript.entries, entry] },
  }))
  resetSilence(h)
}

export function toggleMute(h: Handles): void {
  if (!h.active || h.textOnly || !h.mic || !h.client) return
  h.muted = !h.muted
  h.client.setMuted(h.muted)
  patchView(h, { muted: h.muted })
}

export function createHandles(options: UseVoiceSessionOptions, setView: Handles['setView'], audioRef: Handles['audioRef']): Handles {
  return {
    attempt: 0,
    active: false,
    live: false,
    textOnly: false,
    muted: false,
    client: null,
    mic: null,
    sessionId: null,
    maxSeconds: null,
    usage: ZERO_USAGE,
    answered: new Set(),
    timers: NO_TIMERS,
    startedAt: 0,
    textSeq: 0,
    removeListeners: null,
    endReason: 'user',
    mounted: true,
    options,
    setView,
    audioRef,
  }
}

