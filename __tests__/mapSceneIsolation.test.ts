// Guards on the live map's render cost.
//
// WarehouseCanvas memoizes its whole scene on everything EXCEPT the pan offset, so a
// drag is one <g transform> update instead of 945 bin re-renders. That only holds
// while every OTHER scene dependency keeps a stable identity across renders — and
// the component re-renders on every frame of a pan or a paint stroke.
//
// Two of those dependencies were plain inline values (`renderMarkers`, a function;
// `canvasObjects`, an array), so they re-minted every render and the memo was
// already being busted on every marquee frame before any of this work started. The
// symptom is not an error — it is a tab that stops responding, which on MAIN was bad
// enough that Chrome could not be scripted.
//
// A source assertion is the right shape here: the failure mode is a future edit
// dropping the wrapper, and no behavioural test would notice.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('RackedWorkspace keeps its scene-memo dependencies stable', () => {
  const src = read('components/inventory/warehouse/RackedWorkspace.tsx')

  it('memoizes renderMarkers, which is WarehouseCanvas\'s renderOverlay prop', () => {
    expect(src).toMatch(/const renderMarkers = useCallback\(/)
  })

  it('memoizes canvasObjects, which is its objects prop', () => {
    expect(src).toMatch(/const canvasObjects = useMemo\(/)
  })

  // An inline empty-array fallback mints a new array every render; the shared
  // constants are what stop that reaching the layer memos while the layout loads.
  // Matched as an ASSIGNMENT only — passing one as a call argument is fine, since
  // that value never becomes a memo dependency.
  it('uses module-level empty arrays rather than inline fallbacks', () => {
    expect(src).toMatch(/const EMPTY_OBJECTS: LayoutObject\[\] = \[\]/)
    expect(src).toMatch(/const EMPTY_PLACEMENTS: LayoutPlacement\[\] = \[\]/)
    expect(src).not.toMatch(/=\s*detail\?\.(objects|placements)\s*\?\?\s*\[\]/)
  })

  it('keeps a stable no-op for the suppressed bin-select handler', () => {
    expect(src).toMatch(/const NOOP = \(\) => \{\}/)
    expect(src).not.toMatch(/onSelectBin=\{[^}]*\(\) => \{\}\}/)
  })

  // The same rule reaching one line further than the assertions above covered.
  // `routeStops` fell back to an inline `[]`, and it is the FIRST dependency of the
  // renderMarkers useCallback asserted at the top of this file — so on any site with
  // no active pick route, which is nearly always, that useCallback was defeated by
  // its own dep and the scene memo was busted on every painted cell anyway. Both
  // guards above were passing while the failure they describe was happening.
  it('uses a module-level empty array for the route stops', () => {
    expect(src).toMatch(/const EMPTY_STOPS: PickRouteStop\[\] = \[\]/)
    expect(src).not.toMatch(/route\.stops\s*:\s*\[\]/)
  })

  // The sweep selection changes on every painted cell BY DEFINITION, so it must
  // never be a canvas prop. It is drawn by MapSelectionLayer, a sibling. Passing
  // `undefined` here is what keeps the dep constant for the whole sweep.
  it('does not feed the sweep selection into the canvas highlight', () => {
    expect(src).not.toMatch(/recodeHighlight/)
    expect(src).toMatch(
      /highlightedLocationIds=\{recode\.state\.active \? undefined : highlightedLocationIds\}/,
    )
  })
})

// NX-0047 A4/A5. The pan was already isolated (above); a ZOOM still rebuilt the
// whole scene on every wheel tick, because the live scale was a memo dependency.
// The scene is now drawn at a SETTLED scale that changes once a zoom stops, while
// the live one rides on the <g transform>. And two layers drew a DOM node per row,
// column or cell where one element does the job.
describe('WarehouseCanvas zooms without rebuilding its scene', () => {
  const canvas = read('components/inventory/warehouse/WarehouseCanvas.tsx')
  const memoDeps = (() => {
    const start = canvas.indexOf('const scene = useMemo(')
    const close = canvas.indexOf('}, [', start)
    return canvas.slice(close, canvas.indexOf('])', close))
  })()

  it('the scene memo depends on the settled scale, not the live one', () => {
    expect(canvas).toMatch(/const scale = settledScale \?\? viewport\.scale/)
    expect(memoDeps).toMatch(/\bscale\b/)
    expect(memoDeps).not.toMatch(/viewport/)
    // The live scale still moves the picture, on the transform alone.
    expect(canvas).toMatch(/scale\(\$\{viewport\.scale\}\)/)
    // And MapStage hands the canvas the hook's settled scale.
    const stage = read('components/inventory/warehouse/MapStage.tsx')
    expect(stage).toMatch(/settledScale=\{settledScale\}/)
  })

  it('draws the grid as one pattern and each zone wash as one path', () => {
    expect(canvas).toMatch(/<pattern\b/)
    expect(canvas).not.toMatch(/Array\.from\(\{ length: gridWidth \+ 1 \}/)
    expect(canvas).not.toMatch(/Array\.from\(\{ length: gridHeight \+ 1 \}/)
    // No rect per zone cell.
    expect(canvas).not.toMatch(/region\.cells\.map\(/)
  })
})
