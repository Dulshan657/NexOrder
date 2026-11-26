// Read-only SVG scene renderer for the Warehouse viewer. Unlike the designer's
// LayoutCanvas (paint tools + editor state), this renders published geometry
// from types.ts (WarehouseLayout/LayoutPlacement/LayoutObject) and is purely
// for looking: bins colored by an optional overlay map, click-to-select, and
// overlay marker layers (route / putaway / slotting) supplied by later phases.
// It shares OBJECT_FILL/BASE_CELL with the designer for visual consistency.
//
// This component owns NO pan/zoom state — it's a pure function of a `viewport`
// prop (see mapViewport.ts) applied via a wrapping `<g transform>`. The stage
// (MapStage.tsx / useMapViewport.ts) owns the gesture handling and measures the
// container; this file only draws. Floor switching and zoom controls live in
// MapControls.tsx now.
//
// ── Reading the map ─────────────────────────────────────────────────────────
// Everything drawn here is sized in GRID USER UNITS (cells × BASE_CELL) except
// text and hairline insets, which are counter-scaled by `viewport.scale` through
// the `u()` helper so they stay a constant size on screen at every zoom. That is
// what makes level-of-detail possible: `labelTier(BASE_CELL * scale)` asks how
// many screen pixels a cell actually covers right now, rather than reading a
// `cell` constant that never changes (see mapLabels.ts for the full history).
//
// Layer order, bottom to top: zone washes → grid → zone outlines → structural
// objects → bins (fill, level spine, labels) → zone names → exploded level
// stack → marker overlays.
//
// ── Colour, type and depth (NX-0047) ────────────────────────────────────────
// No colour is typed in this file. Chrome colours (ink, halo, grid, scrim,
// selection) are `var(--color-map-*)` tokens from mapTokens.ts; the rest are
// DATA (a storage form's colour, a level role's, a zone's tint) and arrive
// through props or the shared palette. Text is set in the app's own faces.
//
// Depth is two shared definitions in the <defs> at the bottom of this file:
// ONE drop-shadow filter, referenced by the single <g> that wraps every rack —
// never by a rack or a bin, which would be a filter pass each on a floor of 189
// bays — and one top-to-bottom sheen gradient laid over each rack's fill.

import { useMemo, useState, type ReactNode, type CSSProperties } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject, InventoryLocation } from '@/types'
import { OBJECT_FILL, OBJECT_STROKE, BASE_CELL, PLACEMENT_FILL, levelRoleFill, levelRoleStroke, levelRoleLabel } from '@/components/admin/layout/layoutPalette'
import { MERGED_OBJECT_TYPES, objectRegions, regionBounds, regionFillPath, regionOutlinePath } from '@/components/admin/layout/objectRegions'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { groupPlacementsByCell } from '@/components/admin/layout/LayoutCanvas'
import { DEFAULT_BIN_FILL, DEFAULT_BIN_STROKE } from './warehouseOverlays'
import { labelTier, screenFont, fitCode, fitName, regionLabelBudget, commonCodePrefix, shortCode, coarseCode } from './mapLabels'
import { isUninformativeName, locationOneLine, nameTail } from '@/lib/locationDisplay'
import { spineRows, spineFits, rollupFill } from './levelSpine'
import { zoneTint, zoneTypeLabel, ZONE_FILL_OPACITY, ZONE_STROKE_OPACITY } from './zoneTints'
import type { ZoneRegion } from './zoneRegions'
import type { Viewport } from './mapViewport'
import { MAP_COLOR, MAP_FONT, MAP_RACK_SHADOW_ID, MAP_SHEEN_ID } from './mapTokens'

/** Sentinel meaning "explicitly collapsed" — distinct from `null` ("no manual
 *  override; derive expansion from `selectedLocationId`"), see `expandedKey`. */
const COLLAPSED = '__collapsed__'

/** Structural objects that carry an operator-authored `meta.name` worth drawing,
 *  stamped PER OBJECT. Mirrors LayoutCanvas's NAMED_OBJECT_TYPES so the two
 *  canvases agree on which blocks are named — this is how MAIN's "Cold room" /
 *  "Returns" / "Quarantine" stop being anonymous grey rectangles on the ops map.
 *
 *  `label` is deliberately NOT here any more (mig 00097). A sign is now a merged
 *  named region like an area, so it is drawn once per region below; leaving it in
 *  this pass would stamp the text onto every one of its 1x1 cells. */
const NAMED_OBJECT_TYPES = new Set(['obstacle', 'staging'])
/** Below this many screen px of width, an object's name cannot be read. */
const MIN_OBJECT_NAME_PX = 48

/** Per-bin display data the renderer cannot derive from geometry alone. Built by
 *  RackedWorkspace from `locationsById` + the viewer model, both of which it
 *  already holds — none of this is a new query. */
export interface BinInfo {
  code: string
  /** The operator-facing name (mig 00094), e.g. "Chiller · Rack 7". Absent on a
   *  warehouse drawn before names existed, where the label falls back to code. */
  name?: string | null
  capacitySlots?: number
  slotKind?: 'pallet' | 'carton'
  /** Distinct products in the bin; drives the "×3" badge and the hover card. */
  contentsCount: number
  topSku?: string
  /** `storage_types.color` for this bin's form — the base fill at rest. */
  formColor?: string
}

/** What the stage needs to place and populate a hover card.
 *
 *  The cell rect travels with the event rather than being looked up from
 *  `placements` afterwards, because a levelled rack's hover reports the RACK
 *  parent — which deliberately has no `layout_placements` row of its own (mig
 *  00072 gives placements to the levels, not the rack), so there would be
 *  nothing to look up. */
export interface BinHover {
  locationId: number
  /** Grid cell rect of the hovered group. */
  x: number
  y: number
  w: number
  h: number
  /** 0 for a legacy single bin. */
  levelCount: number
  fillPct: number | null
}

/** Center of a placement in grid cells — used by marker/route layers. */
export function placementCenter(p: LayoutPlacement): { cx: number; cy: number } {
  return { cx: p.x + p.w / 2, cy: p.y + p.h / 2 }
}

export interface WarehouseCanvasProps {
  layout: WarehouseLayout
  placements: LayoutPlacement[]
  objects: LayoutObject[]
  floor: number
  /** Pan/zoom transform applied to the whole scene, owned by the stage. */
  viewport: Viewport
  selectedLocationId: number | null
  /** Bins to outline (e.g. all descendants of a selected zone). */
  highlightedLocationIds?: Set<number>
  onSelectBin: (locationId: number) => void
  /** locationId → overlay fill (Phase 4). Absent → default bin fill. */
  binColors?: Map<number, string>
  /** True when `binColors` says something about the PLACE (its code block, its
   *  slotting block) rather than about the stock in it. A level's stripe then
   *  takes the colour whether or not it holds anything: an empty rack mid-sweep
   *  is exactly the one the operator needs to see (NX-0046). */
  binColorsAreCategories?: boolean
  /** RACK location id → overlay fill for the whole rack, rolled up across its
   *  levels by the caller (which knows the active overlay). Used for the
   *  collapsed rect when it is too small to draw a per-level spine. */
  rackColors?: Map<number, string>
  /** locationId → small corner badge text, e.g. "×3" for multi-product bins. */
  binBadges?: Map<number, string>
  /** locationId → code/capacity/contents for on-map labels and the hover card. */
  binInfo?: Map<number, BinInfo>
  /** locationId → used/capacity; null when the bin has no capacity configured. */
  binFillPct?: Map<number, number | null>
  /** Zone areas derived from bin membership (zones have no geometry of their
   *  own — see zoneRegions.ts). Absent → no zone layer. */
  zoneRegions?: ZoneRegion[]
  /** zone_profiles.id → zone_type, for tinting a region. */
  zoneTypeByProfileId?: Map<number, string>
  /** Extra SVG drawn on top of the active floor, in cell units × `cell`. */
  renderOverlay?: (cell: number, scale: number) => ReactNode
  /** Location metadata (code, levelRole) for the level rows in a placement
   *  group — needed to label the exploded stack. Absent → levels render with
   *  a bare "L{n}" label instead of their real code/role. */
  locationsById?: Map<number, InventoryLocation>
  /** Wraps a click-driven state change (expand/collapse) so a pan that ends
   *  over a rack doesn't also toggle it — mirrors the `didDrag()` guard
   *  MapStage already applies to `onSelectBin`. Defaults to firing immediately. */
  guardClick?: (fn: () => void) => void
  /** Pointer entered/left a bin; the stage turns this into a hover card. */
  onHoverBin?: (hover: BinHover | null) => void
  /** Admin/Manager clicked an area's NAME to rename it (mig 00094). Omitted →
   *  the label is inert, as it always was. Note the target is the label, never
   *  the wash: the wash lies under the racks with pointerEvents="none" so it
   *  cannot steal their hit tests, and a handler there would fight that. */
  onRenameArea?: (areaName: string) => void
  /** Admin/Manager clicked a floor sign's text to edit or remove it (mig 00097).
   *  Omitted → signs are inert, which is what every read-only surface wants. */
  onEditSign?: (signName: string) => void
  /** The scale the scene is DRAWN at (NX-0047): text sizes, label tiers and
   *  hairlines are computed from it, and it changes only once a zoom stops.
   *  The live `viewport.scale` still moves the picture every frame, on the
   *  transform. Absent → the live scale (the scene then rebuilds per frame). */
  settledScale?: number
  /** The map is moving (pan, pinch, glide, zoom). Drops the rack shadow for the
   *  duration, so a moving frame is one cheap raster rather than a filter pass. */
  moving?: boolean
}

export function WarehouseCanvas({
  layout,
  placements,
  objects,
  floor,
  viewport,
  selectedLocationId,
  highlightedLocationIds,
  onSelectBin,
  binColors,
  binColorsAreCategories = false,
  rackColors,
  binBadges,
  binInfo,
  binFillPct,
  zoneRegions,
  zoneTypeByProfileId,
  renderOverlay,
  locationsById,
  guardClick,
  onHoverBin,
  onRenameArea,
  onEditSign,
  settledScale,
  moving = false,
}: WarehouseCanvasProps) {
  // Operator-managed role vocabulary (mig 00081). A level whose role has been
  // retired still renders with its own colour, because getLevelRoles returns
  // inactive rows too.
  const { data: levelRoles = [] } = useLevelRoles()
  const cell = BASE_CELL
  const { gridWidth, gridHeight } = layout
  // The SETTLED scale, not the live one: see the prop. Everything in the scene
  // memo reads this, so a zoom in progress costs one attribute per frame.
  const scale = settledScale ?? viewport.scale

  // These three are memoized for identity, not for the cost of the work: they
  // are dependencies of the scene memo below, and `filter` returns a fresh array
  // on every render. Since this component re-renders on every pan frame (the
  // viewport prop changes), an unmemoized filter would hand the scene memo new
  // deps each frame and defeat the whole optimization.
  const guard = useMemo(() => guardClick ?? ((fn: () => void) => fn()), [guardClick])
  const floorObjects = useMemo(() => objects.filter((o) => o.floor === floor), [objects, floor])
  // Outside the `scene` memo on purpose: a pan/zoom must never rebuild the flood
  // fill. Keyed on the raw `objects` array, not on `floorObjects`, for the same
  // reason the designer is.
  const objRegions = useMemo(() => objectRegions(objects, floor), [objects, floor])
  // Areas (mig 00090) are a BACKDROP, not structure: they name the ground the
  // racks stand on, so they render under the grid while walls and walkways
  // render over it. Split once here rather than filtering twice in the scene.
  const areaRegions = useMemo(() => objRegions.filter((r) => r.objectType === 'area'), [objRegions])
  const structuralRegions = useMemo(() => objRegions.filter((r) => r.objectType !== 'area'), [objRegions])
  // Signs (mig 00097) are structural for their PLATE — they stay in
  // structuralRegions above and draw with the rest — but their TEXT is hoisted
  // into the wayfinding layer, so it needs its own handle. Not subtracted from
  // structuralRegions: the plate belongs where it is.
  const signRegions = useMemo(() => objRegions.filter((r) => r.objectType === 'label'), [objRegions])
  const floorPlacements = useMemo(() => placements.filter((p) => p.floor === floor), [placements, floor])

  // Group by (floor,x,y) — every level of a rack now shares its rack's cell,
  // distinguished only by `levelIndex` (see LayoutPlacement.levelIndex in
  // types.ts). A legacy group (lone placement, levelIndex undefined) renders
  // exactly as the original per-placement loop below.
  const placementGroups = useMemo(() => groupPlacementsByCell(floorPlacements), [floorPlacements])

  // Manual expand/collapse override: undefined = "derive from selection",
  // a group key = "force this rack expanded" (right after clicking its
  // collapsed cell, before any level has been selected), COLLAPSED = "force
  // nothing expanded" (right after clicking the scrim), regardless of a
  // stale selection still pointing at one of that rack's levels.
  const [expandOverride, setExpandOverride] = useState<string | null>(null)

  // The warehouse root every code on this floor shares ("MAIN-"), computed once
  // so labels spend their few characters on what actually differs.
  const sharedPrefix = useMemo(() => {
    if (!binInfo) return ''
    const codes: string[] = []
    for (const group of placementGroups) {
      // Mirror the renderer's choice of which location supplies the label: a
      // levelled rack is labelled by its RACK parent, not by one of its levels.
      const first = group.items[0].locationId
      const id = group.isLegacyBin ? first : locationsById?.get(first)?.parentId
      const code = id != null ? binInfo.get(id)?.code : undefined
      if (code) codes.push(code)
    }
    return commonCodePrefix(codes)
  }, [binInfo, placementGroups, locationsById])

  const derivedExpandedKey = useMemo(() => {
    if (selectedLocationId == null) return null
    const g = placementGroups.find((gr) => gr.items.some((item) => item.locationId === selectedLocationId))
    return g && !g.isLegacyBin ? g.key : null
  }, [placementGroups, selectedLocationId])

  const effectiveExpandedKey = expandOverride === COLLAPSED ? null : expandOverride ?? derivedExpandedKey
  const expandedGroup = effectiveExpandedKey != null
    ? placementGroups.find((g) => g.key === effectiveExpandedKey) ?? null
    : null

  const selectLevel = (locationId: number) => {
    // Reuses the caller's (already didDrag()-guarded) onSelectBin — see
    // MapStage's guardedSelectBin — so this needs no guard of its own.
    onSelectBin(locationId)
    setExpandOverride(null)
  }

  // The whole scene, memoized on everything EXCEPT the pan offset. Panning
  // changes only tx/ty, which live on the wrapping <g transform> below, so a
  // drag becomes a single attribute update instead of re-rendering every node.
  // That matters now the node count has roughly tripled: MAIN is 189 bays and a
  // 4-level rack draws its rect, four spine stripes and up to two labels.
  const scene = useMemo(() => {
    /** Screen px expressed in user units — the counter-scale for anything that
     *  must not grow with zoom (text, insets, hairlines). */
    const u = (px: number) => screenFont(px, scale)
    const cellPx = cell * scale
    /** How much text THIS placement can hold, from its own on-screen size —
     *  a 2x1 bay carries a label at zooms where a 1x1 bin cannot. */
    const tierFor = (p: LayoutPlacement) =>
      labelTier((p.w * cell - 2) * scale, (p.h * cell - 2) * scale)

    /** The RACK parent of a levelled group, which is what carries the human code
     *  ("MAIN-B-4-2"); its levels are "…-L1", "…-L2". */
    const rackIdOf = (locationId: number): number | undefined =>
      locationsById?.get(locationId)?.parentId

    /** An area wears its zone profile's tint, so "Cold Storage" reads the same
     *  sky as the cold zone and the COLD_ROOM storage form. Without a profile it
     *  falls back to the palette's neutral rather than to a zone colour it has
     *  not earned. */
    const areaFill = (region: (typeof areaRegions)[number]): string => {
      const zp = region.meta?.zoneProfileId
      const zoneType = typeof zp === 'number' ? zoneTypeByProfileId?.get(zp) : undefined
      return zoneType ? zoneTint(zoneType) : OBJECT_FILL.area
    }
    const areaName = (region: (typeof areaRegions)[number]): string =>
      typeof region.meta?.name === 'string' ? region.meta.name : ''

    /** Zone profiles a NAMED area on this floor already speaks for — the zone
     *  label pass below skips them. Keyed on the profile rather than on which
     *  cells overlap, because the profile IS the binding: `meta.zoneProfileId`
     *  is the field mig 00096 reads to decide which ZONE a bin is re-parented
     *  under. An unnamed area speaks for nothing and is not counted. */
    const areaNamedProfileIds = new Set<number>()
    for (const region of areaRegions) {
      const zp = region.meta?.zoneProfileId
      if (areaName(region).trim() && typeof zp === 'number') areaNamedProfileIds.add(zp)
    }

    return (
      <>
        {/* Zone washes — under the grid so the grid still reads through them. */}
        {/* One path per zone, not a rect per cell: the cells are unit squares
            in one path, so they fill as a union with no seams between them. */}
        {zoneRegions?.map((region) => {
          const tint = zoneTint(
            region.zoneProfileId != null ? zoneTypeByProfileId?.get(region.zoneProfileId) : null,
          )
          return (
            <path
              key={`zone-fill-${region.zoneId}`} pointerEvents="none"
              d={cellsPath(region.cells, cell)}
              fill={tint} fillOpacity={ZONE_FILL_OPACITY}
            />
          )
        })}

        {/* Named areas (mig 00090) — the wayfinding backdrop, under the grid so
            the grid still reads through them, exactly like the zone washes
            above. An area is what makes "cold storage, bottom right" visible as
            a region rather than as a scattering of individually-tinted bins. */}
        {areaRegions.map((region) => {
          const tint = areaFill(region)
          return (
            <g key={region.key} pointerEvents="none">
              <path d={regionFillPath(region, cell)} fill={tint} fillOpacity={ZONE_FILL_OPACITY} />
              <path
                d={regionOutlinePath(region, cell)}
                fill="none" stroke={tint} strokeOpacity={ZONE_STROKE_OPACITY}
                strokeWidth={2} strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}

        {/* Grid: one patterned rect, not a <line> per row and column. The
            stroke is counter-scaled by hand (u(1)) because vector-effect is not
            honoured inside a pattern tile. Below GRID_MIN_CELL_PX on screen the
            lines would be closer than they are wide, a grey moiré rather than a
            grid, so the grid is left out and the floor shows through. */}
        {cellPx >= GRID_MIN_CELL_PX && (
          <>
            <defs>
              <pattern id={MAP_GRID_ID} width={cell} height={cell} patternUnits="userSpaceOnUse">
                <path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" stroke={MAP_COLOR.grid} strokeWidth={u(1)} />
              </pattern>
            </defs>
            <rect
              pointerEvents="none"
              x={0} y={0} width={gridWidth * cell} height={gridHeight * cell}
              fill={`url(#${MAP_GRID_ID})`}
              stroke={MAP_COLOR.grid} strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {/* Zone outlines — only the edges facing out of each region, so an
            L-shaped zone traces its notch instead of being boxed in. */}
        {zoneRegions?.map((region) => {
          const tint = zoneTint(
            region.zoneProfileId != null ? zoneTypeByProfileId?.get(region.zoneProfileId) : null,
          )
          return (
            <g key={`zone-edge-${region.zoneId}`} pointerEvents="none">
              {region.edges.map((e, i) => (
                <line
                  key={i}
                  x1={e.x1 * cell} y1={e.y1 * cell} x2={e.x2 * cell} y2={e.y2 * cell}
                  stroke={tint} strokeOpacity={ZONE_STROKE_OPACITY}
                  strokeWidth={2} strokeDasharray="5 3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )
        })}

        {/* Merged structural regions — mirrors LayoutCanvas so the designer and
            this viewer never disagree about how a floor looks. Contiguous same-type
            cells are one silhouette: inset-free, radius-free union fill plus an
            exterior-only outline. `vectorEffect` is needed HERE and not in the
            designer because this canvas draws in grid user units under a scaling
            <g transform>, so without it the outline thickens as you zoom in. */}
        {structuralRegions.map((region) => (
          <g key={region.key} pointerEvents="none">
            <path d={regionFillPath(region, cell)} fill={OBJECT_FILL[region.objectType]} />
            <path
              d={regionOutlinePath(region, cell)}
              fill="none"
              stroke={OBJECT_STROKE[region.objectType]}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {/* The one type that deliberately doesn't merge: `obstacle` (discrete
            named rooms — two adjacent ones fusing would read as one mislabelled
            room). */}
        {floorObjects
          .filter((o) => !MERGED_OBJECT_TYPES.has(o.objectType))
          .map((o) => (
            <rect
              key={o.id} pointerEvents="none"
              x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
              fill={OBJECT_FILL[o.objectType]} rx={2}
            />
          ))}

        {/* Object names, above the fills so a name is never buried under a region. */}
        {floorObjects.map((o) => {
          const name = typeof o.meta?.name === 'string' ? o.meta.name : null
          if (!name || !NAMED_OBJECT_TYPES.has(o.objectType) || o.w * cellPx < MIN_OBJECT_NAME_PX) return null
          return (
            <text
              key={`name-${o.id}`} pointerEvents="none"
              x={o.x * cell + (o.w * cell) / 2} y={o.y * cell + (o.h * cell) / 2 + u(3.5)}
              textAnchor="middle" fontSize={u(10)} fontWeight={600}
              fill={MAP_COLOR.ink} fontFamily={MAP_FONT.sans}
            >
              {fitCode(name, o.w * cell, u(10))}
            </text>
          )
        })}

        {/* Storage bins — one rect per (floor,x,y) group (see placementGroups
            above), so a levelled rack paints once instead of N overlapping
            times. A legacy group (isLegacyBin) keeps the original single-bin
            appearance; only its labelling is new. */}
        <g data-rack-layer filter={`url(#${MAP_RACK_SHADOW_ID})`}>
        {placementGroups.map((group, i) => {
          const p = group.items[0]
          const selected = group.items.some((item) => item.locationId === selectedLocationId)
          const highlighted = group.items.some((item) => highlightedLocationIds?.has(item.locationId))
          const isRack = !group.isLegacyBin
          const tier = tierFor(p)
          // Selection is no longer said by this stroke — it is the two rings drawn
          // by `selectionRings` below, which read on any fill.
          const stroke = highlighted ? PLACEMENT_FILL.highlightStroke : DEFAULT_BIN_STROKE
          const binClass = `wh-bin wh-bin-in${selected ? ' wh-bin-selected' : ''}`
          const stagger = { '--wh-i': Math.min(i, 40) } as CSSProperties
          const rectX = p.x * cell + 1
          const rectY = p.y * cell + 1
          const rectW = p.w * cell - 2
          const rectH = p.h * cell - 2

          // ── Legacy single bin ────────────────────────────────────────────
          if (!isRack) {
            const info = binInfo?.get(p.locationId)
            // At rest a bin carries its storage form's colour; an active overlay
            // still wins, because that is the layer the operator switched on to
            // read. With no form colour we land on the DESIGNER's fallback
            // (PLACEMENT_FILL.existing) rather than on grey — the same cell drawn
            // by LayoutCanvas:394 is emerald there, and a bin that changes colour
            // between the two canvases reads as data loss. Grey is reserved for
            // `!info`: no location row at all, hence no code and nothing to say.
            const fill =
              binColors?.get(p.locationId)
              ?? info?.formColor
              ?? (info ? PLACEMENT_FILL.existing : DEFAULT_BIN_FILL)
            const badge = binBadges?.get(p.locationId)
            const fillPct = binFillPct?.get(p.locationId) ?? null
            return (
              <g
                key={group.key}
                data-testid={`rack-${p.locationId}`}
                onClick={() => onSelectBin(p.locationId)}
                onPointerEnter={() => onHoverBin?.({
                  locationId: p.locationId, x: p.x, y: p.y, w: p.w, h: p.h, levelCount: 0, fillPct,
                })}
                onPointerLeave={() => onHoverBin?.(null)}
                className="wh-cell"
                style={{ cursor: 'pointer' }}
              >
                <rect
                  className={binClass}
                  style={stagger}
                  x={rectX} y={rectY} width={rectW} height={rectH}
                  fill={fill} stroke={stroke} strokeWidth={highlighted ? 2 : 1.5} rx={3}
                  vectorEffect="non-scaling-stroke"
                />
                {sheen(rectX, rectY, rectW, rectH, stagger)}
                {info && <title>{hoverTitle(info, fillPct, 0)}</title>}
                {renderBinLabel({ tier, u, info, sharedPrefix, fillPct, levelCount: 0, rectX, rectY, rectW, rectH, cellPx })}
                {badge && tier !== 'none' && (
                  <text
                    x={rectX + rectW - u(2)} y={rectY + u(9)}
                    textAnchor="end" fontSize={u(8)} fill={MAP_COLOR.inkMuted} fontFamily={MAP_FONT.mono}
                    pointerEvents="none"
                  >
                    {badge}
                  </text>
                )}
                {selected && selectionRings(rectX, rectY, rectW, rectH, u)}
              </g>
            )
          }

          // ── Levelled rack ────────────────────────────────────────────────
          // Clicking expands the cell in place rather than selecting a bin:
          // there's no single "the" location to select until a level is chosen.
          const rackId = rackIdOf(p.locationId)
          const rows = spineRows(group.items, locationsById ?? new Map(), binFillPct ?? new Map())
          // Capacity comes from `locations`, not from binInfo: it is the
          // authoritative column, and sourcing it here would otherwise make the
          // rack's rolled-up fill silently null whenever a caller populated
          // binInfo for bins but not for the SHELF-kind level rows.
          const capacityByLocation = new Map<number, number | null | undefined>(
            rows.map((r) => [r.locationId, locationsById?.get(r.locationId)?.capacitySlots]),
          )
          const rackFill = rollupFill(rows, capacityByLocation)
          const showSpine = spineFits(rectH * scale, rows.length)
          // With a spine drawn, the rect is just the frame — the stripes carry
          // the per-level truth. Without one (zoomed out), fall back to the
          // caller's capacity-weighted rack rollup, which replaced the old
          // "colour of whichever level happened to be first" approximation.
          const rackInfo = rackId != null ? binInfo?.get(rackId) : undefined
          // Same designer-parity rule as the legacy bin above. Note this reads the
          // RACK PARENT's form, not the level's — the parent is what owns the cell.
          const baseFill = rackInfo?.formColor ?? (rackInfo ? PLACEMENT_FILL.existing : DEFAULT_BIN_FILL)
          const fill = showSpine
            ? baseFill
            : (rackId != null ? rackColors?.get(rackId) : undefined)
              ?? binColors?.get(p.locationId)
              ?? baseFill

          return (
            <g
              key={group.key}
              data-testid={`rack-${p.locationId}`}
              onClick={() => guard(() => setExpandOverride(group.key))}
              onPointerEnter={() => onHoverBin?.({
                locationId: rackId ?? p.locationId,
                x: p.x, y: p.y, w: p.w, h: p.h,
                levelCount: rows.length, fillPct: rackFill,
              })}
              onPointerLeave={() => onHoverBin?.(null)}
              className="wh-cell"
              style={{ cursor: 'pointer' }}
            >
              <rect
                className={binClass}
                style={stagger}
                x={rectX} y={rectY} width={rectW} height={rectH}
                fill={fill} stroke={stroke} strokeWidth={highlighted ? 2 : 1.5} rx={3}
                vectorEffect="non-scaling-stroke"
              />
              {sheen(rectX, rectY, rectW, rectH, stagger)}
              {rackInfo && <title>{hoverTitle(rackInfo, rackFill, rows.length)}</title>}

              {/* Level spine: one stripe per level, BOTTOM-FIRST so L1 sits at
                  the bottom of the rect exactly as it does on the floor. The
                  stripe's tint is its role; the inner bar's length is how full
                  that level is, and its colour follows the active overlay when
                  one is on. This is what makes level count, role mix and
                  fullness readable without clicking the rack open. */}
              {showSpine && (() => {
                const inset = Math.min(u(1.5), rectH / 4)
                const innerX = rectX + inset
                const innerW = Math.max(0, rectW - inset * 2)
                const innerH = Math.max(0, rectH - inset * 2)
                const stripeH = innerH / rows.length
                const gap = Math.min(u(0.5), stripeH / 5)
                return (
                  <g pointerEvents="none">
                    {rows.map((row, idx) => {
                      // SVG y grows downward, so L1 (idx 0) is laid out from the
                      // BOTTOM edge upward.
                      const y = rectY + inset + innerH - (idx + 1) * stripeH
                      const roleColor = levelRoleFill(levelRoles, row.roleKey)
                      const overlayColor = binColors?.get(row.locationId)
                      const barColor = overlayColor ?? roleColor
                      // A category colour belongs to the place, so it fills the
                      // whole stripe, stock or none; a measure keeps the bar.
                      const placeColor = binColorsAreCategories ? overlayColor : undefined
                      const pct = row.fillPct == null ? 0 : Math.max(0, Math.min(1, row.fillPct))
                      return (
                        <g key={row.locationId}>
                          <rect
                            x={innerX} y={y} width={innerW} height={Math.max(0, stripeH - gap)}
                            fill={placeColor ?? roleColor} fillOpacity={placeColor ? 0.95 : 0.35}
                            rx={Math.min(1, stripeH / 4)}
                          />
                          {!placeColor && row.fillPct != null && pct > 0 && (
                            <rect
                              x={innerX} y={y} width={innerW * pct} height={Math.max(0, stripeH - gap)}
                              fill={barColor} fillOpacity={0.95} rx={Math.min(1, stripeH / 4)}
                            />
                          )}
                        </g>
                      )
                    })}
                  </g>
                )
              })()}

              {renderBinLabel({
                tier, u, info: rackInfo, sharedPrefix, fillPct: rackFill, levelCount: rows.length,
                rectX, rectY, rectW, rectH, cellPx,
                // With a spine behind it the code needs a plate to stay legible.
                plate: showSpine,
              })}
              {selected && selectionRings(rectX, rectY, rectW, rectH, u)}
            </g>
          )
        })}
        </g>

        {/* Area names — same wayfinding layer as the zone names below, and for
            the same reason: an area label matters MOST when zoomed out, where no
            individual bin can label itself. Anchored to the region's top-left
            cell (cells are (y,x)-sorted, so [0] never lands in an L's notch).

            INSIDE that cell, not in the row above it. Anchoring above put the
            label in a row this region does not own, so a "Slow Movers" area
            drawn under a "Fast Movers" one printed its name across the Fast
            Movers bays. Drawn after the bins, so sitting on them is fine; the
            halo below is what keeps it readable over a dark rack. */}
        {areaRegions.map((region) => {
          const name = areaName(region)
          const anchor = region.cells[0]
          if (!name || !anchor) return null
          // The NAME is the rename target, never the wash. The wash sits under
          // the racks with pointerEvents="none" precisely so it cannot steal
          // their hit tests; giving it a click handler would fight that.
          const clickable = Boolean(onRenameArea)
          // Bounded to roughly the region's own width, so an un-clipped name
          // cannot run sideways over its neighbours and read as a second label.
          // See regionLabelBudget for why a NARROW region is allowed to overrun
          // a little, and why this one measurement is not counter-scaled.
          const fitted = fitName(
            clickable ? `${name} ✎` : name,
            regionLabelBudget(regionBounds(region).w, cell),
            12,
          )
          if (!fitted) return null
          return (
            <text
              key={`area-name-${region.key}`}
              x={anchor.x * cell + u(3)}
              y={anchor.y * cell + u(11)}
              fontSize={u(12)} fontWeight={700} fontFamily={MAP_FONT.sans}
              fill={areaFill(region)}
              stroke={MAP_COLOR.halo} strokeWidth={u(3)} paintOrder="stroke" strokeLinejoin="round"
              pointerEvents={clickable ? 'auto' : 'none'}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onClick={clickable ? (e: { stopPropagation: () => void }) => {
                e.stopPropagation()
                // Through the stage's pan guard, so finishing a drag over the
                // label does not pop a dialog.
                guard(() => onRenameArea!(name))
              } : undefined}
            >
              {fitted}
              {clickable && <title>Rename “{name}” and the locations inside it</title>}
            </text>
          )
        })}

        {/* Floor signs (mig 00097) — the plate is already drawn among the
            structural regions above; this is its text, hoisted into the
            wayfinding layer so a sign painted OVER racks is not buried under
            them. Signs co-occupy with everything, so that is the normal case,
            not an edge one.

            Centred on the region's bounding box, unlike an area name (which
            anchors above its region). See regionBounds for why the two differ. */}
        {signRegions.map((region) => {
          const name = typeof region.meta?.name === 'string' ? region.meta.name : ''
          if (!name) return null
          const b = regionBounds(region)
          // The gate is on the REGION's width, which is the whole point of
          // merging: a painted sign is N 1x1 cells and could never clear this
          // bar object-by-object.
          if (b.w * cellPx < MIN_OBJECT_NAME_PX) return null
          const clickable = Boolean(onEditSign)
          return (
            <text
              key={`sign-name-${region.key}`}
              x={(b.x + b.w / 2) * cell}
              y={(b.y + b.h / 2) * cell + u(3.5)}
              textAnchor="middle" fontSize={u(10)} fontWeight={600}
              fill={MAP_COLOR.ink} fontFamily={MAP_FONT.sans}
              pointerEvents={clickable ? 'auto' : 'none'}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onClick={clickable ? (e: { stopPropagation: () => void }) => {
                e.stopPropagation()
                // Through the stage's pan guard, so finishing a drag over the
                // sign does not pop a dialog.
                guard(() => onEditSign!(name))
              } : undefined}
            >
              {/* fitName, not fitCode: a sign's text is operator prose set in a
                  sans face, so it needs SANS_ADVANCE and it must keep its HEAD.
                  fitCode preserves the tail — right for a code whose last
                  segment identifies it, but it turned "Inbound Staging" into
                  "…bound Staging". */}
              {fitName(clickable ? `${name} ✎` : name, b.w * cell, u(10))}
              {clickable && <title>Edit or remove the sign “{name}”</title>}
            </text>
          )
        })}

        {/* Zone names, above the bins so they stay readable over a dense floor.
            Deliberately NOT gated on how legible an individual bin is: an area
            name is the wayfinding layer, and it matters MOST at the zoomed-out
            view where no bin can label itself. Being counter-scaled, it stays
            the same size on screen however far out you go.

            SUPPRESSED where a named area already carries this zone's profile.
            Since mig 00096 painting an area with a `zoneProfileId` is what
            CREATES that ZONE (`resolveZone`), and the row it creates is named
            after the profile — so the two labels are two spellings of one fact
            about one patch of floor. Worse, they are anchored by the same
            arithmetic from two different corners (the area's top-left CELL, the
            zone's top-left BIN), so they print side by side on one line and read
            as the name repeated. 00096's own rule decides which survives: the
            AREA wins over the per-bin dropdown, because the area is what the
            operator drew and named.

            A zone reached the OTHER way — PlacementInspector's per-bin dropdown,
            with no area over it — has nothing else naming it, and still draws. */}
        {zoneRegions?.map((region) => {
          if (region.zoneProfileId != null && areaNamedProfileIds.has(region.zoneProfileId)) return null
          const type = region.zoneProfileId != null ? zoneTypeByProfileId?.get(region.zoneProfileId) : null
          // Same budget as the area names above.
          const fitted = fitName(
            `${region.name} · ${zoneTypeLabel(type)}`,
            regionLabelBudget(regionBounds(region).w, cell),
            12,
          )
          if (!fitted) return null
          return (
            <text
              key={`zone-name-${region.zoneId}`}
              x={region.labelAt.x * cell + u(3)}
              // Inside the region's own first row, for the same reason the area
              // names above are: the row above belongs to whatever is drawn
              // there. This also keeps the label inside the content bounds
              // `fit()` measures, which the old negative-y clamp existed to do.
              y={region.labelAt.y * cell + u(11)}
              fontSize={u(12)} fontWeight={700} fontFamily={MAP_FONT.sans}
              fill={zoneTint(type)}
              stroke={MAP_COLOR.halo} strokeWidth={u(3)} paintOrder="stroke" strokeLinejoin="round"
              pointerEvents="none"
            >
              {fitted}
            </text>
          )
        })}

        {/* Expand-in-place: the selected rack's levels, exploded into a
            vertical stack anchored to its cell. Drawn on top of everything
            else; the scrim dims the rest of the grid (never moves it) and
            collapses the expansion on click. */}
        {expandedGroup && (() => {
          const group = expandedGroup
          const gridPxW = gridWidth * cell
          const gridPxH = gridHeight * cell
          const levels = [...group.items].sort((a, b) => (b.levelIndex ?? 0) - (a.levelIndex ?? 0))

          // Every dimension here is a SCREEN measurement expressed in user units
          // through u(), exactly as renderBinLabel does.
          //
          // This block used to mix the two currencies: rowH/stackW were in GRID
          // units (constant on the grid, shrinking on screen as you zoom out)
          // while fontSize was a raw user-unit number (growing on screen as you
          // zoom in). The text therefore outgrew a box that never moved, and
          // since the code and the role label were both anchored inside that one
          // box with no reserved columns, they overlapped into an unreadable
          // smear — `L3 · NEXG0%-·2Bulk1-L`. Everything below is derived from
          // u(), so the panel is the same size on screen at every zoom.
          const font = u(10)
          const metaFont = u(9)
          const padX = u(7)
          const colGap = u(10)
          const rowH = Math.max(cell * 1.1, u(22))
          const gap = u(3)
          /** Monospace advance, matching mapLabels' MONO_ADVANCE. Used to size the
           *  panel from its content; over-estimating only widens it. */
          const advance = 0.6

          const rows = levels.map((lvl) => {
            const loc = locationsById?.get(lvl.locationId)
            const pct = binFillPct?.get(lvl.locationId)
            const role = loc?.levelRole ?? null
            const roleText = levelRoleLabel(levelRoles, role)
            // A level with no capacity configured has no honest fullness, and a
            // legacy row has no role — either half may be absent, so join what is
            // actually there rather than emitting a dangling separator.
            const meta = [pct != null ? `${Math.round(pct * 100)}%` : null, roleText || null]
              .filter(Boolean)
              .join(' · ')
            return {
              locationId: lvl.locationId,
              role,
              fullCode: loc?.code ?? `#${lvl.locationId}`,
              fullName: loc?.name ?? null,
              code: loc ? shortCode(loc.code, sharedPrefix) : `#${lvl.locationId}`,
              idx: lvl.levelIndex ?? loc?.levelIndex ?? 0,
              meta,
            }
          })

          // Width comes from the widest row, so a long code or an operator-renamed
          // role ("Quarantine overflow") widens the panel instead of colliding
          // inside it. Capped so one pathological code can't span the floor;
          // anything past the cap is elided by fitCode per row below.
          const leftChars = Math.max(...rows.map((r) => `L${r.idx} · ${r.code}`.length), 1)
          const metaChars = Math.max(...rows.map((r) => r.meta.length), 0)
          const naturalW =
            padX * 2 + leftChars * font * advance + (metaChars > 0 ? colGap + metaChars * metaFont * advance : 0)
          const stackW = Math.min(
            Math.max(cell * 2.6, naturalW),
            Math.max(cell * 2.6, Math.min(u(340), gridPxW - u(8))),
          )
          const metaW = metaChars * metaFont * advance
          const stackH = levels.length * rowH + (levels.length - 1) * gap
          const cellCenterX = group.x * cell + (group.w * cell) / 2
          const cellCenterY = group.y * cell + (group.h * cell) / 2
          const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), Math.max(4, max - 4))
          const stackX = clamp(cellCenterX - stackW / 2, gridPxW - stackW)
          const stackY = clamp(cellCenterY - stackH / 2, gridPxH - stackH)

          return (
            <g>
              <rect
                x={0} y={0} width={gridPxW} height={gridPxH}
                fill={MAP_COLOR.scrim}
                onClick={() => guard(() => setExpandOverride(COLLAPSED))}
                style={{ cursor: 'pointer' }}
              />
              {rows.map((row, stackPos) => {
                const y = stackY + stackPos * (rowH + gap)
                const isSelected = row.locationId === selectedLocationId
                // The code gets whatever the meta column doesn't claim. fitCode
                // keeps the TAIL (see mapLabels) — the discriminating end of a
                // hierarchical code — and returns '' rather than a lone ellipsis.
                const prefix = `L${row.idx} · `
                const codeW =
                  stackW - padX * 2 - (row.meta ? metaW + colGap : 0) - prefix.length * font * advance
                const code = fitCode(row.code, codeW, font)
                return (
                  <g
                    key={row.locationId}
                    data-testid={`level-${row.fullCode}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectLevel(row.locationId)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={stackX} y={y} width={stackW} height={rowH} rx={u(4)}
                      fill={levelRoleFill(levelRoles, row.role)}
                      stroke={isSelected ? MAP_COLOR.selection : levelRoleStroke(levelRoles, row.role)}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* Elision means the visible code can be partial, so the full
                        one lives in a title — same contract as the bins above. */}
                    <title>
                      {locationOneLine({ code: row.fullCode, name: row.fullName })}
                      {row.meta ? ` · ${row.meta}` : ''}
                    </title>
                    <text
                      x={stackX + padX} y={y + rowH / 2 + font * 0.35}
                      fontSize={font} fontFamily={MAP_FONT.mono} fill={MAP_COLOR.ink}
                      pointerEvents="none"
                    >
                      {prefix}{code}
                    </text>
                    {row.meta && (
                      <text
                        x={stackX + stackW - padX} y={y + rowH / 2 + metaFont * 0.35}
                        textAnchor="end" fontSize={metaFont} fontFamily={MAP_FONT.sans} fill={MAP_COLOR.inkMuted}
                        style={TABULAR}
                        pointerEvents="none"
                      >
                        {row.meta}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* Overlay marker layers (route/putaway/slotting), supplied by consumers. */}
        {renderOverlay?.(cell, scale)}
      </>
    )
    // `viewport.tx`/`viewport.ty` are deliberately absent: they only move the
    // wrapping <g>, so excluding them makes a pan skip this whole subtree.
  }, [
    cell, scale, gridWidth, gridHeight, floorObjects, areaRegions, structuralRegions, placementGroups, expandedGroup,
    selectedLocationId, highlightedLocationIds, binColors, binColorsAreCategories, rackColors, binBadges, binInfo,
    binFillPct, zoneRegions, zoneTypeByProfileId, locationsById, levelRoles, renderOverlay,
    onSelectBin, onHoverBin, guard, sharedPrefix,
  ])

  return (
    <svg
      className="block h-full w-full"
      role="img"
      aria-label={`${layout.name} floor ${floor + 1}`}
      data-moving={moving || undefined}
    >
      {SCENE_DEFS}
      <g transform={`translate(${viewport.tx},${viewport.ty}) scale(${viewport.scale})`}>
        {scene}
      </g>
    </svg>
  )
}

/** Figures that change under the eye (a fill %) must not shimmy as they do. */
const TABULAR: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** The grid's pattern tile. One canvas is mounted at a time, so a fixed id is safe,
 *  as it is for the shadow and sheen in SCENE_DEFS. */
const MAP_GRID_ID = 'wh-map-grid'
/** Below this many screen pixels per cell the grid is noise, not structure. */
const GRID_MIN_CELL_PX = 6

/** A set of grid cells as ONE path of unit squares: the cells fill as a union. */
function cellsPath(cells: readonly { x: number; y: number }[], cell: number): string {
  return cells.map((c) => `M${c.x * cell} ${c.y * cell}h${cell}v${cell}h${-cell}z`).join('')
}

/**
 * The scene's two shared definitions. A module constant, so it is one element
 * with one identity for the life of the page: it sits OUTSIDE the scene memo and
 * adds nothing to that memo's dependencies.
 *
 * The shadow's offset and blur are in user units, so it deepens as you zoom in
 * and all but vanishes at the fitted view — which is what a real floor does, and
 * what keeps a whole-floor view from turning into a field of smudges.
 */
const SCENE_DEFS = (
  <defs>
    <filter id={MAP_RACK_SHADOW_ID} x="-5%" y="-5%" width="110%" height="115%" colorInterpolationFilters="sRGB">
      <feDropShadow dx={0} dy={1} stdDeviation={1.1} style={{ floodColor: MAP_COLOR.rackShadow }} />
    </filter>
    <linearGradient id={MAP_SHEEN_ID} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style={{ stopColor: MAP_COLOR.sheenLight }} />
      <stop offset="0.55" style={{ stopColor: MAP_COLOR.sheenLight, stopOpacity: 0 }} />
      <stop offset="1" style={{ stopColor: MAP_COLOR.sheenShade }} />
    </linearGradient>
  </defs>
)

/** A soft top-lit sheen over a rack's fill: light at the top edge, a trace of
 *  shade at the bottom. One shared gradient; this is only the rect that wears
 *  it. It rides the same load-in animation as the fill beneath it. */
function sheen(x: number, y: number, w: number, h: number, stagger: CSSProperties): ReactNode {
  return (
    <rect
      className="wh-bin-in" style={stagger} pointerEvents="none"
      x={x} y={y} width={w} height={h} rx={3} fill={`url(#${MAP_SHEEN_ID})`}
    />
  )
}

/**
 * The selected cell: a brand ring on the cell's edge and a white ring just
 * inside it. Two rings because one cannot work everywhere — an emerald stroke
 * disappears on an emerald fast-mover rack, and the white one alone disappears
 * on an empty (white) bin. Together one of them always has contrast.
 *
 * Both stay inside the cell's own footprint, so a neighbour drawn later can
 * never paint over half of the ring.
 */
function selectionRings(x: number, y: number, w: number, h: number, u: (px: number) => number): ReactNode {
  const inset = Math.min(u(2.25), w / 4, h / 4)
  return (
    <g pointerEvents="none">
      <rect
        data-ring="outer" x={x} y={y} width={w} height={h} rx={3}
        fill="none" stroke={MAP_COLOR.selection} strokeWidth={3} vectorEffect="non-scaling-stroke"
      />
      <rect
        data-ring="inner"
        x={x + inset} y={y + inset} width={Math.max(0, w - inset * 2)} height={Math.max(0, h - inset * 2)} rx={2}
        fill="none" stroke={MAP_COLOR.selectionInner} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}

/** Native SVG tooltip — the no-pointer and assistive fallback for the stage's
 *  hover card. Kept terse: a `<title>` has no layout, so it must read as one line. */
function hoverTitle(info: BinInfo, fillPct: number | null, levelCount: number): string {
  // Name AND code, always — the drawn label is elided (and since mig 00094 may
  // be the name's tail alone), so this is where the full pair lives.
  const parts = [locationOneLine(info)]
  if (levelCount > 0) parts.push(`${levelCount} levels`)
  if (fillPct != null) parts.push(`${Math.round(fillPct * 100)}% full`)
  if (info.capacitySlots) parts.push(`${info.capacitySlots} ${info.slotKind ?? 'slot'}s`)
  if (info.contentsCount > 0) parts.push(`${info.contentsCount} SKU${info.contentsCount > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

interface BinLabelArgs {
  tier: ReturnType<typeof labelTier>
  u: (px: number) => number
  info?: BinInfo
  /** Shared code root to strip, so labels spend their width on what differs. */
  sharedPrefix: string
  fillPct: number | null
  levelCount: number
  rectX: number
  rectY: number
  rectW: number
  rectH: number
  cellPx: number
  plate?: boolean
}

/**
 * The bin's on-map text, gated by how much room the current zoom actually gives.
 *
 * `code` tier draws the location code alone; `full` adds a second line of
 * `78% · 4L`. The second line is additionally gated on the rect being tall
 * enough for two lines, so a 1-cell-high placement at high zoom doesn't overflow
 * its own box.
 */
function renderBinLabel({
  tier, u, info, sharedPrefix, fillPct, levelCount, rectX, rectY, rectW, rectH, plate,
}: BinLabelArgs): ReactNode {
  if (tier === 'none' || !info?.code) return null

  const codeFont = u(9)
  // Prefer the friendly name (mig 00094), and specifically its TAIL: the area
  // name is already drawn across the whole region as its own wayfinding layer,
  // so repeating "Chiller" on each of its forty bins spends the entire label on
  // the one part the operator can already see. "Rack 7" is what is left.
  //
  // Falls back to the code — for a warehouse that predates 00094 (where `name`
  // is `Bin 9,4`, strictly worse than the code) and for any rect too narrow for
  // even the tail. A truncated name stub is worse than a whole code.
  const label = (() => {
    const tail = isUninformativeName(info.name, info.code) ? '' : nameTail(info.name)
    if (tail) {
      const fitted = fitName(tail, rectW - u(4), codeFont)
      if (fitted) return { text: fitted, mono: false }
    }
    // Coarse-then-fine: a tight rect gets the aisle ("F01"), a roomy one the full
    // in-warehouse code ("F01-L01"). See coarseCode's note on why the tail is the
    // wrong thing to keep when the whole floor is in view.
    const source = tier === 'full'
      ? shortCode(info.code, sharedPrefix)
      : coarseCode(info.code, sharedPrefix)
    const fitted = fitCode(source, rectW - u(4), codeFont)
    return fitted ? { text: fitted, mono: true } : null
  })()
  if (!label) return null
  const code = label.text
  const advance = label.mono ? 0.6 : 0.52

  const detail: string[] = []
  if (fillPct != null) detail.push(`${Math.round(fillPct * 100)}%`)
  if (levelCount > 1) detail.push(`${levelCount}L`)
  const secondLine = detail.join(' · ')
  const hasSecond = tier === 'full' && secondLine.length > 0 && rectH >= u(9) * 2.2

  const cx = rectX + rectW / 2
  const cy = rectY + rectH / 2

  return (
    <g pointerEvents="none">
      {plate && (
        // A code drawn straight over the level spine is unreadable; this is the
        // smallest thing that restores contrast without hiding the stripes.
        <rect
          x={cx - (code.length * codeFont * advance) / 2 - u(2)}
          y={hasSecond ? cy - u(10) : cy - u(6)}
          width={code.length * codeFont * advance + u(4)}
          height={hasSecond ? u(20) : u(12)}
          fill={MAP_COLOR.halo} fillOpacity={0.82} rx={u(2)}
        />
      )}
      <text
        x={cx} y={hasSecond ? cy - u(0.5) : cy + u(3.2)}
        textAnchor="middle" fontSize={codeFont}
        fontFamily={label.mono ? MAP_FONT.mono : MAP_FONT.sans} fontWeight={500} fill={MAP_COLOR.ink}
      >
        {code}
      </text>
      {hasSecond && (
        <text
          x={cx} y={cy + u(9)}
          textAnchor="middle" fontSize={u(8)} fontFamily={MAP_FONT.mono} fill={MAP_COLOR.inkMuted}
        >
          {secondLine}
        </text>
      )}
    </g>
  )
}
