// Warehouse layout designer (Admin). Lists a warehouse's layouts, opens a draft
// on the grid canvas, and drives save/publish. Publishing builds the routing
// graph server-side (publish-layout) and opts the warehouse into rack-level
// tracking; validation failures surface as an actionable fix-it list. Draft and
// archived layouts can be deleted outright to keep the list clean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Check, X, ImageUp, Copy, Wand2, Ruler } from 'lucide-react'
import { evaluatePublishReadiness } from '@/supabase/functions/_shared/wie/publishReadiness'
import { autoConnectLayout } from '@/supabase/functions/_shared/wie/autoConnect'
import { PUTAWAY_CANDIDATE_LIMIT } from '@/supabase/functions/_shared/wie/types'
import { useSetupAcks } from '@/hooks/queries/useWarehouseSetup'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useZoneProfiles } from '@/hooks/queries/useZoneProfiles'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import {
  useLayouts,
  useLayoutDetail,
  useCreateLayout,
  useUpdateLayout,
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
import type { PublishRejection } from '@/services/supabase/layoutService'
import type { CommitMove } from '@/services/supabase/reslotService'
import type { LayoutObjectType, LevelRole, SimulationResult, Warehouse } from '@/types'
import { LayoutCanvas } from './LayoutCanvas'
import { LayoutToolbar } from './LayoutToolbar'
import { LayoutLegend } from './LayoutLegend'
import { PlacementInspector } from './PlacementInspector'
import { ObjectInspector } from './ObjectInspector'
import { PublishChecklist } from './PublishChecklist'
import LayoutLabelBadge from '@/components/admin/labels/LayoutLabelBadge'
import { CapacityAdvisor } from './CapacityAdvisor'
import { ReslotPlannerModal } from './ReslotPlannerModal'
import { RackWizard } from './RackWizard'
import { FloorPlanImportModal } from './FloorPlanImportModal'
import { LayoutPropertiesModal, type LayoutPropertiesValues, type PreviewItem } from './LayoutPropertiesModal'
import { SimulationResultCard } from './SimulationResultCard'
import { OCCUPANT_LABEL, STORAGE_UNIT, TOOL_LABEL } from './labels'
import { editorUnits, useLayoutEditorState } from './useLayoutEditorState'
import { composeName, nextSeqForArea, sanitizeAreaName } from '@/lib/locationNaming'
import { areaCellsFingerprint, areaSpecsFromObjects } from '@/lib/areaPaint'
import { sanitizeSignNameInput, signCellsFingerprint, signSpecsFromObjects } from '@/lib/signPaint'
// The same confirm panel the live map uses. Deliberately not forked: the counts
// it shows are the server's dry run, and two copies would eventually disagree
// about what the operator was told before they pressed Save.
import { AreaPaintSummaryModal } from '@/components/inventory/warehouse/AreaPaintSummaryModal'
import { buildSaveGeometryPayload } from './savePayload'
import { resolveLayoutOverlaps } from './resolveOverlaps'

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
  // Layout header editor. 'create' births a draft; 'edit' changes an existing
  // one's building size or resolution. null = closed.
  const [propertiesMode, setPropertiesMode] = useState<'create' | 'edit' | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [reslotOpen, setReslotOpen] = useState(false)
  const detailQuery = useLayoutDetail(selectedLayoutId)

  const [state, dispatch] = useLayoutEditorState(warehouse.code)
  const [rejections, setRejections] = useState<PublishRejection[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [simulation, setSimulation] = useState<SimulationResult | null>(null)
  const hydratedLayoutRef = useRef<number | null>(null)
  // Live area painting (mig 00095).
  const [areaConfirmOpen, setAreaConfirmOpen] = useState(false)
  const areaBaseFingerprintRef = useRef<string>('')
  // Floor signs (mig 00097) — their own baseline, see the hydrate effect.
  const signBaseFingerprintRef = useRef<string>('')
  const { addToast } = useToasts()

  const createLayout = useCreateLayout(warehouse.id)
  const updateLayout = useUpdateLayout(warehouse.id)
  const cloneLayout = useCloneLayout(warehouse.id)
  const archiveLayout = useArchiveLayout(warehouse.id)
  const deleteLayout = useDeleteLayout(warehouse.id)
  const saveGeometry = useSaveGeometry(selectedLayoutId ?? 0, warehouse.id)
  const publishLayout = usePublishLayout(warehouse.id)
  const runSimulation = useRunSimulation()
  const stockSummary = useWarehouseStockSummary(warehouse.id)
  const commitReslot = useCommitReslotPlan(warehouse.id)

  /** zone_profiles.id → zone_type, so a named area draws in its zone's tint on
   *  both canvases (WarehouseCanvas builds the identical map). */
  const zoneTypeByProfileId = useMemo(() => {
    const map = new Map<number, string>()
    for (const zp of zoneProfilesQuery.data ?? []) map.set(zp.id, zp.zoneType)
    return map
  }, [zoneProfilesQuery.data])

  /** Distinct area names already drawn on the current floor, in first-drawn
   *  order — the toolbar offers these so extending an area is a click rather
   *  than retyping its name, where one typo would silently start a second area. */
  const areaNamesOnFloor = useMemo(() => {
    const names: string[] = []
    for (const o of state.objects) {
      if (o.floor !== state.floor || o.objectType !== 'area') continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name : ''
      if (name && !names.includes(name)) names.push(name)
    }
    return names
  }, [state.objects, state.floor])

  /** Distinct sign texts already placed on the current floor (mig 00097). Same
   *  purpose as areaNamesOnFloor: extending a sign must be a click, because a
   *  typo starts a second one. */
  const signNamesOnFloor = useMemo(() => {
    const names: string[] = []
    for (const o of state.objects) {
      if (o.floor !== state.floor || o.objectType !== 'label') continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name : ''
      if (name && !names.includes(name)) names.push(name)
    }
    return names
  }, [state.objects, state.floor])

  /** What the next rack painted into the active area will be called (mig 00094).
   *  Produced by the same pure module the reducer and the server use, so the
   *  hint cannot drift from what actually gets stored. */
  const nextRackName = useMemo(() => {
    const areaName = sanitizeAreaName(state.activeArea?.name ?? '')
    return composeName(areaName, nextSeqForArea(editorUnits(state.placements), areaName))
  }, [state.activeArea, state.placements])

  const codeByLocation = useMemo(() => {
    const map: Record<number, { code: string; name: string; kind: never; capacitySlots?: number; slotKind?: 'pallet' | 'carton'; weightCapacityKg?: number; storageTypeId?: number; parentId?: number; levelRole?: LevelRole; levelIndex?: number; nameSeq?: number | null; nameArea?: string | null; nameIsAuto?: boolean }> = {}
    for (const l of locationsQuery.data ?? []) {
      map[l.id] = {
        code: l.code, name: l.name, kind: l.kind as never,
        capacitySlots: l.capacitySlots, slotKind: l.slotKind, weightCapacityKg: l.weightCapacityKg, storageTypeId: l.storageTypeId,
        // Level metadata so the reducer's `load` can rebuild a levelled rack's
        // embedded levels[] instead of falling back to the form standard.
        parentId: l.parentId, levelRole: l.levelRole, levelIndex: l.levelIndex,
        // Name provenance (mig 00094) — without it a reload would treat every
        // saved rack as never-numbered and hand it a second number.
        nameSeq: l.nameSeq, nameArea: l.nameArea, nameIsAuto: l.nameIsAuto,
      }
    }
    return map
  }, [locationsQuery.data])

  // Which unit the drawn bins measure capacity in. A layout of pallet bays is
  // counted in POSITIONS (a pallet takes one, mig 00078), so the advisor must
  // compare like with like — otherwise 36 pallets in 36 positions reads as a
  // 430-slot shortfall. Majority wins; a mixed layout falls back to per-unit,
  // which over-states demand and is therefore the safe side to be wrong on.
  const palletDenominated = useMemo(() => {
    const capped = state.placements.filter((p) => (p.capacitySlots ?? 0) > 0)
    if (capped.length === 0) return false
    return capped.filter((p) => p.slotKind === 'pallet').length * 2 > capped.length
  }, [state.placements])

  // locationId → code, for the object inspector's "linked staging location" line.
  const locationCodeById = useMemo(() => {
    const map = new Map<number, string>()
    for (const l of locationsQuery.data ?? []) map.set(l.id, l.code)
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
        // Racks painted with this form inherit its STANDARD level layout
        // (mig 00072); individual racks override it in the inspector. Only
        // forms that opted into levels carry one.
        levelTemplate: t.hasLevels ? t.levelTemplate : undefined,
      },
    })
  }

  // Hydrate the editor once per selected layout — NOT on every refetch, so a
  // background invalidation can't wipe the operator's unsaved canvas edits. Wait
  // for locations too, so existing racks hydrate with their real code/capacity.
  useEffect(() => {
    if (detailQuery.data && locationsQuery.data && selectedLayoutId && hydratedLayoutRef.current !== selectedLayoutId) {
      hydratedLayoutRef.current = selectedLayoutId
      const status = (layoutsQuery.data ?? []).find((l) => l.id === selectedLayoutId)?.status
      // Scope FIRST: `load` spreads `...state`, so the scope survives it, and a
      // scope applied afterwards would leave one render in which a published
      // layout's geometry tools were live.
      dispatch({ type: 'set_edit_scope', scope: status === 'draft' ? 'all' : 'areas' })
      // The picture this session's area edits are based on, captured ONCE. Never
      // recomputed from live query data: a background refetch would move the
      // baseline and leave the conflict check comparing the server's picture
      // against itself.
      areaBaseFingerprintRef.current = areaCellsFingerprint(detailQuery.data.objects as never)
      // Signs get their OWN baseline (mig 00097). Sharing the area one would make
      // an area paint 409 a sign save and vice versa — the two pictures move
      // independently and each server action checks only its own.
      signBaseFingerprintRef.current = signCellsFingerprint(detailQuery.data.objects as never)
      dispatch({
        type: 'load',
        placements: detailQuery.data.placements,
        objects: detailQuery.data.objects,
        codeByLocation,
      })
    }
  }, [detailQuery.data, locationsQuery.data, selectedLayoutId, codeByLocation, dispatch, layoutsQuery.data])

  const layouts = layoutsQuery.data ?? []
  const selectedLayout = layouts.find((l) => l.id === selectedLayoutId) ?? null
  const isDraft = selectedLayout?.status === 'draft'
  // Two axes, not one flag (mig 00095). Geometry is frozen at publish — the
  // routing graph, every edge weight and every access offset were computed from
  // it — but an `area` carries none of that, so it stays editable for life.
  const canEditAreas = isDraft || selectedLayout?.status === 'published'
  const areaOnly = !!canEditAreas && !isDraft

  // ── Stale-draft warning (mig 00095) ────────────────────────────────────────
  //
  // Areas can now be repainted on the LIVE layout, so a draft cloned before that
  // happened would silently discard the operator's labelling the moment it is
  // published — save_geometry is a full replace.
  //
  // Compared by FINGERPRINT and not by timestamp, and that is not a preference:
  // paint_areas deliberately does not bump warehouse_layouts.updated_at (it must
  // not, or needsRepublish would demand a routing rebuild for a wayfinding edit),
  // so there is NO timestamp that moves when areas change. Reaching for one here
  // would find it stale and conclude this warning is broken.
  //
  // Gated on `clonedFrom` deliberately: a draft drawn from scratch was never
  // meant to match the live areas, and nagging about it trains the operator to
  // ignore the banner.
  const publishedLayout = layouts.find((l) => l.status === 'published') ?? null
  const draftClonedFromLive =
    isDraft && publishedLayout != null && selectedLayout?.clonedFrom === publishedLayout.id
  const publishedDetailQuery = useLayoutDetail(draftClonedFromLive ? publishedLayout!.id : null)
  const liveAreas = publishedDetailQuery.data?.objects
  const liveAreasDiffer = useMemo(() => {
    if (!draftClonedFromLive || !liveAreas) return false
    return areaCellsFingerprint(liveAreas as never) !== areaCellsFingerprint(state.objects as never)
  }, [draftClonedFromLive, liveAreas, state.objects])
  const selectedPlacement = state.placements.find((p) => p.clientRef === state.selectedRef) ?? null
  // A selection is either a placement (rack) or a structural object
  // (obstacle/staging/label/…) — never both, since clientRefs don't collide.
  const selectedObject = !selectedPlacement ? state.objects.find((o) => o.clientRef === state.selectedRef) ?? null : null

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

  // How many addressable LOCATIONS this layout will publish. Not the placement
  // count: a levelled rack holds no placement row of its own — its SHELF levels
  // do — so a 189-bay site at 5 levels/rack is 945 locations. That is the
  // number wie_putaway_candidates' hard cutoff counts against.
  const addressableLocations = useMemo(
    () => state.placements.reduce((sum, p) => sum + (p.levels?.length || 1), 0),
    [state.placements],
  )
  // Warn while there is still room to reorganise, not at the cliff. Past the
  // ceiling the FARTHEST bays vanish from the engine silently — stock is never
  // recommended there and nothing reports it.
  const nearCandidateCeiling = addressableLocations >= PUTAWAY_CANDIDATE_LIMIT * 0.9

  // Level roles and zone profiles both ship SEEDED, so "are any configured" is
  // permanently true and worthless as a gate. What matters is whether anyone
  // checked them against this building — which is a sign-off on the setup
  // checklist, and is what this reads.
  const { data: setupAcks } = useSetupAcks(warehouse.id)
  const unreviewedConfig = useMemo(() => {
    const done = new Set((setupAcks ?? []).map((a) => a.stepKey))
    return [
      { key: 'level_roles_reviewed', label: 'Level roles' },
      { key: 'zone_profiles_reviewed', label: 'Zone profiles' },
    ].filter((c) => !done.has(c.key))
  }, [setupAcks])
  const configReviewed = unreviewedConfig.length === 0
  const unreviewedConfigCount = unreviewedConfig.length
  const unreviewedConfigLabel = unreviewedConfig.map((c) => c.label).join(' and ')

  // Pre-existing overlaps in the loaded draft. Draw-time prevention can't help a
  // layout that already has them — cloning an older layout and AI floor-plan
  // import both bypass the reducer's paint branch. One memo serves both the
  // banner's visibility and the button's payload; it's two Map passes over the
  // cells, strictly cheaper than the BFS the readiness memo above already runs.
  const overlapReport = useMemo(
    () => resolveLayoutOverlaps(state.objects, state.placements),
    [state.objects, state.placements],
  )
  const hasOverlaps = !!isDraft && (overlapReport.changed || overlapReport.placementConflicts.length > 0)

  // Refused-paint hint. paint_cell fires once per cell CROSSED during a drag, so a
  // 40-cell drag over a wall would raise 40 toasts (addToast has no dedupe and each
  // lives 5s). The canvas flash gives free per-cell feedback; this cooldown caps the
  // toast at one per stroke-ish regardless of drag length. Dep list is `seq` only,
  // so no unrelated re-render can re-fire it.
  const BLOCKED_TOAST_COOLDOWN_MS = 4_000
  const lastBlockedToastAt = useRef(0)
  const blockedSeq = state.blockedAt?.seq
  useEffect(() => {
    const b = state.blockedAt
    if (!b) return
    const now = Date.now()
    if (now - lastBlockedToastAt.current < BLOCKED_TOAST_COOLDOWN_MS) return
    lastBlockedToastAt.current = now
    addToast(
      b.reason === 'unnamed'
        // The bug this message exists for: the Area tool armed on click, so
        // painting before typing wrote cells belonging to nothing — invisible on
        // the map and rejected on save. Say which box to fill in.
        ? b.tool === 'label'
          ? 'Type the sign’s text first — a sign is its text, so there is nothing to draw yet.'
          : 'Name the area first — an area is its name, so there is nothing to draw yet.'
        : b.count != null
          ? `Skipped ${b.count} cell${b.count === 1 ? '' : 's'} that already hold something else.`
          : `Can't draw ${TOOL_LABEL[b.tool]} at (${b.x},${b.y}) — that cell is already a ${OCCUPANT_LABEL[b.blockedBy!]}. Erase it first, or use Clean up overlaps.`,
      'info',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedSeq])

  // What a batch fill just named. RackWizard closes its modal on submit, so a
  // fill spanning two areas would otherwise mint two number ranges the operator
  // never sees. Same seq-keyed hint channel as blockedAt above.
  const lastFillSeq = state.lastFill?.seq
  useEffect(() => {
    const fill = state.lastFill
    if (!fill || !fill.ranges) return
    addToast(`Named ${fill.count} bin${fill.count === 1 ? '' : 's'} — ${fill.ranges}.`, 'info')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastFillSeq])

  // Resolve every cell with more than one owner. Placements are never removed —
  // a bin may already be a real `locations` row with stock, a label and open pick
  // tasks, whereas a wall costs one drag to redraw — so a bin-vs-object clash
  // drops the object and REPORTS it, and a bin-vs-bin clash is reported only.
  const handleCleanUpOverlaps = () => {
    if (!overlapReport.changed && overlapReport.placementConflicts.length === 0) {
      addToast('No overlaps to clean up.', 'info')
      return
    }
    if (overlapReport.changed) {
      dispatch({
        type: 'apply_overlap_repair',
        objects: overlapReport.objects.map((o) => ({
          objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
          meta: o.meta, stagingLocationId: o.stagingLocationId,
        })),
      })
    }

    const parts: string[] = []
    if (overlapReport.removedObjectCells > 0) {
      parts.push(`Cleared ${overlapReport.removedObjectCells} overlapping cell${overlapReport.removedObjectCells === 1 ? '' : 's'}.`)
    }
    if (overlapReport.removedObjects > 0) {
      parts.push(`Removed ${overlapReport.removedObjects} fully-covered object${overlapReport.removedObjects === 1 ? '' : 's'}.`)
    }
    if (overlapReport.binConflicts.length > 0) {
      const saved = overlapReport.binConflicts.filter((c) => c.saved)
      const savedCodes = [...new Set(saved.map((c) => c.placementCode))]
      parts.push(
        `${overlapReport.binConflicts.length} cell${overlapReport.binConflicts.length === 1 ? '' : 's'} kept the ${STORAGE_UNIT.lower} and lost what was drawn over it` +
          (savedCodes.length > 0 ? ` (${savedCodes.length} already saved: ${savedCodes.slice(0, 4).join(', ')}${savedCodes.length > 4 ? '…' : ''}).` : '.'),
      )
    }
    if (overlapReport.placementConflicts.length > 0) {
      const codes = [...new Set(overlapReport.placementConflicts.flatMap((c) => c.codes))]
      parts.push(
        `${overlapReport.placementConflicts.length} cell${overlapReport.placementConflicts.length === 1 ? '' : 's'} hold two ${STORAGE_UNIT.lowerPlural} — erase one by hand: ${codes.slice(0, 4).join(' / ')}${codes.length > 4 ? '…' : ''}.`,
      )
    }
    addToast(parts.join(' ') || 'Nothing to change.', overlapReport.placementConflicts.length > 0 ? 'info' : 'success')
  }

  // Repair unreachable bins in one click: carve docks out of overlapping walls
  // and route new 1×1 walkway cells from the reachable network to every
  // stranded bin. Uses the exact same objects/placements→ConnectObject/
  // ConnectPlacement mapping as the readiness memo above so `stillUnreachable`
  // lines up with `readiness.unreachableIds`.
  const handleAutoConnect = () => {
    if (!selectedLayout) return
    const result = autoConnectLayout({
      objects: state.objects.map((o) => ({
        objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        meta: o.meta, stagingLocationId: o.stagingLocationId,
      })),
      placements: state.placements.map((p) => ({ id: p.clientRef, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
      gridWidth: selectedLayout.gridWidth,
      gridHeight: selectedLayout.gridHeight,
      floors: selectedLayout.floorCount,
      cellSizeM: selectedLayout.cellSizeM,
    })

    if (!result.changed) {
      addToast('Nothing to auto-connect — layout is already fully routed.', 'info')
      return
    }

    // De-overlap the engine's output before it lands. autoConnectLayout is very
    // nearly overlap-free already (its `isFree` excludes walls, obstacles,
    // conveyors and placement cells), but an UNREACHABLE lift cell is `isFree` and
    // in neither the reachable nor the current-walkway set, so a BFS path can lay a
    // walkway straight over it. Running the same resolver used by "Clean up
    // overlaps" also collapses duplicate 1×1 wall fragments left by the dock carve.
    const connected = result.objects.map((o, i) => ({
      clientRef: `ac${i}`,
      objectType: o.objectType as LayoutObjectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
      meta: o.meta, stagingLocationId: (o as { stagingLocationId?: number }).stagingLocationId,
    }))
    const cleaned = resolveLayoutOverlaps(connected, state.placements)

    dispatch({
      type: 'apply_auto_connect',
      objects: cleaned.objects.map((o) => ({
        objectType: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
        meta: o.meta, stagingLocationId: o.stagingLocationId,
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

  // What the properties modal previews a rescale against. Labels are what a
  // refusal names, so they must be something the operator can walk to: a bin's
  // code, or an object described by type and position.
  const previewPlacements = useMemo<PreviewItem[]>(
    () => state.placements.map((p) => ({ label: p.code || p.clientRef, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
    [state.placements],
  )
  const previewObjects = useMemo<PreviewItem[]>(
    () => state.objects.map((o) => ({ label: `${o.objectType} at (${o.x},${o.y})`, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
    [state.objects],
  )

  /** Editing the header rescales rows in the DATABASE while the canvas holds its
   *  own copy of the geometry. Saving first is the only way those two stay in
   *  agreement — anything cleverer silently desynchronises them. */
  const openProperties = (mode: 'create' | 'edit') => {
    if (mode === 'edit' && state.dirty) {
      addToast('Save or discard your changes before editing the layout properties.', 'info')
      return
    }
    setPropertiesMode(mode)
  }

  const handlePropertiesSubmit = async (v: LayoutPropertiesValues) => {
    try {
      if (propertiesMode === 'create') {
        const layout = await createLayout.mutateAsync({
          warehouse_id: warehouse.id,
          name: v.name,
          grid_width: v.gridWidth,
          grid_height: v.gridHeight,
          cell_size_m: v.cellSizeM,
          floor_count: v.floorCount,
        })
        setSelectedLayoutId(layout.id)
        setNotice(`Draft created — draw walkways, a dock, and ${STORAGE_UNIT.lowerPlural}, then Publish.`)
      } else if (selectedLayout) {
        const rescaled = v.cellSizeM !== selectedLayout.cellSizeM
        const updated = await updateLayout.mutateAsync({
          layout_id: selectedLayout.id,
          name: v.name,
          grid_width: v.gridWidth,
          grid_height: v.gridHeight,
          cell_size_m: v.cellSizeM,
          floor_count: v.floorCount,
        })
        setNotice(
          rescaled
            ? `Now ${v.cellSizeM} m per cell — everything was rescaled to keep its real size.` +
                (updated.status === 'published' ? ' Publish again to update travel distances.' : '')
            : 'Layout properties saved.',
        )
      }
      setPropertiesMode(null)
    } catch (error) {
      // The server names the offending racks/walls; surface it verbatim rather
      // than a generic failure, because the message IS the fix instruction.
      addToast(error instanceof Error ? error.message : 'Failed to save layout properties', 'error')
    }
  }

  // Persist the current canvas geometry and reconcile client refs → real location
  // ids. Shared by explicit Save and by the one-click Save & Publish path.
  const persistGeometry = async () => {
    if (!selectedLayoutId) return
    // The editor-state -> wire translation is a pure function in savePayload.ts
    // so the contract with mutate-layout can be asserted in a test; it used to
    // live inline here, where the one `null` that broke every Shelving save was
    // invisible to both tsc and the suite.
    const { placements, objects, area_renames } = buildSaveGeometryPayload(state.placements, state.objects, {
      warehouseId: warehouse.id,
      warehouseCode: warehouse.code,
      layoutId: selectedLayoutId,
    }, state.pendingRenames)
    const result = await saveGeometry.mutateAsync({ placements, objects, areaRenames: area_renames })
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

  // On a PUBLISHED layout, Save routes to `paint_areas` instead — a narrow,
  // area-only replace. It must NEVER route to save_geometry: that is a full
  // replace of every placement and object plus an orphan sweep that hard-deletes
  // `locations` rows, and on a live site those rows hold stock.
  const areaSpecs = useMemo(() => areaSpecsFromObjects(state.objects as never), [state.objects])
  // Signs ride the same Save (mig 00097) through their own action. Folded here
  // rather than in the modal so the designer and the live map hand it identical
  // specs — the same reason areaSpecs is folded here.
  const signSpecs = useMemo(() => signSpecsFromObjects(state.objects as never), [state.objects])

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
          {selectedLayout && (
            <button
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-stone-200 rounded-lg hover:bg-stone-50 btn-press"
              onClick={() => openProperties('edit')}
              title={state.dirty ? 'Save or discard your changes first' : 'Floor size, resolution and floors'}
            >
              <Ruler className="h-4 w-4 text-stone-500" strokeWidth={2} /> Properties
            </button>
          )}
          <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-stone-200 rounded-lg hover:bg-stone-50 btn-press" onClick={() => setImportOpen(true)}>
            <ImageUp className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Import floor plan
          </button>
          <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 btn-press" onClick={() => openProperties('create')} disabled={createLayout.isPending}>
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
                  // Deleting a draft while its Save is still in flight is a
                  // TOCTOU race: rows inserted after delete_layout's GC took its
                  // snapshot survive as orphans the GC never sees. Block the
                  // delete until the save settles rather than trying to
                  // reconcile afterwards.
                  disabled={saveGeometry.isPending}
                  className="mr-1 rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400 btn-press"
                  aria-label={`Delete ${l.name}`}
                  title={saveGeometry.isPending ? 'Saving — wait before deleting' : 'Delete layout'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {confirming && (
                <span className="mr-1 inline-flex items-center gap-0.5">
                  <button
                    onClick={() => handleDelete(l.id)}
                    disabled={deleteLayout.isPending || saveGeometry.isPending}
                    className="rounded-md p-1 text-red-600 hover:bg-red-100 disabled:opacity-50 btn-press"
                    aria-label="Confirm delete"
                    title={saveGeometry.isPending ? 'Saving — wait before deleting' : 'Confirm delete'}
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

      {/* A live layout's travel graph is frozen at publish, so a header change is
          inert until it is rebuilt. Without this the operator changes the scale,
          sees every distance stay exactly as it was, and has no way to tell that
          from a bug. */}
      {selectedLayout?.needsRepublish && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This layout's properties changed after it was published. Travel distances still reflect the old
          settings — publish it again to rebuild them.
        </div>
      )}

      {rejections && rejections.length > 0 && (
        <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
          <p className="font-semibold text-red-700">Can't publish yet:</p>
          {rejections.map((r) => <p key={r.code} className="text-red-600">• {r.message}</p>)}
        </div>
      )}

      {selectedLayout && (
        <div className="space-y-3">
          {liveAreasDiffer && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-900">
                The live layout's named areas have changed since this draft was cloned. Publishing
                this draft will replace them.
              </p>
              <button
                type="button"
                onClick={() => dispatch({
                  type: 'replace_areas',
                  objects: (liveAreas ?? [])
                    .filter((o) => o.objectType === 'area')
                    .map((o) => ({ floor: o.floor, x: o.x, y: o.y, meta: o.meta })),
                })}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 btn-press"
              >
                Pull in live areas
              </button>
            </div>
          )}

          {!isDraft && (
            <div className="flex items-center justify-between gap-3 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
              <p className="text-xs text-stone-500">
                {areaOnly
                  ? 'This layout is published. You can repaint named areas and floor signs here; everything else is read-only — clone it to change the geometry.'
                  : `This layout is ${selectedLayout.status} and read-only. Clone it to make changes.`}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {/* Labels only make sense once the geometry is final — a draft's
                    bins can still be moved or renamed out from under a sticker. */}
                {selectedLayout.status === 'published' && (
                  <LayoutLabelBadge
                    layoutId={selectedLayout.id}
                    layoutName={selectedLayout.name}
                    dense
                  />
                )}
                <button
                  type="button"
                  onClick={() => cloneLayout.mutate({ layoutId: selectedLayout.id, name: `${selectedLayout.name} copy` })}
                  disabled={cloneLayout.isPending}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 btn-press"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} /> Clone to edit
                </button>
              </div>
            </div>
          )}

          <LayoutToolbar
            isDraft={!!isDraft}
            canEditAreas={!!canEditAreas}
            areaOnly={areaOnly}
            tool={state.tool}
            onSelectTool={(t) => dispatch({ type: 'set_tool', tool: t })}
            forms={drawableForms.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            activeFormId={state.activeForm?.storageTypeId ?? null}
            onSelectForm={handleSelectForm}
            onGenerate={() => setWizardOpen(true)}
            areaNames={areaNamesOnFloor}
            activeArea={state.activeArea}
            onSelectArea={(area) => dispatch({ type: 'set_area', area })}
            nextRackName={nextRackName}
            signNames={signNamesOnFloor}
            activeSign={state.activeSign}
            onSelectSign={(name) => dispatch({ type: 'set_sign', name: sanitizeSignNameInput(name) })}
            zoneProfiles={(zoneProfilesQuery.data ?? []).map((zp) => ({ id: zp.id, name: zp.name }))}
            floorCount={selectedLayout.floorCount}
            floor={state.floor}
            onSetFloor={(f) => dispatch({ type: 'set_floor', floor: f })}
            dirty={state.dirty}
            saving={saveGeometry.isPending}
            publishing={publishLayout.isPending}
            simulating={runSimulation.isPending}
            onSave={areaOnly ? () => setAreaConfirmOpen(true) : handleSave}
            onPublish={handlePublish}
            onClone={() => cloneLayout.mutate({ layoutId: selectedLayout.id, name: `${selectedLayout.name} copy` })}
            onSimulate={() => handleSimulate(selectedLayout.id)}
            onArchive={() => archiveLayout.mutate(selectedLayout.id)}
            onImport={() => setImportOpen(true)}
          />

          {/* Overlaps that predate draw-time prevention (a cloned layout, an AI
              import). Self-dismissing: the banner is gone the moment it's repaired,
              so it adds no clutter in the normal case. Deliberately NOT a
              PublishChecklist row — a row there reads as a gate, and overlaps don't
              block publish. */}
          {hasOverlaps && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-800">
                {overlapReport.removedObjectCells > 0 || overlapReport.removedObjects > 0
                  ? `${overlapReport.removedObjectCells} cell${overlapReport.removedObjectCells === 1 ? '' : 's'} have more than one thing drawn on them. Overlaps hide walkways and docks from the routing engine, which shows up later as "no walkways" or unreachable ${STORAGE_UNIT.lowerPlural}.`
                  : `${overlapReport.placementConflicts.length} cell${overlapReport.placementConflicts.length === 1 ? '' : 's'} hold two ${STORAGE_UNIT.lowerPlural}. Erase one of each pair — nothing else can decide which to keep.`}
              </p>
              <button
                type="button"
                onClick={handleCleanUpOverlaps}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 btn-press"
              >
                <Wand2 className="h-4 w-4" strokeWidth={2} /> Clean up overlaps
              </button>
            </div>
          )}

          <div className="grid grid-cols-[1fr_240px] gap-3">
            <LayoutCanvas state={state} dispatch={dispatch} gridWidth={selectedLayout.gridWidth} gridHeight={selectedLayout.gridHeight} cellSizeM={selectedLayout.cellSizeM} highlightRefs={isDraft ? highlightRefs : undefined} formColorById={formColorById} zoneTypeByProfileId={zoneTypeByProfileId} />
            <div className="space-y-3">
              {isDraft && <PublishChecklist readiness={readiness} onAutoConnect={canAutoConnect ? handleAutoConnect : undefined} />}
              {isDraft && nearCandidateCeiling && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                  <p className="font-semibold">Approaching the putaway engine's limit</p>
                  <p className="mt-1">
                    This layout publishes {addressableLocations.toLocaleString()} addressable locations;
                    the engine loads at most {PUTAWAY_CANDIDATE_LIMIT.toLocaleString()} candidates per line,
                    ordered by distance from the dock. Past that the furthest bays stop being offered for
                    putaway — silently, with no error. Consider fewer rack levels or a second warehouse.
                  </p>
                </div>
              )}
              {isDraft && !configReviewed && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                  <p className="font-semibold">Config not checked for this site</p>
                  <p className="mt-1">
                    {unreviewedConfigLabel} still {unreviewedConfigCount === 1 ? 'shows' : 'show'} as
                    unchecked on the warehouse setup checklist. Publishing creates every bin with the level
                    roles and zones it inherits from that config, so it is worth settling first.
                  </p>
                </div>
              )}
              {isDraft && (
                <CapacityAdvisor
                  requiredSlots={palletDenominated ? stockSummary.requiredPositions : stockSummary.requiredSlots}
                  providedSlots={state.placements.reduce((s, p) => s + (p.capacitySlots ?? 0), 0)}
                  binCount={state.placements.length}
                  slotKind={palletDenominated ? 'pallet' : 'carton'}
                  hasStock={stockSummary.hasStock}
                  loading={stockSummary.isLoading}
                />
              )}
              {/* In area-only scope the placement inspector is not merely
                  useless, it is misleading: the reducer no-ops update_placement,
                  and a control that silently does nothing is worse than an
                  absent one. An AREA object still gets its inspector. */}
              {selectedObject
                ? (!areaOnly || selectedObject.objectType === 'area') && (
                    <ObjectInspector object={selectedObject} dispatch={dispatch} locationCodeById={locationCodeById} />
                  )
                : !areaOnly && (
                    <PlacementInspector placement={selectedPlacement} dispatch={dispatch} zoneProfiles={zoneProfilesQuery.data ?? []} storageTypes={storageTypesQuery.data ?? []} selectedCount={state.selectedRefs?.size ?? 0} />
                  )}
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

      {areaConfirmOpen && selectedLayout && (
        <AreaPaintSummaryModal
          warehouseId={warehouse.id}
          layoutId={selectedLayout.id}
          baseFingerprint={areaBaseFingerprintRef.current}
          specs={areaSpecs}
          signSpecs={signSpecs}
          signBaseFingerprint={signBaseFingerprintRef.current}
          floorCount={selectedLayout.floorCount}
          onClose={() => setAreaConfirmOpen(false)}
          onSaved={() => {
            setAreaConfirmOpen(false)
            // Force a re-hydrate from the server's answer rather than inventing a
            // placement-shaped refMap for a payload that has none. `mark_saved`
            // gives the geometry path the same "the server wins" contract; this
            // is that contract, expressed through the load effect.
            hydratedLayoutRef.current = null
            setNotice('Areas saved.')
          }}
        />
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

      <LayoutPropertiesModal
        open={propertiesMode !== null}
        mode={propertiesMode ?? 'create'}
        layout={propertiesMode === 'edit' ? selectedLayout : null}
        placements={previewPlacements}
        objects={previewObjects}
        busy={createLayout.isPending || updateLayout.isPending}
        onClose={() => setPropertiesMode(null)}
        onSubmit={handlePropertiesSubmit}
      />

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
