#!/usr/bin/env node
// Overlay guard.
//
// Every overlay in the app must go through `components/ui` (Modal / Sheet /
// ConfirmDialog). A raw `fixed inset-0` anywhere else means someone hand-rolled a
// dialog, which is how we ended up with 5 backdrop colours, 4 z-index tiers, no focus
// trap, no scroll lock, and a modal whose header you could not scroll to.
//
// Migration is incremental, so the check runs against a *shrinking baseline*: files
// already known to hand-roll an overlay are listed in `components/overlay-baseline.json`
// and merely warn. Any NEW offender fails the build. Each migration PR deletes its
// entries; when the baseline is empty the guard is absolute.
//
// Usage: node scripts/check-overlays.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['components', 'views', 'context']
const OVERLAY_PATTERN = /fixed\s+inset-0/
const EXEMPT_DIR = 'components/ui/'

// AppShell's mobile sidebar and mobile order-summary are app chrome, not dialogs.
// They are deliberately out of scope and would otherwise flag forever.
const PERMANENT_EXEMPTIONS = new Set(['components/AppShell.tsx'])

const BASELINE_PATH = join(ROOT, 'components', 'overlay-baseline.json')

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

function loadBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    return new Set(parsed.files ?? [])
  } catch {
    return new Set()
  }
}

const baseline = loadBaseline()
const offenders = []

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = toPosix(relative(ROOT, file))
    if (rel.startsWith(EXEMPT_DIR) || PERMANENT_EXEMPTIONS.has(rel)) continue
    if (!OVERLAY_PATTERN.test(readFileSync(file, 'utf8'))) continue
    offenders.push(rel)
  }
}

const unlisted = offenders.filter((f) => !baseline.has(f))
const stale = [...baseline].filter((f) => !offenders.includes(f))

if (stale.length > 0) {
  console.warn(`\nOverlay baseline has ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'} — migrated, please prune:`)
  for (const file of stale) console.warn(`  - ${file}`)
}

if (unlisted.length > 0) {
  console.error(`\nOverlay guard failed: ${unlisted.length} file(s) hand-roll a \`fixed inset-0\` overlay.`)
  console.error('Use <Modal> / <Sheet> / <ConfirmDialog> from components/ui instead.\n')
  for (const file of unlisted) console.error(`  ${file}`)
  console.error('')
  process.exit(1)
}

const remaining = offenders.length
console.log(
  remaining === 0
    ? 'Overlay guard: clean — every overlay goes through components/ui.'
    : `Overlay guard: no new offenders (${remaining} baselined file(s) left to migrate).`,
)
