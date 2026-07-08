// Side panel for editing the selected bin's properties (code, name, kind, soft
// capacity). Mirrors the fields the classic WarehouseTreeEditor exposes, so a bin
// drawn on the canvas carries the same metadata the inventory layer already uses.

import type { Dispatch } from 'react'
import type { StorageType, ZoneProfile } from '@/types'
import type { EditorAction, EditorPlacement } from './useLayoutEditorState'

interface PlacementInspectorProps {
  placement: EditorPlacement | null
  dispatch: Dispatch<EditorAction>
  zoneProfiles: ZoneProfile[]
  storageTypes: StorageType[]
}

const KINDS: EditorPlacement['kind'][] = ['ZONE', 'AISLE', 'RACK', 'BAY', 'SHELF', 'BIN']

export function PlacementInspector({ placement, dispatch, zoneProfiles, storageTypes }: PlacementInspectorProps) {
  if (!placement) {
    return (
      <div className="text-xs text-stone-400 p-3 border border-dashed border-stone-200 rounded-lg">
        Select a rack to edit its code, name and capacity.
      </div>
    )
  }

  const ref = placement.clientRef
  const patch = (p: Partial<Omit<EditorPlacement, 'clientRef'>>) => dispatch({ type: 'update_placement', ref, patch: p })
  // Choosing a storage type prefills capacity + slot kind from the type's
  // defaults (still editable below). 'each'/'uncounted' units clear slot kind.
  const onStorageType = (val: string) => {
    if (val === '') { patch({ storageTypeId: undefined }); return }
    const id = Number(val)
    const st = storageTypes.find((s) => s.id === id)
    patch({
      storageTypeId: id,
      capacitySlots: st?.defaultCapacitySlots,
      slotKind: st && (st.slotUnit === 'pallet' || st.slotUnit === 'carton') ? st.slotUnit : undefined,
      weightCapacityKg: st?.weightCapacityKg,
    })
  }
  // Existing bins own their metadata in the locations table; the designer only
  // moves/removes them. Editing code/name/capacity here would be silently
  // dropped on save, so lock those fields (edit them in the storage tree).
  const isExisting = !!placement.locationId

  return (
    <div className="space-y-3 p-3 border border-stone-200 rounded-lg bg-white">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-stone-700">Rack {placement.code}</h4>
        <button
          className="text-xs text-red-500 hover:text-red-600 btn-press"
          onClick={() => dispatch({ type: 'delete_selected' })}
        >
          Remove
        </button>
      </div>

      <label className="block text-xs text-stone-500">
        Code
        <input
          className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
          value={placement.code}
          disabled={isExisting}
          onChange={(e) => patch({ code: e.target.value })}
        />
      </label>

      <label className="block text-xs text-stone-500">
        Name
        <input
          className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
          value={placement.name}
          disabled={isExisting}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <label className="block text-xs text-stone-500">
        Kind
        <select
          className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
          value={placement.kind}
          disabled={isExisting}
          onChange={(e) => patch({ kind: e.target.value as EditorPlacement['kind'] })}
        >
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>

      {!isExisting && storageTypes.length > 0 && (
        <label className="block text-xs text-stone-500">
          Storage type
          <select
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
            value={placement.storageTypeId ?? ''}
            onChange={(e) => onStorageType(e.target.value)}
          >
            <option value="">Custom (set manually)</option>
            {storageTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-stone-500">
          Capacity (slots)
          <input
            type="number" min={0}
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
            value={placement.capacitySlots ?? ''}
            disabled={isExisting}
            onChange={(e) => patch({ capacitySlots: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="block text-xs text-stone-500">
          Slot kind
          <select
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
            value={placement.slotKind ?? ''}
            disabled={isExisting}
            onChange={(e) => patch({ slotKind: e.target.value === '' ? undefined : (e.target.value as 'pallet' | 'carton') })}
          >
            <option value="">—</option>
            <option value="pallet">pallet</option>
            <option value="carton">carton</option>
          </select>
        </label>
        <label className="block text-xs text-stone-500 col-span-2">
          Weight limit (kg)
          <input
            type="number" min={0}
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50 disabled:text-stone-400"
            value={placement.weightCapacityKg ?? ''}
            disabled={isExisting}
            placeholder="no limit"
            onChange={(e) => patch({ weightCapacityKg: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>

      {!isExisting && (
        <label className="block text-xs text-stone-500">
          Zone
          <select
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
            value={placement.zoneProfileId ?? ''}
            onChange={(e) => patch({ zoneProfileId: e.target.value === '' ? undefined : Number(e.target.value) })}
          >
            <option value="">No zone</option>
            {zoneProfiles.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      )}

      {isExisting
        ? <p className="text-[11px] text-stone-400">Existing rack — edit its details in the storage tree.</p>
        : <p className="text-[11px] text-amber-600">New rack — created on save.</p>}
    </div>
  )
}
