// What the orb shows for each session state. One table, read beside voiceStatus,
// so the orb and the status pill can never tell the rep two different things.

import { describe, expect, it } from 'vitest'
import { orbVisual } from '@/components/voice/orbState'
import { voiceStatus } from '@/components/voice/voiceStatus'
import type { VoicePhase } from '@/lib/voice/voiceSession'
import type { LiveState } from '@/lib/voice/transcript'
import { voiceError } from '@/lib/voice/voiceErrors'

const PHASES: readonly VoicePhase[] = ['idle', 'requesting-mic', 'minting', 'connecting', 'live', 'ending', 'ended', 'error']
const LIVES: readonly LiveState[] = ['listening', 'thinking', 'speaking']

describe('orbVisual', () => {
  it('maps every session state to its orb', () => {
    const shown = (phase: VoicePhase, live: LiveState, textOnly = false) => {
      const v = orbVisual(phase, live, phase === 'error' ? voiceError('offline') : null, textOnly)
      return [v.state, v.audio, v.frozen]
    }
    expect(shown('requesting-mic', 'listening')).toEqual(['connecting', null, false])
    expect(shown('minting', 'listening')).toEqual(['connecting', null, false])
    expect(shown('connecting', 'listening')).toEqual(['connecting', null, false])
    expect(shown('live', 'listening')).toEqual(['listening', 'mic', false])
    expect(shown('live', 'thinking')).toEqual(['working', null, false])
    expect(shown('live', 'speaking')).toEqual(['composing', 'remote', false])
    // Text-only has no mic: it waits for typing, but the model still answers aloud.
    expect(shown('live', 'listening', true)).toEqual(['breathing', null, false])
    expect(shown('live', 'speaking', true)).toEqual(['composing', 'remote', false])
    expect(shown('idle', 'listening')).toEqual(['breathing', null, false])
    expect(shown('ending', 'listening')).toEqual(['breathing', null, false])
    expect(shown('ended', 'listening')).toEqual(['breathing', null, false])
    expect(shown('error', 'speaking')).toEqual(['breathing', null, true])
  })

  it('agrees with the status pill\'s tone for every input', () => {
    for (const phase of PHASES) {
      for (const live of LIVES) {
        for (const textOnly of [false, true]) {
          for (const error of [null, voiceError('mic-denied')]) {
            expect(orbVisual(phase, live, error, textOnly).tone).toBe(voiceStatus(phase, live, error, textOnly).tone)
          }
        }
      }
    }
  })
})
