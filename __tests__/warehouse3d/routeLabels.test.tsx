// NX-0037 A8: in 3D the route stays legible — area names fade while it is shown,
// and the Start pill sits above the dock instead of covering stop 1.

import { describe, it, expect } from 'vitest'
import { areaLabelItems } from '@/components/inventory/warehouse/three/AreaLabels'
import { routeLabelItems } from '@/components/inventory/warehouse/three/RoutePath3D'
import type { SceneLabel } from '@/lib/warehouse3d/buildScene'

const labels: SceneLabel[] = [
  { key: 'a1', kind: 'area', text: 'Inbound staging', position: [1, 2, 1] },
  { key: 's1', kind: 'sign', text: 'Dock', position: [2, 2, 2] },
] as SceneLabel[]

const cls = (node: any): string => String(node?.props?.className ?? '')

describe('route labels', () => {
  it('fade the area names while a route is shown', () => {
    for (const item of areaLabelItems(labels)) expect(cls(item.content)).not.toMatch(/opacity-/)
    for (const item of areaLabelItems(labels, { muted: true })) expect(cls(item.content)).toMatch(/opacity-40/)
  })

  it('anchor the Start pill above the dock', () => {
    const items = routeLabelItems({
      lines: [],
      markers: [{ sequence: 1, locationId: 9, position: [1, 1, 1], label: '1' }],
      start: [0, 0.15, 0],
    })
    expect(items.find((i) => i.key === 'route:start')?.anchor).toBe('above')
    expect(items.find((i) => i.key === 'stop:9')?.anchor ?? 'center').toBe('center')
  })
})
