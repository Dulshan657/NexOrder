// What Nex Assistant's orb draws, as a pure function of the session's state.
// The tone is voiceStatus's own, so the orb and the status pill cannot disagree.
//
//   requesting-mic / minting / connecting -> connecting  (a constellation wiring itself)
//   live listening                        -> listening   (a wave, driven by the mic)
//   live thinking                         -> working     (orbiting particles)
//   live speaking                         -> composing   (a sash, driven by its voice)
//   idle / ending / ended / text-only     -> breathing   (a slow ring)
//   error                                 -> breathing, frozen

import type { OrbState } from 'thinking-orbs/engine'
import type { VoicePhase } from '@/lib/voice/voiceSession'
import type { LiveState } from '@/lib/voice/transcript'
import type { VoiceError } from '@/lib/voice/voiceErrors'
import { voiceStatus } from './voiceStatus'
import type { StatusTone } from './voiceStatus'

/** Whose loudness drives the orb: the rep's mic, the model's voice, or nobody's. */
export type OrbAudio = 'mic' | 'remote' | null

export interface OrbVisual {
  readonly state: OrbState
  readonly tone: StatusTone
  readonly audio: OrbAudio
  /** Hold one still frame (an error is not a thing in progress). */
  readonly frozen: boolean
}

interface Motion {
  readonly state: OrbState
  readonly audio: OrbAudio
}

const RESTING: Motion = { state: 'breathing', audio: null }
const CONNECTING: Motion = { state: 'connecting', audio: null }

const LIVE_MOTION: Readonly<Record<LiveState, Motion>> = {
  listening: { state: 'listening', audio: 'mic' },
  thinking: { state: 'working', audio: null },
  speaking: { state: 'composing', audio: 'remote' },
}

function motion(phase: VoicePhase, live: LiveState, textOnly: boolean): Motion {
  if (phase === 'live') return textOnly && live === 'listening' ? RESTING : LIVE_MOTION[live]
  if (phase === 'requesting-mic' || phase === 'minting' || phase === 'connecting') return CONNECTING
  return RESTING
}

export function orbVisual(phase: VoicePhase, live: LiveState, error: VoiceError | null, textOnly = false): OrbVisual {
  const { state, audio } = motion(phase, live, textOnly)
  return { state, audio, tone: voiceStatus(phase, live, error, textOnly).tone, frozen: phase === 'error' }
}
