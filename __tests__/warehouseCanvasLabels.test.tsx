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

function place(id: number, locationId: number, x: number, y: number, levelIndex?: number): LayoutPlacement {
  return { id, layoutId: 1, locationId, floor: 0, x, y, w: 1, h: 1, rotation: 0, levelIndex }
}

/** One legacy bin at (1,1) and one 3-level rack at (4,4), both inside a cold zone. */
function fixture() {
  const locations = new Map<number, InventoryLocation>()
  locations.set(1, {
    id: 1, kind: 'ZONE', code: 'COLD', name: 'Cold room',
    materializedPath: '/MAIN/COLD', isActive: true, zoneProfileId: 9,
  })
  locations.set(10, {
    id: 10, kind: 'BIN', code: 'MAIN-A-01', name: 'A-01', parentId: 1,
    materializedPath: '/MAIN/COLD/MAIN-A-01', isActive: true, capacitySlots: 10, slotKind: 'carton',
  })
  locations.set(20, {
    id: 20, kind: 'RACK', code: 'MAIN-B-4-2', name: 'B-4-2', parentId: 1,
    materializedPath: '/MAIN/COLD/MAIN-B-4-2', isActive: true,
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
    [10, { code: 'MAIN-A-01', capacitySlots: 10, slotKind: 'carton' as const, contentsCount: 2, topSku: 'Soy Sauce' }],
    [20, { code: 'MAIN-B-4-2', capacitySlots: 72, slotKind: 'carton' as const, contentsCount: 3, topSku: 'Rice' }],
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
    const { container } = renderCanvas(0.4) // BASE_CELL * 0.4 = 10.4px per cell
    expect(drawnText(container)).not.toContain('A-01')
  })

  it('draws the bin code at normal zoom', () => {
    const { container } = renderCanvas(1)
    expect(container.textContent).toContain('A-01')
  })

  it('adds fill and level count at high zoom', () => {
    const { container } = renderCanvas(3)
    expect(container.textContent).toContain('50%') // the legacy bin
    expect(container.textContent).toContain('3L') // the 3-level rack
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

  it('emits a native <title> per bin as the assistive fallback', () => {
    const { container } = renderCanvas(1)
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent)
    expect(titles.some((t) => t?.includes('MAIN-A-01') && t.includes('50% full'))).toBe(true)
  })
})
