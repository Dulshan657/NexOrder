// Warehouse layout designer (Admin). Lists a warehouse's layouts, opens a draft
// on the grid canvas, and drives save/publish. Publishing builds the routing
// graph server-side (publish-layout) and opts the warehouse into rack-level
// tracking; validation failures surface as an actionable fix-it list. Draft and
// archived layouts can be deleted outright to keep the list clean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Check, X, ImageUp, Copy } from 'lucide-react'
import { evaluatePublishReadiness } from '@/supabase/functions/_shared/wie/publishReadiness'
import { autoConnectLayout } from '@/supabase/functions/_shared/wie/autoConnect'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useZoneProfiles } from '@/hooks/queries/useZoneProfiles'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import {
  useLayouts,
  useLayoutDetail,
  useCreateLayout,
  useCloneLayout,
  useArchiveLayout,
  useDeleteLayout,
  useSaveGeometry,
  usePublishLayout,
} from '@/hooks/queries/useLayouts'
import { useRunSimulation } from '@/hooks/queries/useSimulation'
import { useWarehouseStockSummary } from '@/hooks/queries/useWarehouseStockSummary'
import { useCommitReslotPlan } from '@/hooks/queries/useReslotPlan'
import { useToasts } from '@/hooks/useToasts'
import type { PublishRejection, SaveObjectInput, SavePlacementInput } from '@/services/supabase/layoutService'
import type { CommitMove } from '@/services/supabase/reslotService'
import type { LayoutObjectType, SimulationResult, Warehouse } from '@/types'
import { LayoutCanvas } from './LayoutCanvas'
import { LayoutToolbar } from './LayoutToolbar'
import { LayoutLegend } from './LayoutLegend'
import { PlacementInspector } from './PlacementInspector'
import { PublishChecklist } from './PublishChecklist'
import { CapacityAdvisor } from './CapacityAdvisor'
import { ReslotPlannerModal } from './ReslotPlannerModal'
import { RackWizard } from './RackWizard'
import { FloorPlanImportModal } from './FloorPlanImportModal'
import { SimulationResultCard } from './SimulationResultCard'
import { STORAGE_UNIT } from './labels'
import { useLayoutEditorState } from './useLayoutEditorState'

interface LayoutDesignerViewProps {
  warehouse: Warehouse
  /** Open the floor-plan import modal on mount (empty-state CTA deep link). */
  autoOpenImport?: boolean
}

export function LayoutDesignerView({ warehouse, autoOpenImport = false }: LayoutDesignerViewProps) {
  const layoutsQuery = useLayouts(warehouse.id)
  const locationsQuery = useWarehouseLocations(warehouse.id)
  const zoneProfilesQuery = useZoneProfiles()
  const storageTypesQuery = useStorageTypes()
  const [selectedLayoutId, setSelectedLayoutId] = useState<number | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(autoOpenImport)
  const [floorCountInput, setFloorCountInput] = useState(1)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [reslotOpen, setReslotOpen] = useState(false)
  const detailQuery = useLayoutDetail(selectedLayoutId)

  const [state, dispatch] = useLayoutEditorState(warehouse.code)
  const [rejections, setRejections] = useState<PublishRejection[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [simulation, setSimulation] = useState<SimulationResult | null>(null)
  const hydratedLayoutRef = useRef<number | null>(null)
  const { addToast } = useToasts()

  const createLayout = useCreateLayout(warehouse.id)
  const cloneLayout = useCloneLayout(warehouse.id)
  const archiveLayout = useArchiveLayout(warehouse.id)
  const deleteLayout = useDeleteLayout(warehouse.id)
  const saveGeometry = useSaveGeometry(selectedLayoutId ?? 0)
  const publishLayout = usePublishLayout(warehouse.id)
  const runSimulation = useRunSimulation()
  const stockSummary = useWarehouseStockSummary(warehouse.id)
  const commitReslot = useCommitReslotPlan(warehouse.id)

  const codeByLocation = useMemo(() => {
    const map: Record<number, { code: string; name: string; kind: never; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; storageTypeId?: number }> = {}
    for (const l of locationsQuery.data ?? []) {
      map[l.id] = {
        code: l.code, name: l.name, kind: l.kind as never,
        capacitySlots: l.capacitySlots, slotKind: l.slotKind, weightCapacityKg: l.weightCapacityKg, storageTypeId: l.storageTypeId,
      }
    }
    return map
  }, [locationsQuery.data])

  // Drawable storage forms → coloured palette tools + a colour lookup so both
  // draft and existing bins render in their form's colour on the canvas.
  const drawableForms = useMemo(
    () => (storageTypesQuery.data ?? []).filter((t) => t.isDrawable),
    [storageTypesQuery.data],
  )
  const formColorById = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of storageTypesQuery.data ?? []) if (t.color) m.set(t.id, t.color)
    return m
  }, [storageTypesQuery.data])
  const handleSelectForm = (id: number) => {
    const t = (storageTypesQuery.data ?? []).find((s) => s.id === id)
    if (!t) return
    dispatch({
      type: 'set_storage_form',
      form: {
        storageTypeId: t.id,
        label: t.name,
        capacitySlots: t.defaultCapacitySlots,
        slotKind: t.slotUnit === 'pallet' ? 'pallet' : t.slotUnit === 'carton' ? 'carton' : undefined,
        weightCapacityKg: t.weightCapacityKg,
      },
    })
  }

  // Hydrate the editor once per selected layout — NOT on every refetch, so a
  // background invalidation can't wipe the operator's unsaved canvas edits. Wait
  // for locations too, so existing racks hydrate with their real code/capacity.
  useEffect(() => {
    if (detailQuery.data && locationsQuery.data && selectedLayoutId && hydratedLayoutRef.current !== selectedLayoutId) {
      hydratedLayoutRef.current = selectedLayoutId
      dispatch({
        type: 'load',
        placements: detailQuery.data.placements,
        objects: detailQuery.data.objects,
        codeByLocation,
      })
    }
  }, [detailQuery.data, locationsQuery.data, selectedLayoutId, codeByLocation, dispatch])

  const layouts = layoutsQuery.data ?? []
  const selectedLayout = layouts.find((l) => l.id === selectedLayoutId) ?? null
  const isDraft = selectedLayout?.status === 'draft'
  const selectedPlacement = state.placements.find((p) => p.clientRef === state.selectedRef) ?? null

  // Live publish readiness — same pure checks the server runs, keyed by clientRef
  // so unreachable bins map straight back to canvas highlights. Reachability is a
  // connectivity property, so exact cell size doesn't change pass/fail.
  const readiness = useMemo(
    () =>
      evaluatePublishReadiness({
        objects: state.objects.map((o) => ({ objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
        placements: state.placements.map((p) => ({ id: p.clientRef, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
        cellSizeM: selectedLayout?.cellSizeM ?? 1,
      }),
    [state.objects, state.placements, selectedLayout?.cellSizeM],
  )
  const highlightRefs = useMemo(() => new Set(readiness.unreachableIds), [readiness])
  const canAutoConnect = !!isDraft && readiness.unreachableIds.length > 0

  // Repair unreachable bins in one click: carve docks out of overlapping walls
  // and route new 1×1 walkway cells from the reachable network to every
  // stranded bin. Uses the exact same objects/placements→ConnectObject/
  // ConnectPlacement mapping as the readiness memo above so `stillUnreachable`
  // lines up with `readiness.unreachableIds`.
  const handleAutoConnect = () => {
    if (!selectedLayout) return
    const result = autoConnectLayout({
      objects: state.objects.map((o) => ({ objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
      placements: state.placements.map((p) => ({ id: p.clientRef, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
      gridWidth: selectedLayout.gridWidth,
      gridHeight: selectedLayout.gridHeight,
      floors: selectedLayout.floorCount,
    })

    if (!result.changed) {
      addToast('Nothing to auto-connect — layout is already fully routed.', 'info')
      return
    }

    dispatch({
      type: 'apply_auto_connect',
      objects: result.objects.map((o) => ({
        objectType: o.objectType as LayoutObjectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
      })),
    })

    const parts = [
      `Added ${result.addedWalkwayCells.length} walkway cell${result.addedWalkwayCells.length === 1 ? '' : 's'}.`,
    ]
    if (result.removedWallCells.length > 0) {
      parts.push(`Opened ${result.removedWallCells.length} wall cell${result.removedWallCells.length === 1 ? '' : 's'} under a dock.`)
    }
    if (result.stillUnreachable.length > 0) {
      parts.push(
        `${result.stillUnreachable.length} bin${result.stillUnreachable.length === 1 ? '' : 's'} still unreachable — it's fully enclosed or on a floor with no lift; add a walkway or lift by hand.`,
      )
    }
    addToast(parts.join(' '), result.stillUnreachable.length > 0 ? 'info' : 'success')
  }

  const handleCreate = async () => {
    const floorCount = Math.min(10, Math.max(1, Math.round(floorCountInput) || 1))
    const layout = await createLayout.mutateAsync({ warehouse_id: warehouse.id, name: `Layout ${new Date().getFullYear()}`, floor_count: floorCount })
    setSelectedLayoutId(layout.id)
    setNotice(`Draft created — draw walkways, a dock, and ${STORAGE_UNIT.lowerPlural}, then Publish.`)
  }

  // Persist the current canvas geometry and reconcile client refs → real location
  // ids. Shared by explicit Save and by the one-click Save & Publish path.
  const persistGeometry = async () => {
    if (!selectedLayoutId) return
    const placements: SavePlacementInput[] = state.placements.map((p) => ({
      client_ref: p.clientRef,
      location_id: p.locationId,
      new_bin: p.locationId ? undefined : {
        parent_id: warehouse.id, kind: p.kind, code: p.code, name: p.name,
        capacity_slots: p.capacitySlots, slot_kind: p.slotKind, weight_capacity_kg: p.weightCapacityKg,
        zone_profile_id: p.zoneProfileId, storage_type_id: p.storageTypeId,
      },
      floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
    }))
    const objects: SaveObjectInput[] = state.objects.map((o) => ({
      object_type: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
    }))
    const result = await saveGeometry.mutateAsync({ placements, objects })
    dispatch({ type: 'mark_saved', refMap: result.ref_map })
  }

  const handleSave = async () => {
    try {
      await persistGeometry()
      setNotice('Saved.')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to save', 'error')
    }
  }

  // Publish the draft; returns true on success. Renders rejections on failure.
  const doPublish = async (): Promise<boolean> => {
    const result = await publishLayout.mutateAsync(selectedLayoutId as number)
    if (result.ok) return true
    setRejections(result.rejections ?? [])
    return false
  }

  const handlePublish = async () => {
    if (!selectedLayoutId) return
    setRejections(null)
    try {
      // One-click Save & Publish: flush any unsaved edits first so the server
      // validates the geometry the operator actually drew. The server reads the
      // persisted rows, so ordering (save → publish) is what matters.
      if (state.dirty) await persistGeometry()
      // If the warehouse already holds stock, gate publish behind the re-slot
      // planner so existing stock gets an optimal home in the new layout.
      if (stockSummary.hasStock) {
        setReslotOpen(true)
        return
      }
      if (await doPublish()) {
        setNotice('Published — this warehouse now uses rack-level putaway.')
        setSelectedLayoutId(null)
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to publish', 'error')
    }
  }

  // Operator approved the re-slot plan: publish, then write the relocation worklist.
  const handleReslotApprove = async (moves: CommitMove[]) => {
    if (!selectedLayoutId) return
    setRejections(null)
    try {
      const published = await doPublish()
      if (!published) { setReslotOpen(false); return }
      if (moves.length > 0) {
        const { created } = await commitReslot.mutateAsync({ layoutId: selectedLayoutId, moves })
        setNotice(`Published — ${created} relocation move${created === 1 ? '' : 's'} added to the Slotting queue.`)
      } else {
        setNotice('Published — this warehouse now uses rack-level putaway.')
      }
      setReslotOpen(false)
      setSelectedLayoutId(null)
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to publish', 'error')
    }
  }

  const handleSimulate = (layoutId: number) => {
    setSimulation(null)
    runSimulation.mutate(
      { layoutId, days: 30 },
      {
        onSuccess: (result) => setSimulation(result),
        onError: (error) => addToast(error.message || 'Simulation failed', 'error'),
      },
    )
  }

  const handleDelete = async (layoutId: number) => {
    try {
      await deleteLayout.mutateAsync(layoutId)
      setConfirmDeleteId(null)
      if (selectedLayoutId === layoutId) { setSelectedLayoutId(null); setSimulation(null) }
      addToast('Layout deleted.', 'success')
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to delete layout', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-stone-800">Layout Designer</h3>
          <p className="text-xs text-stone-500">{warehouse.name} — model the floor, then publish to enable putaway intelligence.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone-500 flex items-center gap-1">
            Floors
            <input
              type="number" min={1} max={10}
              className="w-14 text-xs border border-stone-200 rounded px-2 py-1"
              value={floorCountInput}
              onChange={(e) => setFloorCountInput(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-stone-200 rounded-lg hover:bg-stone-50 btn-press" onClick={() => setImportOpen(true)}>
            <ImageUp className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Import floor plan
          </button>
          <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 btn-press" onClick={handleCreate} disabled={createLayout.isPending}>
            <Plus className="h-4 w-4" strokeWidth={2} /> New draft
          </button>
        </div>
      </div>

      {/* Layout list */}
      <div className="flex flex-wrap gap-2">
        {layouts.map((l) => {
          const deletable = l.status === 'draft' || l.status === 'archived'
          const confirming = confirmDeleteId === l.id
          const selected = l.id === selectedLayoutId
          return (
            <div
              key={l.id}
              className={`inline-flex items-center rounded-lg border ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 bg-white'}`}
            >
              <button
                onClick={() => { setSelectedLayoutId(l.id); setSimulation(null); setConfirmDeleteId(null) }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs btn-press"
              >
                <span className="font-medium">{l.name}</span>
                <span className="text-stone-400">v{l.version}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${l.status === 'published' ? 'bg-emerald-100 text-emerald-700' : l.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                  {l.status}
                </span>
              </button>
              {deletable && !confirming && (
                <button
                  onClick={() => setConfirmDeleteId(l.id)}
                  className="mr-1 rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 btn-press"
                  aria-label={`Delete ${l.name}`}
                  title="Delete layout"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {confirming && (
                <span className="mr-1 inline-flex items-center gap-0.5">
                  <button
                    onClick={() => handleDelete(l.id)}
                    disabled={deleteLayout.isPending}
                    className="rounded-md p-1 text-red-600 hover:bg-red-100 disabled:opacity-50 btn-press"
                    aria-label="Confirm delete"
                    title="Confirm delete"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-md p-1 text-stone-400 hover:bg-stone-100 btn-press"
                    aria-label="Cancel delete"
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>
          )
        })}
        {layouts.length === 0 && <p className="text-xs text-stone-400">No layouts yet — create a draft to begin.</p>}
      </div>

      {notice && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</div>}

      {rejections && rejections.length > 0 && (
        <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
          <p className="font-semibold text-red-700">Can't publish yet:</p>
          {rejections.map((r) => <p key={r.code} className="text-red-600">• {r.message}</p>)}
        </div>
      )}

      {selectedLayout && (
        <div className="space-y-3">
          {!isDraft && (
            <div className="flex items-center justify-between gap-3 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
              <p className="text-xs text-stone-500">
                This layout is {selectedLayout.status} and read-only. Clone it to make changes.
              </p>
              <button
                type="button"
                onClick={() => cloneLayout.mutate({ layoutId: selectedLayout.id, name: `${selectedLayout.name} copy` })}
                disabled={cloneLayout.isPending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 btn-press"
              >
                <Copy className="h-4 w-4" strokeWidth={2} /> Clone to edit
              </button>
            </div>
          )}

          <LayoutToolbar
            isDraft={!!isDraft}
            tool={state.tool}
            onSelectTool={(t) => dispatch({ type: 'set_tool', tool: t })}
            forms={drawableForms.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            activeFormId={state.activeForm?.storageTypeId ?? null}
            onSelectForm={handleSelectForm}
            onGenerate={() => setWizardOpen(true)}
            floorCount={selectedLayout.floorCount}
            floor={state.floor}
            onSetFloor={(f) => dispatch({ type: 'set_floor', floor: f })}
            dirty={state.dirty}
            saving={saveGeometry.isPending}
            publishing={publishLayout.isPending}
            simulating={runSimulation.isPending}
            onSave={handleSave}
            onPublish={handlePublish}
            onClone={() => cloneLayout.mutate({ layoutId: selectedLayout.id, name: `${selectedLayout.name} copy` })}
            onSimulate={() => handleSimulate(selectedLayout.id)}
            onArchive={() => archiveLayout.mutate(selectedLayout.id)}
            onImport={() => setImportOpen(true)}
          />

          <div className="grid grid-cols-[1fr_240px] gap-3">
            <LayoutCanvas state={state} dispatch={dispatch} gridWidth={selectedLayout.gridWidth} gridHeight={selectedLayout.gridHeight} highlightRefs={isDraft ? highlightRefs : undefined} formColorById={formColorById} />
            <div className="space-y-3">
              {isDraft && <PublishChecklist readiness={readiness} onAutoConnect={canAutoConnect ? handleAutoConnect : undefined} />}
              {isDraft && (
                <CapacityAdvisor
                  requiredSlots={stockSummary.requiredSlots}
                  providedSlots={state.placements.reduce((s, p) => s + (p.capacitySlots ?? 0), 0)}
                  binCount={state.placements.length}
                  hasStock={stockSummary.hasStock}
                  loading={stockSummary.isLoading}
                />
              )}
              <PlacementInspector placement={selectedPlacement} dispatch={dispatch} zoneProfiles={zoneProfilesQuery.data ?? []} storageTypes={storageTypesQuery.data ?? []} />
            </div>
          </div>
          <LayoutLegend forms={drawableForms.map((t) => ({ id: t.id, name: t.name, color: t.color }))} />
          {isDraft && state.dirty && <p className="text-[11px] text-amber-600">Unsaved changes — Publish saves them for you automatically.</p>}

          {simulation && (
            <div className="max-w-md">
              <SimulationResultCard result={simulation} />
            </div>
          )}
        </div>
      )}

      {wizardOpen && selectedLayout && (
        <RackWizard
          dispatch={dispatch}
          zoneProfiles={zoneProfilesQuery.data ?? []}
          storageTypes={storageTypesQuery.data ?? []}
          gridWidth={selectedLayout.gridWidth}
          gridHeight={selectedLayout.gridHeight}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {importOpen && (
        <FloorPlanImportModal
          warehouse={warehouse}
          onClose={() => setImportOpen(false)}
          onDraftCreated={(layoutId) => {
            setImportOpen(false)
            setSelectedLayoutId(layoutId)
            setSimulation(null)
            setNotice('Draft created from your floor plan — review the racks, then Publish.')
          }}
        />
      )}

      {reslotOpen && selectedLayoutId && (
        <ReslotPlannerModal
          warehouse={warehouse}
          layoutId={selectedLayoutId}
          publishing={publishLayout.isPending || commitReslot.isPending}
          onCancel={() => setReslotOpen(false)}
          onApprove={handleReslotApprove}
        />
      )}
    </div>
  )
}
