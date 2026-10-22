// React glue for Nex Assistant's session state machine (lib/voice/voiceSession.ts,
// which documents the phases, the re-mint, the timers and the teardown).
//
// Every mutable handle lives in ONE ref (`Handles`, created once); what renders
// lives in ONE immutable state object. Unmounting ends the session ('unmount').

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveState, TranscriptEntry } from '@/lib/voice/transcript'
import type { VoiceError } from '@/lib/voice/voiceErrors'
import type { VoiceEndReason } from '@/services/supabase/voiceSessionService'
import {
  INITIAL_VIEW,
  createHandles,
  endSession,
  readLevel,
  sendText,
  startSession,
  toggleMute,
} from '@/lib/voice/voiceSession'
import type { Handles, LevelSource, StartVoiceOptions, UseVoiceSessionOptions, ViewState, VoiceBudget, VoicePhase } from '@/lib/voice/voiceSession'

export type { VoiceError, VoiceErrorKind } from '@/lib/voice/voiceErrors'
export type { VoiceEndReason } from '@/services/supabase/voiceSessionService'
export type { LevelSource, StartVoiceOptions, UseVoiceSessionOptions, VoiceBudget, VoicePhase } from '@/lib/voice/voiceSession'
export { CAP_WARNING } from '@/lib/voice/voiceSession'

export interface VoiceSessionApi {
  phase: VoicePhase
  live: LiveState
  muted: boolean
  /** True for a text-only session (hide the Mute button). */
  textOnly: boolean
  transcript: readonly TranscriptEntry[]
  error: VoiceError | null
  budget: VoiceBudget | null
  maxSeconds: number | null
  elapsedSec: number
  start(opts?: StartVoiceOptions): Promise<void>
  end(reason?: VoiceEndReason): Promise<void>
  toggleMute(): void
  sendText(text: string): void
  /** Loudness 0..1 of the rep's mic or the model's voice, for the orb. Call per frame, not per render. */
  getLevel(source: LevelSource): number
  /** Attach to an <audio autoPlay playsInline> element; the model's voice plays there. */
  audioRef: { current: HTMLAudioElement | null }
}

export function useVoiceSession(options: UseVoiceSessionOptions): VoiceSessionApi {
  const [view, setView] = useState<ViewState>(INITIAL_VIEW)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const handles = useRef<Handles | null>(null)
  if (handles.current === null) handles.current = createHandles(options, setView, audioRef)
  const h = handles.current

  useEffect(() => {
    h.options = options
  })

  useEffect(() => {
    h.mounted = true
    return () => {
      h.mounted = false
      endSession(h, 'unmount')
    }
  }, [h])

  const start = useCallback((opts?: StartVoiceOptions) => startSession(h, opts), [h])
  const end = useCallback(async (reason: VoiceEndReason = 'user') => endSession(h, reason), [h])
  const mute = useCallback(() => toggleMute(h), [h])
  const send = useCallback((text: string) => sendText(h, text), [h])
  const getLevel = useCallback((source: LevelSource) => readLevel(h, source), [h])

  return {
    phase: view.phase,
    live: view.transcript.live,
    muted: view.muted,
    textOnly: view.textOnly,
    transcript: view.transcript.entries,
    error: view.error,
    budget: view.budget,
    maxSeconds: view.maxSeconds,
    elapsedSec: view.elapsedSec,
    start,
    end,
    toggleMute: mute,
    sendText: send,
    getLevel,
    audioRef,
  }
}
