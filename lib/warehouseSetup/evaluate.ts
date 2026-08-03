// Pure evaluation of the warehouse setup chain.
//
// Takes already-fetched data and returns a status per step. No hooks, no
// fetching, no `window` — hooks/queries/useWarehouseSetup.ts does the gathering
// and this does the thinking, which is what makes the whole chain a plain
// .test.ts. Same split as _shared/wie/publishReadiness.ts vs PublishChecklist.

import { stepsFor, type SetupStep } from './steps'

/** Layout facts. `needsRepublish` is already derived in lib/adapters.ts from
 *  `updated_at > published_at` — nothing else can move updated_at on a
 *  published layout. */
export interface LayoutFacts {
  hasDraft: boolean
  publishedLayoutId: number | null
  needsRepublish: boolean
}

/** From useLayoutLabelStatus(publishedLayoutId).byGroup.slots — SHEET_GROUPS
 *  maps `slots` to BIN/SHELF/BAY, i.e. exactly the bins. Null when there is no
 *  published layout to ask about. */
export interface LabelFacts {
  total: number
  outstanding: number
}

export interface SetupInput {
  warehouseId: number
  locationType: 'bulk' | 'racked'
  /** step_keys with a row in warehouse_setup_acknowledgements for this site. */
  acknowledgedKeys: readonly string[]
  storageFormCount: number
  levelRoleCount: number
  pickZoneRoleCount: number
  zoneProfileCount: number
  /** A wie_rules row scoped to THIS warehouse (global rules don't count — the
   *  step is about this site having been considered). */
  hasWarehouseRule: boolean
  layout: LayoutFacts
  labels: LabelFacts | null
  /** Global product count — the catalogue is not warehouse-scoped. */
  productCount: number
  /** product_home_bins rows with replen_enabled at this warehouse. */
  replenConfiguredCount: number
  /** A balance row at a location other than the warehouse root with on_hand > 0. */
  hasBinLevelStock: boolean
  /** Any stock at all here, root included. Distinguishes "nothing received" from
   *  "received but still sitting at the root", which is a real and different
   *  state — the importer reports rows whose receipt succeeded but whose
   *  placement failed exactly this way. */
  hasAnyStock: boolean
}

export type StepStatus = 'done' | 'current' | 'blocked' | 'todo'

export interface SetupStepState {
  step: SetupStep
  status: StepStatus
  /** Short supporting text: the count, the state, what is missing. */
  evidence: string
  /** Titles of the unfinished prerequisites, for the blocked explanation. */
  blockedBy: readonly string[]
}

export interface SetupSummary {
  steps: readonly SetupStepState[]
  doneCount: number
  totalCount: number
  /** Every DERIVED step passes. Drives the collapse-to-one-line behaviour, so a
   *  site that is genuinely live stops shouting even with sign-offs missing. */
  derivedComplete: boolean
  outstandingSignoffs: number
  /** The one step the operator should do next, if any. */
  currentKey: string | null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Is this step satisfied, ignoring ordering? */
function isDone(step: SetupStep, input: SetupInput): boolean {
  if (step.kind === 'signoff') return input.acknowledgedKeys.includes(step.key)

  switch (step.key) {
    case 'optimizer_rules':
      return input.hasWarehouseRule
    case 'layout_published':
      // A layout whose geometry moved after publishing is INERT until it is
      // published again (publishing freezes the travel graph), so it is not done.
      return input.layout.publishedLayoutId !== null && !input.layout.needsRepublish
    case 'labels_confirmed':
      return input.labels !== null && input.labels.total > 0 && input.labels.outstanding === 0
    case 'catalogue_loaded':
      return input.productCount > 0
    case 'replen_min_max':
      return input.replenConfiguredCount > 0
    case 'opening_stock':
      // On a racked site the stock has to be IN bins; on a bulk site the root
      // is where it correctly lives.
      return input.locationType === 'racked' ? input.hasBinLevelStock : input.hasAnyStock
    default:
      return false
  }
}

function evidenceFor(step: SetupStep, input: SetupInput, done: boolean): string {
  switch (step.key) {
    case 'storage_forms_reviewed':
      return plural(input.storageFormCount, 'form') + ' available'
    case 'level_roles_reviewed':
      return `${plural(input.levelRoleCount, 'role')} · ${input.pickZoneRoleCount} pick zone`
    case 'zone_profiles_reviewed':
      return plural(input.zoneProfileCount, 'profile') + ' available'
    case 'optimizer_rules':
      return done ? 'rule set for this site' : 'using engine defaults'
    case 'layout_published':
      if (input.layout.publishedLayoutId === null) {
        return input.layout.hasDraft ? 'draft not published' : 'no layout yet'
      }
      return input.layout.needsRepublish ? 'changed since publish — republish' : 'published'
    case 'labels_confirmed':
      if (!input.labels) return 'publish a layout first'
      if (input.labels.total === 0) return 'no bins to label'
      return done
        ? `${plural(input.labels.total, 'bin')} confirmed`
        : `${input.labels.outstanding} of ${input.labels.total} bins unconfirmed`
    case 'catalogue_loaded':
      return plural(input.productCount, 'product')
    case 'replen_min_max':
      return done ? plural(input.replenConfiguredCount, 'product') + ' configured' : 'none configured'
    case 'opening_stock':
      if (done) return input.locationType === 'racked' ? 'stock placed in bins' : 'stock on hand'
      if (input.hasAnyStock) return 'received, none placed in bins'
      return 'no stock counted yet'
    default:
      return ''
  }
}

/**
 * Evaluate the chain for one warehouse.
 *
 * Ordering rules:
 *  - a step is `blocked` when any APPLICABLE prerequisite is not done. A
 *    prerequisite that does not apply to this site (labels on a bulk warehouse)
 *    is treated as satisfied, because it genuinely is;
 *  - exactly one unfinished, unblocked step is `current` — the first in chain
 *    order. Everything else unfinished is `todo`.
 */
export function evaluateSetup(input: SetupInput): SetupSummary {
  const steps = stepsFor(input.locationType)
  // Set<string>, not Set<SetupStepKey>: `blockedBy` is a plain string list so a
  // step can name a prerequisite without importing its key type.
  const applicable = new Set<string>(steps.map((s) => s.key))

  const done = new Map<string, boolean>()
  for (const step of steps) done.set(step.key, isDone(step, input))

  let currentKey: string | null = null
  const states: SetupStepState[] = steps.map((step) => {
    const isStepDone = done.get(step.key) === true
    const unmet = step.blockedBy.filter((k) => applicable.has(k) && done.get(k) !== true)

    let status: StepStatus
    if (isStepDone) {
      status = 'done'
    } else if (unmet.length > 0) {
      status = 'blocked'
    } else if (currentKey === null) {
      status = 'current'
      currentKey = step.key
    } else {
      status = 'todo'
    }

    return {
      step,
      status,
      evidence: evidenceFor(step, input, isStepDone),
      blockedBy: unmet.map((k) => steps.find((s) => s.key === k)?.title ?? k),
    }
  })

  const derivedSteps = states.filter((s) => s.step.kind === 'derived')
  const signoffSteps = states.filter((s) => s.step.kind === 'signoff')

  return {
    steps: states,
    doneCount: states.filter((s) => s.status === 'done').length,
    totalCount: states.length,
    derivedComplete: derivedSteps.every((s) => s.status === 'done'),
    outstandingSignoffs: signoffSteps.filter((s) => s.status !== 'done').length,
    currentKey,
  }
}
