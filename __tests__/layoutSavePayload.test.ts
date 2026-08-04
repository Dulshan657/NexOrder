// The designer's editor-state -> save_geometry contract.
//
// This file exists because that contract broke in a way nothing could see. The
// designer sent `capacity_slots: null` / `weight_capacity_kg: null` for a rack
// level; mutate-layout's schema declared both `.optional()`, which in zod accepts
// `undefined` and REJECTS `null`. Every save of a Shelving or Cold Room rack —
// the two drawable storage forms whose level_template carries a NULL weight —
// failed with a bare "Invalid request body". `tsc` cannot catch it (`strict` is
// off, so `number | null` assigns to `capacity_slots?: number`) and nothing
// asserted the payload shape, so the only signal was an operator hitting Save.
//
// The zod schema itself is not importable here — mutate-layout pulls zod from
// https://esm.sh, which doesn't resolve under vitest (see the header of
// mutateProduct.bulkCreate.test.ts for the repo's convention). What IS testable
// is the payload, so these tests pin the shape the server was widened to accept.

import { describe, it, expect } from 'vitest'
import { buildSaveGeometryPayload } from '../components/admin/layout/savePayload'
import type { EditorObject, EditorPlacement } from '../components/admin/layout/useLayoutEditorState'

const CTX = { warehouseId: 2617, warehouseCode: 'NEXG', layoutId: 78 }

function placement(over: Partial<EditorPlacement> = {}): EditorPlacement {
  return {
    clientRef: 'p1', floor: 0, x: 3, y: 4, w: 1, h: 1, rotation: 0,
    kind: 'BIN', code: 'NEXG-B-3-4', name: 'Bin 3,4',
    ...over,
  } as EditorPlacement
}

describe('buildSaveGeometryPayload — new levelled rack', () => {
  it('emits null (never undefined) for a level with no capacity or weight limit', () => {
    // Exactly the SHELVING case: mig 00072 writes weight_capacity_kg NULL into
    // level_template when the form has none, adapters map NULL -> undefined, and
    // applyTemplate carries the undefined onto the placement.
    const { placements } = buildSaveGeometryPayload(
      [placement({
        kind: 'RACK', code: 'NEXG-B-3-4', storageTypeId: 2,
        levels: [
          { levelIndex: 1, role: 'pick', capacitySlots: 10, weightCapacityKg: undefined },
          { levelIndex: 2, role: 'pick', capacitySlots: undefined, weightCapacityKg: undefined },
        ],
      })],
      [],
      CTX,
    )

    expect(placements[0].new_bin?.levels).toEqual([
      { level_index: 1, role: 'pick', capacity_slots: 10, slot_kind: null, weight_capacity_kg: null },
      { level_index: 2, role: 'pick', capacity_slots: null, slot_kind: null, weight_capacity_kg: null },
    ])
  })

  it('sends kind RACK and no top-level levels for a rack that does not exist yet', () => {
    const { placements } = buildSaveGeometryPayload(
      [placement({ kind: 'BIN', levels: [{ levelIndex: 1, role: 'bulk' }] })],
      [],
      CTX,
    )

    expect(placements[0].new_bin?.kind).toBe('RACK')
    expect(placements[0].new_bin?.parent_id).toBe(CTX.warehouseId)
    expect(placements[0].location_id).toBeUndefined()
    // Levels ride inside new_bin; the server rejects the pairing otherwise.
    expect(placements[0].levels).toBeUndefined()
  })

  it("normalises the editor's empty-string role to null, not ''", () => {
    // '' is how the reducer represents "no stored role" — deliberately not
    // 'pick', which would silently claim a Pick Zone that drives replenishment.
    const { placements } = buildSaveGeometryPayload(
      [placement({ kind: 'RACK', levels: [{ levelIndex: 1, role: '' }, { levelIndex: 2, role: '  ' }] })],
      [],
      CTX,
    )

    expect(placements[0].new_bin?.levels?.map((l) => l.role)).toEqual([null, null])
  })

  it('threads a per-level slot_kind, which used to be dropped on every save', () => {
    const { placements } = buildSaveGeometryPayload(
      [placement({ kind: 'RACK', levels: [{ levelIndex: 1, role: 'pick', slotKind: 'carton' }] })],
      [],
      CTX,
    )

    expect(placements[0].new_bin?.levels?.[0].slot_kind).toBe('carton')
  })
})

describe('buildSaveGeometryPayload — already-saved levelled rack', () => {
  const saved = placement({
    locationId: 2664, kind: 'RACK', code: 'NEXG-B-10-3',
    levels: [
      { locationId: 2665, levelIndex: 1, role: 'pick', capacitySlots: 24, weightCapacityKg: 1000 },
      { locationId: 2666, levelIndex: 2, role: 'reserve', capacitySlots: 24, weightCapacityKg: 1000 },
    ],
  })

  it('re-sends the levels alongside location_id so the server cannot flatten the rack', () => {
    // The regression that matters most. `locationId` on a levelled rack is the
    // RACK PARENT — the parent holds no placement row, its SHELF children do. A
    // save that named the parent alone made save_geometry (a full replace) write
    // one placement row on the parent and then garbage-collect every level.
    const { placements } = buildSaveGeometryPayload([saved], [], CTX)

    expect(placements[0].location_id).toBe(2664)
    expect(placements[0].new_bin).toBeUndefined()
    expect(placements[0].levels).toEqual([
      { location_id: 2665, level_index: 1, role: 'pick', capacity_slots: 24, slot_kind: null, weight_capacity_kg: 1000 },
      { location_id: 2666, level_index: 2, role: 'reserve', capacity_slots: 24, slot_kind: null, weight_capacity_kg: 1000 },
    ])
  })

  it('carries an inspector edit (role changed, weight cleared) onto the wire', () => {
    const edited = {
      ...saved,
      levels: [
        { ...saved.levels![0], role: 'bulk', weightCapacityKg: undefined },
        saved.levels![1],
      ],
    }

    const { placements } = buildSaveGeometryPayload([edited], [], CTX)

    expect(placements[0].levels?.[0]).toMatchObject({
      location_id: 2665, role: 'bulk', weight_capacity_kg: null,
    })
  })

  it('omits location_id for a level the operator just added to a saved rack', () => {
    const grown = {
      ...saved,
      levels: [...saved.levels!, { levelIndex: 3, role: 'bulk', capacitySlots: 24 }],
    }

    const { placements } = buildSaveGeometryPayload([grown], [], CTX)

    expect(placements[0].levels).toHaveLength(3)
    expect(placements[0].levels?.[2].location_id).toBeUndefined()
    expect(placements[0].levels?.[2].level_index).toBe(3)
  })

  it('leaves a saved FLAT bin as location_id + its form, no levels', () => {
    const { placements } = buildSaveGeometryPayload([placement({ locationId: 900 })], [], CTX)

    expect(placements[0]).toEqual({
      client_ref: 'p1', location_id: 900, new_bin: undefined, storage_type_id: null,
      floor: 0, x: 3, y: 4, w: 1, h: 1, rotation: 0,
    })
  })

  it('re-sends storage_type_id for a saved bin, flat and levelled', () => {
    // The form used to travel only inside `new_bin`, so repainting an
    // already-saved cell with a different storage form was silently dropped: the
    // designer showed the new colour from editor state, the save discarded it,
    // and the Warehouse tab kept the old one forever.
    const flat = buildSaveGeometryPayload([placement({ locationId: 900, storageTypeId: 4 })], [], CTX)
    expect(flat.placements[0].storage_type_id).toBe(4)

    const levelled = buildSaveGeometryPayload([{ ...saved, storageTypeId: 12 }], [], CTX)
    expect(levelled.placements[0].storage_type_id).toBe(12)
    // …without disturbing the levels, which the same branch is responsible for.
    expect(levelled.placements[0].levels).toHaveLength(2)
  })

  it('omits storage_type_id on a NEW bin, which carries its form inside new_bin', () => {
    // Sending both would be two sources of truth for one column; the server keys
    // "leave it alone" on `undefined`, so a new bin must not spell it as null.
    const { placements } = buildSaveGeometryPayload([placement({ storageTypeId: 4 })], [], CTX)

    expect(placements[0].storage_type_id).toBeUndefined()
    expect(placements[0].new_bin?.storage_type_id).toBe(4)
  })

  it('does not send levels for a saved rack whose levels array is empty', () => {
    const { placements } = buildSaveGeometryPayload([placement({ locationId: 900, levels: [] })], [], CTX)

    expect(placements[0].levels).toBeUndefined()
    expect(placements[0].location_id).toBe(900)
  })
})

describe('buildSaveGeometryPayload — objects', () => {
  function object(over: Partial<EditorObject> = {}): EditorObject {
    return { clientRef: 'o1', objectType: 'wall', floor: 0, x: 1, y: 1, w: 1, h: 1, ...over } as EditorObject
  }

  it('asks the server to create a STAGING location for an unlinked staging object', () => {
    const { objects } = buildSaveGeometryPayload([], [object({ objectType: 'staging', meta: { name: 'S&R' } })], CTX)

    expect(objects[0].new_staging).toEqual({ code: 'NEXG-STG-L78', name: 'S&R' })
  })

  it('sends no new_staging once the staging object is linked', () => {
    const { objects } = buildSaveGeometryPayload(
      [], [object({ objectType: 'staging', stagingLocationId: 4242 })], CTX,
    )

    expect(objects[0].new_staging).toBeUndefined()
    expect(objects[0].staging_location_id).toBe(4242)
  })

  it('passes a wall through untouched', () => {
    const { objects } = buildSaveGeometryPayload([], [object({ x: 5, y: 6 })], CTX)

    expect(objects[0]).toEqual({
      object_type: 'wall', floor: 0, x: 5, y: 6, w: 1, h: 1,
      meta: undefined, staging_location_id: undefined, new_staging: undefined,
    })
  })
})

// ── Name provenance (mig 00094) ──────────────────────────────────────────────

describe('buildSaveGeometryPayload — name provenance', () => {
  it('sends the three provenance fields on a new bin', () => {
    const { placements } = buildSaveGeometryPayload(
      [placement({ name: 'Chiller · Rack 7', nameSeq: 7, nameArea: 'Chiller', nameIsAuto: true })],
      [], CTX,
    )

    expect(placements[0].new_bin).toMatchObject({
      name: 'Chiller · Rack 7', name_seq: 7, name_area: 'Chiller', name_is_auto: true,
    })
  })

  it('spells "never numbered" as null, not undefined', () => {
    // `.optional()` in zod accepts undefined and REJECTS null; these columns are
    // nullable so the server declares them `.nullish()`. Sending undefined for a
    // field the server expects to be able to read as null is the same class of
    // bug that made every Shelving rack save fail with "Invalid request body".
    const { placements } = buildSaveGeometryPayload([placement()], [], CTX)

    expect(placements[0].new_bin!.name_seq).toBeNull()
    expect(placements[0].new_bin!.name_area).toBeNull()
    expect('name_seq' in placements[0].new_bin!).toBe(true)
  })

  it('marks a hand-named bin as custom so the server stores it verbatim', () => {
    const { placements } = buildSaveGeometryPayload(
      [placement({ name: 'Damaged goods bay', nameIsAuto: false })], [], CTX,
    )

    expect(placements[0].new_bin!.name_is_auto).toBe(false)
    expect(placements[0].new_bin!.name).toBe('Damaged goods bay')
  })

  it('sends no name at all for an already-saved bin', () => {
    // save_geometry has never updated an existing bin's name implicitly and must
    // not start: the cascade is explicit, via area_renames.
    const { placements } = buildSaveGeometryPayload(
      [placement({ locationId: 900, name: 'Chiller · Rack 7' })], [], CTX,
    )

    expect(placements[0].new_bin).toBeUndefined()
    expect('name' in placements[0]).toBe(false)
  })

  it('carries area renames alongside the geometry', () => {
    // Load-bearing: a full replace cannot distinguish "renamed Chiller" from
    // "erased Chiller, painted Cold Room" — the payloads are byte-identical.
    const { area_renames } = buildSaveGeometryPayload(
      [], [], CTX, [{ from: 'Chiller', to: 'Cold Room' }],
    )

    expect(area_renames).toEqual([{ from: 'Chiller', to: 'Cold Room' }])
  })

  it('defaults to an empty rename list', () => {
    expect(buildSaveGeometryPayload([], [], CTX).area_renames).toEqual([])
  })
})
