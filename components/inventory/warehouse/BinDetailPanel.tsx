// Detail for the currently-selected location: metadata, fill, and the per-product
// contents table (the source of truth for multi-product bins that the velocity
// overlay only summarizes). Read-only, EXCEPT the rack-levels section (mig
// 00072): a live rack's level config is editable here via RackLevelEditor.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, PackageSearch, Pencil } from 'lucide-react'
import { locationSubtitle, locationTitle } from '@/lib/locationDisplay'
import { RenameLocationModal } from './RenameLocationModal'
import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import { useToasts } from '@/hooks/useToasts'
import { warehouseLocationKeys } from '@/hooks/queries/useWarehouseLocations'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { defaultRoleKey } from '@/lib/levelRoles'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import { convertRackToLevels } from '@/services/supabase/warehouseLocationService'
import { ConfirmDialog } from '@/components/ui'
import { ReleaseQuarantineModal } from './ReleaseQuarantineModal'
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
  /** Admin/Manager — mutate-warehouse-location's role gate (mig 00094). The
   *  pencil is hidden otherwise: the function refuses anyway, and a button that
   *  always errors is worse than no button. */
  canRename?: boolean
  /** This location sits under a hold zone (mig 00101): its stock is on hand but
   *  cannot be allocated. Derived by the caller from the zone tree. */
  isHeld?: boolean
  /** Where released stock may go — every stock-holding location on this site
   *  that is not itself held. */
  releaseDestinations?: InventoryLocation[]
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
  canRename = false,
  isHeld = false,
  releaseDestinations = [],
}: BinDetailPanelProps) {
  const [releasing, setReleasing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const { addToast } = useToasts()
  const setLevels = useSetRackLevels(warehouseId)
  const convertRack = useConvertRack(warehouseId)
  const storageTypes = useStorageTypes()
  // Operator-managed role vocabulary (mig 00081) — drives the level editor's
  // dropdown, its tints, and the role a freshly-drafted level starts on.
  const { data: levelRoles = [] } = useLevelRoles()
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
      role: loc.levelRole ?? '',
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

  const form = storageTypes.data?.find((t) => t.id === location.storageTypeId)
  const formTemplate = form?.levelTemplate

  // A flat bin that could become a levelled rack: it must be a real BIN (not
  // already a level) and be placed in a published layout, since every level
  // inherits the rack's geometry and graph anchor.
  //
  // ...and its storage form must not be a FLOOR (mig 00100). A Floor Pallet or
  // a Bulk Floor cell is a marked-out spot on the slab — there is no upright to
  // hang a beam from, so offering to split it is offering something that cannot
  // be built.
  //
  // `isFloor`, emphatically not `!hasLevels`. The latter means "carries a
  // standard level layout", which is false on MAIN's own bay forms purely
  // because nobody has measured a template for them (00072 left them that way
  // deliberately) — gating on it would take this action away from all 189 of
  // MAIN's bays. A form with no `isFloor` at all defaults to false, which is
  // the permissive answer and the right one for anything predating the column.
  const canConvert =
    location.kind === 'BIN' && !hasRackLevels && placement != null && form?.isFloor !== true
  const startConvert = () =>
    setDraftLevels(
      // Seed from the form's standard layout when it has one; otherwise a
      // single pick level, so the operator builds up explicitly rather than
      // us inventing a level count for their physical rack.
      applyTemplate(
        formTemplate && formTemplate.length > 0
          ? formTemplate
          : [{ levelIndex: 1, role: defaultRoleKey(levelRoles) }],
      ),
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
        {/* Name over code (mig 00094), the same order every other surface uses.
            The code stays visible in mono: it is what the barcode prints, what a scan
            matches, and what someone quotes when reporting a problem. */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-stone-900">{locationTitle(location)}</p>
              {canRename && (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  aria-label="Rename this location"
                  title="Rename"
                  className="shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-600 btn-press"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {locationSubtitle(location) && (
              <p className="font-mono text-[11px] text-stone-500">{locationSubtitle(location)}</p>
            )}
          </div>
          <span className="shrink-0 rounded bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {isLevel ? `LEVEL ${location.levelIndex}` : location.kind}
          </span>
        </div>

        {renaming && (
          <RenameLocationModal
            warehouseId={warehouseId}
            location={location}
            levelCount={rackLevelLocations.length}
            onClose={() => setRenaming(false)}
          />
        )}

        <dl className="@container/bin mb-3 grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs @min-[22rem]/bin:grid-cols-2">
          {isBin && (
            <>
              <dt className="text-stone-500">Capacity</dt>
              <dd className="text-stone-700">
                {location.capacitySlots != null ? `${location.capacitySlots} ${location.slotKind ?? 'slots'}` : '—'}
              </dd>
              <dt className="text-stone-500">Fill</dt>
              <dd className="text-stone-700">{fillPct == null ? '—' : `${Math.round(fillPct * 100)}% (${totalSlots.toFixed(0)} used)`}</dd>
            </>
          )}
          {hasRackLevels && (
            <>
              <dt className="text-stone-500">Levels</dt>
              <dd className="text-stone-700">{levels.length} ({totalCapacity(levels)} slots total)</dd>
            </>
          )}
          {zoneName && (
            <>
              <dt className="text-stone-500">Zone</dt>
              <dd className="text-stone-700">{zoneName}</dd>
            </>
          )}
          {placement && (
            <>
              <dt className="text-stone-500">Position</dt>
              <dd className="text-stone-700 font-mono">F{placement.floor + 1} · {placement.x},{placement.y}</dd>
            </>
          )}
          {nodeVisits != null && (
            <>
              <dt className="text-stone-500">Pick visits (30d)</dt>
              <dd className="text-stone-700">{nodeVisits}</dd>
            </>
          )}
        </dl>

        {isBin && <StockTable rows={contents} showAbc showAllocated emptyLabel="Empty bin" />}
      </div>

      {hasRackLevels && (
        <div className="border-t border-stone-200 pt-3" data-testid="rack-level-panel">
          <RackLevelEditor
            levels={levels}
            roles={levelRoles}
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

      {/* Quarantine (mig 00101). Stock here is on hand and NOT sellable — the
          hold is on the place, so moving it out is the whole release. */}
      {isHeld && (
        <div className="border-t border-stone-200 pt-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <p className="text-xs font-semibold text-amber-900">On hold — not available to sell</p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              Anything in this location is counted in stock but cannot be allocated to an order.
              Releasing it means moving it to an ordinary location.
            </p>
            {contents.length > 0 && (
              <button
                type="button"
                data-testid="release-quarantine-button"
                onClick={() => setReleasing(true)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 btn-press"
              >
                Release from quarantine
              </button>
            )}
          </div>
        </div>
      )}

      {isHeld && location && (
        <ReleaseQuarantineModal
          open={releasing}
          onClose={() => setReleasing(false)}
          from={location}
          contents={contents}
          destinations={releaseDestinations}
        />
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
                data-testid="split-into-levels-button"
                onClick={startConvert}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium hover:bg-stone-50 btn-press"
              >
                <Layers className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Split into levels
              </button>
            </>
          ) : (
            <>
              <RackLevelEditor levels={draftLevels} roles={levelRoles} template={formTemplate} onChange={setDraftLevels} />
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
                  data-testid="convert-to-levels-button"
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
