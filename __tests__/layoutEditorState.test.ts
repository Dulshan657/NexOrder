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

// ── Area-only scope: a PUBLISHED layout (mig 00095) ──────────────────────────
//
// The reducer is where this is enforced, not the toolbar: a keyboard shortcut, a
// stale render or a canvas drag must be refused by the same thing that refuses a
// bad co-occupancy. A published layout's placements and walls carry the frozen
// routing graph; an `area` carries none of it, which is why the scope exists.

describe('layoutEditorReducer — editScope: areas', () => {
  /** A published layout holding one rack, one wall and one painted area. */
  function published(): EditorState {
    let s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 1, y: 1 })
    s = layoutEditorReducer({ ...s, tool: 'wall' }, { type: 'paint_cell', x: 2, y: 1 })
    s = layoutEditorReducer({ ...s, tool: 'area', activeArea: { name: 'Chiller' } }, { type: 'paint_cell', x: 3, y: 1 })
    return layoutEditorReducer(s, { type: 'set_edit_scope', scope: 'areas' })
  }

  it('drops a geometry tool the operator was holding rather than leaving it inert', () => {
    const s = layoutEditorReducer({ ...withTool('wall') }, { type: 'set_edit_scope', scope: 'areas' })
    expect(s.tool).toBe('select')
  })

  it('refuses to pick up a geometry tool, leaving the current one held', () => {
    const s = { ...published(), tool: 'select' as const }
    for (const tool of ['wall', 'rack', 'dock', 'walkway', 'lift', 'staging'] as const) {
      expect(layoutEditorReducer(s, { type: 'set_tool', tool })).toBe(s)
    }
    expect(layoutEditorReducer(s, { type: 'set_tool', tool: 'area' }).tool).toBe('area')
    expect(layoutEditorReducer(s, { type: 'set_tool', tool: 'erase' }).tool).toBe('erase')
    // Signs join the scope with mig 00097 on the same argument that admitted
    // areas: a `label` row is inert in buildWalkableCells, so it freezes nothing.
    expect(layoutEditorReducer(s, { type: 'set_tool', tool: 'label' }).tool).toBe('label')
  })

  it('paints and erases SIGNS on a published layout', () => {
    let s = layoutEditorReducer(published(), { type: 'set_sign', name: 'Inbound Staging' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 9, y: 9 })
    expect(s.objects.filter((o) => o.objectType === 'label')).toHaveLength(1)

    s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 9, y: 9 })
    expect(s.objects.filter((o) => o.objectType === 'label')).toHaveLength(0)
  })

  it('the eraser takes the layer the operator last picked up, not the topmost hit', () => {
    // Signs and areas co-occupy freely, so there is NO stacking rule that is
    // right in both directions — erasing an area cell must not eat the sign over
    // it, and erasing a sign must not eat the area under it. `annotationBrush`
    // is how the operator says which layer they are working on.
    let s = layoutEditorReducer(published(), { type: 'set_sign', name: 'Inbound' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 3, y: 1 })   // over "Chiller"
    expect(s.objects.filter((o) => o.x === 3 && o.y === 1)).toHaveLength(2)

    // Sign brush held → the eraser takes the sign.
    const signGone = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 3, y: 1 })
    expect(signGone.objects.filter((o) => o.objectType === 'label')).toHaveLength(0)
    expect(signGone.objects.filter((o) => o.objectType === 'area')).toHaveLength(1)

    // Area brush picked back up → the eraser takes the area instead.
    let t = layoutEditorReducer(s, { type: 'set_area', area: { name: 'Chiller' } })
    t = layoutEditorReducer({ ...t, tool: 'erase' }, { type: 'paint_cell', x: 3, y: 1 })
    expect(t.objects.filter((o) => o.objectType === 'area')).toHaveLength(0)
    expect(t.objects.filter((o) => o.objectType === 'label')).toHaveLength(1)
  })

  it('rename_sign moves EVERY cell, so a merged sign cannot be split in half', () => {
    let s = layoutEditorReducer(published(), { type: 'set_sign', name: 'Inbound' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 5, y: 5 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 6, y: 5 })
    s = layoutEditorReducer(s, { type: 'rename_sign', from: 'Inbound', to: 'Goods In' })
    const signs = s.objects.filter((o) => o.objectType === 'label')
    expect(signs).toHaveLength(2)
    expect(signs.every((o) => (o.meta as any).name === 'Goods In')).toBe(true)
    // The brush follows, so the next stroke extends the RENAMED sign rather than
    // re-creating the old one beside it.
    expect(s.activeSign).toBe('Goods In')
  })

  it('still paints and erases AREAS', () => {
    let s = layoutEditorReducer(published(), { type: 'set_area', area: { name: 'Cold Room' } })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 9, y: 9 })
    expect(s.objects.filter((o) => o.objectType === 'area')).toHaveLength(2)

    s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 9, y: 9 })
    expect(s.objects.filter((o) => o.objectType === 'area')).toHaveLength(1)
  })

  it('erase cannot reach a placement or a wall, and says why', () => {
    const s = { ...published(), tool: 'erase' as const }

    const overRack = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
    expect(overRack.placements).toHaveLength(1)
    expect(overRack.blockedAt).toMatchObject({ x: 1, y: 1, blockedBy: 'storage' })

    const overWall = layoutEditorReducer(s, { type: 'paint_cell', x: 2, y: 1 })
    expect(overWall.objects.filter((o) => o.objectType === 'wall')).toHaveLength(1)
    expect(overWall.blockedAt).toMatchObject({ x: 2, y: 1, blockedBy: 'wall' })
  })

  it('erases the AREA over a wall, not the wall under it', () => {
    // Areas co-occupy with everything — they name the ground the racks stand on
    // — so objectAt's topmost hit over this cell is the wall, not the area.
    let s = layoutEditorReducer(
      { ...published(), tool: 'area', activeArea: { name: 'Chiller' } },
      { type: 'paint_cell', x: 2, y: 1 },
    )
    s = layoutEditorReducer({ ...s, tool: 'erase' }, { type: 'paint_cell', x: 2, y: 1 })
    expect(s.objects.filter((o) => o.objectType === 'wall')).toHaveLength(1)
    expect(s.objects.some((o) => o.objectType === 'area' && o.x === 2 && o.y === 1)).toBe(false)
  })

  it('no-ops every action that would touch frozen geometry', () => {
    const s = published()
    const rackRef = s.placements[0].clientRef
    expect(layoutEditorReducer(s, { type: 'update_placement', ref: rackRef, patch: { name: 'Nope' } })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'set_rack_levels', ref: rackRef, levels: PALLET_RACK_TEMPLATE })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'apply_levels_to_selection', levels: PALLET_RACK_TEMPLATE })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'generate_bins', startX: 0, startY: 5, cols: 3, rows: 3 })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'apply_auto_connect', objects: [{ objectType: 'walkway', floor: 0, x: 0, y: 0, w: 1, h: 1 }] })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'apply_overlap_repair', objects: [] })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'set_storage_form', form: { storageTypeId: 1, label: 'x' } })).toBe(s)
  })

  it('deletes a selected AREA but not a selected rack or wall', () => {
    const s = published()
    const area = s.objects.find((o) => o.objectType === 'area')!
    const wall = s.objects.find((o) => o.objectType === 'wall')!

    const wallSelected = { ...s, selectedRef: wall.clientRef }
    expect(layoutEditorReducer(wallSelected, { type: 'delete_selected' })).toBe(wallSelected)

    const rackSelected = { ...s, selectedRef: s.placements[0].clientRef }
    expect(layoutEditorReducer(rackSelected, { type: 'delete_selected' })).toBe(rackSelected)

    const areaSelected = { ...s, selectedRef: area.clientRef }
    expect(layoutEditorReducer(areaSelected, { type: 'delete_selected' }).objects
      .filter((o) => o.objectType === 'area')).toHaveLength(0)
  })

  it('lets update_object rename an area but not relabel a wall', () => {
    const s = published()
    const area = s.objects.find((o) => o.objectType === 'area')!
    const wall = s.objects.find((o) => o.objectType === 'wall')!
    expect(layoutEditorReducer(s, { type: 'update_object', ref: wall.clientRef, patch: { meta: { name: 'x' } } })).toBe(s)
    expect(layoutEditorReducer(s, { type: 'update_object', ref: area.clientRef, patch: { meta: { name: 'x' } } })
      .objects.find((o) => o.clientRef === area.clientRef)!.meta).toMatchObject({ name: 'x' })
  })

  it('survives a load, because load spreads state', () => {
    const s = layoutEditorReducer(published(), { type: 'load', placements: [], objects: [], codeByLocation: {} })
    expect(s.editScope).toBe('areas')
  })
})

describe('layoutEditorReducer — replace_areas', () => {
  it('swaps the area set, keeps every other object, and clears pending renames', () => {
    let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer({ ...s, tool: 'area', activeArea: { name: 'Chiller' } }, { type: 'paint_cell', x: 1, y: 0 })
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold Room' })
    expect(s.pendingRenames).toHaveLength(1)

    const next = layoutEditorReducer(s, {
      type: 'replace_areas',
      objects: [
        { floor: 0, x: 5, y: 5, meta: { name: 'Bulk', zoneProfileId: 2 } },
        { floor: 0, x: 6, y: 5, meta: { name: 'Bulk', zoneProfileId: 2 } },
      ],
    })

    expect(next.objects.filter((o) => o.objectType === 'wall')).toHaveLength(1)
    const areas = next.objects.filter((o) => o.objectType === 'area')
    expect(areas).toHaveLength(2)
    expect(areas.every((o) => o.meta?.name === 'Bulk' && o.w === 1 && o.h === 1)).toBe(true)
    // A rename recorded against the DISCARDED set would rename something else.
    expect(next.pendingRenames).toEqual([])
    expect(next.dirty).toBe(true)
  })

  it('mints fresh clientRefs so an adopted cell cannot collide with an existing one', () => {
    const s = layoutEditorReducer(
      layoutEditorReducer(withTool('area'), { type: 'paint_cell', x: 0, y: 0 }),
      { type: 'replace_areas', objects: [{ floor: 0, x: 1, y: 1, meta: { name: 'Bulk' } }] },
    )
    expect(new Set(s.objects.map((o) => o.clientRef)).size).toBe(s.objects.length)
  })
})

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
  ] as const)('paints a %s object at a cell', (tool, objectType) => {
    const s = layoutEditorReducer(withTool(tool), { type: 'paint_cell', x: 3, y: 3 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]).toMatchObject({ objectType, x: 3, y: 3 })
    expect(s.dirty).toBe(true)
  })

  // A sign is its text (mig 00097), so it takes the brush first — see the
  // blank-brush block below for why painting without one is refused outright.
  it('paints a sign at a cell, carrying its text', () => {
    let s = layoutEditorReducer(initialEditorState(), { type: 'set_sign', name: 'Inbound Staging' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 3, y: 3 })
    expect(s.objects).toHaveLength(1)
    expect(s.objects[0]).toMatchObject({ objectType: 'label', x: 3, y: 3, meta: { name: 'Inbound Staging' } })
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
    let s = layoutEditorReducer(withTool('obstacle'), { type: 'paint_cell', x: 7, y: 7 })
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

    // A form whose `default_capacity_slots` is NULL means UNCOUNTED — no slot
    // ceiling. `?? 10` overrode exactly that, so every cell painted with a Bulk
    // Floor brush was stored as a 10-pallet bin and the form's own default never
    // reached the server (which only consults the form when the field is null).
    it('a form that states no capacity paints an UNCOUNTED bin, not a 10-slot one', () => {
      const withForm = layoutEditorReducer(initialEditorState(), {
        type: 'set_storage_form',
        form: { label: 'Amadiya Bulk Floor', storageTypeId: 7, slotKind: 'pallet' },
      })
      const s = layoutEditorReducer(withForm, { type: 'paint_cell', x: 0, y: 0 })
      expect(s.placements[0].capacitySlots).toBeUndefined()
      expect(s.placements[0].slotKind).toBe('pallet')
    })

    it('a single-pallet form paints exactly one slot', () => {
      const withForm = layoutEditorReducer(initialEditorState(), {
        type: 'set_storage_form',
        form: { label: 'Floor Pallet', storageTypeId: 8, capacitySlots: 1, slotKind: 'pallet' },
      })
      const s = layoutEditorReducer(withForm, { type: 'paint_cell', x: 0, y: 0 })
      expect(s.placements[0]).toMatchObject({ capacitySlots: 1, slotKind: 'pallet', kind: 'BIN' })
      expect(s.placements[0].levels).toBeUndefined()
    })

    // The generic fallback is for NO form selected, and only that.
    it('paints the generic 10-pallet bin when no form is armed', () => {
      const s = layoutEditorReducer(withTool('rack'), { type: 'paint_cell', x: 0, y: 0 })
      expect(s.placements[0]).toMatchObject({ capacitySlots: 10, slotKind: 'pallet' })
    })

    it('generate_bins treats a null capacity as uncounted and an absent one as generic', () => {
      const uncounted = layoutEditorReducer(initialEditorState(), {
        type: 'generate_bins', startX: 0, startY: 0, cols: 1, rows: 1, capacitySlots: null,
      })
      expect(uncounted.placements[0].capacitySlots).toBeUndefined()

      const generic = layoutEditorReducer(initialEditorState(), {
        type: 'generate_bins', startX: 0, startY: 0, cols: 1, rows: 1,
      })
      expect(generic.placements[0].capacitySlots).toBe(10)
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

    /** Pick up the sign brush, which a sign stroke now requires. */
    const withSign = (name = 'Inbound Staging') =>
      layoutEditorReducer(initialEditorState(), { type: 'set_sign', name })

    it('a sign may share a cell with anything, in both directions', () => {
      let s = layoutEditorReducer(withTool('wall'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer({ ...s, tool: 'label', activeSign: 'Inbound Staging' }, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(2)
      expect(s.blockedAt).toBeNull()

      let t = layoutEditorReducer(withSign(), { type: 'paint_cell', x: 2, y: 2 })
      t = layoutEditorReducer({ ...t, tool: 'wall' }, { type: 'paint_cell', x: 2, y: 2 })
      expect(t.objects).toHaveLength(2)
      expect(t.blockedAt).toBeNull()
    })

    it('repainting a cell with the SAME sign text is an idempotent no-op', () => {
      // A drag that crosses its own stroke must not churn object identity or
      // re-mark the layout dirty on every cell.
      let s = layoutEditorReducer(withSign(), { type: 'paint_cell', x: 1, y: 1 })
      const before = s.objects
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(1)
      expect(s.objects).toBe(before)
      expect(s.blockedAt).toBeNull()
    })

    it('painting DIFFERENT sign text over a cell reassigns it', () => {
      let s = layoutEditorReducer(withSign('Inbound'), { type: 'paint_cell', x: 1, y: 1 })
      s = layoutEditorReducer(s, { type: 'set_sign', name: 'Outbound' })
      s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(1)
      expect(s.objects[0].meta).toEqual({ name: 'Outbound' })
    })

    // The reported bug, both halves: an annotation IS its name, so a nameless
    // brush wrote a cell belonging to nothing — invisible on the map (an area's
    // wash is 12% opacity under the grid; a sign draws no text at all) and
    // refused by the server. It must be refused HERE, out loud.
    it.each(['area', 'label'] as const)('refuses a %s stroke while the brush has no name', (tool) => {
      const s = layoutEditorReducer(withTool(tool), { type: 'paint_cell', x: 1, y: 1 })
      expect(s.objects).toHaveLength(0)
      expect(s.dirty).toBe(false)
      expect(s.blockedAt).toMatchObject({ x: 1, y: 1, reason: 'unnamed', tool })
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
        'wall', 'walkway', 'dock', 'lift', 'conveyor', 'staging', 'obstacle', 'label', 'storage', 'area',
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

    // An area (mig 00090) names the ground the racks stand on, so it must lie
    // OVER them rather than compete for the cell — an area that could not
    // overlap the bins it names would be unable to name anything.
    it('lets an area co-exist with everything', () => {
      for (const k of kinds) expect(ALLOWED_COOCCUPANTS.area).toContain(k)
    })

    it('allows nothing but label and area except the staging↔dock pair', () => {
      for (const k of kinds) {
        if (k === 'label' || k === 'area' || k === 'dock' || k === 'staging') continue
        expect([...ALLOWED_COOCCUPANTS[k]].sort()).toEqual(['area', 'label'])
      }
      expect([...ALLOWED_COOCCUPANTS.dock].sort()).toEqual(['area', 'label', 'staging'])
      expect([...ALLOWED_COOCCUPANTS.staging].sort()).toEqual(['area', 'dock', 'label'])
    })
  })
})

// ── Friendly names at draw time (mig 00094) ──────────────────────────────────

/** Paint a named area over a rectangle, then pick up the rack tool. */
function withArea(name: string, w = 6, h = 6): EditorState {
  let s = layoutEditorReducer(initialEditorState('NEXG'), { type: 'set_tool', tool: 'area' })
  s = layoutEditorReducer(s, { type: 'set_area', area: { name } })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) s = layoutEditorReducer(s, { type: 'paint_cell', x, y })
  }
  return layoutEditorReducer(s, { type: 'set_tool', tool: 'rack' })
}

describe('draw-time naming', () => {
  it('names a rack from the area it is painted in, and numbers it', () => {
    let s = withArea('Chiller')
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })

    expect(s.placements.map((p) => p.name)).toEqual(['Chiller · Rack 1', 'Chiller · Rack 2'])
    expect(s.placements.map((p) => p.nameSeq)).toEqual([1, 2])
    expect(s.placements.every((p) => p.nameArea === 'Chiller' && p.nameIsAuto)).toBe(true)
    // The CODE is untouched — it is the QR payload and the scan identity.
    expect(s.placements.map((p) => p.code)).toEqual(['NEXG-B-0-0', 'NEXG-B-1-0'])
  })

  it('never reuses the number of a rack that was SAVED and then deleted', () => {
    // The number that matters is one that reached a label. Deleting a saved rack
    // drops its placement row but not its `locations` row — publishing never
    // retires a bin — so its number stays spoken for.
    let s = withArea('Chiller')
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
    s = layoutEditorReducer(s, {
      type: 'mark_saved',
      refMap: s.placements.map((p, i) => ({
        client_ref: p.clientRef, location_id: 700 + i,
        name: p.name, name_seq: p.nameSeq!, name_area: 'Chiller',
      })),
    })
    s = layoutEditorReducer(s, { type: 'select', ref: s.placements[1].clientRef })
    s = layoutEditorReducer(s, { type: 'delete_selected' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 2, y: 0 })

    // Not "Rack 2" — a sign already on the floor cannot be un-printed.
    expect(s.placements.map((p) => p.name)).toEqual(['Chiller · Rack 1', 'Chiller · Rack 3'])
  })

  it('frees the number of a rack drawn and deleted before any save', () => {
    // Nothing was ever printed, so the number really is free. Holding it would
    // burn a number every time someone mis-clicked.
    let s = withArea('Chiller')
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'select', ref: s.placements[0].clientRef })
    s = layoutEditorReducer(s, { type: 'delete_selected' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })

    expect(s.placements[0].name).toBe('Chiller · Rack 1')
  })

  it('seeds the floor from the whole warehouse on load, not just this layout', () => {
    // codeByLocation covers every location under the warehouse, so a rack that
    // left this layout still holds its claim after a reload.
    let s = layoutEditorReducer(initialEditorState('NEXG'), {
      type: 'load',
      placements: [],
      objects: [],
      codeByLocation: {
        900: { code: 'NEXG-B-0-0', name: 'Chiller · Rack 12', kind: 'BIN', nameSeq: 12, nameArea: 'Chiller', nameIsAuto: true },
      } as never,
    })
    expect(s.seqFloor).toEqual({ Chiller: 12 })

    s = layoutEditorReducer(s, { type: 'set_tool', tool: 'area' })
    s = layoutEditorReducer(s, { type: 'set_area', area: { name: 'Chiller' } })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'set_tool', tool: 'rack' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })

    expect(s.placements[0].name).toBe('Chiller · Rack 13')
  })

  it('names a rack drawn outside every area without an area prefix', () => {
    let s = layoutEditorReducer(initialEditorState('NEXG'), { type: 'set_tool', tool: 'rack' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 9, y: 9 })

    expect(s.placements[0].name).toBe('Rack 1')
    expect(s.placements[0].nameArea).toBe('')
  })

  it('gives each area in a batch fill its own number run', () => {
    let s = layoutEditorReducer(initialEditorState('NEXG'), { type: 'set_tool', tool: 'area' })
    s = layoutEditorReducer(s, { type: 'set_area', area: { name: 'Chiller' } })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
    s = layoutEditorReducer(s, { type: 'set_area', area: { name: 'Bulk' } })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 2, y: 0 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 3, y: 0 })
    s = layoutEditorReducer(s, { type: 'set_tool', tool: 'rack' })
    s = layoutEditorReducer(s, { type: 'generate_bins', startX: 0, startY: 0, cols: 4, rows: 1 })

    expect(s.placements.map((p) => p.name)).toEqual([
      'Chiller · Rack 1', 'Chiller · Rack 2', 'Bulk · Rack 1', 'Bulk · Rack 2',
    ])
    // RackWizard closes its modal on submit, so the ranges have to be reported
    // or the operator never sees what was minted.
    expect(s.lastFill).toMatchObject({ count: 4, ranges: 'Chiller 1–2, Bulk 1–2' })
  })

  it('marks a hand-typed name as custom and releases its number', () => {
    let s = withArea('Chiller')
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    const ref = s.placements[0].clientRef
    s = layoutEditorReducer(s, { type: 'update_placement', ref, patch: { name: 'Damaged goods bay' } })

    expect(s.placements[0]).toMatchObject({
      name: 'Damaged goods bay', nameIsAuto: false, nameSeq: null, nameArea: null,
    })
    // Releasing the claim is deliberate: the pool no longer holds 1.
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 1, y: 0 })
    expect(s.placements[1].name).toBe('Chiller · Rack 1')
  })

  it('does not clobber provenance on an unrelated placement edit', () => {
    let s = withArea('Chiller')
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    const ref = s.placements[0].clientRef
    s = layoutEditorReducer(s, { type: 'update_placement', ref, patch: { capacitySlots: 42 } })

    expect(s.placements[0]).toMatchObject({ nameIsAuto: true, nameSeq: 1, nameArea: 'Chiller' })
  })
})

describe('rename_area', () => {
  function twoFloorChiller(): EditorState {
    let s = layoutEditorReducer(initialEditorState('NEXG'), { type: 'set_tool', tool: 'area' })
    s = layoutEditorReducer(s, { type: 'set_area', area: { name: 'Chiller' } })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    s = layoutEditorReducer(s, { type: 'set_floor', floor: 1 })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    return layoutEditorReducer(s, { type: 'set_floor', floor: 0 })
  }

  it('renames the area on EVERY floor, because number pools are layout-wide', () => {
    let s = twoFloorChiller()
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold Room' })

    expect(s.objects.map((o) => o.meta?.name)).toEqual(['Cold Room', 'Cold Room'])
  })

  it('records the rename so the server can tell it from an erase-and-repaint', () => {
    let s = twoFloorChiller()
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold Room' })

    expect(s.pendingRenames).toEqual([{ from: 'Chiller', to: 'Cold Room' }])
  })

  it('coalesces A→B→C into A→C', () => {
    let s = twoFloorChiller()
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold' })
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Cold', to: 'Cold Room' })

    expect(s.pendingRenames).toEqual([{ from: 'Chiller', to: 'Cold Room' }])
  })

  it('drops the entry entirely when renamed back to where it started', () => {
    let s = twoFloorChiller()
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold' })
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Cold', to: 'Chiller' })

    expect(s.pendingRenames).toEqual([])
  })

  it('clears pending renames once saved', () => {
    let s = twoFloorChiller()
    s = layoutEditorReducer(s, { type: 'rename_area', from: 'Chiller', to: 'Cold Room' })
    s = layoutEditorReducer(s, { type: 'mark_saved', refMap: [] })

    expect(s.pendingRenames).toEqual([])
  })

  it('adopts the server’s authoritative name on save', () => {
    let s = layoutEditorReducer(initialEditorState('NEXG'), { type: 'set_tool', tool: 'rack' })
    s = layoutEditorReducer(s, { type: 'paint_cell', x: 0, y: 0 })
    const ref = s.placements[0].clientRef
    // The server recomputed from the database and disagreed with this stale tab.
    s = layoutEditorReducer(s, {
      type: 'mark_saved',
      refMap: [{ client_ref: ref, location_id: 501, name: 'Chiller · Rack 9', name_seq: 9, name_area: 'Chiller' }],
    })

    expect(s.placements[0]).toMatchObject({
      locationId: 501, name: 'Chiller · Rack 9', nameSeq: 9, nameArea: 'Chiller',
    })
  })
})
