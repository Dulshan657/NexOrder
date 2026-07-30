import { describe, it, expect } from 'vitest'
import {
  ALLOWED_COOCCUPANTS,
  initialEditorState,
  layoutEditorReducer,
  type EditorState,
  type OccupantKind,
} from '../components/admin/layout/useLayoutEditorState'
import type { RackLevel } from '../types'

const PALLET_RACK_TEMPLATE: RackLevel[] = [
  { levelIndex: 1, role: 'pick', capacitySlots: 2 },
  { levelIndex: 2, role: 'pick', capacitySlots: 2 },
  { levelIndex: 3, role: 'pick', capacitySlots: 2 },
  { levelIndex: 4, role: 'pick', capacitySlots: 2 },
  { levelIndex: 5, role: 'bulk', capacitySlots: 4 },
]

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

  // Was "does not stack two objects in the same cell", which asserted the dock
  // REPLACED the wall. Overlap prevention makes an occupied cell a no-op instead:
  // eviction meant a drag could silently delete a wall run you'd just drawn.
  it('blocks a different-type object in an occupied cell', () => {
    let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
    s = layoutEditorReducer({ ...s, tool: 'dock' }, { type: 'paint_cell', x: 1, y: 1 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0].objectType).toBe('wall')
    expect(s.blockedAt).toMatchObject({ x: 1, y: 1, blockedBy: 'wall', tool: 'dock' })
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

  it('regroups co-located level rows into one RACK placement with levels[] on load', () => {
    // A levelled rack (mig 00072) persists as N co-located SHELF placement rows,
    // one per level, all sharing the rack's (floor,x,y). Load must collapse them
    // back onto the RACK parent with an embedded levels[] — otherwise the
    // inspector falls back to the form's standard template and the operator's
    // saved override appears lost on reload.
    const s = layoutEditorReducer(initialEditorState(), {
      type: 'load',
      placements: [
        { id: 1, layoutId: 1, locationId: 101, floor: 0, x: 5, y: 5, w: 1, h: 1, rotation: 0, levelIndex: 1 },
        { id: 2, layoutId: 1, locationId: 102, floor: 0, x: 5, y: 5, w: 1, h: 1, rotation: 0, levelIndex: 2 },
        // A plain legacy bin sharing the same load must still map 1:1.
        { id: 3, layoutId: 1, locationId: 9, floor: 0, x: 8, y: 2, w: 1, h: 1, rotation: 0 },
      ],
      objects: [],
      codeByLocation: {
        100: { code: 'A-R1', name: 'Rack 1', kind: 'RACK' as never },
        101: { code: 'A-R1-L1', name: 'L1', kind: 'SHELF' as never, parentId: 100, levelIndex: 1, levelRole: 'pick', capacitySlots: 2 },
        102: { code: 'A-R1-L2', name: 'L2', kind: 'SHELF' as never, parentId: 100, levelIndex: 2, levelRole: 'bulk', capacitySlots: 3 },
        9: { code: 'A-09', name: 'Bin 9', kind: 'BIN' as never },
      },
    })
    // One rack (collapsed from 2 level rows) + one legacy bin = 2 placements.
    expect(s.placements).toHaveLength(2)
    const rack = s.placements.find((p) => p.locationId === 100)
    expect(rack).toMatchObject({ kind: 'RACK', code: 'A-R1', x: 5, y: 5 })
    expect(rack?.levels).toEqual([
      expect.objectContaining({ levelIndex: 1, role: 'pick', capacitySlots: 2, locationId: 101 }),
      expect.objectContaining({ levelIndex: 2, role: 'bulk', capacitySlots: 3, locationId: 102 }),
    ])
    // Legacy bin untouched.
    expect(s.placements.find((p) => p.locationId === 9)).toMatchObject({ kind: 'BIN', code: 'A-09' })
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

  describe('selectedRefs (multi-select superset of selectedRef)', () => {
    it('starts empty', () => {
      expect(initialEditorState().selectedRefs.size).toBe(0)
    })

    it('mirrors selectedRef as a one-element set on every plain (non-additive) selection path', () => {
      const s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
      expect(s.selectedRefs).toEqual(new Set([s.selectedRef]))
    })

    it('a plain select action replaces the selection (back-compat, additive omitted)', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      const [refA, refB] = s.placements.map((p) => p.clientRef)
      s = layoutEditorReducer(s, { type: 'select', ref: refA })
      expect(s.selectedRef).toBe(refA)
      expect(s.selectedRefs).toEqual(new Set([refA]))
      s = layoutEditorReducer(s, { type: 'select', ref: refB })
      expect(s.selectedRef).toBe(refB)
      expect(s.selectedRefs).toEqual(new Set([refB]))
    })

    it('select with additive:true toggles refs into the multi-selection without dropping the others', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 2, y: 0 })
      const [refA, refB, refC] = s.placements.map((p) => p.clientRef)
      // Painting auto-selects the last-drawn rack; start from a clean slate.
      s = layoutEditorReducer(s, { type: 'select', ref: null })

      s = layoutEditorReducer(s, { type: 'select', ref: refA, additive: true })
      s = layoutEditorReducer(s, { type: 'select', ref: refB, additive: true })
      expect(s.selectedRefs).toEqual(new Set([refA, refB]))
      expect(s.selectedRef).toBe(refB) // last toggled in

      // Toggling refA again removes it, leaving refB as the sole remaining selection.
      s = layoutEditorReducer(s, { type: 'select', ref: refA, additive: true })
      expect(s.selectedRefs).toEqual(new Set([refB]))
      expect(s.selectedRef).toBe(refB)

      s = layoutEditorReducer(s, { type: 'select', ref: refC, additive: true })
      expect(s.selectedRefs).toEqual(new Set([refB, refC]))
    })

    it('a plain click (non-additive) after a multi-select collapses back to one', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      const [refA, refB] = s.placements.map((p) => p.clientRef)
      s = layoutEditorReducer(s, { type: 'select', ref: refA, additive: true })
      s = layoutEditorReducer(s, { type: 'select', ref: refB, additive: true })
      s = layoutEditorReducer(s, { type: 'select', ref: refA }) // plain click, not additive
      expect(s.selectedRef).toBe(refA)
      expect(s.selectedRefs).toEqual(new Set([refA]))
    })

    it('erasing the selected placement clears it from selectedRefs too', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 5 })
      const ref = s.selectedRef!
      s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 4, y: 5 })
      expect(s.selectedRefs.has(ref)).toBe(false)
    })
  })

  describe('rack levels (mig 00072)', () => {
    it('set_rack_levels updates only the targeted placement, immutably', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      const [refA, refB] = s.placements.map((p) => p.clientRef)
      const levels = [{ levelIndex: 1, role: 'pick' as const, capacitySlots: 5 }]

      const s2 = layoutEditorReducer(s, { type: 'set_rack_levels', ref: refA, levels })
      expect(s2).not.toBe(s)
      expect(s2.placements.find((p) => p.clientRef === refA)?.levels).toEqual(levels)
      expect(s2.placements.find((p) => p.clientRef === refB)?.levels).toBeUndefined()
      expect(s2.dirty).toBe(true)
      // Original state's placement is untouched.
      expect(s.placements.find((p) => p.clientRef === refA)?.levels).toBeUndefined()
    })

    it('the rack paint tool inherits the active form\'s level template, recoded to the new rack\'s own code', () => {
      const withForm = layoutEditorReducer(initialEditorState(), {
        type: 'set_storage_form',
        form: { label: 'Pallet Rack', storageTypeId: 1, capacitySlots: 10, levelTemplate: PALLET_RACK_TEMPLATE },
      })
      const s = layoutEditorReducer(withForm, { type: 'paint_cell', x: 4, y: 2 })
      const placement = s.placements[0]
      expect(placement.levels).toHaveLength(5)
      expect(placement.levels?.map((l) => l.levelIndex)).toEqual([1, 2, 3, 4, 5])
      expect(placement.levels?.map((l) => l.code)).toEqual([
        `${placement.code}-L1`, `${placement.code}-L2`, `${placement.code}-L3`, `${placement.code}-L4`, `${placement.code}-L5`,
      ])
      expect(placement.levels?.[4].role).toBe('bulk')
    })

    it('a form with no level template leaves the new placement levels undefined', () => {
      const withForm = layoutEditorReducer(initialEditorState(), {
        type: 'set_storage_form',
        form: { label: 'Bulk Floor', capacitySlots: 50 },
      })
      const s = layoutEditorReducer(withForm, { type: 'paint_cell', x: 0, y: 0 })
      expect(s.placements[0].levels).toBeUndefined()
    })

    it('generate_bins inherits a level template onto every generated bin, each recoded to its own code', () => {
      const s = layoutEditorReducer(initialEditorState(), {
        type: 'generate_bins', startX: 0, startY: 0, cols: 2, rows: 1, levelTemplate: PALLET_RACK_TEMPLATE,
      })
      expect(s.placements).toHaveLength(2)
      for (const p of s.placements) {
        expect(p.levels).toHaveLength(5)
        expect(p.levels?.[0].code).toBe(`${p.code}-L1`)
      }
      // Distinct racks never share a level code.
      const allCodes = s.placements.flatMap((p) => p.levels?.map((l) => l.code) ?? [])
      expect(new Set(allCodes).size).toBe(allCodes.length)
    })

    it('apply_levels_to_selection applies to the single current selection by default', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 }) // now selected
      const [refA, refB] = s.placements.map((p) => p.clientRef)

      s = layoutEditorReducer(s, { type: 'apply_levels_to_selection', levels: PALLET_RACK_TEMPLATE })

      const placementB = s.placements.find((p) => p.clientRef === refB)
      const placementA = s.placements.find((p) => p.clientRef === refA)
      expect(placementB?.levels).toHaveLength(5)
      expect(placementA?.levels).toBeUndefined() // was not selected
    })

    it('apply_levels_to_selection applies to every multi-selected rack, each keeping its own code', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 2, y: 0 })
      const [refA, refB, refC] = s.placements.map((p) => p.clientRef)
      // Painting auto-selects the last-drawn rack; start from a clean slate.
      s = layoutEditorReducer(s, { type: 'select', ref: null })

      s = layoutEditorReducer(s, { type: 'select', ref: refA, additive: true })
      s = layoutEditorReducer(s, { type: 'select', ref: refB, additive: true })
      // refC deliberately left unselected.

      s = layoutEditorReducer(s, { type: 'apply_levels_to_selection', levels: PALLET_RACK_TEMPLATE })

      const byRef = new Map(s.placements.map((p) => [p.clientRef, p]))
      expect(byRef.get(refA)?.levels).toHaveLength(5)
      expect(byRef.get(refB)?.levels).toHaveLength(5)
      expect(byRef.get(refC)?.levels).toBeUndefined()
      expect(byRef.get(refA)?.levels?.[0].code).toBe(`${byRef.get(refA)?.code}-L1`)
      expect(byRef.get(refB)?.levels?.[0].code).toBe(`${byRef.get(refB)?.code}-L1`)
    })

    it('apply_levels_to_selection is a no-op when nothing is selected', () => {
      const s0 = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      const s1 = layoutEditorReducer(s0, { type: 'select', ref: null })
      const s2 = layoutEditorReducer(s1, { type: 'apply_levels_to_selection', levels: PALLET_RACK_TEMPLATE })
      expect(s2).toBe(s1)
    })
  })

  // ── Overlap prevention ───────────────────────────────────────────────────
  describe('overlap prevention', () => {
    /** Load a single multi-cell object, the way an AI import or a clone delivers
     *  one. The paint tools only ever mint 1×1, so `load` is the only way in. */
    function withLoadedObject(o: { objectType: string; x: number; y: number; w: number; h: number }): EditorState {
      return layoutEditorReducer(initialEditorState(), {
        type: 'load',
        placements: [],
        objects: [{ id: 1, layoutId: 1, objectType: o.objectType, floor: 0, x: o.x, y: o.y, w: o.w, h: o.h } as never],
        codeByLocation: {},
      })
    }

    it('cross-category: a rack cannot be painted onto a wall', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 3, y: 3 })
      s = layoutEditorReducer({ ...s, tool: 'rack' }, { type: 'paint_cell', x: 3, y: 3 })
      expect(s.placements).toHaveLength(0)
      expect(s.blockedAt).toMatchObject({ blockedBy: 'wall', tool: 'rack' })
    })

    it('cross-category: a wall cannot be painted onto a rack', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 3, y: 3 })
      s = layoutEditorReducer({ ...s, tool: 'wall' }, { type: 'paint_cell', x: 3, y: 3 })
      expect(s.objects).toHaveLength(0)
      expect(s.blockedAt).toMatchObject({ blockedBy: 'storage', tool: 'wall' })
    })

    it('a label may share a cell with anything, in both directions', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'label' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(2)
      expect(s.blockedAt).toBeNull()

      let t = layoutEditorReducer(withTool('label'), { type: 'paint_cell', x: 2, y: 2 })
      t = layoutEditorReducer({ ...t, tool: 'wall' }, { type: 'paint_cell', x: 2, y: 2 })
      expect(t.objects).toHaveLength(2)
      expect(t.blockedAt).toBeNull()
    })

    it('two labels in one cell collapse to one, silently', () => {
      let s = layoutEditorReducer(withTool('label'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(1)
      expect(s.blockedAt).toBeNull()
    })

    it('staging and dock may share a cell, in both directions', () => {
      let s = layoutEditorReducer(withTool('dock'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'staging' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(2)

      let t = layoutEditorReducer(withTool('staging'), { type: 'paint_cell', x: 5, y: 5 })
      t = layoutEditorReducer({ ...t, tool: 'dock' }, { type: 'paint_cell', x: 5, y: 5 })
      expect(t.objects).toHaveLength(2)
    })

    it('staging is still blocked by a wall', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'staging' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(1)
      expect(s.blockedAt).toMatchObject({ blockedBy: 'wall' })
    })

    // A drag that crosses its own stroke must not flash or toast.
    it('re-painting the same type is a silent no-op, not a refusal', () => {
      const s1 = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      const s2 = layoutEditorReducer(s1, { type: 'paint_cell', x: 1, y: 1 })
      expect(s2.objects).toHaveLength(1)
      expect(s2.blockedAt).toBeNull()

      const r1 = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 1, y: 1 })
      const r2 = layoutEditorReducer(r1, { type: 'paint_cell', x: 1, y: 1 })
      expect(r2).toBe(r1)
    })

    it('blockedAt.seq increments on repeated refusals at the same cell', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'dock' }, { type: 'paint_cell', x: 1, y: 1 })
      const first = s.blockedAt!.seq
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.blockedAt!.seq).toBeGreaterThan(first)
    })

    it('a refusal does not mark the layout dirty', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = { ...s, dirty: false, tool: 'dock' }
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.dirty).toBe(false)
    })

    it('a successful paint clears blockedAt', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'dock' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.blockedAt).not.toBeNull()
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 9, y: 9 })
      expect(s.blockedAt).toBeNull()
    })

    it('generate_bins skips wall-owned cells and reports the count', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
      s = layoutEditorReducer(s, { type: 'generate_bins', startX: 0, startY: 0, cols: 3, rows: 1 })
      expect(s.placements).toHaveLength(1)
      expect(s.placements[0]).toMatchObject({ x: 2, y: 0 })
      expect(s.blockedAt).toMatchObject({ count: 2, blockedBy: 'wall', tool: 'rack' })
    })

    it('a fully-blocked generate_bins still reports', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 0, y: 0 })
      s = layoutEditorReducer(s, { type: 'generate_bins', startX: 0, startY: 0, cols: 1, rows: 1 })
      expect(s.placements).toHaveLength(0)
      expect(s.blockedAt).toMatchObject({ count: 1 })
    })

    // AABB containment. A multi-cell object used to be invisible to every hit test
    // except at its own top-left cell.
    it('a multi-cell wall blocks a rack painted at its interior', () => {
      const s0 = withLoadedObject({ objectType: 'wall', x: 2, y: 2, w: 5, h: 1 })
      const s = layoutEditorReducer({ ...s0, tool: 'rack' }, { type: 'paint_cell', x: 4, y: 2 })
      expect(s.placements).toHaveLength(0)
      expect(s.blockedAt).toMatchObject({ blockedBy: 'wall' })
    })

    it('a multi-cell object is selectable from its interior', () => {
      const s0 = withLoadedObject({ objectType: 'wall', x: 2, y: 2, w: 5, h: 1 })
      const s = layoutEditorReducer({ ...s0, tool: 'select' }, { type: 'paint_cell', x: 4, y: 2 })
      expect(s.selectedRef).toBe(s0.objects[0].clientRef)
    })

    it('erasing the interior of a multi-cell object removes only that cell', () => {
      const s0 = withLoadedObject({ objectType: 'wall', x: 2, y: 2, w: 5, h: 1 })
      const s = layoutEditorReducer({ ...s0, tool: 'erase' }, { type: 'paint_cell', x: 4, y: 2 })
      // 5 cells minus the erased one, as four 1×1 fragments.
      expect(s.objects).toHaveLength(4)
      expect(s.objects.map((o) => o.x).sort((a, b) => a - b)).toEqual([2, 3, 5, 6])
      expect(s.objects.every((o) => o.w === 1 && o.h === 1)).toBe(true)
    })

    it('erasing a 1×1 object still removes it outright', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(0)
    })

    it('apply_overlap_repair mints fresh refs and clears a dangling object selection', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'select' }, { type: 'paint_cell', x: 1, y: 1 })
      const originalRef = s.selectedRef
      expect(originalRef).not.toBeNull()
      s = layoutEditorReducer(s, {
        type: 'apply_overlap_repair',
        objects: [{ objectType: 'wall', floor: 0, x: 1, y: 1, w: 1, h: 1 }],
      })
      expect(s.objects).toHaveLength(1)
      expect(s.objects[0].clientRef).not.toBe(originalRef)
      expect(s.selectedRef).toBeNull()
    })

    it('apply_overlap_repair keeps a placement selection and never touches placements', () => {
      let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 4, y: 4 })
      const placementRef = s.selectedRef
      s = layoutEditorReducer(s, {
        type: 'apply_overlap_repair',
        objects: [{ objectType: 'wall', floor: 0, x: 1, y: 1, w: 1, h: 1 }],
      })
      expect(s.placements).toHaveLength(1)
      expect(s.selectedRef).toBe(placementRef)
    })
  })

  // The matrix drives every decision above, so assert its invariants rather than
  // trusting a hand-read of the table.
  describe('ALLOWED_COOCCUPANTS', () => {
    const kinds = Object.keys(ALLOWED_COOCCUPANTS) as OccupantKind[]

    it('covers every occupant kind', () => {
      const expected: OccupantKind[] = [
        'wall', 'walkway', 'dock', 'lift', 'conveyor', 'staging', 'obstacle', 'label', 'storage',
      ]
      expect(kinds.sort()).toEqual(expected.sort())
    })

    // blockerAt only looks the matrix up in one direction, so an asymmetric entry
    // would let A sit on B while refusing B on A.
    it('is symmetric', () => {
      for (const a of kinds) {
        for (const b of kinds) {
          expect(ALLOWED_COOCCUPANTS[a].includes(b)).toBe(ALLOWED_COOCCUPANTS[b].includes(a))
        }
      }
    })

    it('lets a label co-exist with everything', () => {
      for (const k of kinds) expect(ALLOWED_COOCCUPANTS.label).toContain(k)
    })

    it('allows nothing but label except the staging↔dock pair', () => {
      for (const k of kinds) {
        if (k === 'label' || k === 'dock' || k === 'staging') continue
        expect([...ALLOWED_COOCCUPANTS[k]]).toEqual(['label'])
      }
      expect([...ALLOWED_COOCCUPANTS.dock].sort()).toEqual(['label', 'staging'])
      expect([...ALLOWED_COOCCUPANTS.staging].sort()).toEqual(['dock', 'label'])
    })
  })
})
