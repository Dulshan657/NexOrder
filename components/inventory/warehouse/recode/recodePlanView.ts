// Turning a plan into what the operator sees: ghost numbers on the map, which
// controls are worth rendering, and what to DO about a refusal.
//
// ── Why the plan is computed client-side at all ──────────────────────────────
//
// The `:recode:` rate bucket is 10/min. Ghost numbers that redraw as the operator
// clicks through four origin corners would spend the whole budget in ten seconds, so
// the live preview runs `planRecode` here, from the same pure module the server
// plans with. That is the point of the module being pure.
//
// ONE DIFFERENCE, AND IT MUST BE SAID OUT LOUD: the client's `takenCodes` is
// SITE-scoped (it is built from the locations this tab has loaded) while the
// server's is GLOBAL — `locations.code` is unique across every warehouse, and
// `loadTakenCodes` reads all of them including inactive rows. So the client can miss
// a collision with another site. It cannot miss one WITHIN this site, which is the
// overwhelmingly common case, and the Review step's `dry_run` is the authority
// before anything is written. `labelPrinted` and `hasStock` are likewise absent
// client-side; both are warnings the server reports, never gates.

import type { LayoutPlacement } from '@/types'
import {
  blockIssue,
  describeCodeIssue,
  formatCode,
  sanitizeBlock,
  templateIssue,
  usedTokens,
  type RecodePlan,
  type RecodeRefusal,
  type RecodeUnit,
} from '@/lib/codePattern'

export interface GhostLabel {
  locationId: number
  floor: number
  x: number
  y: number
  w: number
  h: number
  /** What to draw. Already trimmed of the run's shared prefix. */
  text: string
}

/**
 * The part of every code in a sweep that is identical BY CONSTRUCTION.
 *
 * `AMADIYA-BULK-1-1` is 16 characters and a bin is a few dozen pixels wide at map
 * zoom, so drawing the whole code draws nothing legible. The warehouse and the block
 * are the same on every bin of one sweep and are the least informative half, so they
 * come off and the operator reads `1-1`.
 *
 * DERIVED FROM THE PATTERN, NOT FROM THE DATA. A character-wise common prefix looks
 * equivalent and is not: `AMADIYA-BULK-1-1` and `AMADIYA-BULK-1-2` share
 * `AMADIYA-BULK-1-`, so a one-row selection would draw `1` and `2` — which reads as
 * a flat sequence and hides the grid entirely. What is trimmed has to depend on the
 * template, not on which numbers happened to coincide.
 *
 * Returns '' for a template that does not lead with those tokens, in which case the
 * full code is drawn. Honest, and rare: it means the operator wrote their own.
 */
export function sweepPrefix(template: string, wh: string, block: string): string {
  const used = usedTokens(template)
  if (!used.has('wh') && !used.has('block')) return ''
  // Render with every NUMBER absent. The engine collapses an absent token together
  // with its neighbouring separator, so this is exactly the constant half of the
  // code — the same trick the module's own header describes for building a pool key.
  const stem = formatCode(template, {
    wh, block, x: null, y: null, n: null, row: null, col: null, floor: null,
  })
  return stem ? `${stem}-` : ''
}

/**
 * One label per selected unit, in grid cells.
 *
 * Drawn by MapSelectionLayer, which is a SIBLING of WarehouseCanvas rather than a
 * prop of it — the canvas memoizes its whole scene, and a value that changes on
 * every painted cell would rebuild all 945 bins per stroke.
 */
export function ghostLabels(args: {
  units: readonly RecodeUnit[]
  placements: ReadonlyMap<number, LayoutPlacement>
  plan: RecodePlan
  template: string
  wh: string
  block: string
}): GhostLabel[] {
  const { units, placements, plan } = args
  // A refused plan writes nothing, but its rendered codes are still the best answer
  // to "what would this give me" — showing them is how the operator sees WHY it was
  // refused (two bins reading the same number, say).
  // `proposed` carries EVERY unit's rendered code, refused or not. Reading these
  // off `writes` instead was wrong in exactly the case that matters most: a refused
  // batch writes nothing, so only the offending bins had a new code and every other
  // bin fell back to its OLD one — which reads as "just those few are changing".
  const codeById = new Map(plan.proposed.map((p) => [p.id, p.to]))

  const prefix = sweepPrefix(args.template, args.wh, args.block)

  const labels: GhostLabel[] = []
  for (const unit of units) {
    const p = placements.get(unit.id)
    if (!p) continue
    const code = codeById.get(unit.id)
    // An unchanged unit produces no write and no refusal — it already carries the
    // code this sweep would give it, so its own code IS the answer.
    const full = code ?? unit.code
    labels.push({
      locationId: unit.id,
      floor: p.floor ?? 0,
      x: p.x,
      y: p.y,
      w: p.w ?? 1,
      h: p.h ?? 1,
      text: prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full,
    })
  }
  return labels
}

/**
 * Which numbering controls a template can actually honour.
 *
 * THE REPORTED BUG, in one function. The built-in template is `{wh}-{block}-{x}-{y}`
 * and carries no counter, yet the toolbar rendered `Start at` and `Order` anyway —
 * so the operator set them, nothing happened, and there was no way to find out why.
 * A control that cannot affect the result must not be on screen.
 */
export interface VisibleControls {
  origin: boolean
  order: boolean
  startAt: boolean
  /** Why the hidden ones are hidden, for the one-line note in their place. */
  note: string | null
}

export function visibleControls(template: string): VisibleControls {
  const used = usedTokens(template)
  const hasCounter = used.has('n')
  const hasFrame = used.has('row') || used.has('col')

  // The origin decides where BOTH the counter and the coordinates start, so either
  // token makes it meaningful.
  const origin = hasCounter || hasFrame
  // Fill order only reorders the counter; coordinates come from position, not walk.
  const order = hasCounter
  const startAt = hasCounter

  let note: string | null = null
  if (!origin) {
    note = 'This pattern numbers bins by their position on the grid, so there is nothing to order or start.'
  } else if (!hasCounter) {
    note = 'This pattern has no {n} counter, so a start number and a fill order would have no effect.'
  }
  return { origin, order, startAt, note }
}

/** A concrete next action for a refusal, rather than a dead end. */
export interface RefusalRemedy {
  /** What went wrong, in the operator's terms. */
  detail: string
  /** Which panel step can fix it. */
  step: 1 | 2 | 3 | null
  /** Label for the one-click fix, when there is one. */
  action: string | null
}

export function refusalRemedy(refusal: RecodeRefusal): RefusalRemedy {
  switch (refusal.kind) {
    case 'collision':
      return {
        detail: refusal.detail,
        step: 2,
        action: 'Change the block name',
      }
    case 'duplicate':
      // Almost always one cause: a template with no counter and no coordinates, so
      // every unit renders the same string.
      return {
        detail: `${refusal.detail} — the pattern needs a counter or a row/column to tell them apart.`,
        step: 3,
        action: 'Use row & column numbering',
      }
    case 'drift':
      return {
        detail: refusal.detail,
        step: 3,
        action: 'Change where numbering starts',
      }
    case 'kind':
      return { detail: refusal.detail, step: 1, action: 'Remove it from the selection' }
    case 'too_long':
      return { detail: refusal.detail, step: 2, action: 'Shorten the block name' }
    case 'template':
      return { detail: refusal.detail, step: 3, action: 'Fix the pattern' }
    default:
      return {
        detail: refusal.detail || describeCodeIssue(refusal.kind, refusal.to),
        step: 2,
        action: null,
      }
  }
}

/** Whether each step's own question has been answered. */
export type StepSatisfaction = Record<1 | 2 | 3 | 4, boolean>

/**
 * SATISFACTION, NOT VISITEDNESS — and that distinction is forced on us rather than
 * chosen. Every step in this flow is reachable at any time (the rail is four
 * buttons, not a gate), so "have you been here" says nothing useful: an operator who
 * clicked straight to Review has visited it and answered nothing. What a tick can
 * honestly mean here is that the step's own question is settled.
 *
 * Step 4 is settled only when the server has ANSWERED and the answer is actionable —
 * a preview full of refusals is a visited step, not a finished one.
 */
export function stepSatisfaction(args: {
  selectedCount: number
  block: string
  template: string
  hasPreview: boolean
  refusedTotal: number
  willRecode: number
}): StepSatisfaction {
  const clean = sanitizeBlock(args.block)
  return {
    1: args.selectedCount > 0,
    2: clean.length > 0 && !blockIssue(clean),
    3: !templateIssue(args.template),
    4: args.hasPreview && args.refusedTotal === 0 && args.willRecode > 0,
  }
}
