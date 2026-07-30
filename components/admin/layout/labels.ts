// User-facing name for the placed leaf storage unit. Internally the data model
// calls it a BIN (locations.kind='BIN', tool id 'rack'), but operators think in
// racks — these are large physical racks, not small bins. Centralised so the
// wording is consistent and a future re-label is a one-line change. This is a
// DISPLAY string only; it must never leak into codes, kinds, or DB values.
export const STORAGE_UNIT = {
  singular: 'Rack',
  plural: 'Racks',
  lower: 'rack',
  lowerPlural: 'racks',
} as const

import type { OccupantKind } from './useLayoutEditorState'
import type { EditorTool } from './useLayoutEditorState'

/** What already owns a cell, said the way an operator would say it. Used by the
 *  "can't draw here" hint, so `storage` reads as the STORAGE_UNIT wording rather
 *  than leaking the internal 'BIN'/'storage' vocabulary. */
export const OCCUPANT_LABEL: Record<OccupantKind, string> = {
  wall: 'wall',
  walkway: 'walkway',
  dock: 'dock',
  lift: 'lift',
  conveyor: 'conveyor',
  staging: 'staging floor',
  obstacle: 'obstacle',
  label: 'label',
  storage: STORAGE_UNIT.lower,
}

/** What the operator is currently trying to draw. */
export const TOOL_LABEL: Record<EditorTool, string> = {
  select: 'selection',
  walkway: 'a walkway',
  wall: 'a wall',
  dock: 'a dock',
  lift: 'a lift',
  conveyor: 'a conveyor',
  staging: 'a staging floor',
  obstacle: 'an obstacle',
  label: 'a label',
  rack: `a ${STORAGE_UNIT.lower}`,
  erase: 'an erase',
}
