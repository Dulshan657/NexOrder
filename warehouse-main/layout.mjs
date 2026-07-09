// Floor-plan generator for the MAIN warehouse. Pure — no I/O, no Supabase — so
// the geometry can be unit-tested and fed straight to `mutate-layout`
// (save_geometry) without a round trip.
//
// The building is a 60x40 grid at 1 m/cell, one floor. The whole interior is
// painted as a single walkway rectangle; walls and rack footprints subtract from
// it (see _shared/wie/publishReadiness.ts buildWalkableCells), which is what
// guarantees every open cell is connected and every bay is reachable from a dock.

export const GRID = { width: 60, height: 40, cellSize: 1, floorCount: 1 }

const FLOOR = 0

/** Rack bays are 2 cells wide, 1 deep. Two blocks split by a central N-S aisle. */
export const BAY_W = 2
const LEFT_BAY_XS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26]
const RIGHT_BAY_XS = [31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55]

/** Cold-room bays only span the left wall to the room's dividing wall at x=14. */
const COLD_BAY_XS = [2, 4, 6, 8, 10, 12]

/** Rack rows, grouped into back-to-back pairs with a pick aisle between.
 *
 *  Total bays must stay <= CANDIDATE_LIMIT: putawayTasks.ts asks
 *  wie_putaway_candidates for only the 200 nearest bins. Overshoot and the
 *  farthest bays never become candidates — and the farthest bays are the cold
 *  room, the only legal home for Plant-Based under the cold-chain rule. Overflow
 *  is therefore a single rack row, with y=21 left as a marshalling lane. */
export const CANDIDATE_LIMIT = 200
const FAST_ROWS = [6, 7, 9, 10]
const SLOW_ROWS = [13, 14]
const OVERFLOW_ROWS = [20]
const COLD_ROWS = [29, 30]

/** Bulk floor blocks: 4x2 footprints in the left half, mid-depth. */
const BULK_BLOCK_XS = [2, 8, 14, 20]
const BULK_BLOCK_YS = [20, 23]
const BULK_BLOCK = { w: 4, h: 2 }

const DOCK_IN = { x: 5, w: 6 }
const DOCK_OUT = { x: 48, w: 6 }

/** Cold room: walled off along y=26 and x=14, with a two-cell doorway. */
const COLD_DOOR_X = [7, 8]

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * Build the full MAIN geometry.
 *
 * @param {object} cfg
 * @param {number} cfg.warehouseId          `locations.id` of the MAIN warehouse (bin parent fallback).
 * @param {object} cfg.zoneProfiles         `{ fast, slow, bulk, overflow, cold }` -> zone_profiles.id
 * @param {object} cfg.storageTypes         `{ palletBay, shelfBay, coldBay, bulkFloor }` -> storage_types.id
 * @returns {{gridWidth:number, gridHeight:number, floors:number, cellSizeM:number,
 *           placements:Array, objects:Array}}
 */
export function buildMainLayout({ warehouseId, zoneProfiles, storageTypes }) {
  if (!warehouseId) throw new Error('buildMainLayout: warehouseId required')
  for (const k of ['fast', 'slow', 'bulk', 'overflow', 'cold']) {
    if (!zoneProfiles?.[k]) throw new Error(`buildMainLayout: zoneProfiles.${k} required`)
  }
  for (const k of ['palletBay', 'shelfBay', 'coldBay', 'bulkFloor']) {
    if (!storageTypes?.[k]) throw new Error(`buildMainLayout: storageTypes.${k} required`)
  }

  const placements = []
  const bin = (code, name, x, y, w, h, zoneProfileId, storageTypeId) => {
    placements.push({
      client_ref: code,
      new_bin: {
        parent_id: warehouseId,
        kind: 'BIN',
        code,
        name,
        zone_profile_id: zoneProfileId,
        storage_type_id: storageTypeId,
      },
      floor: FLOOR,
      x,
      y,
      w,
      h,
      rotation: 0,
    })
  }

  // ── Racked bays, block by block ────────────────────────────────────────────
  const rackRow = (rows, prefix, zoneProfileId, storageTypeId, sides) => {
    rows.forEach((y, rowIdx) => {
      const aisle = `${prefix}${pad2(rowIdx + 1)}`
      for (const [sideKey, xs, sideName] of sides) {
        xs.forEach((x, bayIdx) => {
          const bay = pad2(bayIdx + 1)
          bin(
            `MAIN-${aisle}-${sideKey}${bay}`,
            `${aisle} ${sideName} bay ${bay}`,
            x, y, BAY_W, 1,
            zoneProfileId, storageTypeId,
          )
        })
      }
    })
  }

  const bothSides = [['L', LEFT_BAY_XS, 'left'], ['R', RIGHT_BAY_XS, 'right']]

  rackRow(FAST_ROWS, 'F', zoneProfiles.fast, storageTypes.palletBay, bothSides)
  rackRow(SLOW_ROWS, 'S', zoneProfiles.slow, storageTypes.shelfBay, bothSides)
  rackRow(OVERFLOW_ROWS, 'O', zoneProfiles.overflow, storageTypes.palletBay, [['R', RIGHT_BAY_XS, 'right']])
  rackRow(COLD_ROWS, 'C', zoneProfiles.cold, storageTypes.coldBay, [['B', COLD_BAY_XS, 'bay']])

  let bulkIdx = 0
  for (const y of BULK_BLOCK_YS) {
    for (const x of BULK_BLOCK_XS) {
      bulkIdx += 1
      const code = `MAIN-BLK-${pad2(bulkIdx)}`
      bin(code, `Bulk floor block ${pad2(bulkIdx)}`, x, y, BULK_BLOCK.w, BULK_BLOCK.h,
        zoneProfiles.bulk, storageTypes.bulkFloor)
    }
  }

  // ── Objects ───────────────────────────────────────────────────────────────
  // Walkway first so it renders beneath everything; walls/footprints subtract
  // from it when the walk graph is built.
  const objects = [
    { object_type: 'walkway', floor: FLOOR, x: 1, y: 1, w: GRID.width - 2, h: GRID.height - 2 },

    { object_type: 'wall', floor: FLOOR, x: 0, y: 0, w: GRID.width, h: 1 },
    { object_type: 'wall', floor: FLOOR, x: 0, y: GRID.height - 1, w: GRID.width, h: 1 },
    { object_type: 'wall', floor: FLOOR, x: 0, y: 1, w: 1, h: GRID.height - 2 },
    { object_type: 'wall', floor: FLOOR, x: GRID.width - 1, y: 1, w: 1, h: GRID.height - 2 },

    // Cold-room enclosure: top run split by the doorway, plus a dividing wall.
    { object_type: 'wall', floor: FLOOR, x: 1, y: 26, w: COLD_DOOR_X[0] - 1, h: 1 },
    { object_type: 'wall', floor: FLOOR, x: COLD_DOOR_X[1] + 1, y: 26, w: 14 - COLD_DOOR_X[1], h: 1 },
    { object_type: 'wall', floor: FLOOR, x: 14, y: 27, w: 1, h: GRID.height - 1 - 27 },

    { object_type: 'dock', floor: FLOOR, x: DOCK_IN.x, y: 1, w: DOCK_IN.w, h: 1, meta: { name: 'Inbound dock' } },
    { object_type: 'dock', floor: FLOOR, x: DOCK_OUT.x, y: 1, w: DOCK_OUT.w, h: 1, meta: { name: 'Outbound dock' } },

    // Labels are non-blocking floor markings (buildWalkableCells ignores them).
    { object_type: 'label', floor: FLOOR, x: 3, y: 3, w: 10, h: 1, meta: { name: 'Inbound staging' } },
    { object_type: 'label', floor: FLOOR, x: 46, y: 3, w: 10, h: 1, meta: { name: 'Outbound staging' } },
    { object_type: 'label', floor: FLOOR, x: 2, y: 27, w: 6, h: 1, meta: { name: 'Cold room' } },
    { object_type: 'label', floor: FLOOR, x: 40, y: 28, w: 8, h: 1, meta: { name: 'Returns' } },
    { object_type: 'label', floor: FLOOR, x: 50, y: 28, w: 8, h: 1, meta: { name: 'Quarantine' } },
  ]

  return {
    gridWidth: GRID.width,
    gridHeight: GRID.height,
    floors: GRID.floorCount,
    cellSizeM: GRID.cellSize,
    placements,
    objects,
  }
}

/** Expand a rect into `floor:x:y` keys — used by the overlap assertions. */
export function cellsOf({ floor = 0, x, y, w, h }) {
  const out = []
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push(`${floor}:${x + dx}:${y + dy}`)
  return out
}
