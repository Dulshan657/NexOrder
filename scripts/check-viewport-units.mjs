#!/usr/bin/env node
// Viewport-unit guard.
//
// `vh` is the LARGE viewport: the height the page would have with the browser's
// URL bar retracted. On the CipherLab RS35 handheld it never retracts, because
// the app shell is `overflow-hidden` and `document.body` never scrolls, so there
// is no root-scroll gesture to retract it with. `100vh` was therefore ~56px
// taller than the screen, permanently, with the overflow hidden and unreachable
// — and `<ProfileMenu>`, i.e. SIGN OUT, was in that band (register F36).
//
// So: `svh` (or `dvh`) everywhere, and `h-screen`/`min-h-screen` nowhere.
//
// WHY A SCRIPT AND NOT A TEST. Playwright cannot catch this class of defect at
// all: its `viewport` option sets the layout and visual viewport together, so
// `100vh` always equals the visible height there and an `h-screen` regression is
// invisible to every spec we could write. jsdom has no layout engine, so vitest
// cannot see it either. A source assertion is the only automatable guard, which
// is the same reasoning as `__tests__/mapSceneIsolation.test.ts`.
//
// This guard is ABSOLUTE — there is no baseline file and there should never be
// one. The sweep that introduced it converted all 28 `min-h-screen` occurrences,
// so the clean state is the starting state. Prose in comments is not scanned:
// several files legitimately explain why `h-screen` was wrong.
//
// Usage: node scripts/check-viewport-units.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['components', 'views', 'context']
const EXTRA_FILES = ['index.css']

// `h-screen` / `min-h-screen`, and any arbitrary Tailwind value in `vh`
// (`max-h-[90vh]`). `[68svh]` and `[100dvh]` do not match: the digits must sit
// immediately before `vh`, and in those the `s`/`d` intervenes.
const CLASS_PATTERN = /\b(?:min-)?h-screen\b|\[\d+(?:\.\d+)?vh\]/
// Raw CSS, for index.css: `max-height: 92vh`.
const CSS_PATTERN = /:\s*\d+(?:\.\d+)?vh\b/

const FIX = 'use `svh` (or `dvh`) — see components/ui/Modal.tsx and register F36'

function toPosix(p) {
  return p.split('\\').join('/')
}

function walk(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) acc.push(full)
  }
  return acc
}

/** A comment line. These explain the rule and must not trip it. */
function isComment(line) {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...EXTRA_FILES.map((f) => join(ROOT, f)),
]

const offenders = []
for (const file of files) {
  const rel = toPosix(relative(ROOT, file))
  const isCss = rel.endsWith('.css')
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  source.split('\n').forEach((line, i) => {
    if (isComment(line)) return
    const pattern = isCss ? CSS_PATTERN : CLASS_PATTERN
    const m = line.match(pattern)
    if (m) offenders.push({ rel, line: i + 1, match: m[0].trim() })
  })
}

if (offenders.length > 0) {
  console.error('Viewport-unit guard: FAILED\n')
  for (const o of offenders) {
    console.error(`  ${o.rel}:${o.line}  ${o.match}`)
  }
  console.error(`\n${offenders.length} offender(s). ${FIX}.`)
  console.error(
    '\n`vh` is the URL-bar-retracted height. The shell never scrolls the body, so on a\n' +
      'handheld that bar never retracts and ~56px of the app sits below the fold,\n' +
      'unreachable. Do not add a baseline file to make this pass.',
  )
  process.exit(1)
}

console.log('Viewport-unit guard: clean — no `vh` heights outside comments.')
