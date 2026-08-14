// Code 128 encoding. PURE — no Deno, no pdf-lib, no I/O — so vitest runs the
// identical module the generate-labels Edge Function renders with (same contract
// as _shared/labelSheet.ts and _shared/wie/*).
//
// It knows only integers and modules. It does NOT import labelSheet.ts and
// labelSheet.ts does not import it: the encoder knows nothing of points or
// millimetres, the geometry knows only a module COUNT, and generate-labels is
// the one place that knows both. That is what lets the sizing wizard predict a
// bar width in the browser without rendering anything.
//
// Widths are returned in MODULES as integers, never normalised floats. The
// renderer positions bar n at `x + run.start * moduleWidth` — an exact
// multiplication from a shared origin rather than a running sum, so a 97-run
// symbol cannot accumulate float error and print its last bars fractionally
// wider than its first. That drift is precisely what a decoder measures.

/**
 * The 107 Code 128 patterns, value 0..106, as the canonical six-digit width
 * strings every published table uses (bar, space, bar, space, bar, space).
 *
 * Kept in the published spelling on purpose: a transcription error is the
 * realistic failure mode here, and this form can be diffed against the source
 * by eye. `__tests__/code128.test.ts` also checks four structural invariants
 * over the table — 11 modules, widths 1-4, even bar parity, all distinct —
 * which between them catch essentially any single mistyped digit.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', // 0-7
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', // 8-15
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', // 16-23
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', // 24-31
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 32-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', // 40-47
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', // 48-55
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', // 56-63
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', // 64-71
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 72-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', // 80-87
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', // 88-95
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', // 96-103
  '211214', '211232', '2331112',                                                  // 104-106
]

/** Start in Code Set A. Not emitted — Set A is not implemented; see encode(). */
export const START_A = 103
/** Start in Code Set B: ASCII 32..126, one symbol per character. */
export const START_B = 104
/** Start in Code Set C: two digits per symbol. */
export const START_C = 105
/** Switch to Code Set B. Emitted from Set C. */
export const CODE_B = 100
/** Switch to Code Set C. Emitted from Set B. */
export const CODE_C = 99
/** Stop pattern: 7 elements, 13 modules, ending in the termination bar. */
export const STOP = 106

/**
 * Blank margin either side of the symbol, in modules.
 *
 * ISO 15417 requires 10x the narrow module width for Code 128 — note this is
 * NOT the 6.35mm figure quoted for UPC/EAN, which is a different symbology's
 * convention. Too little quiet zone is the most common cause of a barcode that
 * "scans sometimes".
 */
export const QUIET_ZONE_MODULES = 10

/** A character the encoder cannot represent, with enough detail to fix it. */
export class Code128EncodeError extends Error {
  readonly char: string
  readonly index: number

  constructor(message: string, char: string, index: number) {
    super(message)
    this.name = 'Code128EncodeError'
    this.char = char
    this.index = index
  }
}

export interface Code128Symbol {
  /** Exactly the string encoded — so a caller can assert the printed text matches. */
  value: string
  /** [start, ...data and switch symbols, checksum, STOP]. */
  codes: readonly number[]
  /**
   * Element widths in modules, left to right, strictly alternating and always
   * starting AND ending with a bar (so the length is odd).
   */
  bars: readonly number[]
  /** sum(bars) === 11 * (codes.length - 1) + 13. Excludes the quiet zones. */
  modules: number
}

/** One dark bar, as integer module offsets from the symbol's left edge. */
export interface Code128Run {
  start: number
  width: number
}

function digitRunLength(value: string, from: number): number {
  let n = 0
  while (from + n < value.length) {
    const c = value.charCodeAt(from + n)
    if (c < 48 || c > 57) break
    n++
  }
  return n
}

/**
 * The symbol values for `value`, including the start character, the checksum and
 * STOP. Exported because the checksum and the set-switching decisions are the
 * two places this can go subtly wrong, and pinning them against published
 * reference vectors is far more direct than inspecting bar widths.
 *
 * Set B / Set C switching follows the classic greedy AIM rules rather than a
 * provably-optimal search. That is deliberate: an optimal encoder would produce
 * a shorter symbol than the reference implementations for some inputs, which
 * would break deep-equality against published vectors — and those vectors are
 * the strongest correctness evidence available. Optimality is worth one symbol;
 * agreeing with the rest of the world is worth more.
 */
export function code128Values(value: string): number[] {
  if (value.length === 0) {
    throw new Code128EncodeError('code128: cannot encode an empty string', '', 0)
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 32 || c > 126) {
      // Control characters would need Code Set A and extended ASCII would need
      // FNC4; neither is implemented. Substituting or dropping the character is
      // the one thing we must never do — it prints a sticker whose barcode says
      // something other than the text underneath it.
      throw new Code128EncodeError(
        `code128: cannot encode ${JSON.stringify(value[i])} (U+${c
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}) at index ${i} of ${JSON.stringify(value)}`,
        value[i],
        i,
      )
    }
  }

  const codes: number[] = []
  let mode: 'B' | 'C'
  let i = 0

  // Start set. A wholly numeric even-length code goes straight into Set C; so
  // does a leading run of four or more digits, where the pairs already pay for
  // the switch that Start C gives away free.
  const lead = digitRunLength(value, 0)
  if ((lead === value.length && lead >= 2 && lead % 2 === 0) || lead >= 4) {
    codes.push(START_C)
    mode = 'C'
  } else {
    codes.push(START_B)
    mode = 'B'
  }

  while (i < value.length) {
    const run = digitRunLength(value, i)

    if (mode === 'C') {
      if (run >= 2) {
        codes.push(Number(value.slice(i, i + 2)))
        i += 2
        continue
      }
      // Fewer than two digits left in this run: a pair can never straddle the
      // end of a run, so drop back to Set B for the odd digit or the letter.
      codes.push(CODE_B)
      mode = 'B'
      continue
    }

    // In Set B, switching costs one symbol now and one more to come back, so a
    // run of N even digits saves N - (N/2 + 2) — positive only from 6 up. A run
    // that reaches the end of the string never pays to come back, so 4 is
    // enough there.
    if (run >= 6 || (run >= 4 && i + run === value.length)) {
      codes.push(CODE_C)
      mode = 'C'
      continue
    }

    codes.push(value.charCodeAt(i) - 32)
    i++
  }

  // Mod-103 checksum. The start character carries weight 1 and so does the
  // first data symbol; switch characters take their positional weight like any
  // other. The stop pattern is not weighted and not part of the sum.
  let sum = codes[0]
  for (let k = 1; k < codes.length; k++) sum += k * codes[k]
  codes.push(sum % 103)
  codes.push(STOP)

  return codes
}

/** Encode `value` as a Code 128 symbol. Throws `Code128EncodeError` if it cannot. */
export function encodeCode128(value: string): Code128Symbol {
  const codes = code128Values(value)

  const bars: number[] = []
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code]
    for (let k = 0; k < pattern.length; k++) bars.push(pattern.charCodeAt(k) - 48)
  }

  let modules = 0
  for (const width of bars) modules += width

  return { value, codes, bars, modules }
}

/**
 * The dark bars only, as integer module offsets.
 *
 * Elements alternate bar/space starting with a bar, and every character
 * contributes six of them — an even count — so the bars are exactly the
 * even-indexed elements, and STOP's seventh element is the termination bar.
 */
export function darkRuns(symbol: Code128Symbol): Code128Run[] {
  const runs: Code128Run[] = []
  let offset = 0
  for (let i = 0; i < symbol.bars.length; i++) {
    const width = symbol.bars[i]
    if (i % 2 === 0) runs.push({ start: offset, width })
    offset += width
  }
  return runs
}
