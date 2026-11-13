// The pick walk drawn in 3D (NX-0037).
//
// drei `Line` (screen-space width, so it stays readable at any zoom), drawn ON
// TOP of everything (`depthTest` off, late render order): the walk runs between
// racks at floor level, and drawn with depth testing it all but vanished under
// the shelving — the owner saw only the stop numbers. Stop numbers and the start
// marker are screen labels (ScreenLabels), never drei `Html`.

import { Line } from '@react-three/drei'
import type { RouteScene } from '@/lib/warehouse3d/routeScene'
import type { ScreenLabel } from './ScreenLabels'

/** Fuchsia: clear of the fill bands, the zone tints, the blue floor and the
 *  selection/beacon blue. */
const ROUTE_COLOR = '#c026d3' // fuchsia-600

export interface RoutePath3DProps {
  route: RouteScene
}

export function RoutePath3D({ route }: RoutePath3DProps) {
  return (
    <group>
      {route.lines.map((points, i) => (
        <Line
          key={`leg-${i}`}
          points={points}
          color={ROUTE_COLOR}
          lineWidth={6}
          depthTest={false}
          transparent
          renderOrder={10}
        />
      ))}
    </group>
  )
}

export function routeLabelItems(route: RouteScene): ScreenLabel[] {
  const items: ScreenLabel[] = route.markers.map((m) => ({
    key: `stop:${m.locationId}`,
    position: m.position,
    content: (
      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-fuchsia-700 px-1.5 font-mono text-xs font-bold text-white shadow-md ring-2 ring-white">
        {m.label}
      </span>
    ),
  }))
  if (route.start) {
    items.push({
      key: 'route:start',
      position: route.start,
      content: (
        <span className="whitespace-nowrap rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-md ring-2 ring-white">
          Start
        </span>
      ),
    })
  }
  return items
}
