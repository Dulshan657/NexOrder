// Single source of truth for the layout grid's visual language — shared by the
// editor (LayoutCanvas) and the read-only viewer (WarehouseCanvas) so the two
// never drift, and by LayoutLegend so the legend is always in sync with what's
// actually drawn. Keep colours here; components import, never redefine.

import type { LayoutObjectType } from '@/types'

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
]
