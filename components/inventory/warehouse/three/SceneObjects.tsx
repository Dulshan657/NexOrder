// The floor, walls, docks, walkways and painted areas (NX-0035).

import type { SceneModel } from '@/lib/warehouse3d/buildScene'
import { InstancedBoxes } from './InstancedBoxes'

const FLOOR_COLOR = '#e7e5e4' // stone-200
const GRID_MAJOR = '#a8a29e' // stone-400
const GRID_MINOR = '#d6d3d1' // stone-300

export interface SceneObjectsProps {
  scene: SceneModel
  cellSizeM: number
}

export function SceneObjects({ scene, cellSizeM }: SceneObjectsProps) {
  const { width, depth, center } = scene.bounds
  const span = Math.max(width, depth)
  const divisions = Math.max(1, Math.round(span / Math.max(cellSizeM, 0.1)))
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -0.01, center[2]]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={1} />
      </mesh>
      <gridHelper args={[span, divisions, GRID_MAJOR, GRID_MINOR]} position={[center[0], 0.002, center[2]]} />
      <InstancedBoxes items={scene.areaTiles} opacity={0.35} />
      <InstancedBoxes items={scene.objects} castShadow receiveShadow />
    </group>
  )
}
