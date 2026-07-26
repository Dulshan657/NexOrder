// Single source of truth for the layout grid's visual language — shared by the
// editor (LayoutCanvas) and the read-only viewer (WarehouseCanvas) so the two
// never drift, and by LayoutLegend so the legend is always in sync with what's
// actually drawn. Keep colours here; components import, never redefine.

import type { LayoutObjectType, LevelRole } from '@/types'

/** Base cell size in px; the zoom control multiplies this. */
export const BASE_CELL = 26

/** Fill per structural object type (walls / walkways / docks / lifts …). */
export const OBJECT_FILL: Record<LayoutObjectType, string> = {
  walkway: '#bae6fd',
  wall: '#44403c',
  dock: '#fbbf24',
  obstacle: '#a8a29e',
  label: '#e7e5e4',
  lift: '#c4b5fd',
  conveyor: '#fdba74',
  // Distinct from the seeded "Staging Area" storage form (#a855f7, mig 00061) —
  // this is a walkable floor object, not a storage unit.
  staging: '#99f6e4',
}

/** Storage-rack fills + strokes. `existing` = persisted (has a location id);
 *  `draft` = drawn this session, not yet saved. */
export const PLACEMENT_FILL = {
  existing: '#6ee7b7',
  draft: '#a7f3d0',
  stroke: '#10b981',
  selectedStroke: '#059669',
  highlightStroke: '#0ea5e9',
  /** Unreachable bin (no walkway route from a dock) — flagged on the publish checklist. */
  problemStroke: '#ef4444',
  problemFill: '#fecaca',
  labelText: '#065f46',
} as const

/** A legend row. `outline` renders a hollow swatch (stroke only), `rect` a filled one. */
export interface LegendItem {
  key: string
  label: string
  shape: 'rect' | 'outline'
  fill?: string
  stroke?: string
}

/** What the grid's colours mean, in reading order. Rendered by LayoutLegend. */
export const LEGEND_ITEMS: LegendItem[] = [
  { key: 'rack', label: 'Rack', shape: 'rect', fill: PLACEMENT_FILL.existing, stroke: PLACEMENT_FILL.stroke },
  { key: 'rack-draft', label: 'Unsaved rack', shape: 'rect', fill: PLACEMENT_FILL.draft, stroke: PLACEMENT_FILL.stroke },
  { key: 'selected', label: 'Selected', shape: 'outline', stroke: PLACEMENT_FILL.selectedStroke },
  { key: 'walkway', label: 'Walkway', shape: 'rect', fill: OBJECT_FILL.walkway },
  { key: 'wall', label: 'Wall', shape: 'rect', fill: OBJECT_FILL.wall },
  { key: 'dock', label: 'Dock', shape: 'rect', fill: OBJECT_FILL.dock },
  { key: 'lift', label: 'Lift', shape: 'rect', fill: OBJECT_FILL.lift },
  { key: 'conveyor', label: 'Conveyor', shape: 'rect', fill: OBJECT_FILL.conveyor },
  { key: 'staging', label: 'Staging floor', shape: 'rect', fill: OBJECT_FILL.staging },
  { key: 'obstacle', label: 'Obstacle', shape: 'rect', fill: OBJECT_FILL.obstacle },
  { key: 'label', label: 'Label', shape: 'rect', fill: OBJECT_FILL.label },
]

// ── Rack levels (mig 00072) ───────────────────────────────────────────────
// ADD-ONLY additions for the expand-in-place stack drawn by LayoutCanvas and
// WarehouseCanvas. This file's existing exports are off-limits for restyling
// (see the file banner + memory/warehouse-tab-immersive-map-2026-07.md) — do
// not edit anything above this line, only append.

// These three were `Record<LevelRole, string>` maps keyed on a closed union.
// Since mig 00081 the role vocabulary is operator-managed data, so the colours
// and the label live on the role row and these become lookups over it. The seed
// carries the exact values that used to be hardcoded here, so nothing changed
// visually — but an operator can now recolour a role, and a role they invent
// renders correctly instead of falling off the map.
//
// Callers get the role array from useLevelRoles(). Re-exported (rather than
// having callers import @/lib/levelRoles directly) so the canvases keep a single
// palette import, which is what the file banner's add-only rule is protecting.
export { roleFill as levelRoleFill, roleStroke as levelRoleStroke } from '@/lib/levelRoles'

import { roleLabel } from '@/lib/levelRoles'
import type { LevelRoleRecord } from '@/lib/levelRoles'

/** Short display label per rack-level role, for the exploded stack's text.
 *
 *  Truncated to a canvas-sized label: the stack draws these inside a level band
 *  a few pixels tall, which is why this reads "Pick Zone" as-is but would clip a
 *  long operator-invented name. The editor and the bin picker use the full
 *  displayName; only the canvas abbreviates. */
export function levelRoleLabel(roles: readonly LevelRoleRecord[], key: string | null | undefined): string {
  const full = roleLabel(roles, key)
  return full.length > 12 ? `${full.slice(0, 11)}…` : full
}
