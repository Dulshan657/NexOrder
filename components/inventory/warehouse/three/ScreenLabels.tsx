// Text over the 3D scene, WITHOUT drei `Html` (NX-0037).
//
// drei `Html` mounts a separate React root inside the canvas's container, and
// tearing the 3D view down (switching warehouse while in 3D) made React's own
// commit throw `removeChild … not a child of this node` — the map went blank.
// So labels are an ordinary React overlay BESIDE the canvas, and a projector
// INSIDE the canvas moves them each rendered frame by writing a transform to
// their DOM nodes. One React tree, nothing mounted into three's DOM.

import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { Vec3 } from '@/lib/warehouse3d/buildScene'

export interface ScreenLabel {
  key: string
  position: Vec3
  content: ReactNode
}

/** key → the label's DOM node, shared by the overlay (writes) and projector (reads). */
export type LabelRegistry = Map<string, HTMLElement | null>

export function useLabelRegistry(): LabelRegistry {
  const ref = useRef<LabelRegistry | null>(null)
  if (!ref.current) ref.current = new Map()
  return ref.current
}

/** DOM side: render inside the 3D view's relative container, after the Canvas. */
export function LabelOverlay({ labels, registry }: { labels: readonly ScreenLabel[]; registry: LabelRegistry }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {labels.map((l) => (
        <div
          key={l.key}
          ref={(el: HTMLElement | null) => {
            if (el) registry.set(l.key, el)
            else registry.delete(l.key)
          }}
          // Parked off-screen until the first projected frame places it.
          style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-9999px, -9999px)', willChange: 'transform' }}
        >
          {l.content}
        </div>
      ))}
    </div>
  )
}

/** Canvas side: projects each label's world position to the screen. */
export function LabelProjector({ labels, registry }: { labels: readonly ScreenLabel[]; registry: LabelRegistry }) {
  const invalidate = useThree((s: any) => s.invalidate)
  const v = useRef(new THREE.Vector3()).current

  // The demand frameloop only renders on change: draw once when labels change
  // so new ones are placed without waiting for the camera to move.
  useEffect(() => {
    invalidate()
  }, [labels, invalidate])

  useFrame(({ camera, size }: any) => {
    for (const l of labels) {
      const el = registry.get(l.key)
      if (!el) continue
      v.set(l.position[0], l.position[1], l.position[2]).project(camera)
      // Behind the camera or outside the clip volume: hide rather than mirror.
      if (v.z > 1 || v.z < -1) {
        el.style.transform = 'translate(-9999px, -9999px)'
        continue
      }
      const x = ((v.x + 1) / 2) * size.width
      const y = ((1 - v.y) / 2) * size.height
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    }
  })
  return null
}
