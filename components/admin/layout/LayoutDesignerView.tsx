// Warehouse layout designer (Admin). Lists a warehouse's layouts, opens a draft
// on the grid canvas, and drives save/publish. Publishing builds the routing
// graph server-side (publish-layout) and opts the warehouse into rack-level
// tracking; validation failures surface as an actionable fix-it list. Draft and
// archived layouts can be deleted outright to keep the list clean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Check, X, ImageUp } from 'lucide-react'
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
import { useToasts } from '@/hooks/useToasts'
import type { PublishRejection, SaveObjectInput, SavePlacementInput } from '@/services/supabase/layoutService'
import type { SimulationResult, Warehouse } from '@/types'
import { LayoutCanvas } from './LayoutCanvas'
import { LayoutToolbar } from './LayoutToolbar'
import { LayoutLegend } from './LayoutLegend'
import { PlacementInspector } from './PlacementInspector'
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

  const codeByLocation = useMemo(() => {
    const map: Record<number, { code: string; name: string; kind: never; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; storageTypeId?: number }> = {}
    for (const l of locationsQuery.data ?? []) {
      map[l.id] = {
        code: l.code, name: l.name, kind: l.kind as never,
        capacitySlots: l.capacitySlots, slotKind: l.slotKind, storageTypeId: l.storageTypeId,
      }
    }
    return map
  }, [locationsQuery.data])

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

  const handleCreate = async () => {
    const floorCount = Math.min(10, Math.max(1, Math.round(floorCountInput) || 1))
    const layout = await createLayout.mutateAsync({ warehouse_id: warehouse.id, name: `Layout ${new Date().getFullYear()}`, floor_count: floorCount })
    setSelectedLayoutId(layout.id)
    setNotice(`Draft created — draw walkways, a dock, and ${STORAGE_UNIT.lowerPlural}, then Publish.`)
  }

  const handleSave = async () => {
    if (!selectedLayoutId) return
    const placements: SavePlacementInput[] = state.placements.map((p) => ({
      client_ref: p.clientRef,
      location_id: p.locationId,
      new_bin: p.locationId ? undefined : {
        parent_id: warehouse.id, kind: p.kind, code: p.code, name: p.name,
        capacity_slots: p.capacitySlots, slot_kind: p.slotKind, zone_profile_id: p.zoneProfileId,
        storage_type_id: p.storageTypeId,
      },
      floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
    }))
    const objects: SaveObjectInput[] = state.objects.map((o) => ({
      object_type: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
    }))
    const result = await saveGeometry.mutateAsync({ placements, objects })
    dispatch({ type: 'mark_saved', refMap: result.ref_map })
    setNotice('Saved.')
  }

  const handlePublish = async () => {
    if (!selectedLayoutId) return
    setRejections(null)
    const result = await publishLayout.mutateAsync(selectedLayoutId)
    if (result.ok) {
      setNotice('Published — this warehouse now uses rack-level putaway.')
      setSelectedLayoutId(null)
    } else {
      setRejections(result.rejections ?? [])
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
            <p className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
              This layout is {selectedLayout.status} and read-only. Clone it to make changes.
            </p>
          )}

          <LayoutToolbar
            isDraft={!!isDraft}
            tool={state.tool}
            onSelectTool={(t) => dispatch({ type: 'set_tool', tool: t })}
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
            <LayoutCanvas state={state} dispatch={dispatch} gridWidth={selectedLayout.gridWidth} gridHeight={selectedLayout.gridHeight} />
            <PlacementInspector placement={selectedPlacement} dispatch={dispatch} zoneProfiles={zoneProfilesQuery.data ?? []} storageTypes={storageTypesQuery.data ?? []} />
          </div>
          <LayoutLegend />
          {state.dirty && <p className="text-[11px] text-amber-600">Unsaved changes — save before publishing.</p>}

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
    </div>
  )
}
