// The floor, walls, docks, walkways and painted areas (NX-0035).

import { useMemo } from 'react'
import * as THREE from 'three'
import type { SceneModel } from '@/lib/warehouse3d/buildScene'
import { InstancedBoxes } from './InstancedBoxes'

const FLOOR_COLOR = '#e7e5e4' // stone-200
const GRID_COLOR = '#d6d3d1' // stone-300

export interface SceneObjectsProps {
  scene: SceneModel
  layout: { cellSizeM: number; gridWidth: number; gridHeight: number }
}

/** One line per grid cell edge, exactly over the floor — a three GridHelper is
 *  square and centred, so on a non-square layout it overhangs the short axis and
 *  can sit half a cell out of register with the racks. */
function gridGeometry(gridWidth: number, gridHeight: number, cell: number): THREE.BufferGeometry {
  const pts: number[] = []
  const w = gridWidth * cell
  const d = gridHeight * cell
  for (let x = 0; x <= gridWidth; x++) pts.push(x * cell, 0, 0, x * cell, 0, d)
  for (let y = 0; y <= gridHeight; y++) pts.push(0, 0, y * cell, w, 0, y * cell)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

export function SceneObjects({ scene, layout }: SceneObjectsProps) {
  const { width, depth, center } = scene.bounds
  const grid = useMemo(
    () => gridGeometry(layout.gridWidth, layout.gridHeight, layout.cellSizeM),
    [layout.gridWidth, layout.gridHeight, layout.cellSizeM],
  )
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -0.01, center[2]]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={1} />
      </mesh>
      <lineSegments geometry={grid} position={[0, 0.002, 0]}>
        <lineBasicMaterial color={GRID_COLOR} />
      </lineSegments>
      <InstancedBoxes items={scene.areaTiles} opacity={0.35} />
      <InstancedBoxes items={scene.objects} castShadow receiveShadow />
    </group>
  )
}
