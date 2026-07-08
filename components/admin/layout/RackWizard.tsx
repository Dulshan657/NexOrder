// Bulk bin generator — fill a rectangular block of the grid with bins in one
// step instead of hand-placing each cell, optionally assigning them all to a zone
// and a uniform capacity. A big usability win for real racked layouts.

import { useState } from 'react'
import type { Dispatch } from 'react'
import type { StorageType, ZoneProfile } from '@/types'
import type { EditorAction } from './useLayoutEditorState'

interface RackWizardProps {
  dispatch: Dispatch<EditorAction>
  zoneProfiles: ZoneProfile[]
  storageTypes: StorageType[]
  gridWidth: number
  gridHeight: number
  onClose: () => void
}

export function RackWizard({ dispatch, zoneProfiles, storageTypes, gridWidth, gridHeight, onClose }: RackWizardProps) {
  const [startX, setStartX] = useState(0)
  const [startY, setStartY] = useState(0)
  const [cols, setCols] = useState(4)
  const [rows, setRows] = useState(3)
  const [capacity, setCapacity] = useState(10)
  const [slotKind, setSlotKind] = useState<'pallet' | 'carton'>('pallet')
  const [weightCap, setWeightCap] = useState<number | ''>('')
  const [zoneProfileId, setZoneProfileId] = useState<number | ''>('')
  const [storageTypeId, setStorageTypeId] = useState<number | ''>('')

  const fits = startX + cols <= gridWidth && startY + rows <= gridHeight
  const count = cols * rows

  // Selecting a storage type prefills capacity + slot kind from its defaults.
  const onStorageType = (val: string) => {
    if (val === '') { setStorageTypeId(''); return }
    const id = Number(val)
    setStorageTypeId(id)
    const st = storageTypes.find((s) => s.id === id)
    if (st) {
      if (st.defaultCapacitySlots != null) setCapacity(st.defaultCapacitySlots)
      if (st.slotUnit === 'pallet' || st.slotUnit === 'carton') setSlotKind(st.slotUnit)
      setWeightCap(st.weightCapacityKg ?? '')
    }
  }

  const generate = () => {
    dispatch({
      type: 'generate_bins',
      startX, startY, cols, rows,
      capacitySlots: capacity,
      slotKind,
      weightCapacityKg: weightCap === '' ? undefined : weightCap,
      zoneProfileId: zoneProfileId === '' ? undefined : zoneProfileId,
      storageTypeId: storageTypeId === '' ? undefined : storageTypeId,
    })
    onClose()
  }

  const numField = (label: string, value: number, set: (n: number) => void, max: number) => (
    <label className="block text-xs text-stone-500">
      {label}
      <input
        type="number" min={label.startsWith('Start') ? 0 : 1} max={max}
        className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
        value={value}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-stone-700">Generate racks</h3>

        {storageTypes.length > 0 && (
          <label className="block text-xs text-stone-500">
            Storage type
            <select
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
              value={storageTypeId}
              onChange={(e) => onStorageType(e.target.value)}
            >
              <option value="">Custom (set manually)</option>
              {storageTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          {numField('Start X', startX, setStartX, gridWidth - 1)}
          {numField('Start Y', startY, setStartY, gridHeight - 1)}
          {numField('Columns', cols, setCols, gridWidth)}
          {numField('Rows', rows, setRows, gridHeight)}
          {numField('Capacity (slots)', capacity, setCapacity, 100000)}
          <label className="block text-xs text-stone-500">
            Slot kind
            <select
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
              value={slotKind}
              onChange={(e) => setSlotKind(e.target.value as 'pallet' | 'carton')}
            >
              <option value="pallet">pallet</option>
              <option value="carton">carton</option>
            </select>
          </label>
          <label className="block text-xs text-stone-500">
            Weight limit (kg)
            <input
              type="number" min={0}
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
              value={weightCap}
              placeholder="no limit"
              onChange={(e) => setWeightCap(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>

        <label className="block text-xs text-stone-500">
          Zone
          <select
            className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
            value={zoneProfileId}
            onChange={(e) => setZoneProfileId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">No zone</option>
            {zoneProfiles.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>

        <p className="text-xs text-stone-400">
          Creates up to {count} racks{fits ? '' : ' — but the block runs off the grid'}.
        </p>

        <div className="flex justify-end gap-2">
          <button className="text-xs px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={onClose}>Cancel</button>
          <button
            className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
            onClick={generate}
            disabled={!fits || count === 0}
          >
            Generate {count}
          </button>
        </div>
      </div>
    </div>
  )
}
