// Floor-plan extraction contract + normaliser. Pure (no supabase / no Deno APIs)
// so it can be unit-tested. The Edge Function feeds an uploaded image to OpenAI
// vision with FLOORPLAN_SCHEMA (strict JSON), then runs normalizeFloorplan() to
// turn the raw model output into a draft the existing mutate-layout save_geometry
// path accepts — clamped to the grid, de-duped, with racks mapped onto zone
// profiles + storage types.

// ── Raw model output ────────────────────────────────────────────────────────

export type FloorplanObjectType = 'wall' | 'dock' | 'walkway' | 'lift'

export interface FloorplanObject {
  type: FloorplanObjectType
  x: number
  y: number
  w: number
  h: number
  floor: number
}

export interface FloorplanZone {
  code: string
  name: string
  x: number
  y: number
  w: number
  h: number
  floor: number
  zoneType: string
}

export interface FloorplanRack {
  code: string
  x: number
  y: number
  floor: number
  storageTypeHint: string
}

export interface FloorplanExtraction {
  gridWidth: number
  gridHeight: number
  floors: number
  objects: FloorplanObject[]
  zones: FloorplanZone[]
  racks: FloorplanRack[]
  confidence: number
  notes: string
}

// ── JSON schema for OpenAI structured output (strict) ───────────────────────
// Strict mode requires every property listed in `required` and
// additionalProperties:false on every object.

export const FLOORPLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gridWidth', 'gridHeight', 'floors', 'objects', 'zones', 'racks', 'confidence', 'notes'],
  properties: {
    gridWidth: { type: 'integer', description: 'Grid columns (10–60).' },
    gridHeight: { type: 'integer', description: 'Grid rows (10–40).' },
    floors: { type: 'integer', description: 'Number of floors/levels (1–10).' },
    objects: {
      type: 'array',
      description: 'Structural cells: walls, docks, walkways, lifts.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'x', 'y', 'w', 'h', 'floor'],
        properties: {
          type: { type: 'string', enum: ['wall', 'dock', 'walkway', 'lift'] },
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          floor: { type: 'integer' },
        },
      },
    },
    zones: {
      type: 'array',
      description: 'Named regions (e.g. Receiving, Cold, Bulk). Rectangular.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'name', 'x', 'y', 'w', 'h', 'floor', 'zoneType'],
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          floor: { type: 'integer' },
          zoneType: {
            type: 'string',
            description: 'One of: fast_moving, slow_moving, hazardous, cold, bulk, returns, quarantine, overflow, or "" if unknown.',
          },
        },
      },
    },
    racks: {
      type: 'array',
      description: 'Individual storage racks/bays, one grid cell each.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'x', 'y', 'floor', 'storageTypeHint'],
        properties: {
          code: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          floor: { type: 'integer' },
          storageTypeHint: { type: 'string', description: 'e.g. "pallet rack", "shelving", "cold", or "" if unknown.' },
        },
      },
    },
    confidence: { type: 'number', description: '0–1 self-rated extraction confidence.' },
    notes: { type: 'string', description: 'Short caveats about anything ambiguous.' },
  },
} as const

export const FLOORPLAN_SYSTEM_PROMPT = `You convert a photo or scan of a warehouse floor plan into a structured grid layout.

Read the plan and return a coordinate grid where (0,0) is the top-left. Choose gridWidth (10–60) and gridHeight (10–40) that roughly preserve the plan's proportions. Use integer cell coordinates.

- objects: the fixed structure. Trace outer WALLS, the loading DOCK(s), main WALKWAY aisles, and any LIFT/elevator. Each object covers a rectangle of cells (w×h ≥ 1).
- zones: named regions like Receiving, Dispatch, Cold Store, Bulk, Hazardous. Give each a short code, a name, a rectangle, and a zoneType from: fast_moving, slow_moving, hazardous, cold, bulk, returns, quarantine, overflow (use "" if unclear).
- racks: individual storage racks/bays, ONE cell each. Place them where the plan shows racking. Give a short code and a storageTypeHint ("pallet rack", "shelving", "cold", or "").

Prefer completeness but do not invent detail that isn't visible. Set confidence honestly (lower if the image is blurry or partial). Keep everything inside the grid bounds.`

// ── Normalised draft (matches mutate-layout save_geometry) ──────────────────

export interface NormalizedNewBin {
  parent_id: number
  kind: 'BIN'
  code: string
  name: string
  zone_profile_id?: number
  storage_type_id?: number
}

export interface NormalizedPlacement {
  client_ref: string
  new_bin: NormalizedNewBin
  floor: number
  x: number
  y: number
  w: number
  h: number
  rotation: 0
}

export interface NormalizedObject {
  object_type: 'wall' | 'dock' | 'walkway' | 'lift' | 'label'
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta?: Record<string, unknown>
}

export interface NormalizedDraft {
  gridWidth: number
  gridHeight: number
  floors: number
  placements: NormalizedPlacement[]
  objects: NormalizedObject[]
  rackCount: number
  objectCount: number
  zoneCount: number
}

export interface NormalizeOptions {
  warehouseId: number
  warehouseCode: string
  /** zone_type (lowercased) → zone_profiles.id */
  zoneProfileByType?: Record<string, number>
  /** matcher token (lowercased) → storage_types.id */
  storageTypeByToken?: Record<string, number>
  maxGridWidth?: number
  maxGridHeight?: number
  maxFloors?: number
}

const clampInt = (v: number, lo: number, hi: number): number => {
  const n = Math.round(Number.isFinite(v) ? v : lo)
  return Math.max(lo, Math.min(hi, n))
}

/** Does a storage-type hint match a catalogue token? Loose contains-match both ways. */
function matchStorageType(hint: string, byToken: Record<string, number>): number | undefined {
  const h = hint.trim().toLowerCase()
  if (!h) return undefined
  for (const token of Object.keys(byToken)) {
    if (h.includes(token) || token.includes(h)) return byToken[token]
  }
  return undefined
}

/**
 * Turn raw model output into a save_geometry-ready draft: clamp to the grid,
 * drop out-of-bounds/duplicate racks, map zones to `label` objects, and tag each
 * rack with its containing zone's profile + a storage type from its hint.
 */
export function normalizeFloorplan(raw: FloorplanExtraction, opts: NormalizeOptions): NormalizedDraft {
  const gw = clampInt(raw.gridWidth, 10, opts.maxGridWidth ?? 60)
  const gh = clampInt(raw.gridHeight, 10, opts.maxGridHeight ?? 40)
  const floors = clampInt(raw.floors, 1, opts.maxFloors ?? 10)
  const zoneByType = opts.zoneProfileByType ?? {}
  const stByToken = opts.storageTypeByToken ?? {}

  const inFloor = (f: number) => clampInt(f, 0, floors - 1)

  // Structural objects → clamped rects.
  const objects: NormalizedObject[] = []
  for (const o of raw.objects ?? []) {
    const x = clampInt(o.x, 0, gw - 1)
    const y = clampInt(o.y, 0, gh - 1)
    const w = clampInt(o.w, 1, gw - x)
    const h = clampInt(o.h, 1, gh - y)
    objects.push({ object_type: o.type, floor: inFloor(o.floor), x, y, w, h })
  }

  // Zones → visible label objects (non-blocking) + a lookup for rack tagging.
  const zoneRects: Array<{ x: number; y: number; w: number; h: number; floor: number; profileId?: number }> = []
  for (const z of raw.zones ?? []) {
    const x = clampInt(z.x, 0, gw - 1)
    const y = clampInt(z.y, 0, gh - 1)
    const w = clampInt(z.w, 1, gw - x)
    const h = clampInt(z.h, 1, gh - y)
    const floor = inFloor(z.floor)
    const profileId = zoneByType[(z.zoneType ?? '').trim().toLowerCase()]
    zoneRects.push({ x, y, w, h, floor, profileId })
    objects.push({
      object_type: 'label', floor, x, y, w, h,
      meta: { code: z.code, name: z.name, zoneType: z.zoneType },
    })
  }

  const zoneProfileAt = (x: number, y: number, floor: number): number | undefined => {
    for (const z of zoneRects) {
      if (z.floor === floor && x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z.profileId
    }
    return undefined
  }

  // Racks → placements, deduped per (floor,x,y), warehouse-prefixed codes.
  const placements: NormalizedPlacement[] = []
  const seen = new Set<string>()
  let seq = 1
  for (const r of raw.racks ?? []) {
    const x = clampInt(r.x, 0, gw - 1)
    const y = clampInt(r.y, 0, gh - 1)
    const floor = inFloor(r.floor)
    const key = `${floor}:${x}:${y}`
    if (seen.has(key)) continue
    seen.add(key)
    placements.push({
      client_ref: `fp${seq++}`,
      new_bin: {
        parent_id: opts.warehouseId,
        kind: 'BIN',
        code: `${opts.warehouseCode}-B-${x}-${y}${floor > 0 ? `-F${floor}` : ''}`,
        name: `Rack ${x},${y}`,
        zone_profile_id: zoneProfileAt(x, y, floor),
        storage_type_id: matchStorageType(r.storageTypeHint ?? '', stByToken),
      },
      floor, x, y, w: 1, h: 1, rotation: 0,
    })
  }

  return {
    gridWidth: gw,
    gridHeight: gh,
    floors,
    placements,
    objects,
    rackCount: placements.length,
    objectCount: objects.filter((o) => o.object_type !== 'label').length,
    zoneCount: zoneRects.length,
  }
}
