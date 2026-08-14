/**
 * Code 128 encoding — the module every warehouse label now rests on.
 *
 * A wrong barcode is worse than no barcode: it scans cleanly and names the wrong
 * bin. So this suite checks the encoder three independent ways, because no single
 * one of them is sufficient on its own.
 *
 *  1. STRUCTURAL INVARIANTS on the pattern table. The table is 107 hand-
 *     transcribed six-digit patterns and transcription is exactly where a silent
 *     error would live. Code 128 characters have a property that makes typos
 *     detectable without a second copy of the table: every character is 3 bars +
 *     3 spaces summing to 11 modules, and the BAR widths always sum to an even
 *     number. A mistyped digit breaks one of those almost every time.
 *
 *  2. REFERENCE VECTORS computed by hand from the specification — both as symbol
 *     VALUES (which catch checksum and mode-switch errors) and, for one short
 *     code, as the exact bar-width sequence (which catches table errors).
 *
 *  3. ROUND TRIP through a decoder written here, independently of the encoder.
 *     It shares the pattern table — so it cannot catch a table typo, which is
 *     what (1) and (2) are for — but it exercises every mode switch, the
 *     checksum and the element ordering over a large generated corpus, which is
 *     where encoder logic actually goes wrong.
 */
import { describe, it, expect } from 'vitest'
import {
  CODE128_PATTERNS,
  STOP,
  START_B,
  START_C,
  CODE_B,
  CODE_C,
  QUIET_ZONE_MODULES,
  encodeCode128,
  code128Values,
  darkRuns,
} from '@/supabase/functions/_shared/labels/code128'

// ── 1. Structural invariants on the table ────────────────────────────

describe('the pattern table', () => {
  it('has all 107 code values', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(CODE128_PATTERNS.every((p) => typeof p === 'string')).toBe(true)
  })

  it('gives every character 6 elements summing to 11 modules', () => {
    // Value 106 is STOP and is the one exception: 7 elements, 13 modules.
    CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
      expect(pattern, `value ${value}`).toHaveLength(6)
      const widths = [...pattern].map(Number)
      expect(widths.reduce((a, b) => a + b, 0), `value ${value} module sum`).toBe(11)
    })
  })

  it('gives STOP 7 elements summing to 13 modules', () => {
    const stop = CODE128_PATTERNS[STOP]
    expect(stop).toHaveLength(7)
    expect([...stop].map(Number).reduce((a, b) => a + b, 0)).toBe(13)
  })

  it('uses only widths 1-4', () => {
    CODE128_PATTERNS.forEach((pattern, value) => {
      for (const ch of pattern) {
        expect(Number(ch), `value ${value} width`).toBeGreaterThanOrEqual(1)
        expect(Number(ch), `value ${value} width`).toBeLessThanOrEqual(4)
      }
    })
  })

  /**
   * The invariant that makes a hand-transcribed table checkable. Every Code 128
   * character's bars sum to an even number of modules — it is what lets a
   * scanner self-check each character. A single mistyped digit changes that sum
   * by an odd amount and trips this.
   */
  it('gives every character an even number of bar modules', () => {
    CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
      const widths = [...pattern].map(Number)
      const bars = widths[0] + widths[2] + widths[4]
      expect(bars % 2, `value ${value} bar parity`).toBe(0)
    })
  })

  it('has no duplicate patterns', () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length)
  })
})

// ── 2. Reference vectors ─────────────────────────────────────────────

describe('reference vectors', () => {
  /**
   * "Code128" in Code Set B.
   *   START B 104, C 35, o 79, d 68, e 69, 1 17, 2 18, 8 24
   *   check = (104 + 1*35 + 2*79 + 3*68 + 4*69 + 5*17 + 6*18 + 7*24) mod 103
   *         = 1138 mod 103 = 5
   */
  it('encodes "Code128" with checksum 5', () => {
    expect(code128Values('Code128')).toEqual([104, 35, 79, 68, 69, 17, 18, 24, 5, STOP])
  })

  /**
   * "1234567890" is ten leading digits, so it starts in Code Set C.
   *   START C 105, 12, 34, 56, 78, 90
   *   check = (105 + 1*12 + 2*34 + 3*56 + 4*78 + 5*90) mod 103 = 1115 mod 103 = 85
   */
  it('encodes a long digit string in Set C', () => {
    expect(code128Values('1234567890')).toEqual([105, 12, 34, 56, 78, 90, 85, STOP])
  })

  /**
   * The exact bar widths for a one-character code, composed by hand from the
   * table. This is the check that a table typo cannot survive.
   *   START B 104 -> 211214
   *   'A'     33  -> 111323
   *   check = (104 + 33) mod 103 = 34 -> 131123
   *   STOP    106 -> 2331112
   */
  it('produces the exact bar sequence for "A"', () => {
    const { bars, modules } = encodeCode128('A')
    expect(bars.join('')).toBe('211214' + '111323' + '131123' + '2331112')
    expect(modules).toBe(11 + 11 + 11 + 13)
  })
})

// ── 2b. Third-party vectors ──────────────────────────────────────────

/**
 * Bar widths produced by bwip-js, an independent Code 128 implementation.
 *
 * Generated once during development and frozen here as literals — bwip-js is
 * NOT a dependency of this project and nothing installs it at test time. This
 * is the check the round-trip decoder structurally cannot perform: the decoder
 * shares our pattern table, so a mistyped table row round-trips perfectly.
 * These do not share it.
 *
 * The last five entries walk the whole printable ASCII range, so between them
 * they exercise almost every row of the table. The digit strings pin the Set B
 * to Set C switching heuristic against a reference implementation — including
 * `ABC-1234`, which switches only because the run reaches the end of the string.
 */
const THIRD_PARTY_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['1', '2112141232212232112331112'],
  ['12', '2112321122321222312331112'],
  ['123', '2112141232212232112211321322122331112'],
  ['1234', '2112321122321311231212412331112'],
  ['1234567', '2112321122321311233311211141313121311321312331112'],
  ['12345678', '2112321122321311233311212411121331212331112'],
  ['1234567890', '2112321122321311233311212411122141211242112331112'],
  ['A', '2112141113231311232331112'],
  ['Code128', '2112141313211341111412211122141232212232113112221312222331112'],
  ['Wikipedia', '2112143113211421122412111421121112421122141412211421121211244212112331112'],
  ['AMD-B-12-7-L3', '2112141113231131231123131221321311231221321232212232111221323121311221321321312211322122222331112'],
  ['NEXG-B-9-4-L4', '2112141133211321133311212113131221321311231221323211221221322212311221321321312212312141212331112'],
  ['MAIN-B-189-5-L5', '2112141131231113232313111133211221321311231221321232213112223211221221322132121221321321312132121141132331112'],
  ['HU-000123', '2112142311132131311221321131412122222221223121313221122331112'],
  ['HU-999999', '2112142311132131311221321131411131411131411131414113112331112'],
  ['A1234567890B', '2112141113231131411122321311233311212411122141211141311311231213222331112'],
  ['ABC-1234', '2112141113231311231313211221321131411122321311231311232331112'],
  ['AMD-STAGING-01', '2112141113231131231123131221322131132133111113232113132313111133212113131221321231221232212214112331112'],
  ['ZONE-CHILLER', '2112143123111331211133211321131221321313212311132313111321311321311321132311312412112331112'],
  [' !"#$%&\'()*+,-./', '2112142122222221222222211212231213221312221222131223121322122212132213122312121122321221321222311132222231122331112'],
  ['0123456789:;<=>?', '2112322221223121311131231411222121411141313212213122123221123222112121232123212113312331112'],
  ['@ABCDEFGHIJKLMNO', '2112142321211113231311231313211123131321131323112113132311132313111121331123311321311131231133211331213131212331112'],
  ['PQRSTUVWXYZ[]^_', '2112143131212113312311312131132133112131313111233113213311213121133123113321112214114311111112242231122331112'],
  ['`abcdefghijklmno', '2112141114221211241214211411221412211122141124121221141224111421121422112412112211144131112411121341111422112331112'],
  ['pqrstuvwxyz{|}~', '2112141112421211421212411142121241121242114112124211124212112121412141214121211111431113411311412212132331112'],
]

describe('agreement with an independent implementation', () => {
  it.each(THIRD_PARTY_VECTORS)('matches bwip-js for %j', (code, expected) => {
    expect(encodeCode128(code).bars.join('')).toBe(expected)
  })

  it('covers essentially the whole pattern table', () => {
    // Every symbol value the vectors above exercise, so a shrinking of that list
    // shows up as a failing count rather than as quietly reduced coverage.
    const covered = new Set<number>()
    for (const [code] of THIRD_PARTY_VECTORS) for (const v of code128Values(code)) covered.add(v)
    expect(covered.size).toBeGreaterThanOrEqual(100)
  })
})

// ── Real codes from this system ──────────────────────────────────────

describe('the codes this system actually prints', () => {
  it('keeps a location code in Set B and costs 178 modules', () => {
    // AMD-B-12-7-L3: digit runs are 2, 1 and 1 — none long enough to be worth
    // a switch to Set C, so it is start + 13 characters + check + stop.
    const { bars, modules } = encodeCode128('AMD-B-12-7-L3')
    expect(modules).toBe(11 * 15 + 13)
    expect(bars.reduce((a, b) => a + b, 0)).toBe(modules)
  })

  it('uses Set C for a handling-unit code and saves 22 modules', () => {
    // HU-000123 — the six-digit run is worth the switch.
    const withSetC = encodeCode128('HU-000123').modules
    expect(withSetC).toBe(11 * 9 + 13) // start, H, U, -, CODE C, 3 pairs, check
    // What it would have cost with no switch: start + 9 chars + check.
    expect(11 * 11 + 13 - withSetC).toBe(22)
  })

  it('encodes a rack level code', () => {
    expect(() => encodeCode128('NEXG-B-9-4-L4')).not.toThrow()
  })
})

// ── Structure of the emitted symbol ──────────────────────────────────

describe('emitted symbol structure', () => {
  const samples = ['A', 'AMD-B-12-7-L3', 'HU-000123', '1234567890', 'MAIN-STAGING-01']

  it.each(samples)('starts and ends with a bar: %s', (code) => {
    const { bars } = encodeCode128(code)
    // Elements alternate bar, space, bar, ... and every character contributes an
    // even count except STOP, which contributes 7 — so the last element is a bar.
    expect(bars.length % 2).toBe(1)
  })

  it.each(samples)('total width matches 11n + 13: %s', (code) => {
    const values = code128Values(code)
    const { modules } = encodeCode128(code)
    expect(modules).toBe(11 * (values.length - 1) + 13)
  })

  it.each(samples)('ends with the stop pattern: %s', (code) => {
    const { bars } = encodeCode128(code)
    expect(bars.slice(-7).join('')).toBe(CODE128_PATTERNS[STOP])
  })

  it('reserves a 10-module quiet zone', () => {
    expect(QUIET_ZONE_MODULES).toBe(10)
  })
})

// ── darkRuns: what the PDF renderer draws ────────────────────────────

describe('darkRuns', () => {
  const samples = ['A', 'AMD-B-12-7-L3', 'HU-000123', '1234567890']

  it.each(samples)('returns one run per bar: %s', (code) => {
    const symbol = encodeCode128(code)
    expect(darkRuns(symbol)).toHaveLength((symbol.bars.length + 1) / 2)
  })

  it.each(samples)('runs ascend, never overlap, and end at the symbol edge: %s', (code) => {
    const symbol = encodeCode128(code)
    const runs = darkRuns(symbol)
    let previousEnd = -1
    for (const run of runs) {
      expect(run.start).toBeGreaterThan(previousEnd)
      expect(run.width).toBeGreaterThanOrEqual(1)
      previousEnd = run.start + run.width
    }
    // The stop pattern's final element is the termination bar, so the last dark
    // run finishes flush with the symbol's right edge.
    expect(previousEnd).toBe(symbol.modules)
  })

  it('offsets are integers, so bar positions cannot drift', () => {
    // The renderer computes x as `origin + start * moduleWidth`. That is only
    // exact if start is an integer — a running float sum across 97 elements
    // would widen the last bars relative to the first, which is precisely what
    // a decoder measures.
    for (const run of darkRuns(encodeCode128('MAIN-B-189-5-L5'))) {
      expect(Number.isInteger(run.start)).toBe(true)
      expect(Number.isInteger(run.width)).toBe(true)
    }
  })

  it('reconstructs the original bar sequence', () => {
    const symbol = encodeCode128('AMD-B-12-7-L3')
    const dark = new Set<number>()
    for (const run of darkRuns(symbol)) {
      for (let m = run.start; m < run.start + run.width; m++) dark.add(m)
    }
    // Walk the alternation independently and confirm the same modules are dark.
    let offset = 0
    for (let i = 0; i < symbol.bars.length; i++) {
      for (let m = offset; m < offset + symbol.bars[i]; m++) {
        expect(dark.has(m), `module ${m}`).toBe(i % 2 === 0)
      }
      offset += symbol.bars[i]
    }
  })
})

// ── Refusals ─────────────────────────────────────────────────────────

describe('refusals', () => {
  it('refuses an empty code', () => {
    expect(() => encodeCode128('')).toThrow(/empty/i)
  })

  it('refuses a character it cannot encode, naming it', () => {
    // Code Set B covers ASCII 32-126. A non-Latin character has no encoding, and
    // silently substituting one would print a label that scans as another bin.
    expect(() => encodeCode128('BIN-Ω1')).toThrow(/Ω/)
    expect(() => encodeCode128('BIN\t1')).toThrow(/code128/i)
  })
})

// ── 3. Round trip through an independent decoder ─────────────────────

const PATTERN_TO_VALUE = new Map(CODE128_PATTERNS.map((p, v) => [p, v]))

/**
 * Read a bar-width array back into the string that produced it.
 *
 * Written against the specification rather than against the encoder: it splits
 * the stream into characters, looks each up, verifies the checksum itself, and
 * runs its own Set B / Set C state machine. If the encoder switches modes in the
 * wrong place, miscounts the checksum weights, or emits elements out of order,
 * this disagrees.
 */
function decodeCode128(bars: readonly number[]): string {
  const stopPattern = CODE128_PATTERNS[STOP]
  const stream = bars.join('')
  if (!stream.endsWith(stopPattern)) throw new Error('decode: no stop pattern')

  const body = stream.slice(0, -stopPattern.length)
  if (body.length % 6 !== 0) throw new Error('decode: body is not whole characters')

  const values: number[] = []
  for (let i = 0; i < body.length; i += 6) {
    const value = PATTERN_TO_VALUE.get(body.slice(i, i + 6))
    if (value === undefined) throw new Error(`decode: unknown pattern at ${i}`)
    values.push(value)
  }

  // Last value is the check character; verify it independently.
  const check = values[values.length - 1]
  const data = values.slice(0, -1)
  let sum = data[0]
  for (let k = 1; k < data.length; k++) sum += k * data[k]
  if (sum % 103 !== check) throw new Error(`decode: checksum ${sum % 103} != ${check}`)

  let mode: 'B' | 'C' = data[0] === START_C ? 'C' : 'B'
  if (data[0] !== START_B && data[0] !== START_C) throw new Error('decode: bad start')

  let out = ''
  for (const value of data.slice(1)) {
    if (mode === 'B') {
      if (value === CODE_C) { mode = 'C'; continue }
      out += String.fromCharCode(value + 32)
    } else {
      if (value === CODE_B) { mode = 'B'; continue }
      out += String(value).padStart(2, '0')
    }
  }
  return out
}

describe('round trip', () => {
  const corpus = [
    'A',
    'AB',
    'ABC',
    '1',
    '12',
    '123',
    '1234',
    '12345',
    '123456',
    '1234567',
    '1234567890123456',
    'AMD-B-12-7-L3',
    'NEXG-B-9-4-L4',
    'MAIN-B-189-5-L5',
    'HU-000123',
    'HU-999999',
    'AMD-STAGING-01',
    'A1B2C3D4E5',
    'X-000000000000-Y',
    'ZONE-CHILLER',
    ' leading space',
    'trailing space ',
    '!"#$%&\'()*+,-./',
    ':;<=>?@[\\]^_`{|}~',
  ]

  it.each(corpus)('decode(encode(%j)) is the original', (code) => {
    expect(decodeCode128(encodeCode128(code).bars)).toBe(code)
  })

  it('round-trips a generated corpus of every printable character', () => {
    // Deterministic pseudo-random so a failure is reproducible.
    let seed = 20260814
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const alphabet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))

    for (let n = 0; n < 500; n++) {
      const length = 1 + Math.floor(rand() * 24)
      const code = Array.from({ length }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('')
      expect(decodeCode128(encodeCode128(code).bars), code).toBe(code)
    }
  })

  it('round-trips digit strings of every length, which is where Set C switches', () => {
    for (let length = 1; length <= 30; length++) {
      const code = Array.from({ length }, (_, i) => String(i % 10)).join('')
      expect(decodeCode128(encodeCode128(code).bars), code).toBe(code)
    }
  })

  it('round-trips digit runs embedded at every offset', () => {
    for (let lead = 0; lead <= 4; lead++) {
      for (let run = 1; run <= 12; run++) {
        const code = 'X'.repeat(lead) + '7'.repeat(run) + 'Y'
        expect(decodeCode128(encodeCode128(code).bars), code).toBe(code)
      }
    }
  })
})
