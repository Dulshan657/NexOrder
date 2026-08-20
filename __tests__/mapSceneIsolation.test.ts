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
