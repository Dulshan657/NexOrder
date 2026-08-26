// The racked (published-layout) workspace: a tall pan/zoom map with an
// overlay-controls strip and a tree/bin-detail/test-bench panel row stacked
// below it in normal document flow. Owns all interactive state (selection,
// floor, overlay, dry-run results) — moved unchanged from the former inline
// `RackedWarehouseView` in WarehousePage.tsx.
//
// Responsive contract: single column at every width. Below `md` the map
// keeps a fixed `aspect-[4/3]` box and gestures are disabled (tap-to-select
// only); at `md+` the map is a tall `h-[65vh]` block. The panel row below it
// is `lg:grid-cols-[...]` (asymmetric: tree | bin detail | ask-engine) and
// collapses to one stacked column below `lg`. Nothing floats over the map
// except MapControls and the hint pill, both inside MapStage's own stacking
// context — this component no longer needs one of its own.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InventoryLocation, LayoutObject, LayoutPlacement, PickRouteStop } from '@/types'
import { useLayoutDetail, useLayouts } from '@/hooks/queries/useLayouts'
import { usePickRoute } from '@/hooks/queries/usePickRoute'
import { useStorageTypes } from '@/hooks/queries/useStorageTypes'
import { useZoneProfiles } from '@/hooks/queries/useZoneProfiles'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { useWarehouseMapLayers } from './useWarehouseMapLayers'
import { deriveMapMode, modeGuards } from './mapMode'
import { MapStage } from './MapStage'
import type { SelectionCell } from './MapSelectionLayer'
import { FloatingPanel } from './FloatingPanel'
import { WarehouseTreePanel } from './WarehouseTreePanel'
import { BinDetailPanel } from './BinDetailPanel'
import { buildHeldLocationIds } from '@/lib/heldLocations'
import { RenameAreaModal } from './RenameAreaModal'
import { BindZonesModal } from './BindZonesModal'
import { EditSignModal } from './EditSignModal'
import { AreaPaintToolbar } from './AreaPaintToolbar'
import { AreaPaintSummaryModal } from './AreaPaintSummaryModal'
import { LayoutLabelJobModal } from '@/components/admin/labels/LayoutLabelJobModal'
import { RecodePanel } from './recode/RecodePanel'
import { useRecodeSelection, type MarqueeRect, type RecodeStep } from './recode/useRecodeSelection'
import { useSlotSelection, type SlotStep } from './slotting/useSlotSelection'
import { useProducts } from '@/hooks/queries/useProducts'
import { SlottingPanel, type SlotApplied } from './slotting/SlottingPanel'
import {
  useSlottingRows,
  useSlottingBlockBins,
  useSaveSlottingBlock,
  useSaveSlottingRule,
} from '@/hooks/queries/useSlottingRules'
import { useOffHomeTasks } from '@/hooks/queries/useOffHome'
import {
  areasOfSelection, blockCensus, buildLevelIdsByRack, buildUnitPlacements,
  incumbentsOfBlock, takenCodesFromLocations, unitsAtCell, unitsFromSelection,
  unitsInArea, unitsInRect, warehouseCodeOf,
} from './recode/recodeGeometry'
import { ghostLabels, visibleControls, type GhostLabel } from './recode/recodePlanView'
import { WIZARD_DEFAULT_PATTERN, planRecode, sanitizeBlock } from '@/lib/codePattern'
import { useLatestCodeSweep, useRecodeLocations, useRevertCodeSweep } from '@/hooks/queries/useWarehouseLocations'
import { useWarehouseCodePattern, useSetWarehouseCodePattern } from '@/hooks/queries/useWarehouses'
import { previewRecode, type RecodePreview } from '@/services/supabase/warehouseLocationService'
import { useAreaPaintState } from './useAreaPaintState'
import { areaCellsFingerprint } from '@/lib/areaPaint'
import { signCellsFingerprint } from '@/lib/signPaint'
import { OverlayControls } from './OverlayControls'
import { AskEnginePanel } from './AskEnginePanel'
import { slottingArrows, routePath, putawayMarkers } from './warehouseMarkers'
import type { OverlayKind } from './warehouseOverlays'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { useToasts } from '@/hooks/useToasts'
import { useWarehouseLabelPrefs } from '@/hooks/queries/useLabelJobs'
import { resolvePreset } from '@/supabase/functions/_shared/labels/layoutLabelPlan'

/** Module-level for the same identity reason as NOOP below. An inline empty-array
 *  fallback mints a fresh array on every render while the layout is loading, and
 *  both of these feed the map-layer memos, which are scene-memo dependencies. */
const EMPTY_OBJECTS: LayoutObject[] = []
const EMPTY_PLACEMENTS: LayoutPlacement[] = []
const EMPTY_GHOSTS: GhostLabel[] = []
const EMPTY_STRINGS: string[] = []
/** EMPTY_STOPS is the same rule reaching one line further than anyone noticed.
 *  `routeStops` fed `renderMarkers`, whose useCallback comment below calls itself
 *  LOAD-BEARING — and an inline `: []` fallback defeated it on every site with no
 *  active pick route, which is every site nearly all of the time. So the scene memo
 *  was being busted on every painted cell regardless of the guards around it. */
const EMPTY_STOPS: PickRouteStop[] = []

/** Module-level so its identity is stable. An inline `() => {}` here re-mints on
 *  every render, which busts MapStage's `guardedSelectBin` useCallback and through
 *  it WarehouseCanvas's whole scene memo — 945 bins re-rendered on every frame of a
 *  marquee drag, which froze the tab hard enough that Chrome could not be scripted.
 *  Same class of mistake as the per-row <select> in the replenishment grid. */
const NOOP = () => {}

/** An abandoned band resolves to nothing. Module-level for the same identity reason
 *  as everything above it. */
const NO_UNITS = () => []
/** Slotting draws no ghost text — it renumbers nothing. A module constant, not
 *  an inline `new Map()`, so the identity is stable across renders and
 *  MapSelectionLayer is not handed a fresh object per painted cell.
 *
 *  NOT `undefined`: MapSelectionLayer does `ghosts.get(...)` inside a map over
 *  the cells, and with `strict` off `undefined` is assignable to its
 *  ReadonlyMap prop — so tsc passed and the first paint stroke crashed the tab. */
const NO_GHOSTS: ReadonlyMap<number, string> = new Map()

export interface RackedWorkspaceProps {
  warehouseId: number
  layoutId: number
  /** Admin/Manager, per mutate-warehouse-location's role gate (mig 00094).
   *  Warehouse staff read the map; they do not rename what is on it. A button
   *  that always errors is worse than no button. */
  canRename?: boolean
}

export function RackedWorkspace({ warehouseId, layoutId, canRename = false }: RackedWorkspaceProps) {
  const { data: detail, isLoading } = useLayoutDetail(layoutId)
  const model = useWarehouseViewerModel(warehouseId, layoutId)
  const { data: storageTypes = [], isLoading: storageTypesLoading } = useStorageTypes()
  const { data: zoneProfiles = [] } = useZoneProfiles()
  const { data: levelRoles = [] } = useLevelRoles()

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null)
  /** Area whose name is being edited (mig 00094); null = dialog closed. */
  const [renamingArea, setRenamingArea] = useState<string | null>(null)
  const [bindingZones, setBindingZones] = useState(false)

  // ── Area painting (mig 00095) ─────────────────────────────────────────────
  const paint = useAreaPaintState()
  const [confirmingPaint, setConfirmingPaint] = useState(false)
  /**
   * The fingerprint of the picture this session was built from, captured ONCE at
   * paint-mode entry.
   *
   * Held in a ref rather than recomputed from `detail`, because a background
   * refetch would otherwise move the baseline under the operator and the
   * conflict check would compare the server's picture against itself — silently
   * disabling the only protection against two people painting at once.
   */
  const baseFingerprintRef = useRef<string>('')
  const { data: layouts = [] } = useLayouts(warehouseId)
  const draftLayout = layouts.find((l) => l.status === 'draft')

  /** The sign picture's own baseline (mig 00097). Separate from the area one, and
   *  captured at the same moment for the same reason — the two pictures move
   *  independently and each server action checks only its own, so sharing a
   *  fingerprint would make an area paint 409 a sign save. */
  const signBaseFingerprintRef = useRef<string>('')
  /** Sign whose text is being edited from the map; null = dialog closed. */
  const [editingSign, setEditingSign] = useState<string | null>(null)

  const beginPaint = () => {
    if (!detail) return
    baseFingerprintRef.current = areaCellsFingerprint(detail.objects as any)
    signBaseFingerprintRef.current = signCellsFingerprint(detail.objects as any)
    paint.dispatch({ type: 'begin', objects: detail.objects })
  }

  /** Click-to-edit a sign on the map. Opens annotate mode on the sign layer with
   *  that sign already picked up, rather than a bespoke dialog: the edit is a
   *  full `paint_labels` replace either way, so a separate path would be a second
   *  implementation of the same save with its own fingerprint to get wrong. */
  const beginSignEdit = (name: string) => {
    if (!detail) return
    baseFingerprintRef.current = areaCellsFingerprint(detail.objects as any)
    signBaseFingerprintRef.current = signCellsFingerprint(detail.objects as any)
    paint.dispatch({ type: 'begin', objects: detail.objects })
    paint.dispatch({ type: 'set_layer', layer: 'sign' })
    paint.dispatch({ type: 'set_sign_brush', name })
    setEditingSign(name)
  }
  // ── Code sweeps (mig 00107) ───────────────────────────────────────────────
  //
  // Mutually exclusive with annotate mode, enforced by only ever passing one of
  // `paint`/`marquee` as active: both rewrite `locations` rows, and a sweep planned
  // against an unsaved area working set would be planned from a picture the server
  // has never seen.
  const recode = useRecodeSelection()
  const slot = useSlotSelection()
  const [slotError, setSlotError] = useState<string | null>(null)
  const [slotApplied, setSlotApplied] = useState<SlotApplied | null>(null)
  const [recodePreview, setRecodePreview] = useState<RecodePreview | null>(null)
  const [previewingRecode, setPreviewingRecode] = useState(false)
  /** Why the dry run failed, kept as STATE rather than only a toast. A toast is gone
   *  in four seconds and the step it explains is still on screen. */
  const [recodePreviewError, setRecodePreviewError] = useState<string | null>(null)
  /** Bumped to re-run the preview effect on the same inputs, for `Try again`. */
  const [recodePreviewNonce, setRecodePreviewNonce] = useState(0)
  const [ackPrinted, setAckPrinted] = useState(false)
  const [printingRecodedLabels, setPrintingRecodedLabels] = useState(false)
  const [recodedIds, setRecodedIds] = useState<number[]>([])
  const [recodeApplied, setRecodeApplied] = useState<
    { recoded: number; levels: number; labelPrintedReset: number; block: string } | null
  >(null)
  const recodeMutation = useRecodeLocations(warehouseId)
  const revertMutation = useRevertCodeSweep(warehouseId)
  const latestSweep = useLatestCodeSweep(warehouseId)
  /** False when the sweep applied but its before/after record could not be kept.
   *  The write stands either way; withholding the button is the honest response to
   *  not being able to undo it. */
  const [canRevertSweep, setCanRevertSweep] = useState(false)
  /** The site's stored pattern (mig 00108). No row = the built-in default, so this
   *  legitimately resolves to undefined and the wizard's own default takes over. */
  const codePattern = useWarehouseCodePattern(warehouseId)
  const savePattern = useSetWarehouseCodePattern(warehouseId)
  const { addToast } = useToasts()

  /** The stock this site prints SLOT labels on (mig 00106). The confirm dialog
   *  judges bar width against it, so a longer pattern's physical cost is visible
   *  before it is paid rather than at the printer weeks later. */
  const labelPrefs = useWarehouseLabelPrefs(warehouseId)
  const recodeLabelPreset = useMemo(() => {
    const map: Record<string, any> = {}
    for (const p of labelPrefs.data ?? []) map[p.sheetGroup] = p.preset
    return resolvePreset('slots', map)
  }, [labelPrefs.data])

  const [floor, setFloor] = useState(0)
  const [overlay, setOverlay] = useState<OverlayKind>('none')
  /** What the operator was looking at before the sweep armed the code tint, so
   *  cancelling puts the map back rather than leaving it amber. */
  const overlayBeforeRecodeRef = useRef<OverlayKind>('none')
  // Dry-run test-bench outputs drawn on the grid.
  const [putawayResult, setPutawayResult] = useState<PutawayResponse | null>(null)
  const [routeOrderIds, setRouteOrderIds] = useState<string[]>([])
  const routeQuery = usePickRoute(warehouseId, routeOrderIds)
  const routeStops = routeQuery.data?.mode === 'engine' ? routeQuery.data.route.stops : EMPTY_STOPS

  const placements = detail?.placements ?? EMPTY_PLACEMENTS
  const placementByLocation = useMemo(() => {
    const map = new Map<number, LayoutPlacement>()
    placements.forEach((p) => map.set(p.locationId, p))
    return map
  }, [placements])

  // Fetched only while the Blocks overlay is on. Every other overlay draws from
  // data the tab already holds; this one does not, and a map screen is heavy
  // enough without two more queries nobody asked for.
  const blocksOverlayOn = overlay === 'slotting_blocks'
  const overlayBlockBins = useSlottingBlockBins(blocksOverlayOn ? warehouseId : null)
  const overlayOffHome = useOffHomeTasks(blocksOverlayOn ? warehouseId : null)
  const offHomeLocationIds = useMemo(
    () => new Set((overlayOffHome.data ?? []).map((t) => t.fromLocationId)),
    [overlayOffHome.data],
  )

  // Every colour and label the canvas draws, derived once and memoized for
  // IDENTITY as much as for cost — they are all scene-memo dependencies.
  const {
    binColors, rackColors, binBadges, binInfo, zoneAreas, zoneTypeByProfileId, legendExtras,
  } = useWarehouseMapLayers({
    model,
    placements,
    placementByLocation,
    objects: detail?.objects ?? EMPTY_OBJECTS,
    storageTypes,
    zoneProfiles,
    levelRoles,
    overlay,
    floor,
    slotBlockIdsByLocation: overlayBlockBins.data,
    offHomeLocationIds,
  })

  // ── Code sweep derivations (migs 00107 / 00108) ───────────────────────────
  //
  // Everything below is computed from data the tab has ALREADY fetched. That is
  // deliberate: the ghost numbers on the map redraw as the operator clicks through
  // four origin corners, and the `:recode:` bucket is 10/min — a round trip per
  // keystroke would spend the whole budget in seconds. The server re-derives all of
  // it for the Review step's `dry_run`, which is the authority before any write.

  /** The site code, its rack→levels index, and a placement for every sweepable
   *  unit (a levelled rack borrows its lowest level's, having none of its own). */
  const warehouseCode = useMemo(() => warehouseCodeOf(model.locationsById), [model.locationsById])
  const levelIdsByRack = useMemo(() => buildLevelIdsByRack(model.locationsById), [model.locationsById])
  const unitPlacements = useMemo(
    () => buildUnitPlacements(placements, model.locationsById),
    [placements, model.locationsById],
  )

  /** The pattern this sweep is using: the operator's override, else the site's
   *  stored default, else the wizard's. NOT `BUILTIN_PATTERN` — that one renders
   *  absolute grid coordinates and is the compatibility fallback, never an arm. */
  const recodeTemplate = recode.state.template
    ?? codePattern.data?.template
    ?? WIZARD_DEFAULT_PATTERN.template
  const recodeControls = useMemo(() => visibleControls(recodeTemplate), [recodeTemplate])

  const recodeUnits = useMemo(
    () => unitsFromSelection(recode.state.selected, model.locationsById, unitPlacements, levelIdsByRack),
    [recode.state.selected, model.locationsById, unitPlacements, levelIdsByRack],
  )

  /** Members of this block that are NOT selected. Their codes must not move. */
  const recodeIncumbents = useMemo(
    () => (recode.state.renumberBlock
      ? []
      : incumbentsOfBlock(recode.state.block, recode.state.selected, model.locationsById, unitPlacements, levelIdsByRack)),
    [recode.state.block, recode.state.renumberBlock, recode.state.selected, model.locationsById, unitPlacements, levelIdsByRack],
  )

  /** The client's copy of the plan, for the ghost numbers and the live sample. See
   *  recodePlanView's header for the one way it differs from the server's. */
  const recodePlan = useMemo(() => {
    if (!recode.state.active || recodeUnits.length === 0) return null
    const units = recode.state.renumberBlock
      ? [...recodeUnits, ...incumbentsOfBlock(recode.state.block, recode.state.selected, model.locationsById, unitPlacements, levelIdsByRack)]
      : recodeUnits
    return planRecode(units, {
      template: recodeTemplate,
      block: recode.state.block || 'B',
      start: recode.state.startAt ?? 1,
      order: recode.state.order,
      origin: recode.state.origin,
      wh: warehouseCode,
      takenCodes: takenCodesFromLocations(model.locationsById),
      frameCells: [...units, ...recodeIncumbents],
      incumbents: recodeIncumbents,
    })
  }, [
    recode.state.active, recode.state.block, recode.state.startAt, recode.state.order,
    recode.state.origin, recode.state.renumberBlock, recode.state.selected,
    recodeUnits, recodeIncumbents, recodeTemplate, warehouseCode, model.locationsById,
    unitPlacements, levelIdsByRack,
  ])

  const recodeGhosts = useMemo(
    () => (recodePlan
      ? ghostLabels({
          units: recodeUnits, placements: unitPlacements, plan: recodePlan,
          template: recodeTemplate, wh: warehouseCode, block: recode.state.block || 'B',
        })
      : EMPTY_GHOSTS),
    [recodePlan, recodeUnits, unitPlacements, recodeTemplate, warehouseCode, recode.state.block],
  )

  /** Ghost codes by unit, for the overlay's TEXT only. The boxes come from
   *  `selectionCells` and must keep drawing when this is empty. */
  const ghostTextById = useMemo(() => {
    const m = new Map<number, string>()
    for (const g of recodeGhosts) m.set(g.locationId, g.text)
    return m
  }, [recodeGhosts])

  /** The first few codes, as the operator will actually get them. */
  const recodeSamples = useMemo(
    () => (recodePlan?.allCodes ?? []).slice(0, 3),
    [recodePlan],
  )

  /** Level codes, listed rather than summarised — they are derived rather than
   *  chosen, so they are the half most likely to surprise. */
  const recodeLevelCodes = useMemo(
    () => (recodePlan?.writes ?? []).flatMap((w) => w.levels.map((l) => l.to)),
    [recodePlan],
  )

  /** What has been swept so far. `code_block IS NULL` is 00107's provenance
   *  signal and means exactly "not minted by a pattern". */
  const sweepableIds = useMemo(() => new Set(unitPlacements.keys()), [unitPlacements])
  const recodeCensus = useMemo(
    () => blockCensus(model.locationsById, sweepableIds),
    [model.locationsById, sweepableIds],
  )

  /** Areas on this floor, for the one-click shortcut and the crossing warning. */
  const floorAreaNames = useMemo(() => {
    const names = new Set<string>()
    for (const o of detail?.objects ?? EMPTY_OBJECTS) {
      if (o.objectType !== 'area' || o.floor !== floor) continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name : ''
      if (name) names.add(name)
    }
    return [...names].sort()
  }, [detail?.objects, floor])

  const spannedAreas = useMemo(
    () => (recode.state.active
      ? areasOfSelection(recode.state.selected, unitPlacements, detail?.objects ?? EMPTY_OBJECTS)
      : EMPTY_STRINGS),
    [recode.state.active, recode.state.selected, unitPlacements, detail?.objects],
  )

  /** A code-safe suggestion from the area the selection sits in — a PREFILL the
   *  operator can overtype, never a derivation. The code must not come from the
   *  area name; see the engine header for why. */
  const blockSuggestion = useMemo(
    () => (spannedAreas.length === 1 ? sanitizeBlock(spannedAreas[0]) || null : null),
    [spannedAreas],
  )

  // ── Slotting blocks (mig 00115) ────────────────────────────────────────────
  const slotRows = useSlottingRows(slot.state.active ? warehouseId : null)
  const saveSlotBlock = useSaveSlottingBlock()
  const saveSlotRule = useSaveSlottingRule()

  /**
   * The block's MEMBERS, as the server stores them: one row per selected unit,
   * `unit_kind` telling it whether to expand.
   *
   * A rack parent holds no stock of its own — its SHELF levels do — so sending
   * the parent as `'rack'` is what makes v_slotting_block_bins expand it to
   * every level, including levels added to that rack later. Sending the levels
   * instead would freeze the block at today's rack shape.
   */
  const slotMembers = useMemo(
    () => [...slot.state.selected].map((id) => ({
      locationId: id,
      unitKind: (levelIdsByRack.get(id)?.length ? 'rack' : 'bin') as 'rack' | 'bin',
    })),
    [slot.state.selected, levelIdsByRack],
  )

  /** Leaf bins the selection expands to — the number that matters on the floor,
   *  and not the same as the unit count whenever a rack is involved. */
  const slotBinCount = useMemo(
    () => slotMembers.reduce(
      (n, m) => n + (m.unitKind === 'rack' ? (levelIdsByRack.get(m.locationId)?.length ?? 1) : 1),
      0,
    ),
    [slotMembers, levelIdsByRack],
  )

  // Fetched only while the panel is open: the brand suggestions are the only
  // thing on this screen that needs the catalogue, and the map is heavy enough.
  const slotProducts = useProducts()
  const slotBrandOptions = useMemo(() => {
    if (!slot.state.active) return [] as string[]
    const found = new Set<string>()
    for (const p of (slotProducts.data ?? []) as any[]) {
      if (p.brand) found.add(String(p.brand))
    }
    return [...found].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [slot.state.active, slotProducts.data])

  const applySlot = async () => {
    setSlotError(null)
    try {
      const blockRes = await saveSlotBlock.mutateAsync({
        warehouseId,
        id: slot.state.blockId,
        name: slot.state.blockName.trim(),
        sourceKind: 'manual',
        members: slotMembers,
      })
      const blockId = 'id' in blockRes ? blockRes.id : null
      if (blockId == null) throw new Error('The block was not saved.')

      let ruleName: string | null = null
      let ruleWasCreated = false

      if (slot.state.attachRuleId) {
        // Appended as the LAST block, never inserted: rank is the operator's
        // ordering and a map panel has no business guessing where in it this
        // belongs. The settings table is where it gets reordered.
        const existing = (slotRows.data?.rules ?? []).find(
          (r) => String(r.id) === slot.state.attachRuleId,
        )
        if (!existing) throw new Error('That rule no longer exists — reload and try again.')
        await saveSlotRule.mutateAsync({
          warehouseId,
          id: existing.id,
          name: existing.name,
          matchProductId: existing.matchProductId,
          matchBrand: existing.matchBrand,
          matchCategory: existing.matchCategory,
          matchSupplierId: existing.matchSupplierId,
          enforcement: existing.enforcement,
          reserveEmpty: existing.reserveEmpty,
          isActive: existing.isActive,
          blockIds: [...existing.blocks.map((b) => b.id).filter((id) => id !== blockId), blockId],
        })
        ruleName = existing.name
      } else if (slot.state.newRuleName.trim()) {
        await saveSlotRule.mutateAsync({
          warehouseId,
          name: slot.state.newRuleName.trim(),
          matchBrand: slot.state.newRuleBrand.trim(),
          // Soft, always, from here. Hard enforcement refuses a scan on the
          // floor, and that is not a decision to make one step after a paint
          // stroke — Settings is where it can be read next to everything else.
          enforcement: 'soft',
          reserveEmpty: false,
          isActive: true,
          blockIds: [blockId],
        })
        ruleName = slot.state.newRuleName.trim()
        ruleWasCreated = true
      }

      setSlotApplied({
        blockName: slot.state.blockName.trim(),
        binCount: slotBinCount,
        ruleName,
        ruleWasCreated,
      })
      slot.dispatch({ type: 'applied', blockId })
    } catch (e) {
      setSlotError(e instanceof Error ? e.message : 'Could not save the block.')
    }
  }

  /** Units under one painted cell / inside a band. Plain functions, not memos —
   *  they are only ever read at dispatch time, so they feed no memo boundary. */
  const resolveCell = (f: number, x: number, y: number) =>
    unitsAtCell(placements, model.locationsById, f, x, y)
  const resolveRect = (r: MarqueeRect) => unitsInRect(placements, model.locationsById, r)

  /**
   * What the SELECTION OVERLAY draws — one box per selected unit, straight off the
   * selection.
   *
   * This used to be a `highlightedLocationIds` Set handed to WarehouseCanvas, which
   * meant the picture of what you had selected was a scene-memo dependency: 945 bins
   * re-rendered on every painted cell, the exact failure MapSelectionLayer exists to
   * prevent, arriving through a door its own header did not name. It was also a
   * DUPLICATE — the overlay has drawn a filled box per selected unit since it
   * shipped — so all the canvas copy ever bought was a stroke-colour swap.
   *
   * Deriving it here is free of the plan on purpose (see MapSelectionLayer's header)
   * and needs no rack→levels expansion: a levelled rack draws nothing in the canvas,
   * which is why the old Set had to fan out to its shelves, but an overlay box is
   * ours to place and a rack is ONE unit to a sweep.
   */
  const selectionCells = useMemo(() => {
    const out: SelectionCell[] = []
    // Modes are mutually exclusive (deriveMapMode + showModeButtons), so at most
    // one of these sets is non-empty — but reading the ACTIVE one rather than
    // unioning them keeps that an assertion instead of an assumption.
    const selected = recode.state.active
      ? recode.state.selected
      : slot.state.active
        ? slot.state.selected
        : null
    if (!selected) return out
    for (const id of selected) {
      const p = unitPlacements.get(id)
      if (p) out.push({ locationId: id, floor: p.floor ?? 0, x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 })
    }
    return out
  }, [recode.state.active, recode.state.selected, slot.state.active, slot.state.selected, unitPlacements])


  /**
   * Ask the server what this sweep would do.
   *
   * Fires ONCE on entering Review and again only when the plan's inputs change —
   * never per keystroke, because the `:recode:` bucket is 10/min and the live ghost
   * numbers already answer the per-keystroke question client-side. Cancellable, so
   * a fast Back/Next cannot land a stale answer on a newer selection.
   */
  useEffect(() => {
    if (!recode.state.active || recode.state.step !== 4) return
    if (recodeUnits.length === 0 || !recode.state.block.trim()) return
    let cancelled = false
    setPreviewingRecode(true)
    setRecodePreviewError(null)
    previewRecode({
      warehouseId,
      units: recodeUnits.map((u) => ({ locationId: u.id, expectedCode: u.code })),
      block: recode.state.block,
      startAt: recode.state.startAt,
      // The template the client PLANNED with, not the raw override. The ghost
      // numbers on the map are computed from this, so sending anything else lets
      // the server answer a different question from the one the operator was
      // looking at — which is exactly how `-1-1` came back as `-3-3` on dev.
      templateOverride: recodeTemplate,
      order: recode.state.order,
      origin: recode.state.origin,
      renumberBlock: recode.state.renumberBlock,
    })
      .then((p) => { if (!cancelled) setRecodePreview(p) })
      .catch((err) => {
        if (cancelled) return
        setRecodePreview(null)
        const message = err instanceof Error ? err.message : 'Could not check the new codes'
        setRecodePreviewError(message)
        addToast(message, 'error')
      })
      .finally(() => { if (!cancelled) setPreviewingRecode(false) })
    return () => { cancelled = true }
    // `recodeUnits` is derived from the selection, so listing both would re-fire on
    // every identity change of a value that did not semantically move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recode.state.active, recode.state.step, recode.state.selected, recode.state.block,
    recode.state.startAt, recode.state.template, recode.state.order, recode.state.origin,
    recode.state.renumberBlock, warehouseId, recodePreviewNonce,
  ])

  /** A fresh preview must never inherit the previous one's acknowledgement — the
   *  set of already-labelled bins is exactly what may have changed. */
  useEffect(() => { setAckPrinted(false) }, [recodePreview])

  /**
   * Apply.
   *
   * From any step: if the operator presses it before reviewing, take them to Review
   * rather than refusing. The button is never a lie and never a dead end — which is
   * the entire point of it being visible at every step.
   */
  const runRecode = async () => {
    if (recode.state.step !== 4 || !recodePreview) {
      recode.dispatch({ type: 'goto_step', step: 4 })
      return
    }
    try {
      const res = await recodeMutation.mutateAsync({
        units: recodeUnits.map((u) => ({ locationId: u.id, expectedCode: u.code })),
        block: recode.state.block,
        startAt: recode.state.startAt,
        templateOverride: recodeTemplate,
        order: recode.state.order,
        origin: recode.state.origin,
        renumberBlock: recode.state.renumberBlock,
      })
      // Captured BEFORE `applied` clears the selection: the label hand-off has to
      // name exactly the bins that were swept, and their levels, which is knowledge
      // that only exists at this moment.
      setRecodedIds([
        ...recodeUnits.map((u) => u.id),
        ...recodeUnits.flatMap((u) => (u.levels ?? []).map((l) => l.id)),
      ])
      setCanRevertSweep(res.canRevert !== false)
      setRecodeApplied({
        recoded: res.units,
        levels: res.levels,
        labelPrintedReset: res.labelPrintedReset,
        block: sanitizeBlock(recode.state.block),
      })
      setRecodePreview(null)
      recode.dispatch({ type: 'applied' })
      addToast(
        `Recoded ${res.units} location${res.units === 1 ? '' : 's'}` +
        (res.levels > 0 ? ` and ${res.levels} rack levels` : ''),
        'success',
      )
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not apply the new codes', 'error')
    }
  }

  // Highlight the descendant bins of a selected non-bin (zone/aisle/rack).
  const highlightedLocationIds = useMemo(() => {
    if (selectedLocationId == null) return undefined
    const sel = model.locationsById.get(selectedLocationId)
    if (!sel || sel.kind === 'BIN') return undefined
    const prefix = `${sel.materializedPath}/`
    const set = new Set<number>()
    for (const loc of model.locationsById.values()) {
      if (loc.kind === 'BIN' && loc.materializedPath.startsWith(prefix)) set.add(loc.id)
    }
    return set
  }, [selectedLocationId, model.locationsById])

  const selectLocation = (loc: InventoryLocation) => {
    setSelectedLocationId(loc.id)
    const placement = placementByLocation.get(loc.id)
    if (placement) setFloor(placement.floor)
  }

  /**
   * Selecting from the MAP has to bring Bin detail with it.
   *
   * The map is `md:h-[65vh]` and the panel row sits below it in normal document
   * flow, so clicking a bin — or a level in an expanded rack — answered entirely
   * off-screen: the panel filled in correctly and the operator never saw it, which
   * reads as "clicking does nothing".
   *
   * Only the map path scrolls. The tree already scrolls its own selected row into
   * view (WarehouseTreePanel's useLayoutEffect), and scrolling the page from there
   * too would fight it — selecting in the tree would yank the tree off-screen.
   */
  const binDetailRef = useRef<HTMLDivElement | null>(null)
  const selectFromMap = (locationId: number) => {
    setSelectedLocationId(locationId)
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    binDetailRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const selectedLocation = selectedLocationId != null ? model.locationsById.get(selectedLocationId) ?? null : null
  const selectedPlacement = selectedLocationId != null ? placementByLocation.get(selectedLocationId) : undefined
  const nodeVisits =
    selectedPlacement?.graphNodeId != null ? model.visitsByNode.get(selectedPlacement.graphNodeId) : undefined

  // The rack a selected level (or a directly-selected rack) belongs to — used
  // to feed RackLevelEditor its full sibling list, not just the one row the
  // map/tree happened to select (mig 00072).
  const selectedRackId =
    selectedLocation?.kind === 'RACK'
      ? selectedLocation.id
      : selectedLocation?.kind === 'SHELF' && selectedLocation.levelIndex != null
        ? selectedLocation.parentId ?? null
        : null
  const rackLevelLocations = selectedRackId != null ? model.levelsByRackId.get(selectedRackId) ?? [] : []
  const rackFillByLevel = useMemo(() => {
    const map = new Map<number, number>()
    for (const loc of rackLevelLocations) {
      if (loc.levelIndex == null) continue
      const pct = model.binFillPct.get(loc.id)
      if (pct != null) map.set(loc.levelIndex, pct)
    }
    return map
  }, [rackLevelLocations, model.binFillPct])

  // Which locations are HELD (mig 00101). Recomputed from the zone tree because
  // v_held_locations — what allocation actually reads — is service_role-only;
  // lib/heldLocations.ts carries the same rule so the two cannot disagree.
  const heldLocationIds = useMemo(
    () => buildHeldLocationIds([...model.locationsById.values()], zoneProfiles),
    [model.locationsById, zoneProfiles],
  )

  /** Where released stock may go: any stock-holding location on this site that
   *  is NOT itself held. The server refuses a held destination anyway (releasing
   *  into another quarantine bay would report the hold as ended while it is
   *  not), so this only spares the operator the round trip. */
  const releaseDestinations = useMemo(
    () => [...model.locationsById.values()]
      .filter((l) => !heldLocationIds.has(l.id) && l.kind !== 'ZONE' && l.kind !== 'RACK' && l.isActive)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [model.locationsById, heldLocationIds],
  )

  const zoneName = useMemo(() => {
    if (!selectedLocation) return undefined
    let cur: InventoryLocation | undefined = selectedLocation
    while (cur) {
      if (cur.kind === 'ZONE') return cur.name
      cur = cur.parentId != null ? model.locationsById.get(cur.parentId) : undefined
    }
    return undefined
  }, [selectedLocation, model.locationsById])

  // Compose the marker layers: dry-run route + putaway always show; slotting
  // arrows only when its overlay is active.
  // What the map is FOR right now, and what that forbids. Derived once so a new
  // mode cannot be forgotten at one of the several call sites that must exclude it
  // — see mapMode.ts for why that was worth extracting.
  const mode = deriveMapMode({
    paintActive: paint.state.active,
    recodeActive: recode.state.active,
    slotActive: slot.state.active,
  })
  const guards = modeGuards(mode, canRename)

  const putawayRec = putawayResult?.mode === 'engine' ? putawayResult.recommendations[0] : null
  /**
   * useCallback is LOAD-BEARING, not tidiness.
   *
   * `renderOverlay` is a dependency of WarehouseCanvas's `scene` memo, and this
   * component re-renders on every frame of a pan or a stroke. As a plain inline
   * function it re-minted each time, busting the memo and re-rendering all 945 bins
   * per frame — the same class of mistake the NOOP above documents, and the reason a
   * marquee drag was already janky before anything was painted.
   */
  const renderMarkers = useCallback((cell: number) => (
    <g>
      {routeStops.length > 0 && routePath(cell, routeStops, placementByLocation, floor)}
      {putawayRec && putawayMarkers(cell, putawayRec, placementByLocation, floor)}
      {overlay === 'slotting' && slottingArrows(cell, model.slotting, placementByLocation, floor)}
    </g>
  ), [routeStops, putawayRec, overlay, model.slotting, placementByLocation, floor])

  /**
   * While annotating, the canvas draws the WORKING SET in place of the stored areas
   * AND signs — through the very same shape the stored rows have, so the preview and
   * the saved result cannot look different. Every other object is untouched.
   *
   * Memoized, and hoisted ABOVE the loading guard so it stays an unconditional hook:
   * a fresh array here is another scene-memo bust on every render.
   */
  const canvasObjects = useMemo(() => (
    paint.state.active
      ? [
          ...(detail?.objects ?? EMPTY_OBJECTS).filter(
            (o) => o.objectType !== 'area' && o.objectType !== 'label',
          ),
          ...paint.previewObjects,
        ]
      : detail?.objects ?? EMPTY_OBJECTS
  ), [paint.state.active, paint.previewObjects, detail?.objects])

  // Skeleton mirrors the loaded shape (a tall map slot) so the tab doesn't
  // reflow when the layout lands — this is the first frame of every demo.
  //
  // Gated on THREE queries, not one. The layout supplies geometry; the storage
  // forms supply every fill colour and the locations supply every code, the tree
  // and a levelled rack's colour. Waiting on the layout alone opened a window
  // where geometry had landed and the other two had not, and the canvas has a
  // defined-but-wrong answer for that state: `formColorById` and `locationsById`
  // are both empty, so every bin falls through to DEFAULT_BIN_FILL and the tree
  // renders "No storage locations defined for this warehouse." An operator sees a
  // finished-looking grey map that silently recolours a moment later, which reads
  // as a rendering bug rather than as loading — and is exactly what was reported
  // on NEXG. Deliberately NOT gated on `model.isLoading`: that bundles velocity
  // and traffic, whose absence costs a `0%` label, not the picture.
  if (isLoading || !detail || model.isCoreLoading || storageTypesLoading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading warehouse layout…</span>
        <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
          <div className="wh-shimmer h-full w-full rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The tree (not the map) is the keyboard/AT selection path — this
          announces what just got selected, from either surface. A rack level
          (mig 00072) gets a friendlier phrasing than its raw SHELF kind. */}
      <div aria-live="polite" className="sr-only">
        {selectedLocation
          ? selectedLocation.kind === 'SHELF' && selectedLocation.levelIndex != null
            ? `Selected level ${selectedLocation.levelIndex} (${selectedLocation.code})`
            : `Selected ${selectedLocation.kind.toLowerCase()} ${selectedLocation.code}`
          : ''}
      </div>

      {guards.showModeButtons && (
        <div className="flex flex-wrap justify-end gap-2">
          {/* A sweep works on a phone now. What made that possible is the hit test:
              a drag that starts on a bin selects, a drag that starts on open floor
              moves the map, and two fingers always zoom — so one finger is never
              ambiguous and no modifier is required. Its own button rather than a
              third annotate layer: annotating puts words on the floor, this
              rewrites the barcode payload of every bin in the band. */}
          <button
            type="button"
            onClick={() => {
              overlayBeforeRecodeRef.current = overlay
              setOverlay('unswept')
              recode.dispatch({
                type: 'begin',
                origin: codePattern.data?.origin,
                order: codePattern.data?.order,
                template: codePattern.data?.template ?? null,
              })
            }}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
          >
            Recode bins
          </button>
          {/* Assigning stock is its own errand, not a fourth annotate layer: an
              area puts a NAME on the floor, a block decides where goods go.
              Deliberately mobile-capable like the sweep and unlike Annotate —
              the same hit test makes one finger unambiguous, because both drag
              over RACKING rather than over open floor. */}
          <button
            type="button"
            onClick={() => slot.dispatch({ type: 'begin' })}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
          >
            Assign stock
          </button>
          {/* Painting and saving bind automatically (mig 00096), so this is for a
              site painted before that existed — and it is the only surface that
              previews a re-parent before it happens. */}
          <button
            type="button"
            onClick={() => setBindingZones(true)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
          >
            Bind areas to zones
          </button>
          {/* One entry point for both annotation layers (mig 00097). A third
              header button would imply areas and signs are different errands;
              they are the same errand with different consequences, and the
              toolbar's Areas | Signs toggle is where that distinction belongs.
              
              Still desktop-only, and NOT an oversight left behind by the sweep
              going mobile. An area is painted ON open floor — that is what an area
              is — so the hit test that makes one finger unambiguous for a sweep has
              nothing to test here, and annotate has no honest one-finger form.
              mapGesture rule 5 is the same statement in code. */}
          <button
            type="button"
            onClick={beginPaint}
            className="hidden rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50 md:inline-flex"
          >
            Annotate
          </button>
        </div>
      )}

      {paint.state.active && (
        <AreaPaintToolbar
          brush={paint.state.brush}
          signBrush={paint.state.signBrush}
          layer={paint.state.layer}
          mode={paint.state.mode}
          areaNames={paint.names}
          signNames={paint.signNames}
          zoneProfiles={zoneProfiles}
          dirty={paint.state.dirty}
          canUndo={paint.state.undo.length > 0}
          saving={confirmingPaint}
          draftWarning={draftLayout
            ? `A draft of this layout exists (“${draftLayout.name}”). Publishing it will replace these areas.`
            : null}
          onLayer={(layer) => paint.dispatch({ type: 'set_layer', layer })}
          onBrushName={(name) => paint.dispatch({ type: 'set_brush_name', name })}
          onBrushProfile={(zoneProfileId) => paint.dispatch({ type: 'set_brush_profile', zoneProfileId })}
          onSignBrush={(name) => paint.dispatch({ type: 'set_sign_brush', name })}
          onMode={(mode) => paint.dispatch({ type: 'set_mode', mode })}
          onEraseArea={(name) => paint.dispatch({ type: 'erase_area', name })}
          onEraseSign={(name) => paint.dispatch({ type: 'erase_sign', name })}
          onUndo={() => paint.dispatch({ type: 'undo' })}
          onCancel={() => { setEditingSign(null); paint.dispatch({ type: 'cancel' }) }}
          onSave={() => setConfirmingPaint(true)}
        />
      )}

      {/* The panel is a GRID SIBLING of the map, not an overlay: the map has to
          stay live and paintable while the operator works through the steps, which
          is the whole reason for stepping rather than modalling. It also means this
          never trips `npm run check:overlays`. */}
      <div className={recode.state.active ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
      <div className="aspect-[4/3] w-full md:aspect-auto md:h-[65vh] md:min-h-[420px]">
        <MapStage
          layout={detail.layout}
          placements={detail.placements}
          objects={canvasObjects}
          floor={floor}
          onFloorChange={setFloor}
          selectedLocationId={selectedLocationId}
          // While sweeping, the highlight IS the selection — the existing
          // descendants-of-a-selected-zone meaning has no role in that mode.
          /* `undefined` is a constant, so during a whole sweep this dep never moves
             and the scene memo survives the stroke. The selection is drawn by
             MapSelectionLayer instead; see `selectionCells` above. */
          highlightedLocationIds={recode.state.active ? undefined : highlightedLocationIds}
          // A sweep's band must not double as a bin click, and MapStage's eager
          // capture already routes the click to the container — this is the
          // belt-and-braces half, and it also keeps Bin detail from scrolling
          // into view behind the toolbar mid-selection.
          onSelectBin={guards.canSelectBin ? selectFromMap : NOOP}
          binColors={binColors}
          rackColors={rackColors}
          binBadges={binBadges}
          binInfo={binInfo}
          binFillPct={model.binFillPct}
          zoneRegions={zoneAreas}
          zoneTypeByProfileId={zoneTypeByProfileId}
          renderOverlay={renderMarkers}
          locationsById={model.locationsById}
          // The pencil and paint mode must never be live together: both rewrite
          // the same rows, and a rename applied against a working set that has
          // not been saved would be computed from a picture the server has
          // never seen.
          onRenameArea={guards.canRenameArea ? setRenamingArea : undefined}
          // Same mutual exclusion as the area pencil, and for the same reason:
          // clicking a sign ENTERS annotate mode, so offering it while already
          // in one would re-hydrate the working set and discard unsaved edits.
          onEditSign={guards.canEditSign ? beginSignEdit : undefined}
          paint={{
            active: paint.state.active,
            onStrokeStart: () => paint.dispatch({ type: 'stroke_start' }),
            onPaintCell: paint.paintCell,
          }}
          /* MapStage accepts exactly ONE select bag, and that is deliberate on its
             side — the gesture layer should not know what a mode MEANS. So the
             arbitration happens here: whichever selection mode is live owns the
             gesture. They are mutually exclusive by deriveMapMode, and wiring
             both would silently drop one reducer's strokes — an open panel, a
             crosshair cursor, and nothing selecting. */
          select={slot.state.active ? {
            active: true,
            tool: slot.state.tool,
            rect: slot.state.rect,
            cells: selectionCells,
            ghosts: NO_GHOSTS,
            selectedCount: slot.state.selected.size,
            hasUnitsAt: (f: number, x: number, y: number) => resolveCell(f, x, y).length > 0,
            onStrokeStart: () => slot.dispatch({ type: 'stroke_start' }),
            onSelectCell: (f: number, x: number, y: number, erase?: boolean) =>
              slot.dispatch({ type: 'select_cell', floor: f, x, y, erase, resolve: resolveCell }),
            onDragStart: (f: number, x: number, y: number, additive: boolean) =>
              slot.dispatch({ type: 'drag_start', floor: f, x, y, additive }),
            onDragMove: (x: number, y: number) => slot.dispatch({ type: 'drag_move', x, y }),
            // Resolved against the reducer's OWN rect — see useSlotSelection's
            // note on drag_end. Passing a rect read from a render loses a fast
            // drag entirely.
            onDragEnd: (erase?: boolean) => slot.dispatch({ type: 'drag_end', erase, resolve: resolveRect }),
            onDragCancel: () => slot.dispatch({ type: 'drag_end', resolve: NO_UNITS }),
            onUndo: () => slot.dispatch({ type: 'undo' }),
          } : {
            active: recode.state.active,
            tool: recode.state.tool,
            rect: recode.state.rect,
            cells: selectionCells,
            ghosts: ghostTextById,
            selectedCount: recode.state.selected.size,
            // The hit test behind "drag over storage paints, drag over open floor
            // moves the map". Same selector the brush resolves with, so the two can
            // never disagree about what counts as storage.
            hasUnitsAt: (f, x, y) => resolveCell(f, x, y).length > 0,
            onStrokeStart: () => recode.dispatch({ type: 'stroke_start' }),
            onSelectCell: (f, x, y, erase) =>
              recode.dispatch({ type: 'select_cell', floor: f, x, y, erase, resolve: resolveCell }),
            onDragStart: (f, x, y, additive) =>
              recode.dispatch({ type: 'drag_start', floor: f, x, y, additive }),
            onDragMove: (x, y) => recode.dispatch({ type: 'drag_move', x, y }),
            // The reducer resolves against its OWN rect — see the note on
            // `drag_end`. Passing `resolveRect(recode.state.rect)` here reads a rect
            // that a fast drag has not re-rendered yet, and the band selects
            // nothing. Found in a real browser; no test reproduced it.
            onDragEnd: (erase) => recode.dispatch({ type: 'drag_end', erase, resolve: resolveRect }),
            // An abandoned band applies nothing. NO_UNITS rather than a new action:
            // a resolver returning [] leaves no undo frame either, which is exactly
            // right for a gesture that was interrupted rather than made.
            onDragCancel: () => recode.dispatch({ type: 'drag_end', resolve: NO_UNITS }),
            onUndo: () => recode.dispatch({ type: 'undo' }),
          }}
        />
      </div>

      {slot.state.active && (
        <SlottingPanel
          state={slot.state}
          binCount={slotBinCount}
          areaNames={floorAreaNames}
          existingNames={(slotRows.data?.blocks ?? []).map((b) => b.name)}
          rules={slotRows.data?.rules ?? []}
          brands={slotBrandOptions}
          saving={saveSlotBlock.isPending || saveSlotRule.isPending}
          error={slotError}
          applied={slotApplied}
          onTool={(tool) => slot.dispatch({ type: 'set_tool', tool })}
          onMode={(mode) => slot.dispatch({ type: 'set_mode', mode })}
          onUndo={() => slot.dispatch({ type: 'undo' })}
          onClear={() => slot.dispatch({ type: 'clear_selection' })}
          onSelectArea={(name) =>
            slot.dispatch({
              type: 'select_ids',
              ids: unitsInArea(placements, model.locationsById, detail.objects, name),
            })
          }
          onName={(name) => slot.dispatch({ type: 'set_block_name', name })}
          onAttachRule={(ruleId) => slot.dispatch({ type: 'set_attach_rule', ruleId })}
          onNewRuleName={(name) => slot.dispatch({ type: 'set_new_rule_name', name })}
          onNewRuleBrand={(brand) => slot.dispatch({ type: 'set_new_rule_brand', brand })}
          onGotoStep={(step) => slot.dispatch({ type: 'goto_step', step })}
          onApply={applySlot}
          onCancel={() => { setSlotError(null); setSlotApplied(null); slot.dispatch({ type: 'cancel' }) }}
          onBuildAnother={() => { setSlotError(null); setSlotApplied(null); slot.dispatch({ type: 'begin' }) }}
        />
      )}

      {recode.state.active && (
        <RecodePanel
          state={recode.state}
          template={recodeTemplate}
          controls={recodeControls}
          samples={recodeSamples}
          areaNames={floorAreaNames}
          spannedAreas={spannedAreas}
          blocks={recodeCensus.blocks}
          swept={recodeCensus.swept}
          total={recodeCensus.total}
          lastSweep={latestSweep.data ?? null}
          blockSuggestion={blockSuggestion}
          incumbentCount={recodeIncumbents.length}
          levelCodes={recodeLevelCodes}
          preview={recodePreview}
          previewing={previewingRecode}
          previewError={recodePreviewError}
          onRetryPreview={() => setRecodePreviewNonce((n) => n + 1)}
          applying={recodeMutation.isPending}
          reverting={revertMutation.isPending}
          applied={recodeApplied}
          canRevert={canRevertSweep && !!latestSweep.data}
          preset={recodeLabelPreset}
          ackPrinted={ackPrinted}
          onTool={(tool) => recode.dispatch({ type: 'set_tool', tool })}
          onMode={(mode) => recode.dispatch({ type: 'set_mode', mode })}
          onUndo={() => recode.dispatch({ type: 'undo' })}
          onClear={() => recode.dispatch({ type: 'clear_selection' })}
          onSelectArea={(name) => recode.dispatch({
            type: 'select_ids',
            ids: unitsInArea(placements, model.locationsById, detail.objects, name),
          })}
          onSelectBlock={(block) => {
            const row = recodeCensus.blocks.find((b) => b.block === block)
            if (!row) return
            recode.dispatch({ type: 'select_ids', ids: row.ids })
            recode.dispatch({ type: 'set_block', block })
          }}
          onBlock={(block) => recode.dispatch({ type: 'set_block', block })}
          onTemplate={(template) => recode.dispatch({ type: 'set_template', template })}
          onOrigin={(origin) => recode.dispatch({ type: 'set_origin', origin })}
          onOrder={(order) => recode.dispatch({ type: 'set_order', order })}
          onStart={(startAt) => recode.dispatch({ type: 'set_start', startAt })}
          onAdvanced={(advanced) => recode.dispatch({ type: 'set_advanced', advanced })}
          onSaveDefault={() => {
            savePattern.mutate({
              template: recodeTemplate,
              defaultBlock: sanitizeBlock(recode.state.block) || WIZARD_DEFAULT_PATTERN.defaultBlock,
              start: recode.state.startAt ?? 1,
              order: recode.state.order,
              origin: recode.state.origin,
            }, {
              onSuccess: () => addToast('Saved as this site’s default pattern', 'success'),
              onError: (err) => addToast(
                err instanceof Error ? err.message : 'Could not save the pattern', 'error',
              ),
            })
          }}
          savingDefault={savePattern.isPending}
          isSiteDefault={
            codePattern.data?.template === recodeTemplate
            && codePattern.data?.order === recode.state.order
            && codePattern.data?.origin === recode.state.origin
          }
          onAckPrinted={setAckPrinted}
          onGotoStep={(step) => recode.dispatch({ type: 'goto_step', step })}
          onUseSuggestedOrigin={() => {
            const f = recodePreview?.suggestedFraming
            if (!f) return
            recode.dispatch({ type: 'set_origin', origin: f.origin })
            recode.dispatch({ type: 'set_order', order: f.order })
          }}
          onRenumberBlock={() => recode.dispatch({ type: 'set_renumber_block', renumberBlock: true })}
          onApply={runRecode}
          onPrintLabels={() => setPrintingRecodedLabels(true)}
          onRevert={async () => {
            try {
              const res = await revertMutation.mutateAsync()
              setCanRevertSweep(false)
              setRecodedIds([])
              addToast(
                `Put ${res.reverted} code${res.reverted === 1 ? '' : 's'} back`,
                'success',
              )
              recode.dispatch({ type: 'cancel' })
              setRecodeApplied(null)
            } catch (err) {
              addToast(err instanceof Error ? err.message : 'Could not revert the sweep', 'error')
            }
          }}
          onSweepAnother={() => recode.dispatch({ type: 'goto_step', step: 1 })}
          onCancel={() => {
            setRecodePreview(null)
            setRecodeApplied(null)
            setOverlay(overlayBeforeRecodeRef.current)
            recode.dispatch({ type: 'cancel' })
          }}
        />
      )}
      </div>

      {/* "Print the new labels" from the success step. The run is NARROWED to the
          bins just swept — `ids` restricts what wie_layout_label_targets already
          chose, so the server still decides what a label target is. */}
      <LayoutLabelJobModal
        open={printingRecodedLabels}
        onClose={() => setPrintingRecodedLabels(false)}
        layoutId={layoutId}
        warehouseId={warehouseId}
        locationIds={recodedIds}
        contextNote={`The ${recodedIds.length} location${recodedIds.length === 1 ? '' : 's'} you just recoded. Their old stickers name codes that no longer exist.`}
      />

      {renamingArea && (
        <RenameAreaModal
          warehouseId={warehouseId}
          areaName={renamingArea}
          onClose={() => setRenamingArea(null)}
        />
      )}

      {editingSign && (
        <EditSignModal
          signName={editingSign}
          onRename={(from, to) => paint.dispatch({ type: 'rename_sign', from, to })}
          onErase={(name) => paint.dispatch({ type: 'erase_sign', name })}
          onClose={() => setEditingSign(null)}
        />
      )}

      {bindingZones && (
        <BindZonesModal warehouseId={warehouseId} onClose={() => setBindingZones(false)} />
      )}

      {confirmingPaint && (
        <AreaPaintSummaryModal
          warehouseId={warehouseId}
          layoutId={layoutId}
          baseFingerprint={baseFingerprintRef.current}
          specs={paint.specs}
          signSpecs={paint.signSpecs}
          signBaseFingerprint={signBaseFingerprintRef.current}
          floorCount={detail.layout.floorCount}
          onClose={() => setConfirmingPaint(false)}
          onSaved={() => {
            setConfirmingPaint(false)
            setEditingSign(null)
            // Leave paint mode outright rather than re-hydrating: the mutation
            // has invalidated layout-detail, and the next `detail` to arrive is
            // the server's answer. Staying in with a stale baseFingerprint would
            // make the very next save 409.
            paint.dispatch({ type: 'cancel' })
          }}
        />
      )}

      {/* Hidden below `lg` while sweeping, and the reason is structural rather than
          taste: the panel is `sticky bottom-0` down there, and sticky un-pins the
          moment its container scrolls past — so anything below the map would carry
          the operator away from the footer holding Apply. Nothing is lost: mapMode
          already sets `canSelectBin: false` for the whole sweep, so Bin detail is
          inert, and the overlay is pinned to `unswept` until the sweep ends. Desktop
          is untouched. */}
      <div className={`glass-card rounded-xl p-3 ${recode.state.active ? 'hidden lg:block' : ''}`}>
        <OverlayControls overlay={overlay} onChange={setOverlay} extraEntries={legendExtras} />
      </div>

      <div
        className={`gap-4 lg:grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,22rem)] ${
          recode.state.active ? 'hidden lg:grid' : 'grid'
        }`}
      >
        <FloatingPanel id="wh-tree" title="Locations" className="max-h-[70vh]">
          <WarehouseTreePanel
            tree={model.tree}
            binContents={model.binContents}
            binFillPct={model.binFillPct}
            selectedLocationId={selectedLocationId}
            onSelect={selectLocation}
          />
        </FloatingPanel>

        <FloatingPanel
          id="wh-bin-detail"
          title="Bin detail"
          className="max-h-[70vh]"
          containerRef={binDetailRef}
        >
          <BinDetailPanel
            warehouseId={warehouseId}
            location={selectedLocation}
            contents={selectedLocationId != null ? model.binContents.get(selectedLocationId) ?? [] : []}
            fillPct={selectedLocationId != null ? model.binFillPct.get(selectedLocationId) : undefined}
            placement={selectedPlacement}
            nodeVisits={nodeVisits}
            zoneName={zoneName}
            isHeld={selectedLocationId != null && heldLocationIds.has(selectedLocationId)}
            releaseDestinations={releaseDestinations}
            rackLevelLocations={rackLevelLocations}
            rackFillByLevel={rackFillByLevel}
            onSelectLevel={setSelectedLocationId}
            canRename={canRename}
          />
          {/* Slotting's suggested moves live here rather than as a separate
              panel: they're overlay-driven context about what's currently on
              the map, same as the selected bin's contents. */}
          {overlay === 'slotting' && model.slotting.length > 0 && (
            <div className="mt-3 rounded-lg border border-stone-200 bg-white/60 p-2 text-xs">
              <p className="mb-1 font-semibold text-stone-700">Suggested moves</p>
              <ul className="space-y-0.5 text-stone-500">
                {model.slotting.map((s) => (
                  <li key={s.id} className="font-mono">
                    #{s.productId}: {model.locationsById.get(s.fromLocationId)?.code ?? s.fromLocationId} →{' '}
                    {model.locationsById.get(s.toLocationId)?.code ?? s.toLocationId}
                    <span className="ml-1 text-emerald-600">−{Math.round(s.expectedGainM)}m</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FloatingPanel>

        <AskEnginePanel
          className="max-h-[70vh]"
          warehouseId={warehouseId}
          layoutId={layoutId}
          onPutawayResult={setPutawayResult}
          routeOrderIds={routeOrderIds}
          onRouteOrderIdsChange={setRouteOrderIds}
        />
      </div>
    </div>
  )
}
