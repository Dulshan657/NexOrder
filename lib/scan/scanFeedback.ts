// Telling the operator what the APP thought of a scan.
//
// The gun beeps on every successful decode. That beep means "I read a barcode"
// and nothing more — it is identical for a bin the task wanted, a bin on the
// wrong aisle, and a code this system has never heard of. An operator who has
// learned to trust it will walk away from a refused scan believing the work is
// recorded.
//
// So the app needs its own voice, and it has to be audible: at a rack face the
// operator is looking at the shelf, not the screen. Accept and reject are
// deliberately different in KIND, not just in pitch — a short clean blip against
// a low descending buzz — so they are told apart at a glance of the ear, through
// ear defenders, without anyone having learned a convention.
//
// Synthesised rather than shipped as audio files: two tones are a few lines of
// WebAudio, and an asset would need hosting, a CSP entry and a cache story.
//
// EVERYTHING HERE MUST FAIL SILENTLY. These calls sit inside scan handlers. A
// browser with no AudioContext, a suspended context, a locked-down iframe or a
// full-up audio device must cost the operator a sound, never the scan.

const MUTE_KEY = 'nexorder.scan.muted'

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null
let contextUnavailable = false

function audioContext(): AudioContext | null {
  if (contextUnavailable) return null
  if (context) return context
  try {
    const Ctor: AudioContextCtor | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext
    if (!Ctor) {
      contextUnavailable = true
      return null
    }
    context = new Ctor()
    return context
  } catch {
    contextUnavailable = true
    return null
  }
}

/**
 * Wake the audio context on a real user gesture.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * so a page loaded and scanned before any click is SILENT FOR THAT FIRST SCAN.
 * There is no fix for that which is not autoplay abuse — which is exactly why
 * the visual flash must never be the channel that gets dropped. Call this from
 * a `pointerdown`/`keydown` listener so the second scan onwards is audible.
 */
export function primeScanAudio(): void {
  try {
    const ctx = audioContext()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Nothing to do — the tones will simply stay silent.
  }
}

export function isScanSoundMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setScanSoundMuted(muted: boolean): void {
  try {
    if (muted) globalThis.localStorage?.setItem(MUTE_KEY, '1')
    else globalThis.localStorage?.removeItem(MUTE_KEY)
  } catch {
    // A browser with storage disabled simply cannot remember the preference.
  }
}

interface Tone {
  /** Hz at the start of the note. */
  readonly from: number
  /** Hz at the end — equal to `from` for a flat note. */
  readonly to: number
  readonly durationMs: number
  readonly type: OscillatorType
  /** Seconds after the call before this note starts. */
  readonly delayS: number
  readonly gain: number
}

function play(tones: readonly Tone[]): void {
  if (isScanSoundMuted()) return
  const ctx = audioContext()
  if (!ctx) return

  try {
    // A keydown from the gun IS a user gesture, so this resolves in practice on
    // the very first scan. It is fire-and-forget: if the policy refuses, the
    // scheduled notes are simply never heard.
    if (ctx.state === 'suspended') void ctx.resume()

    const start = ctx.currentTime
    for (const tone of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = start + tone.delayS
      const end = at + tone.durationMs / 1000

      osc.type = tone.type
      osc.frequency.setValueAtTime(tone.from, at)
      if (tone.to !== tone.from) osc.frequency.linearRampToValueAtTime(tone.to, end)

      // Ramp both edges. A square wave switched on at full gain clicks, and a
      // click is exactly the kind of noise an operator learns to ignore.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(tone.gain, at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(end + 0.02)
    }
  } catch {
    // Never let a missing sound break a scan.
  }
}

/** The app accepted the code. One short, clean, high blip. */
export function playScanAccept(): void {
  play([{ from: 1320, to: 1320, durationMs: 70, type: 'sine', delayS: 0, gain: 0.16 }])
}

/**
 * The app refused the code — wrong bin, unknown code, nothing waiting on it.
 * Low, buzzing and falling: the opposite of accept along every axis so the two
 * can never be confused in a noisy aisle.
 */
export function playScanReject(): void {
  play([
    { from: 240, to: 180, durationMs: 120, type: 'square', delayS: 0, gain: 0.1 },
    { from: 190, to: 130, durationMs: 160, type: 'square', delayS: 0.13, gain: 0.1 },
  ])
}

/**
 * Something was scanned while nothing was listening for it — the stray-scan
 * case the global wedge listener exists to catch. Deliberately neither of the
 * two above: it is not a refusal, it is "say that again somewhere useful".
 */
export function playScanStray(): void {
  play([
    { from: 660, to: 660, durationMs: 60, type: 'triangle', delayS: 0, gain: 0.12 },
    { from: 660, to: 660, durationMs: 60, type: 'triangle', delayS: 0.09, gain: 0.12 },
  ])
}

/**
 * Whether the operator has asked the OS for less animation. The flash is a
 * secondary channel — the sound and the text both still land — so honouring
 * this costs nothing.
 */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}
