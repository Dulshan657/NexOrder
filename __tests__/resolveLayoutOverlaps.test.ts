import { describe, it, expect } from 'vitest'
import { resolveLayoutOverlaps } from '../components/admin/layout/resolveOverlaps'
import type { EditorObject, EditorPlacement } from '../components/admin/layout/useLayoutEditorState'
import type { LayoutObjectType } from '../types'

let n = 0
function obj(objectType: LayoutObjectType, x: number, y: number, w = 1, h = 1): EditorObject {
  return { clientRef: `o${++n}`, objectType, floor: 0, x, y, w, h }
}
function bin(x: number, y: number, opts: { code?: string; locationId?: number } = {}): EditorPlacement {
  return {
    clientRef: `p${++n}`, floor: 0, x, y, w: 1, h: 1, rotation: 0,
    kind: 'BIN', code: opts.code ?? `W-B-${x}-${y}`, name: `Bin ${x},${y}`,
    locationId: opts.locationId,
  }
}

describe('resolveLayoutOverlaps', () => {
  it('walkway loses to wall (priority 6 vs 2)', () => {
    const wall = obj('wall', 1, 1)
    const walkway = obj('walkway', 1, 1)
    const r = resolveLayoutOverlaps([wall, walkway], [])
    expect(r.changed).toBe(true)
    expect(r.removedObjectCells).toBe(1)
    expect(r.removedObjects).toBe(1)
    expect(r.objects.map((o) => o.objectType)).toEqual(['wall'])
  })

  // Dock beating wall matters: autoConnectLayout's dock-over-wall carve needs a
  // dock left to carve toward.
  it('dock beats wall', () => {
    const r = resolveLayoutOverlaps([obj('wall', 1, 1), obj('dock', 1, 1)], [])
    expect(r.objects.map((o) => o.objectType)).toEqual(['dock'])
  })

  it('dock and staging both keep a shared cell', () => {
    const r = resolveLayoutOverlaps([obj('dock', 1, 1), obj('staging', 1, 1)], [])
    expect(r.changed).toBe(false)
    expect(r.objects).toHaveLength(2)
  })

  it('a label co-exists with anything and is returned by reference', () => {
    const label = obj('label', 1, 1)
    const wall = obj('wall', 1, 1)
    const r = resolveLayoutOverlaps([wall, label], [])
    expect(r.changed).toBe(false)
    expect(r.objects).toHaveLength(2)
    expect(r.objects).toContain(label)
    expect(r.objects).toContain(wall)
  })

  it('a bin keeps its cell and the wall over it loses, reported', () => {
    const wall = obj('wall', 3, 7)
    const b = bin(3, 7, { code: 'W-B-3-7', locationId: 42 })
    const r = resolveLayoutOverlaps([wall], [b])
    expect(r.objects).toHaveLength(0)
    expect(r.removedObjects).toBe(1)
    expect(r.binConflicts).toHaveLength(1)
    expect(r.binConflicts[0]).toMatchObject({
      x: 3, y: 7, placementCode: 'W-B-3-7', saved: true, objectType: 'wall',
    })
  })

  it('reports saved:false for a bin that has no locationId yet', () => {
    const r = resolveLayoutOverlaps([obj('wall', 1, 1)], [bin(1, 1)])
    expect(r.binConflicts[0].saved).toBe(false)
  })

  // Both sides are expensive to lose, so this one is reported and left alone.
  it('bin-vs-bin is reported and BOTH placements are untouched', () => {
    const a = bin(2, 2, { code: 'W-B-9-1', locationId: 1 })
    const b = bin(2, 2, { code: 'W-B-9-2' })
    const r = resolveLayoutOverlaps([], [a, b])
    expect(r.placementConflicts).toHaveLength(1)
    expect(r.placementConflicts[0]).toMatchObject({ x: 2, y: 2, savedCount: 1 })
    expect(r.placementConflicts[0].codes.sort()).toEqual(['W-B-9-1', 'W-B-9-2'])
    // Nothing was removed — resolveLayoutOverlaps never returns placements at all,
    // and reports `changed` only for object edits.
    expect(r.changed).toBe(false)
    expect(r.removedObjectCells).toBe(0)
  })

  it('a clean layout is an identity no-op', () => {
    const objects = [obj('wall', 0, 0), obj('walkway', 1, 0), obj('dock', 2, 0)]
    const r = resolveLayoutOverlaps(objects, [bin(5, 5)])
    expect(r.changed).toBe(false)
    for (const o of objects) expect(r.objects).toContain(o)
  })

  it('a partially covered multi-cell object survives as 1x1 fragments', () => {
    // 4-wide wall with bins under its middle two cells.
    const r = resolveLayoutOverlaps([obj('wall', 0, 0, 4, 1)], [bin(1, 0), bin(2, 0)])
    expect(r.objects).toHaveLength(2)
    expect(r.objects.map((o) => o.x).sort((a, b) => a - b)).toEqual([0, 3])
    expect(r.objects.every((o) => o.w === 1 && o.h === 1)).toBe(true)
    expect(r.removedObjectCells).toBe(2)
    expect(r.removedObjects).toBe(0)
    expect(r.binConflicts).toHaveLength(2)
  })

  it('is idempotent — repairing the repair changes nothing', () => {
    const first = resolveLayoutOverlaps([obj('wall', 0, 0, 4, 1), obj('walkway', 1, 0)], [bin(2, 0)])
    expect(first.changed).toBe(true)
    const second = resolveLayoutOverlaps(first.objects, [bin(2, 0)])
    expect(second.changed).toBe(false)
  })

  it('ties break on input order, first wins', () => {
    const a = obj('wall', 1, 1)
    const b = obj('wall', 1, 1)
    const r = resolveLayoutOverlaps([a, b], [])
    // Same type, so the matrix blocks the second: `wall` allows only `label`.
    expect(r.objects).toEqual([a])
  })

  it('leaves objects on other floors alone', () => {
    const upstairs: EditorObject = { clientRef: 'up', objectType: 'wall', floor: 1, x: 1, y: 1, w: 1, h: 1 }
    const r = resolveLayoutOverlaps([obj('wall', 1, 1), upstairs], [])
    expect(r.changed).toBe(false)
    expect(r.objects).toContain(upstairs)
  })
})
