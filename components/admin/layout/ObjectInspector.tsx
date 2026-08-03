// Side panel for editing the selected structural object (obstacle/staging/label —
// walls/docks/walkways/lifts/conveyors carry no editable metadata today). Mirrors
// PlacementInspector's layout so the two inspectors feel like one family.

import type { Dispatch } from 'react'
import type { EditorAction, EditorObject } from './useLayoutEditorState'

interface ObjectInspectorProps {
  object: EditorObject | null
  dispatch: Dispatch<EditorAction>
  /** locationId → code, so a linked staging object can show its human code
   *  instead of a bare numeric id. */
  locationCodeById?: ReadonlyMap<number, string>
}

/** Object types with an editable display name (rendered on the canvas). */
const NAMEABLE = new Set<EditorObject['objectType']>(['obstacle', 'staging', 'label', 'area'])

const TYPE_LABEL: Record<EditorObject['objectType'], string> = {
  wall: 'Wall',
  dock: 'Dock',
  walkway: 'Walkway',
  lift: 'Lift',
  conveyor: 'Conveyor',
  obstacle: 'Obstacle',
  staging: 'Staging floor',
  label: 'Label',
  area: 'Named area',
}

export function ObjectInspector({ object, dispatch, locationCodeById }: ObjectInspectorProps) {
  if (!object) return null

  const name = typeof object.meta?.name === 'string' ? object.meta.name : ''
  const zoneProfileId = typeof object.meta?.zoneProfileId === 'number' ? object.meta.zoneProfileId : undefined
  // An AREA is identified by its name, and is painted as many 1x1 cells — so
  // renaming the one cell you happened to select would split the region in two,
  // leaving half of it under the old name. `rename_area` moves every cell.
  const setName = (value: string) =>
    object.objectType === 'area'
      ? dispatch({ type: 'rename_area', from: name, to: value, zoneProfileId })
      : dispatch({ type: 'update_object', ref: object.clientRef, patch: { meta: { ...object.meta, name: value } } })

  return (
    <div className="space-y-3 p-3 border border-stone-200 rounded-lg bg-white">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-stone-700">{TYPE_LABEL[object.objectType]}</h4>
        <button
          className="text-xs text-red-500 hover:text-red-600 btn-press"
          onClick={() => dispatch({ type: 'delete_selected' })}
        >
          Remove
        </button>
      </div>

      <label className="block text-xs text-stone-500">
        Type
        <input
          className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 bg-stone-50 text-stone-400"
          value={TYPE_LABEL[object.objectType]}
          disabled
        />
      </label>

      {NAMEABLE.has(object.objectType) && (
        <label className="block text-xs text-stone-500">
          Name
          <input
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
            value={name}
            placeholder={object.objectType === 'obstacle' ? 'e.g. Office block' : object.objectType === 'staging' ? 'e.g. Shipping & Receiving' : object.objectType === 'area' ? 'e.g. Cold Storage' : 'Label text'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}

      {object.objectType === 'area' && (
        <p className="text-[11px] text-stone-400">
          Renaming moves every cell of this area. Cells sharing a name draw as one
          region.
        </p>
      )}

      {object.objectType === 'staging' && (
        <p className="text-[11px] text-stone-400">
          {object.stagingLocationId
            ? `Linked staging location: ${locationCodeById?.get(object.stagingLocationId) ?? `#${object.stagingLocationId}`}.`
            : 'Staging location created on save.'}
        </p>
      )}
    </div>
  )
}
