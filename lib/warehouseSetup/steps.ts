// The warehouse setup chain, as data.
//
// WHY THIS EXISTS. Standing a warehouse up is strictly order-dependent and
// nothing in the UI said so (gap M2 in WAREHOUSE-ONBOARDING-PLAN.md). The chain:
//
//   storage forms + level roles + zone profiles   (before racks are drawn)
//           -> layout drawn -> published          (publishing creates the bins)
//           -> QR labels generated and applied
//           -> count BY BIN
//           -> opening-stock CSV with bin_code
//           -> directed picking / replenishment become meaningful
//
// Each arrow is a hard ordering, encoded below as `blockedBy`. Draw racks before
// the storage forms are settled and every bin carries the wrong capacity (it is
// derived from the form's levels x positions); count by bin before the labels
// are on the racking and the count cannot be transcribed.
//
// Pure and dependency-free apart from the AdminTab union, so it unit-tests in
// vitest's node environment alongside evaluate.ts.

import type { AdminTab } from '../adminTabUrl'
import {
  SETUP_STEP_KEYS as SHARED_STEP_KEYS,
  SIGNOFF_STEP_KEYS as SHARED_SIGNOFF_KEYS,
  type SetupStepKey,
} from '@/supabase/functions/_shared/warehouseSetupSteps'

// The keys themselves live in the shared module because the edge function
// validates against them; everything below — titles, prose, navigation — is
// browser-only and stays here. Re-exported so consumers need one import.
export {
  SETUP_STEP_KEYS,
  SIGNOFF_STEP_KEYS,
  isSignoffStepKey,
} from '@/supabase/functions/_shared/warehouseSetupSteps'
export type { SetupStepKey } from '@/supabase/functions/_shared/warehouseSetupSteps'

/** Where a step's action button goes. The panel substitutes the live warehouse
 *  id for `warehouseParam` and turns `section` into `?section=`. */
export interface NavTarget {
  tab: AdminTab
  /** Static params, e.g. `{ whrules: '1' }` to auto-open the optimizer rules. */
  params?: Readonly<Record<string, string>>
  /** DOM id of a Settings section to scroll to (see components/admin/settings). */
  section?: string
  /** Param that should carry this warehouse's id. */
  warehouseParam?: 'wh' | 'designer'
  label: string
}

export type SetupPhase = 'configure' | 'map' | 'load'

export interface SetupStep {
  /** Stable forever — it is also the `step_key` stored in
   *  warehouse_setup_acknowledgements. Renaming one orphans its sign-offs. */
  key: SetupStepKey
  phase: SetupPhase
  title: string
  /** The reason this step sits where it does in the chain. Shown under the
   *  title when the step is current or blocked — the whole point of M2. */
  why: string
  /** 'racked' steps are hidden on a bulk site, where they are meaningless. */
  appliesTo: 'racked' | 'both'
  /** 'derived' reads the database; 'signoff' needs an operator to state it. */
  kind: 'derived' | 'signoff'
  /** Keys that must be done first. This is the dependency chain. */
  blockedBy: readonly string[]
  target?: NavTarget
  /** Settings is Admin-only (AdminView gates it), so a Manager seeing this
   *  panel gets the step with its action disabled and an explanation. */
  adminOnly?: boolean
}

export const PHASE_LABELS: Record<SetupPhase, string> = {
  configure: 'Configure',
  map: 'Map & label',
  load: 'Load & go live',
}

/** DOM ids for the five Settings -> Warehouse sections, used by `?section=`. */
export const SETTINGS_SECTION_IDS = {
  warehouses: 'settings-wh-warehouses',
  storageForms: 'settings-wh-storage-forms',
  levelRoles: 'settings-wh-level-roles',
  zoneProfiles: 'settings-wh-zone-profiles',
  labelPrinting: 'settings-wh-label-printing',
} as const

export const SETUP_STEPS: readonly SetupStep[] = [
  // ── Configure ─────────────────────────────────────────────────────────────
  {
    key: 'storage_forms_reviewed',
    phase: 'configure',
    title: 'Storage forms checked against the real racking',
    why:
      "A bin's capacity is derived from its storage form's levels x positions, so forms have to be right BEFORE any rack is drawn. The six shipped forms are a starting point — a seeded PALLET_RACK is 4 x 24, and this building's bays may not be.",
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: [],
    adminOnly: true,
    target: {
      tab: 'Settings',
      section: SETTINGS_SECTION_IDS.storageForms,
      label: 'Open storage forms',
    },
  },
  {
    key: 'level_roles_reviewed',
    phase: 'configure',
    title: 'Level roles checked',
    why:
      'Level roles drive the hard putaway gate and pick-zone replenishment. Three ship by default; confirm they match how this site actually uses its rack levels before bins inherit them.',
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: [],
    adminOnly: true,
    target: {
      tab: 'Settings',
      section: SETTINGS_SECTION_IDS.levelRoles,
      label: 'Open level roles',
    },
  },
  {
    key: 'zone_profiles_reviewed',
    phase: 'configure',
    title: 'Zone profiles checked',
    why:
      'Zone profiles route categories to areas of the floor (scoring never reads SKU temperature — allowed_categories plus a warehouse-scoped rule is the only path). Eight ship by default.',
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: [],
    adminOnly: true,
    target: {
      tab: 'Settings',
      section: SETTINGS_SECTION_IDS.zoneProfiles,
      label: 'Open zone profiles',
    },
  },
  {
    key: 'optimizer_rules',
    phase: 'configure',
    title: 'Optimizer rules set for this site',
    why:
      'Putaway rules are warehouse-scoped. Without one, the engine falls back to defaults and category-to-zone routing never happens.',
    appliesTo: 'racked',
    kind: 'derived',
    blockedBy: [],
    adminOnly: true,
    target: {
      tab: 'Settings',
      params: { whrules: '1' },
      label: 'Open optimizer rules',
    },
  },

  // ── Map & label ───────────────────────────────────────────────────────────
  {
    key: 'layout_published',
    phase: 'map',
    title: 'Layout drawn and published',
    why:
      'Publishing is what creates the bin locations and builds the routing graph. Nothing downstream — labels, a count by bin, directed picking — can exist before it.',
    appliesTo: 'racked',
    kind: 'derived',
    blockedBy: ['storage_forms_reviewed'],
    adminOnly: true,
    target: {
      tab: 'Settings',
      warehouseParam: 'designer',
      label: 'Open layout designer',
    },
  },
  {
    key: 'labels_confirmed',
    phase: 'map',
    title: 'QR labels printed, applied and confirmed',
    why:
      'Confirming is a statement that the stickers are physically on the racking — generating the sheets does not set it. A count by bin before this produces numbers nobody can transcribe.',
    appliesTo: 'racked',
    kind: 'derived',
    blockedBy: ['layout_published'],
    adminOnly: true,
    target: {
      tab: 'Settings',
      section: SETTINGS_SECTION_IDS.labelPrinting,
      label: 'Open label printing',
    },
  },
  {
    key: 'wifi_walked',
    phase: 'map',
    title: 'Wifi checked along every aisle',
    why:
      'Scan-enforced picking and putaway run on staff phones at the rack face. Coverage is a hard dependency and leaves no trace in any table, so it has to be walked and stated.',
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: ['layout_published'],
  },

  // ── Load & go live ────────────────────────────────────────────────────────
  {
    key: 'catalogue_loaded',
    phase: 'load',
    title: 'Catalogue loaded',
    why:
      'Products with their pack sizes must exist before stock can be counted against them. Pack size is the one field that cannot be fixed later without re-counting.',
    appliesTo: 'both',
    kind: 'derived',
    blockedBy: [],
    target: {
      tab: 'Products',
      params: { prodimport: '1' },
      label: 'Import catalogue',
    },
  },
  {
    key: 'replen_min_max',
    phase: 'load',
    title: 'Replenishment min/max set on the fast movers',
    why:
      'Replenishment stays completely silent until a product has min and max on a pick-zone home bin. Nothing else warns you that it is doing nothing.',
    appliesTo: 'racked',
    kind: 'derived',
    blockedBy: ['layout_published'],
    target: { tab: 'Products', label: 'Open products' },
  },
  {
    key: 'opening_stock',
    phase: 'load',
    title: 'Opening stock counted and imported',
    why:
      'Count in base units, not cartons, with a bin_code per row. Rows are grouped by bin before chunking so each group is received and then driven onto its own bin.',
    appliesTo: 'both',
    kind: 'derived',
    blockedBy: ['labels_confirmed', 'catalogue_loaded'],
    target: {
      tab: 'Stock',
      params: { stockimport: '1' },
      warehouseParam: 'wh',
      label: 'Import opening stock',
    },
  },
  {
    key: 'exercise_putaway',
    phase: 'load',
    title: 'Exercised: receipt through putaway',
    why:
      'One receipt driven all the way — assign, walk the route, scan the bin and the plate, complete. Assigning moves no stock; only completing does.',
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: ['opening_stock'],
    target: { tab: 'Putaway', warehouseParam: 'wh', label: 'Open putaway queue' },
  },
  {
    key: 'exercise_pick',
    phase: 'load',
    title: 'Exercised: order through dispatch',
    why:
      'One order reserved, picked against the directed route, packed and dispatched. Train on the phone flow, not the desktop one — the floor uses the scan field.',
    appliesTo: 'both',
    kind: 'signoff',
    blockedBy: ['opening_stock'],
    target: { tab: 'Pick Queue', label: 'Open pick queue' },
  },
  {
    key: 'exercise_replen',
    phase: 'load',
    title: 'Exercised: one replenishment task',
    why:
      'One task driven suggested -> assigned -> accepted with stock actually moving. Tasks are sized from available, never on_hand, so fully-allocated reserve stock raises none.',
    appliesTo: 'racked',
    kind: 'signoff',
    blockedBy: ['opening_stock'],
    target: { tab: 'Replenishment', warehouseParam: 'wh', label: 'Open replenishment queue' },
  },
]

/** Every key in the shared vocabulary has exactly one definition here, and
 *  every definition's kind agrees with which list its key came from. Thrown at
 *  module load rather than asserted in a test, because a mismatch means the
 *  server and the panel disagree about what a step IS. */
if (SETUP_STEPS.length !== SHARED_STEP_KEYS.length) {
  throw new Error(
    `warehouseSetup: ${SETUP_STEPS.length} definitions for ${SHARED_STEP_KEYS.length} shared keys`,
  )
}
for (const step of SETUP_STEPS) {
  const shouldBeSignoff = (SHARED_SIGNOFF_KEYS as readonly string[]).includes(step.key)
  if (shouldBeSignoff !== (step.kind === 'signoff')) {
    throw new Error(`warehouseSetup: "${step.key}" disagrees with the shared vocabulary on its kind`)
  }
}

/** The steps that apply to a warehouse of this kind, in chain order. */
export function stepsFor(locationType: 'bulk' | 'racked'): readonly SetupStep[] {
  return locationType === 'racked'
    ? SETUP_STEPS
    : SETUP_STEPS.filter((s) => s.appliesTo === 'both')
}
