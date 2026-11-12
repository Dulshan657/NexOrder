// Orbit camera + presets (NX-0035). drei `CameraControls`: drag to orbit,
// right-drag to pan, scroll to zoom; it invalidates the demand frameloop itself.

import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { SceneBounds, Vec3 } from '@/lib/warehouse3d/buildScene'
import { cameraPreset, type CameraPresetName } from '@/lib/warehouse3d/cameraPresets'

export interface CameraRigProps {
  bounds: SceneBounds
  preset: CameraPresetName
  /** Bumped by every preset click, so pressing the active preset re-frames. */
  nonce: number
  focus: Vec3 | null
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function CameraRig({ bounds, preset, nonce, focus }: CameraRigProps) {
  const ref = useRef<any>(null)
  const boundsKey = `${bounds.width}:${bounds.depth}`
  const invalidate = useThree((s: any) => s.invalidate)

  useEffect(() => {
    const controls = ref.current
    if (!controls) return
    const { position: p, target: t } = cameraPreset(preset, bounds, focus)
    controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], !prefersReducedMotion())
    // An instant (reduced-motion) move emits no transition event, so the demand
    // frameloop must be told to draw it.
    invalidate()
    // `focus` is deliberately not a dependency: selecting a level must not yank
    // the camera. It is read when a preset is (re)applied. Keyed on the bounds'
    // SIZE, not the object: the scene rebuilds on every fill refetch, and a new
    // bounds object each time would snap the camera back mid-orbit.
  }, [preset, nonce, boundsKey, invalidate])

  const span = Math.max(bounds.width, bounds.depth, 1)
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={1}
      maxDistance={span * 3}
      // Never orbit under the floor.
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  )
}
