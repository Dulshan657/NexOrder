// Render-level checks for the viewer canvas's labelling, level spine and zone
// layer. These assert what actually reaches the DOM, which the pure-module tests
// (mapLabels / levelSpine / zoneRegions) deliberately cannot.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { InventoryLocation, LayoutObject, LayoutPlacement, WarehouseLayout } from '../types'
import { FALLBACK_LEVEL_ROLES } from '../lib/levelRoles'

// The canvas fetches the role vocabulary itself (mig 00081), so stub the hook
// rather than standing up a QueryClient for a pure rendering assertion.
vi.mock('@/hooks/queries/useLevelRoles', () => ({
  useLevelRoles: () => ({ data: FALLBACK_LEVEL_ROLES }),
}))

const { WarehouseCanvas } = await import('../components/inventory/warehouse/WarehouseCanvas')
const { zoneRegions } = await import('../components/inventory/warehouse/zoneRegions')

afterEach(() => cleanup())

const LAYOUT = {
  id: 1, warehouseId: 1, name: 'MAIN', gridWidth: 20, gridHeight: 20,
  cellSizeM: 1, floorCount: 1, status: 'published', version: 1,
} as unknown as WarehouseLayout

// 2x1, matching MAIN's real bays (layout 25) — a 1x1 fixture would have hidden
// the very calibration bug these tests exist to catch.
function place(id: number, locationId: number, x: number, y: number, levelIndex?: number): LayoutPlacement {
  return { id, layoutId: 1, locationId, floor: 0, x, y, w: 2, h: 1, rotation: 0, levelIndex }
}

/** One legacy bin at (1,1) and one 3-level rack at (4,4), both inside a cold zone. */
function fixture() {
  const locations = new Map<number, InventoryLocation>()
  locations.set(1, {
    id: 1, kind: 'ZONE', code: 'COLD', name: 'Cold room',
    materializedPath: '/MAIN/COLD', isActive: true, zoneProfileId: 9,
  })
  // MAIN's real code scheme: warehouse - face/aisle - position.
  locations.set(10, {
    id: 10, kind: 'BIN', code: 'MAIN-F01-L01', name: 'F01-L01', parentId: 1,
    materializedPath: '/MAIN/COLD/MAIN-F01-L01', isActive: true, capacitySlots: 10, slotKind: 'carton',
  })
  locations.set(20, {
    id: 20, kind: 'RACK', code: 'MAIN-F02-L01', name: 'F02-L01', parentId: 1,
    materializedPath: '/MAIN/COLD/MAIN-F02-L01', isActive: true,
  })
  const roles = ['pick', 'reserve', 'bulk']
  roles.forEach((role, i) => {
    const id = 21 + i
    locations.set(id, {
      id, kind: 'SHELF', code: `MAIN-B-4-2-L${i + 1}`, name: `Level ${i + 1}`, parentId: 20,
      materializedPath: `/MAIN/COLD/MAIN-B-4-2/L${i + 1}`, isActive: true,
      levelIndex: i + 1, levelRole: role, capacitySlots: 24,
    })
  })

  const placements = [
    place(100, 10, 1, 1),
    place(101, 21, 4, 4, 1),
    place(102, 22, 4, 4, 2),
    place(103, 23, 4, 4, 3),
  ]

  const objects: LayoutObject[] = [
    { id: 200, layoutId: 1, objectType: 'label', floor: 0, x: 0, y: 8, w: 6, h: 1, meta: { name: 'Cold room' } },
    { id: 201, layoutId: 1, objectType: 'wall', floor: 0, x: 0, y: 10, w: 6, h: 1, meta: {} },
  ]

  const binInfo = new Map([
    [10, { code: 'MAIN-F01-L01', capacitySlots: 10, slotKind: 'carton' as const, contentsCount: 2, topSku: 'Soy Sauce' }],
    [20, { code: 'MAIN-F02-L01', capacitySlots: 72, slotKind: 'carton' as const, contentsCount: 3, topSku: 'Rice' }],
  ])
  const binFillPct = new Map<number, number | null>([[10, 0.5], [21, 1], [22, 0.25], [23, null]])

  return { locations, placements, objects, binInfo, binFillPct }
}

function renderCanvas(scale: number, extra: Record<string, unknown> = {}) {
  const f = fixture()
  const utils = render(
    <WarehouseCanvas
      layout={LAYOUT}
      placements={f.placements}
      objects={f.objects}
      floor={0}
      viewport={{ scale, tx: 0, ty: 0 }}
      selectedLocationId={null}
      onSelectBin={() => {}}
      binInfo={f.binInfo}
      binFillPct={f.binFillPct}
      locationsById={f.locations}
      zoneRegions={zoneRegions(f.placements, f.locations, 0)}
      zoneTypeByProfileId={new Map([[9, 'cold']])}
      {...extra}
    />,
  )
  return { ...utils, ...f }
}

describe('WarehouseCanvas — label level of detail', () => {
  // Asserted over <text> nodes rather than textContent: the <title> fallback is
  // always present (it is what a screen reader and a no-pointer device get), so
  // the code string legitimately appears in the DOM at every zoom.
  const drawnText = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('text')).map((t) => t.textContent).join('|')

  it('draws no bin code when zoomed out past legibility', () => {
    const { container } = renderCanvas(0.4) // a 2x1 bay is 20 x 9.6 screen px
    expect(drawnText(container)).not.toContain('F01')
  })

  // REGRESSION: this is MAIN's actual default view. It rendered nothing at all
  // when the tier was calibrated per-cell instead of per-placement.
  it('labels bays with their AISLE at MAIN’s default fitted zoom (~0.6)', () => {
    const { container } = renderCanvas(0.6)
    const text = drawnText(container)
    expect(text).toContain('F01')
    expect(text).toContain('F02')
    // The position segment is identical across aisles, so it must not be what
    // the tight label spends its characters on.
    expect(text).not.toContain('F01-L01')
  })

  it('shows the full in-warehouse code and detail at high zoom', () => {
    const { container } = renderCanvas(3)
    const text = drawnText(container)
    expect(text).toContain('F01-L01') // shared "MAIN-" root stripped
    expect(text).not.toContain('MAIN-') // ...and never redrawn on every bay
    expect(text).toContain('50%') // the legacy bin
    expect(text).toContain('3L') // the 3-level rack
  })

  // The area layer must survive the zoom at which no bin can label itself —
  // that is exactly when an operator needs to know which end is the cold room.
  it('keeps zone names visible even when bins are too small to label', () => {
    const { container } = renderCanvas(0.4)
    expect(drawnText(container)).not.toContain('F01')
    expect(drawnText(container)).toContain('Cold room · Cold')
  })

  it('counter-scales font size so text is a constant size on screen', () => {
    const at1 = renderCanvas(1).container.querySelector('text[font-family="monospace"]')
    cleanup()
    const at3 = renderCanvas(3).container.querySelector('text[font-family="monospace"]')
    const f1 = Number(at1?.getAttribute('font-size'))
    const f3 = Number(at3?.getAttribute('font-size'))
    expect(f1).toBeGreaterThan(0)
    expect(f1 / f3).toBeCloseTo(3, 5) // 3x zoom → 1/3 the user-unit font
  })
})

describe('WarehouseCanvas — level spine', () => {
  it('draws one stripe per level, bottom-first, tinted by role', () => {
    const { container } = renderCanvas(3)
    const rack = container.querySelector('[data-testid="rack-21"]')
    expect(rack).toBeTruthy()
    const fills = Array.from(rack!.querySelectorAll('rect'))
      .map((r) => r.getAttribute('fill'))
      .filter((f): f is string => !!f)
    // pick / reserve / bulk from FALLBACK_LEVEL_ROLES.
    expect(fills).toContain('#a7f3d0')
    expect(fills).toContain('#c7d2fe')
    expect(fills).toContain('#fde68a')
  })

  it('lays L1 out at the BOTTOM of the rect', () => {
    const { container } = renderCanvas(3)
    const rack = container.querySelector('[data-testid="rack-21"]')!
    const pick = rack.querySelector('rect[fill="#a7f3d0"]') // L1, role pick
    const bulk = rack.querySelector('rect[fill="#fde68a"]') // L3, role bulk
    // SVG y grows downward, so the bottom level has the LARGER y.
    expect(Number(pick!.getAttribute('y'))).toBeGreaterThan(Number(bulk!.getAttribute('y')))
  })

  it('omits the spine when the cell is too small to show one', () => {
    const { container } = renderCanvas(0.4)
    const rack = container.querySelector('[data-testid="rack-21"]')!
    expect(rack.querySelector('rect[fill="#c7d2fe"]')).toBeNull()
  })

  it('reports a capacity-weighted rollup, not the first level’s fill', () => {
    // L1 100% and L2 25% over 24 slots each, L3 unknown → (24 + 6) / 48 = 62.5%.
    const { container } = renderCanvas(3)
    expect(container.textContent).toContain('63%')
  })
})

describe('WarehouseCanvas — areas', () => {
  it('renders a named structural object’s meta.name', () => {
    const { container } = renderCanvas(1)
    expect(container.textContent).toContain('Cold room')
  })

  it('tints and names the zone derived from its bins', () => {
    const { container } = renderCanvas(1)
    expect(container.textContent).toContain('Cold room · Cold')
    const washes = container.querySelectorAll('rect[fill="#0ea5e9"]')
    expect(washes.length).toBeGreaterThan(0)
  })

  // The tooltip keeps the FULL code — abbreviation is a constraint of the map's
  // available pixels, not of the information.
  it('emits a native <title> per bin as the assistive fallback', () => {
    const { container } = renderCanvas(1)
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles.some((t) => t?.includes('MAIN-F01-L01') && t.includes('50% full'))).toBe(true)
  })
})

// An area and the ZONE it created (mig 00096) are two spellings of one fact, and
// they used to be drawn by the same arithmetic from two different corners — the
// area's top-left CELL and the zone's top-left BIN — so both appeared, side by
// side, on one line. That is what "the name is printed twice" was.
describe('WarehouseCanvas — area vs zone label collision', () => {
  const texts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '')

  /** A painted area, stored the way the editor stores one: N 1x1 cells. */
  function area(name: string, cells: { x: number; y: number }[], zoneProfileId?: number): LayoutObject[] {
    return cells.map((c, i) => ({
      id: 300 + i, layoutId: 1, objectType: 'area', floor: 0, x: c.x, y: c.y, w: 1, h: 1,
      meta: zoneProfileId != null ? { name, zoneProfileId } : { name },
    })) as LayoutObject[]
  }

  const row = (y: number, x0: number, len: number) =>
    Array.from({ length: len }, (_, i) => ({ x: x0 + i, y }))

  it('drops the zone label when a named area already carries its profile', () => {
    // Profile 9 is the fixture zone's own profile, so this area is what created it.
    const { container } = renderCanvas(1, { objects: area('Chiller', row(1, 1, 8), 9) })
    const drawn = texts(container)
    expect(drawn).toContain('Chiller')
    // "Cold room ·" is the zone label's own shape — the separator is what makes
    // it distinguishable from the bare area/sign name.
    expect(drawn.some((t) => t.includes('Cold room ·'))).toBe(false)
  })

  it('keeps the zone label when the area over it names no profile', () => {
    // An area painted for wayfinding only did not create the zone and cannot
    // speak for it — over-suppressing here would lose the zone entirely.
    const { container } = renderCanvas(1, { objects: area('Chiller', row(1, 1, 8)) })
    const drawn = texts(container)
    expect(drawn).toContain('Chiller')
    expect(drawn.some((t) => t.includes('Cold room ·'))).toBe(true)
  })

  it('anchors an area name inside its own region, never the row above', () => {
    // Anchoring above put the label in a row the region does not own — which is
    // how "Slow Movers" came to be printed across the Fast Movers bays.
    const { container } = renderCanvas(1, { objects: area('Chiller', row(12, 2, 8)) })
    const label = texts(container).indexOf('Chiller')
    const y = Number(Array.from(container.querySelectorAll('text'))[label].getAttribute('y'))
    expect(y).toBeGreaterThanOrEqual(12 * 26) // BASE_CELL
    expect(y).toBeLessThan(13 * 26)
  })

  it('clips a name to its own region rather than running it over the neighbours', () => {
    const long = 'Slow Moving Overflow Consolidation'
    const wide = renderCanvas(1, { objects: area(long, row(12, 2, 14)) })
    expect(texts(wide.container)).toContain(long)
    cleanup()
    const narrow = renderCanvas(1, { objects: area(long, row(12, 2, 2)) })
    const drawn = texts(narrow.container).find((t) => t.startsWith('Slow'))
    expect(drawn).toBeTruthy()
    expect(drawn).not.toBe(long)
    expect(drawn!.endsWith('…')).toBe(true)
  })

  // Amadiya has "Slow Moving" and "Quarantine" as single rack columns down one
  // side. Clipping those to their own width leaves "Sl…" and "Qu…", which name
  // nothing — and what they overrun is the aisle, which is empty floor.
  it('lets a name overrun a one-column area rather than clipping it to nothing', () => {
    const { container } = renderCanvas(1, { objects: area('Slow Moving', row(12, 2, 1)) })
    expect(texts(container)).toContain('Slow Moving')
  })

  // The clip asks "is this name too long for the shape it names" — a fact about
  // the drawing. Measured on screen it would eat every label as you zoomed out,
  // which is exactly when the wayfinding layer is all that is left.
  it('clips identically at every zoom', () => {
    const long = 'Slow Moving Overflow Consolidation'
    const near = texts(renderCanvas(3, { objects: area(long, row(12, 2, 2)) }).container)
      .find((t) => t.startsWith('Slow'))
    cleanup()
    const far = texts(renderCanvas(0.4, { objects: area(long, row(12, 2, 2)) }).container)
      .find((t) => t.startsWith('Slow'))
    expect(near).toBe(far)
  })
})
