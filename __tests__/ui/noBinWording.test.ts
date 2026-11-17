// NX-0039 A14: no screen calls a place a "bin".
//
// Not everything sits in a bin — a rack level is a rack and a level, a floor bay
// is a bay — so the app says "location". This scans the SOURCE of every screen
// for a user-visible string or JSX text that still says "bin". It reads source
// rather than rendering because no render test reaches every screen.
//
// What it does NOT flag, deliberately: identifiers (`binId` has no word break),
// the location kind enum `'BIN'` (upper case), the CSV column `bin_code`
// (underscore), element ids and class-like strings with no space in them
// (`wh-bin-detail-body`), import paths, and comments. A string that is DATA —
// a value the server or a stored rule reads — may stay, marked on its line with
// a `// wording-ok: <why>` comment.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const DIRS = ['components', 'views', 'lib']
const SKIP_FILES = new Set(['lib/database.types.ts'])

const WORD = /\b(bin|bins|Bin|Bins)\b/

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* sourceFiles(p)
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) yield p
  }
}

/** Blank out comments, keeping line breaks so line numbers stay right. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length))
}

/** A string the user could read: words separated by a space, or a capitalised "Bin(s)"
 *  on its own (a heading). A bare lowercase 'bin' is a key or step id, not prose. */
const readable = (s: string) => /[A-Za-z]\s+[A-Za-z]/.test(s) || /^\s*(Bin|Bins)\s*$/.test(s)

/** A CSS class list ("wh-bin wh-bin-in"): every token is class-shaped and one has a hyphen. */
const classList = (s: string) => {
  const tokens = s.trim().split(/\s+/)
  return tokens.every((t) => /^[\w:\-/[\]@.%!]+$/.test(t)) && tokens.some((t) => t.includes('-'))
}

export function findBinWording(src: string): { line: number; text: string }[] {
  const lines = src.split('\n')
  const clean = stripComments(src)
  const hits: { line: number; text: string }[] = []
  const lineOf = (i: number) => clean.slice(0, i).split('\n').length
  // String literals ('…', "…", `…`), not import specifiers.
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
  for (let m; (m = literal.exec(clean)); ) {
    // Interpolations (${bin.code}) are code, not wording.
    const text = m[2].replace(/\$\{[^{}]*\}/g, ' ')
    const before = clean.slice(Math.max(0, m.index - 6), m.index)
    if (/from\s*$|import\s*$/.test(before)) continue
    if (WORD.test(text) && readable(text) && !classList(text)) hits.push({ line: lineOf(m.index), text })
  }
  // JSX text between tags: >  … bins …  <
  // (Interpolations like {code} are blanked first, so "Scan the bin {code}" is caught.)
  const jsxText = />([^<>]*?)</g
  for (let m; (m = jsxText.exec(clean)); ) {
    const text = m[1].replace(/\{[^{}]*\}/g, ' ')
    // Code between a generic's '>' and the next '<', or an unbalanced { ( … — not text.
    if (/=>|;|&&|\|\||[`'"={}]|\bnew\b|\breturn\b|\(\)/.test(text)) continue
    if (WORD.test(text) && /[A-Za-z]/.test(text)) hits.push({ line: lineOf(m.index), text: text.trim() })
  }
  return hits.filter((h) => !/wording-ok:/.test(lines[h.line - 1] ?? ''))
}

describe('user-facing wording', () => {
  it('no screen calls a place a bin', () => {
    const offenders: string[] = []
    for (const dir of DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).replace(/\\/g, '/')
        if (SKIP_FILES.has(rel)) continue
        for (const h of findBinWording(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${h.line}  ${h.text}`)
      }
    }
    expect(offenders, `Say "location", not "bin":\n${offenders.join('\n')}`).toEqual([])
  })
})
