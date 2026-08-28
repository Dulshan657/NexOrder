#!/usr/bin/env node
// ONE-SHOT codemod. Delete it once it has run -- it is a record of a decision,
// not a tool anyone should reach for twice.
//
//   node scripts/codemod-stone-contrast.mjs --dry-run
//   node scripts/codemod-stone-contrast.mjs
//
// `text-stone-400` renders #a6a09b and measures 2.59:1 on white, 2.48 on
// stone-50, 2.37 on stone-100 and 2.06 on stone-200. It fails WCAG 1.4.3 (4.5:1)
// and AA-Large (3:1) on every background this app uses, and it is the default
// for helper text, secondary labels and placeholders in ~200 files.
//
// The figures above come from the OKLCH values in the BUILT css, not the v3 hex
// table people quote from memory: Tailwind v4 ships an OKLCH palette, so
// stone-400 is #a6a09b rather than #a8a29e. The difference is small and it moves
// every number the wrong way.
//
// TARGET: stone-500 (#79716b) normally -- 4.81 on white, 4.61 on stone-50 --
// but stone-600 (#57534d) where the same element also carries bg-stone-100 or
// bg-stone-200, because stone-500 measures 4.41 and 3.83 there and would leave a
// residue that looks fixed and is not. stone-600 is AA on every background
// (7.64 / 7.32 / 7.01 / 6.08).
//
// NOT SWEPT, each for its own reason:
//   * `bg-`, `border-`, `ring-`, `divide-`, `from-/via-/to-stone-400` -- not
//     text. A bare `stone-400` replace catches all 22 of these; this one is
//     anchored to `text-stone-400` so it cannot.
//   * `disabled:text-stone-400` (13) -- WCAG 1.4.3 exempts inactive controls,
//     and darkening them erases the disabled affordance for no conformance gain.
//   * `placeholder:text-stone-400` (31) -- in scope, but a separate act: it
//     narrows the visual gap between a placeholder and a real value, which is a
//     legibility trade someone should look at on its own.
//   * Text on a dark surface. Checked before writing this: of 97 occurrences in
//     files that contain a dark panel, ZERO have a dark background within six
//     lines above. Dark surfaces here use stone-300 (see the measured table in
//     index.css for the navy login rail). Nothing to exclude, but the check is
//     why that is known rather than assumed.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const DRY = process.argv.includes('--dry-run')

// Anchored to `text-` so sibling utilities are untouched, and the leading group
// keeps a modifier prefix (`disabled:`, `placeholder:`, `md:`) out of the match.
const SWEEP = /(^|[\s"'`{(])text-stone-400\b/g
// A RESTING tint only. `hover:bg-stone-100` is not a background this text sits
// on: it appears under the cursor, at which point `hover:text-stone-700` is
// usually applying as well. Matching it would push icon buttons to stone-600
// for a state they are not in -- 27 of them, measured -- which is a heavier
// visual change than the contrast actually requires. The leading group is what
// excludes a modifier prefix.
const ON_TINT = /(^|[\s"'`{(])bg-stone-(?:100|200)\b/

const files = execSync('git ls-files "*.tsx" "*.ts"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)

let touched = 0
let to500 = 0
let to600 = 0

for (const file of files) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (!SWEEP.test(src)) continue
  SWEEP.lastIndex = 0

  let changed = false
  const out = src
    .split('\n')
    .map((line) => {
      if (!/text-stone-400\b/.test(line)) return line
      // Same line == same className string in practice, so a tint on it is a
      // tint behind this text.
      const target = ON_TINT.test(line) ? 'text-stone-600' : 'text-stone-500'
      const next = line.replace(SWEEP, (_m, lead) => {
        changed = true
        if (target.endsWith('600')) to600++
        else to500++
        return `${lead}${target}`
      })
      return next
    })
    .join('\n')

  if (!changed) continue
  touched++
  if (!DRY) writeFileSync(file, out, 'utf8')
}

console.log(
  `${DRY ? '[dry-run] would rewrite' : 'rewrote'} ${to500 + to600} occurrences in ${touched} files ` +
    `(${to500} -> stone-500, ${to600} -> stone-600 where the element is on a stone-100/200 tint).`,
)
