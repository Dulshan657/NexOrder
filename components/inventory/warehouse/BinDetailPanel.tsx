// Detail for the currently-selected location: metadata, fill, and the per-product
// contents table (the source of truth for multi-product bins that the velocity
// overlay only summarizes). Read-only, EXCEPT the rack-levels section (mig
// 00072): a live rack's level config is editable here via RackLevelEditor.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, PackageSearch } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import { useToasts } from '@/hooks/useToasts'
import { warehouseLocationKeys } from '@/hooks/queries/useWarehouseLocations'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import { convertRackToLevels } from '@/services/supabase/warehouseLocationService'
import { ConfirmDialog } from '@/components/ui'
import type { InventoryLocation, LayoutPlacement, RackLevel } from '@/types'
import { RackLevelEditor } from '@/components/warehouse/levels/RackLevelEditor'
import { applyTemplate, totalCapacity } from '@/components/warehouse/levels/rackLevels'
import type { BinContentRow } from './useWarehouseViewerModel'
import { StockTable } from './StockTable'

interface BinDetailPanelProps {
  /** Needed only to invalidate the right warehouse-locations query on save. */
  warehouseId: number
  location: InventoryLocation | null
  contents: BinContentRow[]
  fillPct: number | null | undefined
  placement?: LayoutPlacement
  nodeVisits?: number
  zoneName?: string
  /** This rack's level rows (kind SHELF, levelIndex set), ascending by
   *  levelIndex — empty when nothing rack-shaped is selected. */
  rackLevelLocations: InventoryLocation[]
  /** Per-level fill fraction, keyed by levelIndex. */
  rackFillByLevel: ReadonlyMap<number, number>
  /** Selecting a level from the editor re-selects it on the map/tree too. */
  onSelectLevel?: (locationId: number) => void
}

/**
 * Saves a rack's level config via `mutate-warehouse-location`'s `set_levels`
 * action (mig 00072). No `hooks/queries/useWarehouseLocations.ts` wrapper
 * exists for this action yet — that file is outside this workstream's
 * ownership — so this calls the Edge Function directly, matching its Zod
 * schema (flat `levels: [{level_index, role, capacity_slots,
 * weight_capacity_kg}]`, snake_case, no `data` wrapper). Replace this with a
 * proper hook in useWarehouseLocations.ts if/when one is added there.
 */
function useSetRackLevels(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { rackLocationId: number; levels: RackLevel[] }) => {
      const { data, error } = await supabase.functions.invoke('mutate-warehouse-location', {
        body: {
          action: 'set_levels',
          id: input.rackLocationId,
          levels: input.levels.map((l) => ({
            level_index: l.levelIndex,
            role: l.role,
            capacity_slots: l.capacitySlots ?? null,
            weight_capacity_kg: l.weightCapacityKg ?? null,
          })),
        },
      })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

/**
 * First-time conversion of a flat BIN into a levelled RACK (mig 00072).
 *
 * Distinct from `useSetRackLevels` because this is the ONLY location mutation
 * that moves live stock: the server relocates the bin's entire balance —
 * on_hand AND allocated — onto the new L1 inside one transaction. Hence the
 * confirm gate at the call site.
 */
function useConvertRack(warehouseId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { rackLocationId: number; layoutId: number; levels: RackLevel[] }) =>
      convertRackToLevels(
        input.rackLocationId,
        input.layoutId,
        input.levels.map((l) => ({
          level_index: l.levelIndex,
          role: l.role,
          capacity_slots: l.capacitySlots ?? null,
          weight_capacity_kg: l.weightCapacityKg ?? null,
        })),
      ),
    // Levels, placements and balances all moved — invalidate broadly rather
    // than trying to patch the cache for a structural change like this.
    onSuccess: () => qc.invalidateQueries({ queryKey: warehouseLocationKeys.byWarehouse(warehouseId) }),
  })
}

export function BinDetailPanel({
  warehouseId,
  location,
  contents,
  fillPct,
  placement,
  nodeVisits,
  zoneName,
  rackLevelLocations,
  rackFillByLevel,
  onSelectLevel,
}: BinDetailPanelProps) {
  const { addToast } = useToasts()
  const setLevels = useSetRackLevels(warehouseId)
  const convertRack = useConvertRack(warehouseId)
  const storageTypes = useStorageTypes()
  // Draft level layout for a not-yet-converted bin, plus the confirm gate.
  // Held here (not in the editor) so Cancel discards it cleanly.
  const [draftLevels, setDraftLevels] = useState<RackLevel[] | null>(null)
  const [confirmConvert, setConfirmConvert] = useState(false)

  if (!location) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <PackageSearch className="mx-auto mb-2 h-7 w-7 text-stone-300" />
        <p className="text-xs text-stone-500">Select a bin on the map or tree to see its contents.</p>
      </div>
    )
  }

  // A rack level (mig 00072) holds real stock exactly like a legacy BIN;
  // everything below that used to gate on `isBin` now gates on this instead,
  // so a legacy bin (kind === 'BIN') renders byte-identical to before.
  const isLevel = location.kind === 'SHELF' && location.levelIndex != null
  const isBin = location.kind === 'BIN' || isLevel
  const totalSlots = contents.reduce((s, r) => s + r.slots, 0)

  const hasRackLevels = rackLevelLocations.length > 0
  const rackLocationId = hasRackLevels ? rackLevelLocations[0].parentId : undefined
  const levels: RackLevel[] = rackLevelLocations
    .filter((loc): loc is InventoryLocation & { levelIndex: number } => loc.levelIndex != null)
    .map((loc) => ({
      locationId: loc.id,
      levelIndex: loc.levelIndex,
      role: loc.levelRole ?? 'pick',
      code: loc.code,
      capacitySlots: loc.capacitySlots,
      slotKind: loc.slotKind,
      weightCapacityKg: loc.weightCapacityKg,
    }))
  const codeByLevel = new Map(levels.map((l) => [l.levelIndex, l.code ?? '']))

  const handleLevelsChange = (next: RackLevel[]) => {
    if (rackLocationId == null) return
    setLevels.mutate(
      { rackLocationId, levels: next },
      {
        onSuccess: () => addToast('Level config saved', 'success'),
        onError: async (error) => {
          const message = await extractFunctionErrorMessage(error, 'Failed to save level config')
          addToast(message, 'error')
        },
      },
    )
  }

  // A flat bin that could become a levelled rack: it must be a real BIN (not
  // already a level) and be placed in a published layout, since every level
  // inherits the rack's geometry and graph anchor.
  const canConvert = location.kind === 'BIN' && !hasRackLevels && placement != null
  const formTemplate = storageTypes.data?.find((t) => t.id === location.storageTypeId)?.levelTemplate
  const startConvert = () =>
    setDraftLevels(
      // Seed from the form's standard layout when it has one; otherwise a
      // single pick level, so the operator builds up explicitly rather than
      // us inventing a level count for their physical rack.
      applyTemplate(formTemplate && formTemplate.length > 0 ? formTemplate : [{ levelIndex: 1, role: 'pick' }]),
    )

  const doConvert = () => {
    if (!draftLevels || placement == null) return
    convertRack.mutate(
      { rackLocationId: location.id, layoutId: placement.layoutId, levels: draftLevels },
      {
        onSuccess: (result) => {
          setConfirmConvert(false)
          setDraftLevels(null)
          addToast(
            result.unitsMoved > 0
              ? `Converted to ${draftLevels.length} levels — ${result.unitsMoved} units moved to L1`
              : `Converted to ${draftLevels.length} levels`,
            'success',
          )
        },
        onError: async (error) => {
          setConfirmConvert(false)
          addToast(await extractFunctionErrorMessage(error, 'Failed to convert rack'), 'error')
        },
      },
    )
  }

  return (
    <div className="glass-card rounded-xl p-4 space-y-4">
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm font-semibold text-stone-900">{location.code}</p>
            <p className="text-xs text-stone-500">{location.name}</p>
          </div>
          <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {isLevel ? `LEVEL ${location.levelIndex}` : location.kind}
          </span>
        </div>

        <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {isBin && (
            <>
              <dt className="text-stone-400">Capacity</dt>
              <dd className="text-stone-700">
                {location.capacitySlots != null ? `${location.capacitySlots} ${location.slotKind ?? 'slots'}` : '—'}
              </dd>
              <dt className="text-stone-400">Fill</dt>
              <dd className="text-stone-700">{fillPct == null ? '—' : `${Math.round(fillPct * 100)}% (${totalSlots.toFixed(0)} used)`}</dd>
            </>
          )}
          {hasRackLevels && (
            <>
              <dt className="text-stone-400">Levels</dt>
              <dd className="text-stone-700">{levels.length} ({totalCapacity(levels)} slots total)</dd>
            </>
          )}
          {zoneName && (
            <>
              <dt className="text-stone-400">Zone</dt>
              <dd className="text-stone-700">{zoneName}</dd>
            </>
          )}
          {placement && (
            <>
              <dt className="text-stone-400">Position</dt>
              <dd className="text-stone-700 font-mono">F{placement.floor + 1} · {placement.x},{placement.y}</dd>
            </>
          )}
          {nodeVisits != null && (
            <>
              <dt className="text-stone-400">Pick visits (30d)</dt>
              <dd className="text-stone-700">{nodeVisits}</dd>
            </>
          )}
        </dl>

        {isBin && <StockTable rows={contents} showAbc showAllocated emptyLabel="Empty bin" />}
      </div>

      {hasRackLevels && (
        <div className="border-t border-stone-200 pt-3">
          <RackLevelEditor
            levels={levels}
            fillByLevel={rackFillByLevel}
            codeByLevel={codeByLevel}
            selectedLevelIndex={isLevel ? location.levelIndex ?? null : null}
            onSelectLevel={(levelIndex) => {
              if (levelIndex == null) return
              const target = rackLevelLocations.find((loc) => loc.levelIndex === levelIndex)
              if (target) onSelectLevel?.(target.id)
            }}
            onChange={handleLevelsChange}
          />
        </div>
      )}

      {canConvert && (
        <div className="border-t border-stone-200 pt-3">
          {draftLevels == null ? (
            <>
              <p className="mb-2 text-xs text-stone-500">
                This rack is a single storage location. Split it into addressable levels to
                direct putaway and picking to a specific shelf.
              </p>
              <button
                type="button"
                onClick={startConvert}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium hover:bg-stone-50 btn-press"
              >
                <Layers className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Split into levels
              </button>
            </>
          ) : (
            <>
              <RackLevelEditor levels={draftLevels} template={formTemplate} onChange={setDraftLevels} />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraftLevels(null)}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs btn-press"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmConvert(true)}
                  disabled={draftLevels.length === 0 || convertRack.isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 btn-press"
                >
                  Convert to {draftLevels.length} level{draftLevels.length === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmConvert}
        tone="danger"
        title={`Split ${location.code} into ${draftLevels?.length ?? 0} levels?`}
        message={
          <>
            <p>
              {location.code} becomes a rack containing {draftLevels?.length ?? 0} addressable
              levels, and <strong>all stock currently in it moves to level 1</strong>.
            </p>
            <p className="mt-2 text-stone-500">
              The move is recorded in the inventory ledger and can be re-slotted afterwards.
              Existing pick and putaway history is preserved.
            </p>
          </>
        }
        confirmLabel={convertRack.isPending ? 'Converting…' : 'Split into levels'}
        busy={convertRack.isPending}
        onConfirm={doConvert}
        onCancel={() => setConfirmConvert(false)}
      />
    </div>
  )
}
