// SVG marker layers drawn on top of the WarehouseCanvas: slotting arrows,
// dry-run pick routes, and dry-run putaway targets. Each takes the current cell
// size, the active floor, and a locationId → placement lookup, and returns the
// SVG for that floor only. Pure/presentational — the data comes from the engine.

import type { ReactNode } from 'react'
import type { LayoutPlacement, PickRouteStop, PutawayLineRecommendation, SlottingSuggestion } from '@/types'
import { placementCenter } from './WarehouseCanvas'
import { screenFont } from './mapLabels'
import { routeOverlay2d } from '@/lib/warehouseRoute2d'
import { MAP_COLOR, MAP_FONT } from './mapTokens'

type PlacementLookup = Map<number, LayoutPlacement>

// Every colour here is a map token (index.css `--color-map-*`), never a literal.
const VIOLET = MAP_COLOR.slot
const BLUE = MAP_COLOR.target

/**
 * Suggested re-slotting moves: from (solid) → to (dashed) with an arrow + qty.
 *
 * The quantity is counter-scaled by `scale`, like every other label on the map.
 * It used to be a raw `fontSize={10}` in user units — 4px on screen at the
 * fitted view and 30px zoomed in.
 */
export function slottingArrows(
  cell: number,
  slotting: SlottingSuggestion[],
  placements: PlacementLookup,
  floor: number,
  scale = 1,
): ReactNode {
  const qtyFont = screenFont(10, scale)
  return (
    <g>
      <defs>
        <marker id="wh-slot-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={VIOLET} />
        </marker>
      </defs>
      {slotting.map((s) => {
        const from = placements.get(s.fromLocationId)
        const to = placements.get(s.toLocationId)
        const fromHere = from?.floor === floor
        const toHere = to?.floor === floor
        const parts: ReactNode[] = []
        if (from && fromHere) {
          parts.push(
            <rect key={`of${s.id}`} x={from.x * cell + 1} y={from.y * cell + 1} width={from.w * cell - 2} height={from.h * cell - 2}
              fill="none" stroke={VIOLET} strokeWidth={2} rx={3} pointerEvents="none" />,
          )
        }
        if (to && toHere) {
          parts.push(
            <rect key={`ot${s.id}`} x={to.x * cell + 1} y={to.y * cell + 1} width={to.w * cell - 2} height={to.h * cell - 2}
              fill="none" stroke={VIOLET} strokeWidth={2} strokeDasharray="4 2" rx={3} pointerEvents="none" />,
          )
        }
        if (from && to && fromHere && toHere) {
          const a = placementCenter(from)
          const b = placementCenter(to)
          parts.push(
            <line key={`l${s.id}`} x1={a.cx * cell} y1={a.cy * cell} x2={b.cx * cell} y2={b.cy * cell}
              stroke={VIOLET} strokeWidth={2} markerEnd="url(#wh-slot-arrow)" pointerEvents="none" />,
            <text key={`q${s.id}`} x={((a.cx + b.cx) / 2) * cell} y={((a.cy + b.cy) / 2) * cell - screenFont(4, scale)}
              textAnchor="middle" fontSize={qtyFont} fontWeight={500} fill={MAP_COLOR.slotInk} fontFamily={MAP_FONT.mono}
              stroke={MAP_COLOR.halo} strokeWidth={screenFont(3, scale)} paintOrder="stroke" strokeLinejoin="round"
              pointerEvents="none">{s.qty}</text>,
          )
        }
        return <g key={s.id}>{parts}</g>
      })}
    </g>
  )
}

/** Fuchsia, as in 3D: clear of the rack fills (emerald/violet/amber/red), the
 *  zone tints and the selection blue. Emerald was the old colour, and on MAIN's
 *  emerald fast-mover racks a stop simply disappeared. */
const ROUTE_LINE = MAP_COLOR.route // fuchsia-600
const ROUTE_MARK = MAP_COLOR.routeStop // fuchsia-700

/**
 * Dry-run pick route (NX-0037): the walk the engine measured — from the dock,
 * along the aisles, into each bay — not straight stop-to-stop lines through the
 * racks. Geometry is `routeOverlay2d` (pure, tested); this only draws it. Line,
 * markers and text are counter-scaled by `scale`, so they keep one size on screen
 * at every zoom instead of shrinking to a 7 px dot at the map's default 41 %.
 */
export function routePath(
  cell: number,
  scale: number,
  stops: PickRouteStop[],
  placements: PlacementLookup,
  floor: number,
): ReactNode {
  const route = routeOverlay2d(stops, placements, floor)
  if (route.markers.length === 0 && route.legs.length === 0) return null
  const u = (px: number) => screenFont(px, scale)
  const pts = (leg: [number, number][]) => leg.map(([x, y]) => `${x * cell},${y * cell}`).join(' ')
  return (
    <g pointerEvents="none">
      {route.legs.map((leg, i) => (
        <g key={`leg${i}`}>
          {/* White casing: the line reads over any fill beneath it. */}
          <polyline points={pts(leg)} fill="none" stroke={MAP_COLOR.halo} strokeWidth={u(7)} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pts(leg)} fill="none" stroke={ROUTE_LINE} strokeWidth={u(4)} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {route.start && (
        <g transform={`translate(${route.start[0] * cell},${route.start[1] * cell})`}>
          <rect x={-u(22)} y={-u(9)} width={u(44)} height={u(18)} rx={u(9)} fill={MAP_COLOR.ink} stroke={MAP_COLOR.halo} strokeWidth={u(2)} />
          <text y={u(3.5)} textAnchor="middle" fontSize={u(10)} fontWeight={700} fill={MAP_COLOR.inkInverse} fontFamily={MAP_FONT.sans}>START</text>
        </g>
      )}
      {route.markers.map((m) => (
        <g key={`stop${m.locationId}`} transform={`translate(${m.x * cell},${m.y * cell})`}>
          <circle r={u(11)} fill={ROUTE_MARK} stroke={MAP_COLOR.halo} strokeWidth={u(2)} />
          <text y={u(4)} textAnchor="middle" fontSize={u(m.label.length > 2 ? 9 : 11)} fontWeight={500} fill={MAP_COLOR.inkInverse} fontFamily={MAP_FONT.mono}>
            {m.label}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Dry-run putaway: pulsing target on the recommended bin, hollow rings on
 * alternatives (current floor only). */
export function putawayMarkers(
  cell: number,
  rec: PutawayLineRecommendation,
  placements: PlacementLookup,
  floor: number,
): ReactNode {
  const parts: ReactNode[] = []
  const target = rec.recommendedLocationId != null ? placements.get(rec.recommendedLocationId) : undefined
  rec.alternatives.forEach((alt) => {
    const p = placements.get(alt.locationId)
    if (!p || p.floor !== floor || alt.locationId === rec.recommendedLocationId) return
    const c = placementCenter(p)
    parts.push(
      <circle key={`alt${alt.locationId}`} cx={c.cx * cell} cy={c.cy * cell} r={7} fill="none" stroke={BLUE} strokeWidth={2} pointerEvents="none" />,
    )
  })
  if (target && target.floor === floor) {
    const c = placementCenter(target)
    parts.push(
      <g key="target" pointerEvents="none">
        {/* CSS pulse (wh-pulse in index.css) replaces the old SMIL <animate>
            elements — SMIL is deprecated and can't respect
            prefers-reduced-motion. Only the ring pulses; the center dot
            stays fixed as an anchor. */}
        <g className="wh-pulse">
          <circle cx={c.cx * cell} cy={c.cy * cell} r={9} fill="none" stroke={BLUE} strokeWidth={2.5} />
        </g>
        <circle cx={c.cx * cell} cy={c.cy * cell} r={3} fill={BLUE} />
      </g>,
    )
  }
  return <g>{parts}</g>
}

const AMBER = MAP_COLOR.holding // amber-600: distinct from the blue putaway target and the route line

/**
 * Every place holding a found product (NX-0039 "Find a product"), outlined on
 * the floor being viewed. A place with no placement (the warehouse root — stock
 * still on the dock) has nothing to outline and is skipped. The stroke is held
 * at a constant on-screen width, like the route, so it reads at every zoom.
 */
export function holdingMarkers(
  cell: number,
  scale: number,
  locationIds: readonly number[],
  placements: PlacementLookup,
  floor: number,
): ReactNode {
  const s = scale > 0 ? scale : 1
  const stroke = 3 / s
  const pad = 1.5 / s
  return (
    <g pointerEvents="none">
      {locationIds.map((id) => {
        const p = placements.get(id)
        if (!p || p.floor !== floor) return null
        return (
          <rect
            key={id}
            data-holding={id}
            x={p.x * cell - pad}
            y={p.y * cell - pad}
            width={p.w * cell + pad * 2}
            height={p.h * cell + pad * 2}
            rx={3 / s}
            fill={AMBER}
            fillOpacity={0.18}
            stroke={AMBER}
            strokeWidth={stroke}
          />
        )
      })}
    </g>
  )
}
