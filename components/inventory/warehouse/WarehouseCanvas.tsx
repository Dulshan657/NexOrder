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

import { useMemo, useState, type ReactNode, type CSSProperties } from 'react'
import type { WarehouseLayout, LayoutPlacement, LayoutObject, InventoryLocation } from '@/types'
import { OBJECT_FILL, BASE_CELL, PLACEMENT_FILL, levelRoleFill, levelRoleStroke, levelRoleLabel } from '@/components/admin/layout/layoutPalette'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { groupPlacementsByCell } from '@/components/admin/layout/LayoutCanvas'
import { DEFAULT_BIN_FILL, DEFAULT_BIN_STROKE } from './warehouseOverlays'
import { labelTier, screenFont, fitCode, commonCodePrefix, shortCode, coarseCode } from './mapLabels'
import { spineRows, spineFits, rollupFill } from './levelSpine'
import { zoneTint, zoneTypeLabel, ZONE_FILL_OPACITY, ZONE_STROKE_OPACITY } from './zoneTints'
import type { ZoneRegion } from './zoneRegions'
import type { Viewport } from './mapViewport'

/** Sentinel meaning "explicitly collapsed" — distinct from `null` ("no manual
 *  override; derive expansion from `selectedLocationId`"), see `expandedKey`. */
const COLLAPSED = '__collapsed__'

/** Structural objects that carry an operator-authored `meta.name` worth drawing.
 *  Mirrors LayoutCanvas's NAMED_OBJECT_TYPES so the two canvases agree on which
 *  blocks are named — this is how MAIN's "Cold room" / "Returns" / "Quarantine"
 *  stop being anonymous grey rectangles on the ops map. */
const NAMED_OBJECT_TYPES = new Set(['obstacle', 'staging', 'label'])
/** Below this many screen px of width, an object's name cannot be read. */
const MIN_OBJECT_NAME_PX = 48

/** Per-bin display data the renderer cannot derive from geometry alone. Built by
 *  RackedWorkspace from `locationsById` + the viewer model, both of which it
 *  already holds — none of this is a new query. */
export interface BinInfo {
  code: string
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
  renderOverlay?: (cell: number) => ReactNode
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
}: WarehouseCanvasProps) {
  // Operator-managed role vocabulary (mig 00081). A level whose role has been
  // retired still renders with its own colour, because getLevelRoles returns
  // inactive rows too.
  const { data: levelRoles = [] } = useLevelRoles()
  const cell = BASE_CELL
  const { gridWidth, gridHeight } = layout
  const scale = viewport.scale

  // These three are memoized for identity, not for the cost of the work: they
  // are dependencies of the scene memo below, and `filter` returns a fresh array
  // on every render. Since this component re-renders on every pan frame (the
  // viewport prop changes), an unmemoized filter would hand the scene memo new
  // deps each frame and defeat the whole optimization.
  const guard = useMemo(() => guardClick ?? ((fn: () => void) => fn()), [guardClick])
  const floorObjects = useMemo(() => objects.filter((o) => o.floor === floor), [objects, floor])
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

    return (
      <>
        {/* Zone washes — under the grid so the grid still reads through them. */}
        {zoneRegions?.map((region) => {
          const tint = zoneTint(
            region.zoneProfileId != null ? zoneTypeByProfileId?.get(region.zoneProfileId) : null,
          )
          return (
            <g key={`zone-fill-${region.zoneId}`} pointerEvents="none">
              {region.cells.map((c) => (
                <rect
                  key={`${c.x}:${c.y}`}
                  x={c.x * cell} y={c.y * cell} width={cell} height={cell}
                  fill={tint} fillOpacity={ZONE_FILL_OPACITY}
                />
              ))}
            </g>
          )
        })}

        {/* Grid lines */}
        {Array.from({ length: gridWidth + 1 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={i * cell} y1={0} x2={i * cell} y2={gridHeight * cell}
            stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: gridHeight + 1 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0} y1={i * cell} x2={gridWidth * cell} y2={i * cell}
            stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}

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

        {/* Objects (walls/walkways/docks/lifts) */}
        {floorObjects.map((o) => {
          const name = typeof o.meta?.name === 'string' ? o.meta.name : null
          const showName =
            name && NAMED_OBJECT_TYPES.has(o.objectType) && o.w * cellPx >= MIN_OBJECT_NAME_PX
          return (
            <g key={o.id} pointerEvents="none">
              <rect
                x={o.x * cell + 1} y={o.y * cell + 1} width={o.w * cell - 2} height={o.h * cell - 2}
                fill={OBJECT_FILL[o.objectType]} rx={2}
              />
              {showName && (
                <text
                  x={o.x * cell + (o.w * cell) / 2} y={o.y * cell + (o.h * cell) / 2 + u(3.5)}
                  textAnchor="middle" fontSize={u(10)} fontWeight={600}
                  fill="#44403c" fontFamily="sans-serif"
                >
                  {fitCode(name, o.w * cell, u(10))}
                </text>
              )}
            </g>
          )
        })}

        {/* Storage bins — one rect per (floor,x,y) group (see placementGroups
            above), so a levelled rack paints once instead of N overlapping
            times. A legacy group (isLegacyBin) keeps the original single-bin
            appearance; only its labelling is new. */}
        {placementGroups.map((group, i) => {
          const p = group.items[0]
          const selected = group.items.some((item) => item.locationId === selectedLocationId)
          const highlighted = group.items.some((item) => highlightedLocationIds?.has(item.locationId))
          const isRack = !group.isLegacyBin
          const tier = tierFor(p)
          const stroke = selected
            ? PLACEMENT_FILL.selectedStroke
            : highlighted
              ? PLACEMENT_FILL.highlightStroke
              : DEFAULT_BIN_STROKE
          const rectX = p.x * cell + 1
          const rectY = p.y * cell + 1
          const rectW = p.w * cell - 2
          const rectH = p.h * cell - 2

          // ── Legacy single bin ────────────────────────────────────────────
          if (!isRack) {
            const info = binInfo?.get(p.locationId)
            // At rest a bin now carries its storage form's colour instead of one
            // undifferentiated grey; an active overlay still wins, because that
            // is the layer the operator switched on to read.
            const fill = binColors?.get(p.locationId) ?? info?.formColor ?? DEFAULT_BIN_FILL
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
                style={{ cursor: 'pointer' }}
              >
                <rect
                  className="wh-bin wh-bin-in"
                  style={{ '--wh-i': Math.min(i, 40) } as CSSProperties}
                  x={rectX} y={rectY} width={rectW} height={rectH}
                  fill={fill} stroke={stroke} strokeWidth={selected ? 3 : highlighted ? 2 : 1.5} rx={3}
                  vectorEffect="non-scaling-stroke"
                />
                {info && <title>{hoverTitle(info, fillPct, 0)}</title>}
                {renderBinLabel({ tier, u, info, sharedPrefix, fillPct, levelCount: 0, rectX, rectY, rectW, rectH, cellPx })}
                {badge && tier !== 'none' && (
                  <text
                    x={rectX + rectW - u(2)} y={rectY + u(9)}
                    textAnchor="end" fontSize={u(8)} fill="#334155" fontFamily="monospace"
                    pointerEvents="none"
                  >
                    {badge}
                  </text>
                )}
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
          const baseFill = rackInfo?.formColor ?? DEFAULT_BIN_FILL
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
              style={{ cursor: 'pointer' }}
            >
              <rect
                className="wh-bin wh-bin-in"
                style={{ '--wh-i': Math.min(i, 40) } as CSSProperties}
                x={rectX} y={rectY} width={rectW} height={rectH}
                fill={fill} stroke={stroke} strokeWidth={selected ? 3 : highlighted ? 2 : 1.5} rx={3}
                vectorEffect="non-scaling-stroke"
              />
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
                      const barColor = binColors?.get(row.locationId) ?? roleColor
                      const pct = row.fillPct == null ? 0 : Math.max(0, Math.min(1, row.fillPct))
                      return (
                        <g key={row.locationId}>
                          <rect
                            x={innerX} y={y} width={innerW} height={Math.max(0, stripeH - gap)}
                            fill={roleColor} fillOpacity={0.35} rx={Math.min(1, stripeH / 4)}
                          />
                          {row.fillPct != null && pct > 0 && (
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
            </g>
          )
        })}

        {/* Zone names, above the bins so they stay readable over a dense floor.
            Deliberately NOT gated on how legible an individual bin is: an area
            name is the wayfinding layer, and it matters MOST at the zoomed-out
            view where no bin can label itself. Being counter-scaled, it stays
            the same size on screen however far out you go. */}
        {zoneRegions?.map((region) => {
          const type = region.zoneProfileId != null ? zoneTypeByProfileId?.get(region.zoneProfileId) : null
          return (
            <text
              key={`zone-name-${region.zoneId}`}
              x={region.labelAt.x * cell + u(3)}
              // Above the region, but never off the top of the grid — `fit()`
              // measures content bounds from placements and objects, so a label
              // at negative y would sit outside the fitted view.
              y={Math.max(u(11), region.labelAt.y * cell - u(3))}
              fontSize={u(12)} fontWeight={700} fontFamily="sans-serif"
              fill={zoneTint(type)} pointerEvents="none"
            >
              {region.name} · {zoneTypeLabel(type)}
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
          const rowH = Math.max(cell * 1.1, 20)
          const gap = 3
          const stackW = Math.max(cell * 2.6, 100)
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
                fill="rgba(15,23,42,0.45)"
                onClick={() => guard(() => setExpandOverride(COLLAPSED))}
                style={{ cursor: 'pointer' }}
              />
              {levels.map((lvl, stackPos) => {
                const loc = locationsById?.get(lvl.locationId)
                const role = loc?.levelRole ?? null
                const idx = lvl.levelIndex ?? loc?.levelIndex ?? 0
                const y = stackY + stackPos * (rowH + gap)
                const isSelected = lvl.locationId === selectedLocationId
                const pct = binFillPct?.get(lvl.locationId)
                return (
                  <g
                    key={lvl.locationId}
                    data-testid={`level-${loc?.code ?? lvl.locationId}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectLevel(lvl.locationId)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={stackX} y={y} width={stackW} height={rowH} rx={4}
                      fill={levelRoleFill(levelRoles, role)}
                      stroke={isSelected ? PLACEMENT_FILL.selectedStroke : levelRoleStroke(levelRoles, role)}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text x={stackX + 6} y={y + rowH / 2 + 3} fontSize={10} fontFamily="monospace" fill="#1c1917">
                      L{idx} · {(loc?.code ?? `#${lvl.locationId}`).slice(0, 14)}
                    </text>
                    <text
                      x={stackX + stackW - 6} y={y + rowH / 2 + 3}
                      textAnchor="end" fontSize={9} fontFamily="sans-serif" fill="#44403c"
                    >
                      {pct != null ? `${Math.round(pct * 100)}% · ` : ''}{levelRoleLabel(levelRoles, role)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* Overlay marker layers (route/putaway/slotting), supplied by consumers. */}
        {renderOverlay?.(cell)}
      </>
    )
    // `viewport.tx`/`viewport.ty` are deliberately absent: they only move the
    // wrapping <g>, so excluding them makes a pan skip this whole subtree.
  }, [
    cell, scale, gridWidth, gridHeight, floorObjects, placementGroups, expandedGroup,
    selectedLocationId, highlightedLocationIds, binColors, rackColors, binBadges, binInfo,
    binFillPct, zoneRegions, zoneTypeByProfileId, locationsById, levelRoles, renderOverlay,
    onSelectBin, onHoverBin, guard,
  ])

  return (
    <svg
      className="block h-full w-full"
      role="img"
      aria-label={`${layout.name} floor ${floor + 1}`}
    >
      <g transform={`translate(${viewport.tx},${viewport.ty}) scale(${viewport.scale})`}>
        {scene}
      </g>
    </svg>
  )
}

/** Native SVG tooltip — the no-pointer and assistive fallback for the stage's
 *  hover card. Kept terse: a `<title>` has no layout, so it must read as one line. */
function hoverTitle(info: BinInfo, fillPct: number | null, levelCount: number): string {
  const parts = [info.code]
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
  // Coarse-then-fine: a tight rect gets the aisle ("F01"), a roomy one the full
  // in-warehouse code ("F01-L01"). See coarseCode's note on why the tail is the
  // wrong thing to keep when the whole floor is in view.
  const source = tier === 'full'
    ? shortCode(info.code, sharedPrefix)
    : coarseCode(info.code, sharedPrefix)
  const code = fitCode(source, rectW - u(4), codeFont)
  if (!code) return null

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
          x={cx - (code.length * codeFont * 0.6) / 2 - u(2)}
          y={hasSecond ? cy - u(10) : cy - u(6)}
          width={code.length * codeFont * 0.6 + u(4)}
          height={hasSecond ? u(20) : u(12)}
          fill="#ffffff" fillOpacity={0.78} rx={u(2)}
        />
      )}
      <text
        x={cx} y={hasSecond ? cy - u(0.5) : cy + u(3.2)}
        textAnchor="middle" fontSize={codeFont} fontFamily="monospace" fill="#1c1917"
      >
        {code}
      </text>
      {hasSecond && (
        <text
          x={cx} y={cy + u(9)}
          textAnchor="middle" fontSize={u(8)} fontFamily="monospace" fill="#57534e"
        >
          {secondLine}
        </text>
      )}
    </g>
  )
}
