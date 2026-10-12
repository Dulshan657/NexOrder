// Text handling for the QR poster. Pure -- no pdf-lib, no Deno, no I/O.
//
// Two problems live here, and both exist because the words on a poster are not
// ours: the venue's name is free text a manager typed, and the operator's company
// name and phone number come from Settings.
//
//   1. ENCODING. pdf-lib's standard fonts (Helvetica) can draw only the WinAnsi
//      (Windows-1252) repertoire, and `widthOfTextAtSize` / `drawText` THROW on
//      anything else. A venue called "Café Münchën" is fine; "Nhà hàng Phở 24" or
//      one emoji would turn "print the poster" into a 500. `sanitizeForWinAnsi`
//      makes every string drawable first, degrading a character rather than the
//      whole request.
//
//   2. FIT. A name that overflows its line is worse than a small name. Text is
//      wrapped on words, shrunk toward a floor, and only truncated (with an
//      ellipsis) when it still does not fit at the floor.
//
// Width comes from an injected `measure` (pdf-lib's `font.widthOfTextAtSize`),
// so the geometry is unit-tested with a trivial fake and never needs a PDF.

import { fitText } from '../labelSheet.ts'

export type PosterFont = 'bold' | 'regular'

/** Width of `text` in points at `size`, in `font`. */
export type Measure = (text: string, size: number, font: PosterFont) => number

// The 0x80-0x9F block of Windows-1252, which is where WinAnsi differs from
// Latin-1. Everything else it can draw is U+0020-U+007E and U+00A0-U+00FF.
const WIN_ANSI_EXTRAS: ReadonlySet<string> = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ',
  '‰', 'Š', '‹', 'Œ', 'Ž', '‘', '’', '“',
  '”', '•', '–', '—', '˜', '™', 'š', '›',
  'œ', 'ž', 'Ÿ',
])

function isWinAnsi(ch: string): boolean {
  const code = ch.charCodeAt(0)
  if (code >= 0x20 && code <= 0x7e) return true
  if (code >= 0xa0 && code <= 0xff) return true
  return WIN_ANSI_EXTRAS.has(ch)
}

function isControl(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/** Zero-width and variation characters: invisible, so they vanish instead of becoming "?". */
function isInvisible(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f) || code === 0xfeff
}

const COMBINING_MARKS = /[\u0300-\u036f]/g
const PICTOGRAPH = /\p{Extended_Pictographic}/u

/**
 * Make `input` safe to hand to a standard PDF font.
 *
 * Whitespace runs (including newlines and tabs, which WinAnsi cannot draw) become
 * one space. A character outside WinAnsi is first decomposed -- "a with a macron"
 * becomes "a" plus a combining macron, and the mark is dropped -- and only becomes
 * "?" if no base letter survives (CJK). Emoji and other pictographs are dropped as
 * a word break rather than printed as "?", and control and zero-width characters
 * vanish.
 */
export function sanitizeForWinAnsi(input: string): string {
  let out = ''
  for (const ch of input.replace(/\s+/g, ' ')) {
    if (isWinAnsi(ch)) {
      out += ch
      continue
    }
    if (isControl(ch) || isInvisible(ch)) continue
    if (PICTOGRAPH.test(ch)) {
      out += ' '
      continue
    }
    const kept = [...ch.normalize('NFD').replace(COMBINING_MARKS, '')].filter(isWinAnsi).join('')
    out += kept || '?'
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

/**
 * Greedy word wrap. A single word wider than the line is broken by character
 * rather than left to overflow, because a venue name like "Supercalifragilistic"
 * must still stay on the page.
 */
export function wrapWords(
  text: string,
  maxWidth: number,
  size: number,
  font: PosterFont,
  measure: Measure,
): string[] {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''

  const push = (line: string): void => {
    if (line) lines.push(line)
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (measure(candidate, size, font) <= maxWidth) {
      current = candidate
      continue
    }
    push(current)
    current = ''

    if (measure(word, size, font) <= maxWidth) {
      current = word
      continue
    }
    // Hard-break an over-wide word.
    let chunk = ''
    for (const ch of word) {
      if (chunk && measure(chunk + ch, size, font) > maxWidth) {
        push(chunk)
        chunk = ch
      } else {
        chunk += ch
      }
    }
    current = chunk
  }
  push(current)
  return lines
}

export interface FitLinesSpec {
  maxWidth: number
  preferredSize: number
  minSize: number
  maxLines: number
  font: PosterFont
}

export interface FittedLines {
  lines: string[]
  size: number
  /** True when even the minimum size could not hold the text and it was cut. */
  truncated: boolean
}

const SIZE_STEP = 0.5

/**
 * Wrap `text` into at most `maxLines` lines no wider than `maxWidth`, as large as
 * possible between `preferredSize` and `minSize`. If it does not fit even at
 * `minSize`, the last allowed line is ellipsised -- shrinking beats truncating, but
 * a name is never allowed to leave its box.
 */
export function fitLines(text: string, spec: FitLinesSpec, measure: Measure): FittedLines {
  const clean = text.trim()
  if (!clean) return { lines: [], size: spec.preferredSize, truncated: false }

  const fits = (lines: string[], size: number): boolean =>
    lines.length <= spec.maxLines && lines.every((l) => measure(l, size, spec.font) <= spec.maxWidth)

  for (let size = spec.preferredSize; size >= spec.minSize; size -= SIZE_STEP) {
    const lines = wrapWords(clean, spec.maxWidth, size, spec.font, measure)
    if (fits(lines, size)) return { lines, size, truncated: false }
  }

  const size = spec.minSize
  const wrapped = wrapWords(clean, spec.maxWidth, size, spec.font, measure)
  const kept = wrapped.slice(0, spec.maxLines)
  const overflowed = wrapped.length > spec.maxLines
  const measureAt = (s: string, sz: number): number => measure(s, sz, spec.font)
  const lines = kept.map((line, i) => {
    const isLast = i === kept.length - 1
    // Mark the cut: the last kept line gets an ellipsis even if it would fit,
    // otherwise the poster would silently drop the end of the name.
    return fitText(isLast && overflowed ? `${line} …` : line, spec.maxWidth, size, measureAt)
  })
  return { lines, size, truncated: overflowed }
}
