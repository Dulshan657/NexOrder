// Racks and their levels (NX-0035).
//
// Each level is drawn as a translucent SHELL (the slot) with an opaque FILL volume
// inside it, as tall as the level is full — so an empty level reads as an empty
// box and a jammed one as a solid block, from any angle. Rack frames are four
// corner posts tinted by the zone the rack sits in.
//
// A click on a shell selects that level's location: the same `onSelect` the 2D
// map calls, so Bin detail opens exactly as it does there (A8).

import { useMemo } from 'react'
import type { LevelBox, RackFrame, Vec3 } from '@/lib/warehouse3d/buildScene'
import { zoneTint } from '@/components/inventory/warehouse/zoneTints'
import { InstancedBoxes, type BoxItem } from './InstancedBoxes'

/** The level box is the slot; the drawn shell sits just inside it so adjacent
 *  levels and racks read as separate boxes rather than one slab. */
const SHELL_INSET = 0.9
/** The fill never quite reaches the beam above, or a full level looks fused to it. */
const FILL_MAX = 0.85
const POST_M = 0.08
const UNKNOWN_SHELL = '#d6d3d1' // stone-300: no capacity configured
const FRAME_DEFAULT = '#78716c' // stone-500
const BEACON_COLOR = '#0369a1' // sky-700, the selection colour
const NO_BEACONS: readonly Vec3[] = []
/** A found level whose own colour says nothing (unknown capacity, or an overlay
 *  that leaves it neutral) takes this instead, so it never reads as dimmed. */
const HIGHLIGHT = '#0ea5e9' // sky-500
const MIN_HIGHLIGHT_FILL = 0.25

function hasOwnColour(l: LevelBox): boolean {
  if (l.colorSource === 'neutral') return false
  if (l.colorSource === 'occupancy' && !l.fillKnown) return false
  return true
}

function shellColor(l: LevelBox): string {
  if (l.highlighted) return hasOwnColour(l) ? l.color : HIGHLIGHT
  return l.colorSource === 'occupancy' && !l.fillKnown ? UNKNOWN_SHELL : l.color
}

export interface RackInstancesProps {
  levels: readonly LevelBox[]
  racks: readonly RackFrame[]
  /** Find stock (NX-0036): one point above each rack holding the product. */
  beacons?: readonly Vec3[]
  selectedLocationId: number | null
  onSelect: (locationId: number) => void
}

export function RackInstances({ levels, racks, beacons = NO_BEACONS, selectedLocationId, onSelect }: RackInstancesProps) {
  const shells = useMemo<BoxItem[]>(
    () =>
      levels.map((l) => ({
        center: l.center,
        size: [l.size[0] * SHELL_INSET, l.size[1] * SHELL_INSET, l.size[2] * SHELL_INSET] as Vec3,
        // Unknown fill greys the slot only when occupancy is what is shown;
        // an overlay colour is meaningful with or without a capacity.
        color: shellColor(l),
      })),
    [levels],
  )

  const fills = useMemo<BoxItem[]>(() => {
    const out: BoxItem[] = []
    for (const l of levels) {
      // A found level always shows a block, even when empty or of unknown
      // capacity — otherwise a match could be fainter than the dimmed levels
      // around it and only the beacon would mark it.
      const pct = Math.max(Math.min(1, Math.max(0, l.fillPct ?? 0)), l.highlighted ? MIN_HIGHLIGHT_FILL : 0)
      if (pct <= 0) continue
      const h = l.size[1] * FILL_MAX * pct
      const floorY = l.center[1] - (l.size[1] * SHELL_INSET) / 2
      out.push({
        center: [l.center[0], floorY + h / 2, l.center[2]],
        size: [l.size[0] * SHELL_INSET * 0.92, h, l.size[2] * SHELL_INSET * 0.92],
        color: l.highlighted && !hasOwnColour(l) ? HIGHLIGHT : l.color,
      })
    }
    return out
  }, [levels])

  const posts = useMemo<BoxItem[]>(() => {
    const out: BoxItem[] = []
    for (const r of racks) {
      const color = r.zoneType ? zoneTint(r.zoneType) : FRAME_DEFAULT
      const hx = r.size[0] / 2 - POST_M / 2
      const hz = r.size[2] / 2 - POST_M / 2
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        out.push({
          center: [r.center[0] + dx * hx, r.center[1], r.center[2] + dz * hz],
          size: [POST_M, r.size[1], POST_M],
          color,
        })
      }
    }
    return out
  }, [racks])

  // A marker floating over each matching rack, readable from across the floor.
  const beaconBoxes = useMemo<BoxItem[]>(
    () => beacons.map((b) => ({ center: b, size: [0.35, 0.9, 0.35] as Vec3, color: BEACON_COLOR })),
    [beacons],
  )

  const selected = selectedLocationId != null ? levels.find((l) => l.locationId === selectedLocationId) : undefined

  return (
    <group>
      <InstancedBoxes items={posts} castShadow />
      <InstancedBoxes items={beaconBoxes} />
      <InstancedBoxes items={fills} castShadow receiveShadow />
      <InstancedBoxes items={shells} opacity={0.28} onPick={(i) => onSelect(levels[i].locationId)} />
      {selected && (
        <mesh position={selected.center}>
          <boxGeometry args={selected.size} />
          <meshBasicMaterial color="#0369a1" wireframe />
        </mesh>
      )}
    </group>
  )
}
