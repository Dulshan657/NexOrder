// Bulk bin generator — fill a rectangular block of the grid with bins in one
// step instead of hand-placing each cell, optionally assigning them all to a zone
// and a uniform capacity. A big usability win for real racked layouts.

import { useMemo, useState } from 'react'
import type { Dispatch } from 'react'
import type { RackLevel, StorageType, ZoneProfile } from '@/types'
import { Button, Modal } from '@/components/ui'
import { unitNoun } from '@/lib/locationNaming'
import type { EditorAction } from './useLayoutEditorState'

interface RackWizardProps {
  dispatch: Dispatch<EditorAction>
  zoneProfiles: ZoneProfile[]
  storageTypes: StorageType[]
  gridWidth: number
  gridHeight: number
  onClose: () => void
}

// Every field opens on these values, so "the operator touched something" is just
// a comparison against them. Declared once rather than inline in each useState so
// the dirty check below can't drift out of step with the initial state.
const DEFAULTS = {
  startX: 0,
  startY: 0,
  cols: 4,
  rows: 3,
  // '' is UNCOUNTED — a floor stack with no slot ceiling. The field has to be
  // able to hold it, or a form whose `default_capacity_slots` is NULL silently
  // generates 10-slot bins instead (which is what it used to do).
  capacity: 10 as number | '',
  slotKind: 'pallet' as 'pallet' | 'carton',
  weightCap: '' as number | '',
  zoneProfileId: '' as number | '',
  storageTypeId: '' as number | '',
}

export function RackWizard({ dispatch, zoneProfiles, storageTypes, gridWidth, gridHeight, onClose }: RackWizardProps) {
  const [startX, setStartX] = useState(DEFAULTS.startX)
  const [startY, setStartY] = useState(DEFAULTS.startY)
  const [cols, setCols] = useState(DEFAULTS.cols)
  const [rows, setRows] = useState(DEFAULTS.rows)
  const [capacity, setCapacity] = useState<number | ''>(DEFAULTS.capacity)
  const [slotKind, setSlotKind] = useState<'pallet' | 'carton'>(DEFAULTS.slotKind)
  const [weightCap, setWeightCap] = useState<number | ''>(DEFAULTS.weightCap)
  const [zoneProfileId, setZoneProfileId] = useState<number | ''>(DEFAULTS.zoneProfileId)
  const [storageTypeId, setStorageTypeId] = useState<number | ''>(DEFAULTS.storageTypeId)
  // The chosen form's standard level layout (mig 00072); every rack this
  // wizard generates inherits it (recoded to that rack's own code).
  const [levelTemplate, setLevelTemplate] = useState<RackLevel[] | undefined>(undefined)

  const fits = startX + cols <= gridWidth && startY + rows <= gridHeight
  const count = cols * rows

  // Arms the discard guard so a stray backdrop click can't silently throw away a
  // block the operator has already dialled in. `levelTemplate` is derived from
  // `storageTypeId`, so it needs no term of its own.
  const isDirty = useMemo(
    () =>
      startX !== DEFAULTS.startX ||
      startY !== DEFAULTS.startY ||
      cols !== DEFAULTS.cols ||
      rows !== DEFAULTS.rows ||
      capacity !== DEFAULTS.capacity ||
      slotKind !== DEFAULTS.slotKind ||
      weightCap !== DEFAULTS.weightCap ||
      zoneProfileId !== DEFAULTS.zoneProfileId ||
      storageTypeId !== DEFAULTS.storageTypeId,
    [startX, startY, cols, rows, capacity, slotKind, weightCap, zoneProfileId, storageTypeId],
  )

  // Selecting a storage type prefills capacity + slot kind from its defaults.
  const onStorageType = (val: string) => {
    if (val === '') { setStorageTypeId(''); setLevelTemplate(undefined); return }
    const id = Number(val)
    setStorageTypeId(id)
    const st = storageTypes.find((s) => s.id === id)
    if (st) {
      // A form that states NO capacity means uncounted, and that has to reach the
      // field: leaving the previous number in place is how every cell drawn with
      // a Bulk Floor form came to claim ten pallet slots.
      setCapacity(st.defaultCapacitySlots ?? '')
      if (st.slotUnit === 'pallet' || st.slotUnit === 'carton') setSlotKind(st.slotUnit)
      setWeightCap(st.weightCapacityKg ?? '')
      setLevelTemplate(st.hasLevels ? st.levelTemplate : undefined)
    } else {
      setLevelTemplate(undefined)
    }
  }

  const generate = () => {
    dispatch({
      type: 'generate_bins',
      startX, startY, cols, rows,
      // null, not undefined: the reducer reads an omitted field as "no opinion"
      // and applies the generic 10.
      capacitySlots: capacity === '' ? null : capacity,
      slotKind,
      weightCapacityKg: weightCap === '' ? undefined : weightCap,
      zoneProfileId: zoneProfileId === '' ? undefined : zoneProfileId,
      storageTypeId: storageTypeId === '' ? undefined : storageTypeId,
      levelTemplate,
      // What the generated units are CALLED (mig 00100). Resolved here, where
      // the catalogue is; "Custom (set manually)" has no form and so no noun,
      // which unitNoun reads as the default "Rack".
      nameNoun: unitNoun(storageTypes.find((s) => s.id === storageTypeId)),
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
    <Modal
      open
      onClose={onClose}
      size="md"
      dirty={isDirty}
      title="Generate racks"
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" size="sm" onClick={requestClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={generate} disabled={!fits || count === 0}>
            Generate {count}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
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
          {/* Not numField: this one field can legitimately be BLANK, meaning the
              bins have no slot ceiling at all. numField coerces to a number and
              would turn that into 0, which is a full bin, not an uncounted one. */}
          <label className="block text-xs text-stone-500">
            Capacity (slots)
            <input
              type="number" min={1} max={100000}
              placeholder="Uncounted"
              className="mt-1 w-full text-xs border border-stone-200 rounded px-2 py-1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
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

        <p className="text-xs text-stone-500">
          Creates up to {count} racks{fits ? '' : ' — but the block runs off the grid'}
          {levelTemplate ? ` · ${levelTemplate.length} levels each` : ''}.
        </p>
      </div>
    </Modal>
  )
}
