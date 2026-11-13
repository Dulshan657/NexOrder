// The pick walk drawn in 3D (NX-0037). drei `Line` (a screen-space-width line,
// so it stays readable at any zoom) and `Html` stop numbers — both on the
// CSP-safe drei allow-list.

import { Html, Line } from '@react-three/drei'
import type { RouteScene } from '@/lib/warehouse3d/routeScene'

const ROUTE_COLOR = '#7c3aed' // violet-600: distinct from fill bands, zones and the selection blue

export interface RoutePath3DProps {
  route: RouteScene
}

export function RoutePath3D({ route }: RoutePath3DProps) {
  return (
    <group>
      {route.lines.map((points, i) => (
        <Line key={`leg-${i}`} points={points} color={ROUTE_COLOR} lineWidth={3} />
      ))}
      {route.markers.map((m) => (
        <Html key={`stop-${m.sequence}`} position={m.position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-violet-700 px-1.5 font-mono text-xs font-bold text-white shadow-sm">
            {m.label}
          </span>
        </Html>
      ))}
    </group>
  )
}
