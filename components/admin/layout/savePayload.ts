// Pure translation from editor state -> the `save_geometry` wire payload.
//
// Extracted from LayoutDesignerView's persistGeometry for one reason: this is
// the contract with mutate-layout, and it was untested. A `null` this file
// emitted for a field the server declared `.optional()` (which in zod accepts
// undefined and REJECTS null) made every save of a Shelving or Cold Room rack
// fail with a bare "Invalid request body", and nothing in the type system or the
// test suite could see it — `strict` is off, so `number | null` assigns happily
// to `capacity_slots?: number`. A pure builder can be asserted against directly;
// see __tests__/layoutSavePayload.test.ts.
//
// No React, no I/O, no mutation — the same shape as this feature's other pure
// modules (resolveOverlaps.ts, objectRegions.ts).

import type { NewBinLevelInput, SaveObjectInput, SavePlacementInput } from '@/services/supabase/layoutService'
import type { RackLevel } from '@/types'
import type { EditorObject, EditorPlacement } from './useLayoutEditorState'

export interface SavePayloadContext {
  /** The warehouse every new bin is parented under. */
  warehouseId: number
  /** Used to derive the staging location's code. */
  warehouseCode: string
  /** Used to derive the staging location's code (one per layout). */
  layoutId: number
}

export interface SaveGeometryPayload {
  placements: SavePlacementInput[]
  objects: SaveObjectInput[]
  /**
   * Area renames since the last save (mig 00094).
   *
   * Load-bearing, not a convenience: `save_geometry` is a full replace, so
   * "renamed Chiller to Cold Room" and "erased Chiller, painted Cold Room" send
   * byte-identical geometry. The server cannot infer which one happened and so
   * cannot know whether the bins inside should follow.
   */
  area_renames: Array<{ from: string; to: string }>
}

/** '' is how the editor represents "no stored role" (see the reducer's `load` —
 *  defaulting to 'pick' would silently claim a Pick Zone that drives
 *  replenishment and allocation). It is NOT a role, so it goes over the wire as
 *  null, which is what locations.level_role and assertValidRoles both accept. */
function roleForWire(role: string | undefined): string | null {
  return role && role.trim().length > 0 ? role : null
}

function levelForWire(level: RackLevel): NewBinLevelInput {
  return {
    level_index: level.levelIndex,
    role: roleForWire(level.role),
    // null, not undefined: these columns are nullable and null is the honest
    // wire value for "no limit" — a Shelving level genuinely has no weight cap.
    // The server accepts it (`.nullish()`), and folds null into the storage
    // form's default exactly as it folds an omitted field.
    capacity_slots: level.capacitySlots ?? null,
    slot_kind: level.slotKind ?? null,
    weight_capacity_kg: level.weightCapacityKg ?? null,
  }
}

function placementForWire(p: EditorPlacement, ctx: SavePayloadContext): SavePlacementInput {
  const hasLevels = !!p.levels && p.levels.length > 0

  // An ALREADY-SAVED rack. Its `locationId` is the RACK PARENT (the parent holds
  // no placement row; its SHELF children do), so sending the parent alone told
  // save_geometry — a full replace — that this cell is one flat location. It
  // wrote a placement row on the parent and garbage-collected every level.
  // Re-sending the levels, each with the location id we already know, is what
  // keeps them alive AND makes an inspector edit to a saved rack's level
  // actually persist instead of reverting on the next reload.
  if (p.locationId && hasLevels) {
    return {
      client_ref: p.clientRef,
      location_id: p.locationId,
      levels: p.levels!.map((l) => ({
        // Absent on a level the operator just ADDED to a saved rack; the server
        // creates that one under the existing rack.
        location_id: l.locationId,
        ...levelForWire(l),
      })),
      storage_type_id: p.storageTypeId ?? null,
      floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
    }
  }

  return {
    client_ref: p.clientRef,
    location_id: p.locationId,
    // Only meaningful for a SAVED bin — a new one carries its form inside
    // new_bin below, and the server ignores this alongside it. Sending `?? null`
    // (rather than omitting) is what makes clearing a form persist; it is safe
    // because the reducer's `load` hydrates storageTypeId from the database for
    // both flat bins and RACK parents (see codeByLocation in LayoutDesignerView),
    // so an untouched bin re-sends the value it already had.
    storage_type_id: p.locationId ? p.storageTypeId ?? null : undefined,
    // A rack with a level layout persists as a RACK PARENT + one SHELF child per
    // level (mig 00072); the server rejects `levels` unless kind is RACK. A flat
    // bin (no levels) keeps its own kind untouched.
    new_bin: p.locationId ? undefined : {
      parent_id: ctx.warehouseId, kind: hasLevels ? 'RACK' : p.kind, code: p.code, name: p.name,
      capacity_slots: p.capacitySlots, slot_kind: p.slotKind, weight_capacity_kg: p.weightCapacityKg,
      zone_profile_id: p.zoneProfileId, storage_type_id: p.storageTypeId,
      levels: hasLevels ? p.levels!.map(levelForWire) : undefined,
      // Name provenance (mig 00094). `?? null`, never omitted: the server
      // declares these `.nullish()` because the columns are nullable, and null
      // is the honest wire value for "never numbered". The server recomputes
      // anyway — this is what it recomputes FROM for a bin it has not seen.
      name_seq: p.nameSeq ?? null,
      name_area: p.nameArea ?? null,
      name_is_auto: p.nameIsAuto !== false,
    },
    floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
  }
}

function objectForWire(o: EditorObject, ctx: SavePayloadContext): SaveObjectInput {
  return {
    object_type: o.objectType, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
    meta: o.meta, staging_location_id: o.stagingLocationId,
    // A hand-drawn "Staging floor" object has no stagingLocationId until the
    // server find-or-creates one — mirrors FloorPlanImportModal.createDraft's
    // new_staging wiring. Every unlinked staging object shares the SAME code
    // (single-S&R assumption: the server dedupes by code and adopts on re-save,
    // so a second save re-sending new_staging for an already-linked object is
    // harmless).
    new_staging: o.objectType === 'staging' && !o.stagingLocationId
      ? { code: `${ctx.warehouseCode}-STG-L${ctx.layoutId}`, name: (o.meta?.name as string) || 'Staging' }
      : undefined,
  }
}

export function buildSaveGeometryPayload(
  placements: EditorPlacement[],
  objects: EditorObject[],
  ctx: SavePayloadContext,
  areaRenames: ReadonlyArray<{ from: string; to: string }> = [],
): SaveGeometryPayload {
  return {
    placements: placements.map((p) => placementForWire(p, ctx)),
    objects: objects.map((o) => objectForWire(o, ctx)),
    area_renames: areaRenames.map((r) => ({ from: r.from, to: r.to })),
  }
}
