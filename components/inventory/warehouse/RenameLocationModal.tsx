// Rename one location, from wherever the operator is already looking.
//
// The code is shown read-only and captioned, because "can I change this?" is the
// first question a rename dialog raises and the answer is load-bearing: the code
// is the QR payload, what every scan matches, a materialized_path segment and
// the CSV `bin_code` column. Nothing here can change it.
//
// Renaming here marks the location CUSTOM (mig 00094) — the server forces that,
// this dialog only says so — which means a later area rename will leave it
// alone. That is the whole point of typing a name by hand, and it is worth
// stating before the operator commits rather than discovering later.

import { useState } from 'react'
import { Modal } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { useRenameRack } from '@/hooks/queries/useWarehouseLocations'
import type { InventoryLocation } from '@/types'

interface RenameLocationModalProps {
  warehouseId: number
  location: InventoryLocation
  /** Level rows under this rack, so the dialog can offer to restamp them.
   *  Empty for a flat bin or a level. */
  levelCount?: number
  onClose: () => void
}

export function RenameLocationModal({
  warehouseId, location, levelCount = 0, onClose,
}: RenameLocationModalProps) {
  const [name, setName] = useState(location.name ?? '')
  const [includeLevels, setIncludeLevels] = useState(levelCount > 0)
  const rename = useRenameRack(warehouseId)
  const { addToast } = useToasts()

  const trimmed = name.trim()
  const dirty = trimmed !== (location.name ?? '').trim()
  const canSave = trimmed.length > 0 && dirty && !rename.isPending

  const submit = async () => {
    if (!canSave) return
    try {
      await rename.mutateAsync({
        id: location.id,
        name: trimmed,
        includeLevels: levelCount > 0 && includeLevels,
      })
      addToast(`Renamed to “${trimmed}”`, 'success')
      onClose()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not rename', 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename location"
      size="md"
      dirty={dirty}
      footer={({ requestClose }) => (
        <div className="flex justify-end gap-2">
          {/* requestClose, never onClose — the discard guard is bypassed otherwise. */}
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
          >
            {rename.isPending ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="rename-location-name" className="mb-1 block text-xs font-medium text-stone-500">
            Name
          </label>
          <input
            id="rename-location-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            maxLength={120}
            autoFocus
            placeholder="Chiller · Rack 7"
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800"
          />
          <p className="mt-1 text-[11px] text-stone-400">
            Renaming here makes this a custom name — a later area rename will leave it alone.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-stone-500">Code</p>
          <p className="rounded-lg bg-stone-50 px-3 py-2 font-mono text-sm text-stone-600">{location.code}</p>
          <p className="mt-1 text-[11px] text-stone-400">
            The code never changes — it is what the QR label prints and what every scan matches.
          </p>
        </div>

        {levelCount > 0 && (
          <label className="flex items-start gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={includeLevels}
              onChange={(e) => setIncludeLevels(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Rename its {levelCount} level{levelCount === 1 ? '' : 's'} to match
              <span className="block text-[11px] text-stone-400">
                Otherwise the rack says one thing and its levels still say another.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  )
}
