// Telling a scanner gun apart from a person, by timing alone.
//
// A keyboard-wedge gun is not a scanner as far as the browser is concerned — it
// is a keyboard that types very fast and then presses a key. There is no event,
// no device id and no flag that says "this came from a gun". The ONLY signal
// available is how quickly the characters arrive, so that is what this module
// reads.
//
// It is deliberately pure: no DOM, no React, no timers. State goes in, state and
// an outcome come out. `useWedgeScanner.ts` owns the listener and the idle timer
// and does nothing else, which is what lets the interesting half be tested
// without a jsdom document — the same split as `_shared/binCount.ts` and
// `_shared/wie/*`.
//
// ── USE event.timeStamp, NEVER Date.now() ───────────────────────────────────
//
// The caller must pass `event.timeStamp`, which the browser stamps when the
// event is CREATED, not when JS gets around to handling it. A busy render can
// delay dispatch by tens of milliseconds; if we measured with Date.now() inside
// the handler, a genuine 5 ms gun burst delivered behind a slow re-render would
// measure as human typing and be thrown away. The OS-stamped times stay correct
// no matter how late we read them.

/**
 * The gap above which two characters cannot have come from the same scan.
 *
 * A wedge gun emits at roughly 2–20 ms per character. Sustained human typing at
 * 120 wpm is about 100 ms per character, and even a burst across the home row
 * rarely dips below 60 ms. 50 ms sits in the empty space between the two and is
 * the threshold warehouse software has converged on.
 */
export const WEDGE_MAX_INTERKEY_MS = 50

/**
 * Shortest run we will ever treat as a code.
 *
 * The shortest real code in the system is a warehouse root — `MAIN`, `NEXG`,
 * `TEST` — at four characters; handling units are nine and SKUs longer still.
 * Three is set just below that so a genuinely short site code still works, while
 * a stray keypress or two can never commit.
 */
export const WEDGE_MIN_SCAN_LENGTH = 3

/**
 * How long a complete-looking buffer waits before committing itself.
 *
 * This is the path for a gun configured with NO suffix, which is a common
 * factory default and was previously unsupported entirely. It must sit
 * comfortably above WEDGE_MAX_INTERKEY_MS so that it can never fire in the
 * middle of a burst that is still arriving.
 */
export const WEDGE_FLUSH_IDLE_MS = 120

/**
 * Longest run we will ever treat as a code.
 *
 * The longest code the system prints is around 24 characters. This is not a
 * validation rule — it is a guard against a held key or a paste repeating fast
 * enough to look like a burst. An overrun discards the WHOLE buffer rather than
 * truncating: half a location code is a different, possibly real, location.
 */
export const WEDGE_MAX_SCAN_LENGTH = 64

/**
 * Keys that are part of typing a character rather than a character themselves.
 * Seeing one must NOT break the run — `Shift` keydown precedes every capital
 * letter a gun sends, so abandoning on it would break every mixed-case code.
 */
const PASSTHROUGH_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Unidentified',
  'Process',
])

/** Keys a gun uses to say "code finished". */
const TERMINATOR_KEYS: ReadonlySet<string> = new Set(['Enter', 'Tab'])

/**
 * The subset of a KeyboardEvent this module reads. Declared structurally rather
 * than as KeyboardEvent so tests can drive it with plain objects and so the
 * module stays free of DOM lib types.
 */
export interface WedgeKey {
  readonly key: string
  /** MUST be `event.timeStamp` — see the header. */
  readonly timeStamp: number
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly altKey?: boolean
  /** `event.getModifierState('AltGraph')`. */
  readonly altGraph?: boolean
}

export interface WedgeBuffer {
  readonly chars: readonly string[]
  readonly lastAt: number
}

export type WedgeOutcome =
  /** Not our business — the run is untouched. */
  | { readonly action: 'ignore' }
  /**
   * Character accepted into the run. `claim` asks the caller to
   * `preventDefault()`: true only from the SECOND character onward, because the
   * first cannot yet be known to belong to a burst. This is what stops a code
   * containing a space from activating whatever button happens to be focused,
   * without stealing ordinary keystrokes from the page.
   */
  | { readonly action: 'buffered'; readonly claim: boolean }
  /** A run ended and qualified as a scan. */
  | { readonly action: 'commit'; readonly code: string; readonly via: 'enter' | 'tab' | 'idle' }
  /** A run ended and did not qualify, or was interrupted. */
  | { readonly action: 'discard'; readonly reason: DiscardReason }

export type DiscardReason =
  /** Fewer than WEDGE_MIN_SCAN_LENGTH characters had accumulated. */
  | 'too-short'
  /** More than WEDGE_MAX_SCAN_LENGTH — a held key or a paste, not a label. */
  | 'too-long'
  /** A modifier combo (Ctrl+C, Cmd+V) — a person driving the keyboard. */
  | 'modifier'
  /** An editing or navigation key. A gun sends none of these. */
  | 'control-key'
  /** Outside printable ASCII. Code 128 Set B cannot encode it, so we never printed it. */
  | 'non-ascii'

export const emptyWedgeBuffer: WedgeBuffer = { chars: [], lastAt: 0 }

const IGNORED: WedgeOutcome = { action: 'ignore' }

/** Code 128 Set B — exactly what `_shared/labels/code128.ts` can encode. */
const PRINTABLE_ASCII = /^[\x20-\x7E]$/

interface WedgeStep {
  readonly next: WedgeBuffer
  readonly outcome: WedgeOutcome
}

function ended(buffer: WedgeBuffer, via: 'enter' | 'tab' | 'idle'): WedgeStep {
  if (buffer.chars.length < WEDGE_MIN_SCAN_LENGTH) {
    return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'too-short' } }
  }
  return {
    next: emptyWedgeBuffer,
    outcome: { action: 'commit', code: buffer.chars.join(''), via },
  }
}

/**
 * Feed one keydown at the buffer.
 *
 * A gap wider than WEDGE_MAX_INTERKEY_MS RESTARTS the run at that character
 * rather than discarding it. That is what lets someone scan immediately after
 * typing, and it is also why the buffer needs no "was this run fast" flag: a
 * slow gap can never survive inside a run, so any run that reaches a terminator
 * is fast by construction.
 */
export function feedWedgeKey(buffer: WedgeBuffer, event: WedgeKey): WedgeStep {
  const { key } = event

  if (PASSTHROUGH_KEYS.has(key)) return { next: buffer, outcome: IGNORED }

  // AltGr is reported on Windows as ctrl+alt together, and it is how a European
  // layout types characters that appear in real codes. Anything else with a
  // modifier down is a person using a shortcut.
  const altGraph = event.altGraph === true
  if (!altGraph && (event.ctrlKey === true || event.metaKey === true || event.altKey === true)) {
    return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'modifier' } }
  }

  if (TERMINATOR_KEYS.has(key)) {
    const gap = event.timeStamp - buffer.lastAt
    // The terminator has to be part of the same burst. A person who types four
    // fast characters and then reaches for Enter is not scanning.
    if (buffer.chars.length === 0 || gap > WEDGE_MAX_INTERKEY_MS) {
      return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'too-short' } }
    }
    return ended(buffer, key === 'Tab' ? 'tab' : 'enter')
  }

  if (key.length !== 1) {
    // Escape, Backspace, arrows, F-keys. A gun sends none of them, and a person
    // pressing one means the run in progress was never a scan.
    return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'control-key' } }
  }

  if (!PRINTABLE_ASCII.test(key)) {
    // An IME or an accented layout. We could never have PRINTED this character,
    // so it cannot be part of one of our labels.
    return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'non-ascii' } }
  }

  const gap = event.timeStamp - buffer.lastAt
  const continues = buffer.chars.length > 0 && gap <= WEDGE_MAX_INTERKEY_MS
  const chars = continues ? [...buffer.chars, key] : [key]

  if (chars.length > WEDGE_MAX_SCAN_LENGTH) {
    return { next: emptyWedgeBuffer, outcome: { action: 'discard', reason: 'too-long' } }
  }

  return {
    next: { chars, lastAt: event.timeStamp },
    // Claim from the second character on — see WedgeOutcome. The first
    // character of a run is indistinguishable from an ordinary keypress, and
    // swallowing it would break find-as-you-type and every keyboard shortcut.
    outcome: { action: 'buffered', claim: chars.length > 1 },
  }
}

/** Has a suffix-less gun's burst gone quiet long enough to be complete? */
export function wedgeBufferIsIdle(buffer: WedgeBuffer, now: number): boolean {
  return buffer.chars.length > 0 && now - buffer.lastAt >= WEDGE_FLUSH_IDLE_MS
}

/**
 * End the run because nothing more arrived. Only ever called by the hook's idle
 * timer; a run this short is discarded exactly as a terminated one would be.
 */
export function flushWedgeBuffer(buffer: WedgeBuffer): WedgeStep {
  if (buffer.chars.length === 0) return { next: buffer, outcome: IGNORED }
  return ended(buffer, 'idle')
}
