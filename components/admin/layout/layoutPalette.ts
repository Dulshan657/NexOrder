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

/** Fill per rack-level role, used by the exploded level stack on both canvases. */
export const LEVEL_ROLE_FILL: Record<LevelRole, string> = {
  pick: '#a7f3d0',
  reserve: '#c7d2fe',
  bulk: '#fde68a',
}

/** Stroke per rack-level role — paired with LEVEL_ROLE_FILL. */
export const LEVEL_ROLE_STROKE: Record<LevelRole, string> = {
  pick: '#059669',
  reserve: '#4f46e5',
  bulk: '#d97706',
}

/** Short display label per rack-level role, for the exploded stack's text. */
export const LEVEL_ROLE_LABEL: Record<LevelRole, string> = {
  pick: 'Pick',
  reserve: 'Reserve',
  bulk: 'Bulk',
}
