// N coloured boxes in ONE draw call (NX-0035).
//
// MAIN is ~945 rack levels plus hundreds of 1x1 wall/area cells; a mesh each
// would be thousands of draw calls and a hot laptop. Everything box-shaped in the
// 3D map goes through this: a unit cube, scaled and placed per instance.
//
// The instance COUNT is fixed when an InstancedMesh is created, so the mesh is
// re-keyed on length — a floor switch or a new rack rebuilds it rather than
// silently drawing only the first N.

import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { Vec3 } from '@/lib/warehouse3d/buildScene'

export interface BoxItem {
  center: Vec3
  size: Vec3
  color: string
}

export interface InstancedBoxesProps {
  items: readonly BoxItem[]
  opacity?: number
  castShadow?: boolean
  receiveShadow?: boolean
  /** Called with the index into `items` of the box that was clicked. */
  onPick?: (index: number) => void
}

const UNIT = new THREE.BoxGeometry(1, 1, 1)
/** Pointer travel (px) above which a press-release is an orbit, not a click. */
const DRAG_TOLERANCE_PX = 4

export function InstancedBoxes({ items, opacity = 1, castShadow = false, receiveShadow = false, onPick }: InstancedBoxesProps) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree((s) => s.invalidate)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      p.set(it.center[0], it.center[1], it.center[2])
      // A zero scale makes a degenerate matrix; keep a hair of thickness.
      s.set(Math.max(it.size[0], 1e-4), Math.max(it.size[1], 1e-4), Math.max(it.size[2], 1e-4))
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  }, [items, invalidate])

  // R3F never calls onPointerOut for an object that unmounts while hovered
  // (leaving 3D by keyboard, a remount on a new count), so the pointer cursor
  // would otherwise stick across the whole app.
  // Keyed on a boolean, not the (inline, per-render) callback, so the cleanup
  // runs on unmount rather than on every render under a resting cursor.
  const pickable = onPick != null
  useEffect(() => () => {
    if (pickable) document.body.style.cursor = ''
  }, [pickable])

  if (items.length === 0) return null
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[UNIT, undefined, items.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      onClick={
        onPick
          ? (e: any) => {
              // R3F fires click after a drag. An orbit that starts or ends over
              // a level is not a pick: without this, every orbit across the racks
              // selected a level and scrolled the page to Bin detail.
              if (e.instanceId == null || e.delta > DRAG_TOLERANCE_PX) return
              e.stopPropagation()
              onPick(e.instanceId)
            }
          : undefined
      }
      onPointerOver={onPick ? () => { document.body.style.cursor = 'pointer' } : undefined}
      onPointerOut={onPick ? () => { document.body.style.cursor = '' } : undefined}
    >
      <meshStandardMaterial
        roughness={0.85}
        metalness={0}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </instancedMesh>
  )
}
