// SVG marker layers drawn on top of the WarehouseCanvas: slotting arrows,
// dry-run pick routes, and dry-run putaway targets. Each takes the current cell
// size, the active floor, and a locationId → placement lookup, and returns the
// SVG for that floor only. Pure/presentational — the data comes from the engine.

import type { ReactNode } from 'react'
import type { LayoutPlacement, PickRouteStop, PutawayLineRecommendation, SlottingSuggestion } from '@/types'
import { placementCenter } from './WarehouseCanvas'

type PlacementLookup = Map<number, LayoutPlacement>

const VIOLET = '#8b5cf6'
const EMERALD = '#059669'
const BLUE = '#2563eb'

/** Suggested re-slotting moves: from (solid) → to (dashed) with an arrow + qty. */
export function slottingArrows(
  cell: number,
  slotting: SlottingSuggestion[],
  placements: PlacementLookup,
  floor: number,
): ReactNode {
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
            <text key={`q${s.id}`} x={((a.cx + b.cx) / 2) * cell} y={((a.cy + b.cy) / 2) * cell - 3}
              textAnchor="middle" fontSize={10} fill="#6d28d9" fontFamily="monospace" pointerEvents="none">{s.qty}</text>,
          )
        }
        return <g key={s.id}>{parts}</g>
      })}
    </g>
  )
}

/** Dry-run pick route: a dashed poly through stops in sequence, numbered circles.
 * Straight stop-to-stop (distances are exact; geometry is approximate — the engine
 * returns the stop order + leg metres, not the literal walk path). */
export function routePath(
  cell: number,
  stops: PickRouteStop[],
  placements: PlacementLookup,
  floor: number,
): ReactNode {
  const points = stops
    .map((s) => ({ stop: s, p: placements.get(s.locationId) }))
    .filter((e): e is { stop: PickRouteStop; p: LayoutPlacement } => e.p != null && e.p.floor === floor)
    .map(({ stop, p }) => ({ stop, ...placementCenter(p) }))

  if (points.length === 0) return null
  return (
    <g pointerEvents="none">
      {/* Connect + label only pairs adjacent in the FULL sequence — an off-floor
          stop between two on-floor stops must not draw a phantom direct leg. */}
      {points.map((pt, i) => {
        if (i === 0) return null
        const prev = points[i - 1]
        const consecutive = pt.stop.sequence === prev.stop.sequence + 1
        if (!consecutive) return null
        return (
          <g key={`leg${pt.stop.sequence}`}>
            <line x1={prev.cx * cell} y1={prev.cy * cell} x2={pt.cx * cell} y2={pt.cy * cell}
              stroke={EMERALD} strokeWidth={2} strokeDasharray="5 3" />
            <text x={((prev.cx + pt.cx) / 2) * cell} y={((prev.cy + pt.cy) / 2) * cell - 3}
              textAnchor="middle" fontSize={8} fill="#047857" fontFamily="monospace">
              +{pt.stop.legDistanceM.toFixed(1)}m
            </text>
          </g>
        )
      })}
      {points.map((pt) => (
        <g key={`${pt.stop.locationId}-${pt.stop.sequence}`}>
          <circle cx={pt.cx * cell} cy={pt.cy * cell} r={8} fill={EMERALD} opacity={0.9} />
          <text x={pt.cx * cell} y={pt.cy * cell + 3} textAnchor="middle" fontSize={9} fill="#fff" fontFamily="monospace">
            {pt.stop.sequence}
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
        <circle cx={c.cx * cell} cy={c.cy * cell} r={9} fill="none" stroke={BLUE} strokeWidth={2.5}>
          <animate attributeName="r" values="9;14;9" dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={c.cx * cell} cy={c.cy * cell} r={3} fill={BLUE} />
      </g>,
    )
  }
  return <g>{parts}</g>
}
