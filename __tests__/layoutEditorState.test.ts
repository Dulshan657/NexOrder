import { describe, it, expect } from 'vitest'
import {
  initialEditorState,
  layoutEditorReducer,
  type EditorState,
} from '../components/admin/layout/useLayoutEditorState'

function withTool(tool: EditorState['tool']): EditorState {
  return layoutEditorReducer(initialEditorState(), { type: 'set_tool', tool })
}

describe('layoutEditorReducer', () => {
  it('paints a walkway object at a cell', () => {
    const s = layoutEditorReducer(withTool('walkway'), { type: 'paint_cell', x: 2, y: 3 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]).toMatchObject({ objectType: 'walkway', x: 2, y: 3 })
    expect(s.dirty).toBe(true)
  })

  it('does not stack two objects in the same cell', () => {
    let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
    s = layoutEditorReducer({ ...s, tool: 'dock' }, { type: 'paint_cell', x: 1, y: 1 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0].objectType).toBe('dock')
  })

  it('places a bin and selects it', () => {
    const s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
    expect(s.placements).toHaveLength(1)
    expect(s.placements[0]).toMatchObject({ kind: 'BIN', x: 4, y: 5 })
    expect(s.selectedRef).toBe(s.placements[0].clientRef)
  })

  it('will not place two bins in the same cell', () => {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 4, y: 5 })
    expect(s.placements).toHaveLength(1)
  })

  it('erases both objects and placements at a cell', () => {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
    s = layoutEditorReducer({ ...s, tool: 'walkway' }, { type: 'paint_cell', x: 6, y: 6 })
    s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 4, y: 5 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 6, y: 6 })
    expect(s.placements).toHaveLength(0)
    expect(s.objects).toHaveLength(0)
  })

  it('updates a placement from the inspector', () => {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
    const ref = s.placements[0].clientRef
    s = layoutEditorReducer(s, { type: 'update_placement', ref, patch: { code: 'A-01', capacitySlots: 20 } })
    expect(s.placements[0]).toMatchObject({ code: 'A-01', capacitySlots: 20 })
  })

  it('generates a block of bins, skipping occupied cells and tagging a zone', () => {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 }) // occupy one cell
    s = layoutEditorReducer(s, { type: 'generate_bins', startX: 0, startY: 0, cols: 2, rows: 2, capacitySlots: 5, zoneProfileId: 3 })
    // 2×2 block minus the already-occupied (0,0) = 3 new bins.
    expect(s.placements).toHaveLength(4)
    const generated = s.placements.filter((p) => p.zoneProfileId === 3)
    expect(generated).toHaveLength(3)
    expect(generated.every((p) => p.capacitySlots === 5)).toBe(true)
  })

  it('carries the storage type id onto generated bins', () => {
    const s = layoutEditorReducer(initialEditorState(), {
      type: 'generate_bins', startX: 0, startY: 0, cols: 2, rows: 1, capacitySlots: 8, slotKind: 'carton', storageTypeId: 12,
    })
    expect(s.placements).toHaveLength(2)
    expect(s.placements.every((p) => p.storageTypeId === 12)).toBe(true)
  })

  it('marks new bins with their assigned location ids after save', () => {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
    const ref = s.placements[0].clientRef
    s = layoutEditorReducer(s, { type: 'mark_saved', refMap: [{ client_ref: ref, location_id: 99 }] })
    expect(s.placements[0].locationId).toBe(99)
    expect(s.dirty).toBe(false)
  })

  it('applies auto-connect results, replacing objects with fresh clientRefs and keeping placements/selection', () => {
    // Seed some existing objects/placements/selection so we can assert they
    // survive (placements) or get fresh refs (objects) after apply_auto_connect.
    let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer({ ...s, tool: 'rack' }, { type: 'paint_cell', x: 4, y: 5 })
    const placementRef = s.placements[0].clientRef
    const priorObjectRefs = s.objects.map((o) => o.clientRef)

    s = layoutEditorReducer(s, {
      type: 'apply_auto_connect',
      objects: [
        { objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1 },
        { objectType: 'walkway', floor: 0, x: 1, y: 0, w: 1, h: 1 },
        { objectType: 'walkway', floor: 0, x: 2, y: 0, w: 1, h: 1 },
      ],
    })

    expect(s.objects).toHaveLength(3)
    expect(s.objects.map((o) => o.objectType)).toEqual(['dock', 'walkway', 'walkway'])
    // Every object got a brand-new clientRef, with no collisions between them
    // or with any ref that existed before the replacement.
    const newRefs = s.objects.map((o) => o.clientRef)
    expect(new Set(newRefs).size).toBe(newRefs.length)
    expect(newRefs.some((ref) => priorObjectRefs.includes(ref))).toBe(false)
    // Placements and selection are untouched — auto-connect only rewrites objects.
    expect(s.placements).toHaveLength(1)
    expect(s.placements[0].clientRef).toBe(placementRef)
    expect(s.selectedRef).toBe(placementRef)
    expect(s.dirty).toBe(true)
  })

  it('hydrates from server rows and is not dirty', () => {
    const s = layoutEditorReducer(initialEditorState(), {
      type: 'load',
      placements: [{ id: 1, layoutId: 1, locationId: 7, floor: 0, x: 2, y: 2, w: 1, h: 1, rotation: 0 }],
      objects: [{ id: 1, layoutId: 1, objectType: 'dock', floor: 0, x: 0, y: 0, w: 1, h: 1, meta: {} }],
      codeByLocation: { 7: { code: 'A-07', name: 'Bin 7', kind: 'BIN' } },
    })
    expect(s.placements[0]).toMatchObject({ locationId: 7, code: 'A-07' })
    expect(s.objects[0].objectType).toBe('dock')
    expect(s.dirty).toBe(false)
  })

  it.each([
    ['conveyor', 'conveyor'],
    ['staging', 'staging'],
    ['obstacle', 'obstacle'],
    ['label', 'label'],
  ] as const)('paints a %s object at a cell', (tool, objectType) => {
    const s = layoutEditorReducer(withTool(tool), { type: 'paint_cell', x: 3, y: 3 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]).toMatchObject({ objectType, x: 3, y: 3 })
    expect(s.dirty).toBe(true)
  })

  it('round-trips meta and stagingLocationId through load', () => {
    const s = layoutEditorReducer(initialEditorState(), {
      type: 'load',
      placements: [],
      objects: [
        { id: 1, layoutId: 1, objectType: 'staging', floor: 0, x: 1, y: 1, w: 2, h: 2, meta: { name: 'Shipping & Receiving' }, stagingLocationId: 42 },
      ],
      codeByLocation: {},
    })
    expect(s.objects[0]).toMatchObject({ objectType: 'staging', meta: { name: 'Shipping & Receiving' }, stagingLocationId: 42 })
    expect(s.dirty).toBe(false)
  })

  it('patches an object\'s meta immutably via update_object', () => {
    const s0 = layoutEditorReducer(withTool('obstacle'), { type: 'paint_cell', x: 0, y: 0 })
    const ref = s0.objects[0].clientRef
    const s1 = layoutEditorReducer(s0, { type: 'update_object', ref, patch: { meta: { name: 'Office block' } } })
    expect(s1).not.toBe(s0)
    expect(s1.objects).not.toBe(s0.objects)
    expect(s1.objects[0]).not.toBe(s0.objects[0])
    expect(s1.objects[0].meta).toEqual({ name: 'Office block' })
    expect(s0.objects[0].meta).toBeUndefined()
    expect(s1.dirty).toBe(true)
  })

  it('select tool falls back to selecting an object when no placement is hit', () => {
    let s = layoutEditorReducer(withTool('obstacle'), { type: 'paint_cell', x: 5, y: 5 })
    const objectRef = s.objects[0].clientRef
    s = layoutEditorReducer({ ...s, tool: 'select' }, { type: 'paint_cell', x: 5, y: 5 })
    expect(s.selectedRef).toBe(objectRef)
  })

  it('delete_selected removes a selected object by clientRef', () => {
    let s = layoutEditorReducer(withTool('label'), { type: 'paint_cell', x: 7, y: 7 })
    const objectRef = s.objects[0].clientRef
    s = layoutEditorReducer({ ...s, tool: 'select', selectedRef: objectRef }, { type: 'delete_selected' })
    expect(s.objects).toHaveLength(0)
    expect(s.selectedRef).toBeNull()
    expect(s.dirty).toBe(true)
  })
})
