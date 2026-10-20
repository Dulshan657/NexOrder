// What the assistant sheet says about the session, as pure functions of the
// session's state. Kept out of the components so every phase, every error kind
// and every number format is one table, not a scatter of ternaries.

import type { VoiceBudget, VoicePhase } from '@/lib/voice/voiceSession'
import type { LiveState } from '@/lib/voice/transcript'
import type { VoiceError, VoiceErrorKind } from '@/lib/voice/voiceErrors'

/** The colour of the status dot: emerald listening, amber busy, blue speaking. */
export type StatusTone = 'emerald' | 'amber' | 'blue' | 'stone' | 'rose'

export interface VoiceStatus {
  readonly label: string
  readonly tone: StatusTone
  /** The dot pulses while something is happening. */
  readonly pulse: boolean
}

/** A short title per error kind; the sentence under it is VoiceError.message. */
export const ERROR_TITLES: Readonly<Record<VoiceErrorKind, string>> = {
  'mic-denied': 'Microphone blocked',
  'no-mic': 'No microphone',
  offline: 'Offline',
  'rate-limited': 'Too many sessions',
  budget: 'Daily limit reached',
  'module-off': 'Not enabled',
  forbidden: 'Not available',
  upstream: 'Assistant unavailable',
  'connect-failed': 'Could not connect',
  expired: 'Connection timed out',
}

/** Kinds a second attempt cannot fix: the budget resets tomorrow, the others never. */
const NOT_RETRYABLE: ReadonlySet<VoiceErrorKind> = new Set<VoiceErrorKind>(['budget', 'module-off', 'forbidden'])

/** Kinds where typing still works: the session can run without a mic. */
const MIC_KINDS: ReadonlySet<VoiceErrorKind> = new Set<VoiceErrorKind>(['mic-denied', 'no-mic'])

const LIVE_STATUS: Readonly<Record<LiveState, VoiceStatus>> = {
  listening: { label: 'Listening', tone: 'emerald', pulse: true },
  thinking: { label: 'Thinking', tone: 'amber', pulse: true },
  speaking: { label: 'Speaking', tone: 'blue', pulse: true },
}

const PHASE_STATUS: Readonly<Record<Exclude<VoicePhase, 'live' | 'error'>, VoiceStatus>> = {
  idle: { label: 'Starting', tone: 'amber', pulse: false },
  'requesting-mic': { label: 'Requesting microphone', tone: 'amber', pulse: true },
  minting: { label: 'Connecting', tone: 'amber', pulse: true },
  connecting: { label: 'Connecting', tone: 'amber', pulse: true },
  ending: { label: 'Ending', tone: 'stone', pulse: false },
  ended: { label: 'Ended', tone: 'stone', pulse: false },
}

export function voiceStatus(phase: VoicePhase, live: LiveState, error: VoiceError | null): VoiceStatus {
  if (phase === 'live') return LIVE_STATUS[live]
  if (phase === 'error') return { label: error ? ERROR_TITLES[error.kind] : 'Something went wrong', tone: 'rose', pulse: false }
  return PHASE_STATUS[phase]
}

export function isRetryable(kind: VoiceErrorKind): boolean {
  return !NOT_RETRYABLE.has(kind)
}

export function canTypeInstead(kind: VoiceErrorKind): boolean {
  return MIC_KINDS.has(kind)
}

/** The phases in which a session is under way and End means something. */
export function isActivePhase(phase: VoicePhase): boolean {
  return phase === 'requesting-mic' || phase === 'minting' || phase === 'connecting' || phase === 'live'
}

/** 65 -> "1:05". */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * "3/30 min today": what the day's budget had used when this session was minted,
 * plus this session so far, in whole minutes. Null before the mint reports one.
 */
export function minutesToday(budget: VoiceBudget | null, elapsedSec: number): string | null {
  if (!budget) return null
  const used = Math.floor((budget.usedSeconds + Math.max(0, elapsedSec)) / 60)
  const daily = Math.round(budget.dailySeconds / 60)
  return `${Math.min(used, daily)}/${daily} min today`
}
