// The 3D view of the warehouse live map (NX-0035). The LAZY ENTRY: reachable only
// through lazy3d.ts, so three.js and @react-three/* live in this chunk alone.
//
// View + select only. Every decision about what to draw is buildScene's (pure,
// tested in node); this file is lights, a canvas and the preset buttons.
//
// `frameloop="demand"`: nothing animates, so the GPU renders only when the camera
// moves or the data changes. A warehouse map left open on a desk all day should
// not keep a laptop fan running.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import type { Product } from '@/types'
import type { BinContentRow } from '@/components/inventory/warehouse/useWarehouseViewerModel'
import { buildScene, type BuildSceneInput, type Vec3 } from '@/lib/warehouse3d/buildScene'
import { locationsHoldingProduct } from '@/lib/warehouse3d/findStock'
import { FindStockBar } from './FindStockBar'
import type { CameraPresetName } from '@/lib/warehouse3d/cameraPresets'
import { RackInstances } from './RackInstances'
import { SceneObjects } from './SceneObjects'
import { AreaLabels } from './AreaLabels'
import { CameraRig } from './CameraRig'

export type Warehouse3DViewProps = Omit<BuildSceneInput, 'highlightIds'> & {
  /** Find stock (NX-0036): the catalogue and the map's own per-location stock. */
  products: readonly Product[]
  binContents: ReadonlyMap<number, readonly BinContentRow[]>
  selectedLocationId: number | null
  onSelect: (locationId: number) => void
  /** The GPU dropped the context (driver reset, too many tabs). Back to 2D. */
  onFallback: () => void
  /** The floor switcher lives in MapStage, which is unmounted in 3D. */
  floorCount: number
  onFloorChange: (floor: number) => void
}

const PRESETS: { name: CameraPresetName; label: string }[] = [
  { name: 'top', label: 'Top' },
  { name: 'iso', label: 'Iso' },
  { name: 'aisle', label: 'Aisle' },
]

const BACKGROUND = '#f5f5f4' // stone-100

export default function Warehouse3DView(props: Warehouse3DViewProps) {
  const { layout, placements, objects, floor, locationsById, binFillPct, binColors, zoneTypeByProfileId, levelHeightM } = props
  const [findProductId, setFindProductId] = useState<number | null>(null)
  /** Bumped by re-picking the current product: re-frames after an orbit. */
  const [reframe, setReframe] = useState(0)
  const onFind = (id: number | null) => {
    if (id != null && id === findProductId) setReframe((n) => n + 1)
    else setFindProductId(id)
  }
  const highlightIds = useMemo(
    () => (findProductId != null ? locationsHoldingProduct(props.binContents, findProductId) : null),
    [props.binContents, findProductId],
  )
  const scene = useMemo(
    () => buildScene({ layout, placements, objects, floor, locationsById, binFillPct, binColors, zoneTypeByProfileId, levelHeightM, highlightIds }),
    [layout, placements, objects, floor, locationsById, binFillPct, binColors, zoneTypeByProfileId, levelHeightM, highlightIds],
  )
  const placedIds = useMemo(() => new Set(placements.map((p) => p.locationId)), [placements])
  const visibleIds = useMemo(() => new Set(scene.levels.map((l) => l.locationId)), [scene.levels])

  // Frame the matches once per search (and per floor switch while searching) —
  // NOT on every stock refetch, or the camera would jump while the operator orbits.
  const [frame, setFrame] = useState<{ points: Vec3[]; nonce: number } | null>(null)
  useEffect(() => {
    if (findProductId == null) return
    const points = scene.levels.filter((l) => l.highlighted).map((l) => l.center)
    if (points.length > 0) setFrame((f) => ({ points, nonce: (f?.nonce ?? 0) + 1 }))
    // scene.levels deliberately omitted — see above.
  }, [findProductId, floor, reframe])
  const [preset, setPreset] = useState<CameraPresetName>('iso')
  // R3F's own teardown calls forceContextLoss(), which fires the same
  // `webglcontextlost` as a real GPU reset. Only a loss while MOUNTED is a fallback.
  const disposedRef = useRef(false)
  const onFallbackRef = useRef(props.onFallback)
  onFallbackRef.current = props.onFallback
  useEffect(() => {
    disposedRef.current = false
    return () => { disposedRef.current = true }
  }, [])
  const [nonce, setNonce] = useState(0)

  const focus = useMemo(() => {
    if (props.selectedLocationId == null) return null
    return scene.levels.find((l) => l.locationId === props.selectedLocationId)?.center ?? null
  }, [scene.levels, props.selectedLocationId])

  const { center, width, depth } = scene.bounds
  const span = Math.max(width, depth, 10)

  return (
    <div className="relative isolate h-full w-full overflow-hidden rounded-lg border border-stone-200" style={{ background: BACKGROUND }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        shadows
        camera={{ fov: 45, near: 0.1, far: span * 10, position: [center[0] + span, span * 0.7, center[2] + span] }}
        onCreated={({ gl }: any) => {
          gl.domElement.addEventListener('webglcontextlost', (e: Event) => {
            e.preventDefault()
            if (!disposedRef.current) onFallbackRef.current()
          })
        }}
        aria-label="3D warehouse map"
      >
        <color attach="background" args={[BACKGROUND]} />
        <hemisphereLight args={['#ffffff', '#d6d3d1', 0.9]} />
        <directionalLight
          position={[center[0] + span * 0.4, span, center[2] + span * 0.3]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-span}
          shadow-camera-right={span}
          shadow-camera-top={span}
          shadow-camera-bottom={-span}
        />
        <SceneObjects scene={scene} layout={layout} />
        <RackInstances
          levels={scene.levels}
          racks={scene.racks}
          beacons={scene.beacons}
          selectedLocationId={props.selectedLocationId}
          onSelect={props.onSelect}
        />
        <AreaLabels labels={scene.labels} />
        <CameraRig bounds={scene.bounds} preset={preset} nonce={nonce} focus={focus} frame={frame} />
      </Canvas>

      <div className="absolute left-3 top-3 z-30">
        <FindStockBar
          products={props.products}
          binContents={props.binContents}
          placedIds={placedIds}
          visibleIds={visibleIds}
          productId={findProductId}
          onChange={onFind}
        />
      </div>

      <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-0.5 shadow-elevated backdrop-blur-sm">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            aria-pressed={preset === p.name}
            onClick={() => {
              setPreset(p.name)
              setNonce((n) => n + 1)
            }}
            className={`min-h-[28px] rounded-md px-2.5 py-1 text-xs font-semibold transition-all btn-press ${
              preset === p.name ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {props.floorCount > 1 && (
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/95 p-0.5 shadow-elevated backdrop-blur-sm">
          {Array.from({ length: props.floorCount }, (_, f) => (
            <button
              key={f}
              type="button"
              aria-pressed={floor === f}
              onClick={() => props.onFloorChange(f)}
              className={`min-h-[28px] rounded-md px-2.5 py-1 text-xs font-semibold transition-all btn-press ${
                floor === f ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              Floor {f + 1}
            </button>
          ))}
        </div>
      )}
      </div>
      <p className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-white/85 px-2 py-1 text-[11px] text-stone-600">
        Drag to orbit · right-drag to pan · scroll to zoom · click a level for detail
      </p>
    </div>
  )
}
