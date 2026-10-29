// How loud a MediaStream is right now, for Nex Assistant's orb.
//
// stream -> MediaStreamAudioSourceNode -> AnalyserNode, and NOWHERE ELSE. The
// analyser is never connected to the context's destination: the model's voice
// already plays through the sheet's <audio> element, so wiring it on would play
// it twice. (Chrome only feeds a remote WebRTC stream into Web Audio while that
// stream is also attached to a media element, which it is.)
//
// read() is called from the orb's animation frame, never from React state, so a
// 60 fps level does not re-render the sheet. One AudioContext serves the page.

import { rms, rmsToLevel, smoothLevel } from './levelSmoothing'

const FFT_SIZE = 512

export interface LevelMeter {
  readonly stream: MediaStream
  /** Smoothed loudness, 0..1. 0 once closed. */
  read(): number
  close(): void
}

let sharedContext: AudioContext | null = null

/** The page's one AudioContext, created on first use; null where Web Audio is missing. */
export function pageAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext
  const Ctor = typeof AudioContext === 'undefined' ? null : AudioContext
  if (!Ctor) return null
  try {
    sharedContext = new Ctor()
  } catch {
    return null
  }
  return sharedContext
}

export function createLevelMeter(stream: MediaStream, ctx: AudioContext | null = pageAudioContext()): LevelMeter | null {
  if (!ctx) return null
  // Created after the tap that started the session, so the page has a user
  // activation and resume() is allowed; a refusal only means a still orb.
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)

  let source: MediaStreamAudioSourceNode
  try {
    source = ctx.createMediaStreamSource(stream)
  } catch {
    return null
  }
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  analyser.smoothingTimeConstant = 0
  source.connect(analyser)

  const samples = new Float32Array(FFT_SIZE)
  let level = 0
  let closed = false

  return {
    stream,
    read() {
      if (closed) return 0
      analyser.getFloatTimeDomainData(samples)
      level = smoothLevel(level, rmsToLevel(rms(samples)))
      return level
    },
    close() {
      if (closed) return
      closed = true
      level = 0
      source.disconnect()
      analyser.disconnect()
    },
  }
}
