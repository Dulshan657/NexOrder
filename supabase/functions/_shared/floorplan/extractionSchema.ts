// Floor-plan extraction contract + normaliser. Pure (no supabase / no Deno APIs)
// so it can be unit-tested. The Edge Function feeds an uploaded image to OpenAI
// vision with FLOORPLAN_SCHEMA (strict JSON), then runs normalizeFloorplan() to
// turn the raw model output into a draft the existing mutate-layout save_geometry
// path accepts — clamped to the grid, de-duped, with rack rows distributed into
// bays mapped onto zone profiles + storage types.

// ── Grid bounds ──────────────────────────────────────────────────────────────
// 120×80 (was 60×40) — raised alongside the mandatory canvas perf rewrite
// (per-cell interaction layer → single transparent rect + pointer math) that a
// grid this size requires in the designer.

export const MAX_GRID_WIDTH = 120
export const MAX_GRID_HEIGHT = 80

// ── Raw model output ────────────────────────────────────────────────────────

export type FloorplanObjectType = 'wall' | 'dock' | 'walkway' | 'lift' | 'conveyor' | 'staging' | 'obstacle'

export interface FloorplanObject {
  type: FloorplanObjectType
  /** Short label, e.g. "Office block", "Shipping & Receiving", "Dock apron".
   *  '' when the object doesn't warrant a name (most walls/walkways/docks). */
  name: string
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

/** A rack line/aisle — a run of bays along its long axis, not one cell each.
 *  Replaces the old per-cell `racks` extraction (kept below for back-compat). */
export interface FloorplanRackRow {
  code: string
  x: number
  y: number
  w: number
  h: number
  floor: number
  /** Estimated bay count along the row's long axis. 0 = unknown (the
   *  normalizer falls back to one bay per cell of the long axis). */
  bayCount: number
  storageTypeHint: string
}

/** A cross-hatched/gridded floor-storage block for palletized goods — never
 *  also emitted as a rackRow. */
export interface FloorplanPalletArea {
  code: string
  x: number
  y: number
  w: number
  h: number
  floor: number
}

/** Legacy per-cell rack extraction. No longer part of FLOORPLAN_SCHEMA (the
 *  model always emits `rackRows` now), but kept as an optional field so the
 *  normalizer can still process a stored/replayed extraction that predates
 *  the rackRows schema. */
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
  rackRows: FloorplanRackRow[]
  palletAreas: FloorplanPalletArea[]
  /** Legacy back-compat only — never populated by the current schema/prompts. */
  racks?: FloorplanRack[]
  confidence: number
  notes: string
}

// ── JSON schema for OpenAI structured output (strict) ───────────────────────
// Strict mode requires every property listed in `required` and
// additionalProperties:false on every object.

export const FLOORPLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gridWidth', 'gridHeight', 'floors', 'objects', 'zones', 'rackRows', 'palletAreas', 'confidence', 'notes'],
  properties: {
    gridWidth: { type: 'integer', description: `Grid columns (10–${MAX_GRID_WIDTH}). Prefer a larger, finer grid — aim for ~1 cell ≈ 1 metre.` },
    gridHeight: { type: 'integer', description: `Grid rows (10–${MAX_GRID_HEIGHT}). Prefer a larger, finer grid — aim for ~1 cell ≈ 1 metre.` },
    floors: { type: 'integer', description: 'Number of floors/levels (1–10).' },
    objects: {
      type: 'array',
      description: 'Structural cells: walls, docks, walkways, lifts, conveyors, staging floor, obstacles.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'name', 'x', 'y', 'w', 'h', 'floor'],
        properties: {
          type: { type: 'string', enum: ['wall', 'dock', 'walkway', 'lift', 'conveyor', 'staging', 'obstacle'] },
          name: {
            type: 'string',
            description: 'Short label such as "Office block", "Shipping & Receiving", or "Dock apron". "" if not applicable.',
          },
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
    rackRows: {
      type: 'array',
      description: 'Rack lines/aisles as rectangular rows — one row per run of racking, not one cell each.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'x', 'y', 'w', 'h', 'floor', 'bayCount', 'storageTypeHint'],
        properties: {
          code: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          floor: { type: 'integer' },
          bayCount: {
            type: 'integer',
            description: "Estimated bay count along the row's long axis. 0 if you can't tell (the importer will assume one bay per cell).",
          },
          storageTypeHint: { type: 'string', description: 'e.g. "pallet rack", "shelving", "cold", or "" if unknown.' },
        },
      },
    },
    palletAreas: {
      type: 'array',
      description: 'Cross-hatched/gridded floor blocks used for palletized floor storage (never also a rackRow).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'x', 'y', 'w', 'h', 'floor'],
        properties: {
          code: { type: 'string' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          w: { type: 'integer' },
          h: { type: 'integer' },
          floor: { type: 'integer' },
        },
      },
    },
    confidence: { type: 'number', description: '0–1 self-rated extraction confidence.' },
    notes: { type: 'string', description: 'Short caveats about anything ambiguous.' },
  },
} as const

/** Aspect-fit grid dims computed client-side from the source image (see
 *  `lib/floorplanGridOverlay.ts` `computeGridDims`) and pinned into the
 *  prompt so the model's coordinate space matches the image instead of being
 *  freely (and inconsistently) chosen per pass. */
export interface PinnedGridDims {
  width: number
  height: number
}

/** Every pass — pinned or not — gets this: the uploaded image carries a
 *  labeled coordinate-grid overlay (drawn client-side; see
 *  `lib/floorplanGridOverlay.ts` `drawGridOverlay`) so the model can read
 *  positions off the labels instead of estimating proportions by eye. */
const GRID_OVERLAY_SENTENCE = `The image has a RED coordinate grid overlay drawn on it: thin lines every 5 cells, heavier lines every 10 cells, with cell-coordinate labels along all four edges. Read every rectangle's x/y/w/h directly off these labels — do not estimate proportions by eye.`

function gridDimsSentence(pinned?: PinnedGridDims): string {
  if (pinned) {
    return `The grid is EXACTLY ${pinned.width} columns x ${pinned.height} rows — echo gridWidth=${pinned.width}, gridHeight=${pinned.height} and place all coordinates within it. It matches the image's aspect ratio.`
  }
  return `Choose gridWidth (10–${MAX_GRID_WIDTH}) and gridHeight (10–${MAX_GRID_HEIGHT}) that roughly preserve the plan's proportions — prefer a larger, finer grid over a coarse one (aim for ~1 cell ≈ 1 metre) so rack rows and pallet blocks aren't lost to rounding. Use integer cell coordinates.`
}

/** Builds the single-pass / pass-1 system prompt. Pass `pinned` (the
 *  client-computed aspect-fit grid) to lock gridWidth/gridHeight instead of
 *  letting the model choose freely; omit for old-client / free-choice
 *  compat — `FLOORPLAN_SYSTEM_PROMPT` below is exactly `buildFloorplanSystemPrompt()`. */
export function buildFloorplanSystemPrompt(pinned?: PinnedGridDims): string {
  return `You convert a photo or scan of a warehouse floor plan into a structured grid layout.

Read the plan and return a coordinate grid where (0,0) is the top-left. ${gridDimsSentence(pinned)} ${GRID_OVERLAY_SENTENCE}

- objects: the fixed structure, each a rectangle of cells (w×h ≥ 1). Give every object a "name" when it identifies something specific; use "" otherwise.
  - Trace outer WALLS, the loading DOCK(s), main WALKWAY aisles, and any LIFT/elevator.
  - CONVEYOR: trace snake/belt conveyors as one or more joined rectangles following the belt's path. Conveyors block walking — never route a walkway across one.
  - STAGING: the Shipping & Receiving floor area (where inbound pallets stage before putaway) is ONE walkable object named "Shipping & Receiving". It is not storage and not a wall.
  - OBSTACLE: office/lounge/restroom/amenity areas are ONE obstacle named "Office block" — never partition them into per-room rectangles (no Janitorial/Men's/Women's/Foyer breakdown). Also include the exterior truck dock-apron strip as an obstacle named "Dock apron" (the paved area trucks reverse into, immediately outside the dock doors). Do NOT extract car parking or anything else outside the building/apron.
- zones: named regions like Receiving, Dispatch, Cold Store, Bulk, Hazardous. Give each a short code, a name, a rectangle, and a zoneType from: fast_moving, slow_moving, hazardous, cold, bulk, returns, quarantine, overflow (use "" if unclear).
- rackRows: storage racking as ROWS, not individual cells — one rackRow per line/run of racking (a straight aisle of bays). Give each a code, its rectangle (the long axis is the row's length), a bayCount estimate (bays along that long axis; use 0 if you can't tell), and a storageTypeHint ("pallet rack", "shelving", "cold", or "").
- palletAreas: cross-hatched or gridded floor blocks used for palletized floor storage (not racked) — give each a code and rectangle. A block is EITHER a rackRow OR a palletArea, never both.
- Never extract movable objects: trucks, cars, forklifts, people, loose pallets, dollies. They aren't part of the fixed layout.

Prefer completeness but do not invent detail that isn't visible. Set confidence honestly (lower if the image is blurry or partial). Keep everything inside the grid bounds.`
}

/** Unpinned variant — back-compat for callers/tests referencing the old
 *  constant name directly, and for old-client requests with no computed grid. */
export const FLOORPLAN_SYSTEM_PROMPT = buildFloorplanSystemPrompt()

// ── Multi-pass (high fidelity) prompts ──────────────────────────────────────
// Pass 1 locks the fixed structure (grid/objects/zones); pass 2 is given the
// pinned dimensions and focuses purely on rack rows / pallet areas. See
// _shared/floorplan/multiPass.ts for how the two responses are merged.

export function buildFloorplanStructurePrompt(pinned?: PinnedGridDims): string {
  return `${buildFloorplanSystemPrompt(pinned)}

This is PASS 1 of a two-pass extraction. Focus entirely on gridWidth, gridHeight, floors, objects, and zones — get the fixed structure right. Return rackRows and palletAreas as EMPTY arrays; a second pass will fill them in against your grid dimensions, which are final once you set them here.`
}

export const FLOORPLAN_STRUCTURE_PROMPT = buildFloorplanStructurePrompt()

/** Pass 2: dimensions are already fixed by pass 1 — extract only rackRows and
 *  palletAreas against them. Always pinned (pass 2 must match pass 1's
 *  final grid, chosen or echoed). */
export function floorplanDetailPrompt(gridWidth: number, gridHeight: number): string {
  return `${buildFloorplanSystemPrompt({ width: gridWidth, height: gridHeight })}

This is PASS 2 of a two-pass extraction. The grid is already fixed at gridWidth=${gridWidth}, gridHeight=${gridHeight} — echo these exact values back and do not change them. A summary of the fixed structure (walls, conveyors, and other cells that already exist) is included in the user message; do not place a rackRow or palletArea on top of those cells. Return objects and zones as EMPTY arrays (pass 1 already captured them) and focus only on rackRows and palletAreas.`
}

/** Reconcile ("render-and-correct") pass: the client renders the current
 *  draft back onto the same labeled grid and uploads it; this prompt shows
 *  the model both images side by side (source scan + rendered draft) plus
 *  the current extraction JSON, and asks for the FULL corrected extraction
 *  (not a diff — keeps the response_format contract identical to every other
 *  pass, and keeps the adopt/reject confidence guard in
 *  extract-floorplan/index.ts simple). Color legend values are hardcoded
 *  here deliberately — this module must stay pure/importable from Deno, so
 *  it cannot import `components/admin/layout/layoutPalette.ts`. */
export function floorplanReconcilePrompt(gridWidth: number, gridHeight: number): string {
  return `You are correcting a warehouse floor-plan extraction. IMAGE 1 is the source plan with the red labeled coordinate grid. IMAGE 2 is a rendering of the CURRENT extraction on the same grid (same coordinates, same labels). The current extraction JSON is included in the user message. Compare the two images: find rectangles that are misplaced, missing, wrongly sized, wrongly typed, or spurious, and return the FULL corrected extraction (same JSON schema, gridWidth=${gridWidth}, gridHeight=${gridHeight} unchanged). Move/resize elements so image 2 would match image 1. Do not invent structures not visible in image 1.

Object-type color legend for reading IMAGE 2: walkway = light blue (#bae6fd), wall = dark (#44403c), dock = amber (#fbbf24), obstacle = grey (#a8a29e), label = pale (#e7e5e4), lift = violet (#c4b5fd), conveyor = orange with hatching (#fdba74), staging = teal (#99f6e4), storage bins = green squares.

${GRID_OVERLAY_SENTENCE}`
}

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

export type NormalizedObjectType = 'wall' | 'dock' | 'walkway' | 'lift' | 'label' | 'conveyor' | 'staging' | 'obstacle'

export interface NormalizedObject {
  object_type: NormalizedObjectType
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta?: Record<string, unknown>
}

/** A pallet-storage floor block. Bins are pre-generated (one per free cell)
 *  but deliberately left OUT of `draft.placements` — the import modal decides
 *  per area whether to keep them (storable) or fold the area into a named
 *  obstacle (visual only) before anything is appended. `storage_type_id` is
 *  always left unset here; the modal backfills the operator's chosen form. */
export interface NormalizedPalletArea {
  code: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  placements: NormalizedPlacement[]
}

export interface NormalizedDraft {
  gridWidth: number
  gridHeight: number
  floors: number
  placements: NormalizedPlacement[]
  objects: NormalizedObject[]
  palletAreas: NormalizedPalletArea[]
  rackCount: number
  objectCount: number
  zoneCount: number
  palletAreaCount: number
}

export interface NormalizeOptions {
  warehouseId: number
  warehouseCode: string
  /** zone_type (lowercased) → zone_profiles.id */
  zoneProfileByType?: Record<string, number>
  /** matcher token (lowercased) → storage_types.id */
  storageTypeByToken?: Record<string, number>
  /**
   * Per-import discriminator (e.g. the floorplan_imports UUID) folded into rack
   * codes so an imported layout never collides with an existing warehouse's
   * `-B-x-y` locations (or a previous import). `locations.code` is globally
   * UNIQUE, so without this every import into a racked warehouse 23505s. Empty
   * → the legacy `${warehouseCode}-B-${x}-${y}` codes (back-compat).
   */
  codeSlug?: string
  maxGridWidth?: number
  maxGridHeight?: number
  maxFloors?: number
}

/** Sanitize a raw discriminator into a short alphanumeric code segment. */
function toCodeSlug(raw: string | undefined): string {
  return (raw ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
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

function cellKey(floor: number, x: number, y: number): string {
  return `${floor}:${x}:${y}`
}

// ── Overlap resolution ───────────────────────────────────────────────────────
// Objects arrive from the model with zero coordination between rectangles —
// overlapping walls/conveyors/docks near the same corner render stacked in
// the designer (the v2.1 "top-left mess" bug). Rasterize to cells in a fixed
// priority order and rebuild each object from its surviving cells so every
// cell has exactly one owner before bin placement (blockedCellKeys) ever runs.

// Exported so the interactive designer's "Clean up overlaps" repair
// (components/admin/layout/resolveOverlaps.ts) resolves a hand-drawn layout in
// exactly the same order this normalizer resolves an AI-imported one. Two
// different answers to "who owns this cell" would be worse than either.
export const OVERLAP_PRIORITY: Record<Exclude<NormalizedObjectType, 'label'>, number> = {
  dock: 0,
  lift: 1,
  wall: 2,
  conveyor: 3,
  staging: 4,
  obstacle: 5,
  walkway: 6,
}

interface OverlapRect {
  x: number
  y: number
  w: number
  h: number
}

/** Greedy rect decomposition of a cell set: merge contiguous x-runs per row
 *  into horizontal strips, then merge vertically-adjacent strips that share
 *  the same x/w into taller rects. Not minimal-rect-count optimal, but
 *  deterministic and cheap — good enough for de-overlap fragments. */
function decomposeCellsToRects(cells: ReadonlyArray<{ x: number; y: number }>): OverlapRect[] {
  const byRow = new Map<number, number[]>()
  for (const c of cells) {
    const xs = byRow.get(c.y) ?? []
    xs.push(c.x)
    byRow.set(c.y, xs)
  }

  const strips: OverlapRect[] = []
  for (const y of [...byRow.keys()].sort((a, b) => a - b)) {
    const xs = [...(byRow.get(y) ?? [])].sort((a, b) => a - b)
    let runStart = xs[0]
    let runEnd = xs[0]
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === runEnd + 1) {
        runEnd = xs[i]
      } else {
        strips.push({ x: runStart, y, w: runEnd - runStart + 1, h: 1 })
        runStart = xs[i]
        runEnd = xs[i]
      }
    }
    strips.push({ x: runStart, y, w: runEnd - runStart + 1, h: 1 })
  }

  const used = new Array(strips.length).fill(false)
  const merged: OverlapRect[] = []
  for (let i = 0; i < strips.length; i++) {
    if (used[i]) continue
    let cur = { ...strips[i] }
    used[i] = true
    let grew = true
    while (grew) {
      grew = false
      for (let j = 0; j < strips.length; j++) {
        if (used[j]) continue
        const s = strips[j]
        if (s.x === cur.x && s.w === cur.w && s.y === cur.y + cur.h) {
          cur = { ...cur, h: cur.h + s.h }
          used[j] = true
          grew = true
        }
      }
    }
    merged.push(cur)
  }
  return merged
}

/**
 * Resolve overlapping structural objects so every grid cell has exactly one
 * owner. Priority (highest wins): dock > lift > wall > conveyor > staging >
 * obstacle > walkway — dock beats wall so `autoConnectLayout`'s dock-over-wall
 * carve still has a dock to carve toward. `label` objects (zone annotations)
 * are exempt: passed through untouched and excluded from rasterization
 * entirely — they're a non-blocking overlay, not physical structure.
 *
 * Rebuild rule per object: all cells survive → kept as-is; no cells survive →
 * dropped; some cells survive → greedy rect-decomposed into 1+ fragments
 * (`decomposeCellsToRects`), with `meta` kept only on the largest fragment so
 * a name/label isn't duplicated across pieces. Ties in priority are broken by
 * earlier array index (first one wins the contested cells).
 */
export function resolveObjectOverlaps(objects: NormalizedObject[]): NormalizedObject[] {
  const priorityOf = (t: NormalizedObjectType): number =>
    t === 'label' ? Number.MAX_SAFE_INTEGER : OVERLAP_PRIORITY[t]

  const rasterIndices = objects
    .map((_, index) => index)
    .filter((index) => objects[index].object_type !== 'label')

  const ordered = [...rasterIndices].sort((a, b) => {
    const pa = priorityOf(objects[a].object_type)
    const pb = priorityOf(objects[b].object_type)
    return pa !== pb ? pa - pb : a - b
  })

  const cellOwner = new Map<string, number>()
  for (const index of ordered) {
    const o = objects[index]
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const key = cellKey(o.floor, o.x + dx, o.y + dy)
        if (!cellOwner.has(key)) cellOwner.set(key, index)
      }
    }
  }

  const fragmentsByIndex = new Map<number, NormalizedObject[]>()
  for (const index of rasterIndices) {
    const o = objects[index]
    const survivingCells: Array<{ x: number; y: number }> = []
    let totalCells = 0
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        totalCells++
        const key = cellKey(o.floor, o.x + dx, o.y + dy)
        if (cellOwner.get(key) === index) survivingCells.push({ x: o.x + dx, y: o.y + dy })
      }
    }
    if (survivingCells.length === 0) {
      fragmentsByIndex.set(index, [])
    } else if (survivingCells.length === totalCells) {
      fragmentsByIndex.set(index, [o])
    } else {
      const rects = decomposeCellsToRects(survivingCells)
      let largest = 0
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].w * rects[i].h > rects[largest].w * rects[largest].h) largest = i
      }
      fragmentsByIndex.set(
        index,
        rects.map((r, i) => ({
          object_type: o.object_type,
          floor: o.floor,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          ...(i === largest && o.meta ? { meta: o.meta } : {}),
        })),
      )
    }
  }

  const result: NormalizedObject[] = []
  objects.forEach((o, index) => {
    if (o.object_type === 'label') {
      result.push(o)
      return
    }
    result.push(...(fragmentsByIndex.get(index) ?? []))
  })
  return result
}

/**
 * Turn raw model output into a save_geometry-ready draft: clamp to the grid,
 * drop out-of-bounds/duplicate/blocked bins, map zones to `label` objects, and
 * tag each bin with its containing zone's profile + a storage type from its
 * hint.
 */
export function normalizeFloorplan(raw: FloorplanExtraction, opts: NormalizeOptions): NormalizedDraft {
  const gw = clampInt(raw.gridWidth, 10, opts.maxGridWidth ?? MAX_GRID_WIDTH)
  const gh = clampInt(raw.gridHeight, 10, opts.maxGridHeight ?? MAX_GRID_HEIGHT)
  const floors = clampInt(raw.floors, 1, opts.maxFloors ?? 10)
  const zoneByType = opts.zoneProfileByType ?? {}
  const stByToken = opts.storageTypeByToken ?? {}

  const inFloor = (f: number) => clampInt(f, 0, floors - 1)

  // Structural objects → clamped rects. obstacle/staging carry their name (if
  // any) into `meta.name` so the designer can render/edit a label on them.
  const objects: NormalizedObject[] = []
  for (const o of raw.objects ?? []) {
    const x = clampInt(o.x, 0, gw - 1)
    const y = clampInt(o.y, 0, gh - 1)
    const w = clampInt(o.w, 1, gw - x)
    const h = clampInt(o.h, 1, gh - y)
    const floor = inFloor(o.floor)
    const name = (o.name ?? '').trim()
    const meta = (o.type === 'obstacle' || o.type === 'staging') && name ? { name } : undefined
    objects.push({ object_type: o.type, floor, x, y, w, h, ...(meta ? { meta } : {}) })
  }

  // Zones → visible label objects (non-blocking) + a lookup for bay tagging.
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

  // De-overlap BEFORE blockedCellKeys is built, so bin placement (and
  // autoConnect, downstream in extract-floorplan) consumes the cleaned,
  // non-stacked set of structural rectangles.
  const resolvedObjects = resolveObjectOverlaps(objects)

  // Blocked cells: nothing storable may land on a wall, conveyor, or obstacle
  // footprint. This also resolves multi-pass conflicts (structure wins per
  // cell over whatever the detail pass guessed there).
  const blockedCellKeys = new Set<string>()
  for (const o of resolvedObjects) {
    if (o.object_type !== 'wall' && o.object_type !== 'conveyor' && o.object_type !== 'obstacle') continue
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) blockedCellKeys.add(cellKey(o.floor, o.x + dx, o.y + dy))
    }
  }

  // Bins → placements, deduped per (floor,x,y) across BOTH rackRows and the
  // legacy racks path, warehouse-prefixed codes. The per-import slug keeps
  // codes unique against existing/other-import bins (locations.code is
  // globally UNIQUE); empty slug preserves legacy codes.
  const slug = toCodeSlug(opts.codeSlug)
  const slugSeg = slug ? `${slug}-` : ''
  const placements: NormalizedPlacement[] = []
  const seen = new Set<string>()
  let seq = 1

  const makeBinCode = (x: number, y: number, floor: number, prefix: 'B' | 'P'): string =>
    `${opts.warehouseCode}-${prefix}-${slugSeg}${x}-${y}${floor > 0 ? `-F${floor}` : ''}`

  const pushBin = (
    x: number,
    y: number,
    floor: number,
    storageTypeHint: string,
    prefix: 'B' | 'P' = 'B',
  ): void => {
    placements.push({
      client_ref: `fp${seq++}`,
      new_bin: {
        parent_id: opts.warehouseId,
        kind: 'BIN',
        code: makeBinCode(x, y, floor, prefix),
        name: `Rack ${x},${y}`,
        zone_profile_id: zoneProfileAt(x, y, floor),
        storage_type_id: matchStorageType(storageTypeHint, stByToken),
      },
      floor, x, y, w: 1, h: 1, rotation: 0,
    })
  }

  // Rack rows → evenly-distributed 1×1 bays along the row's long axis. AI cell
  // counts are unreliable, so bays are spaced out rather than trusting exact
  // per-cell placement: bay i sits at round((i+0.5)*L/bays - 0.5) along the
  // long axis, with bayCount (if given) capped to the axis length.
  for (const r of raw.rackRows ?? []) {
    const x = clampInt(r.x, 0, gw - 1)
    const y = clampInt(r.y, 0, gh - 1)
    const w = clampInt(r.w, 1, gw - x)
    const h = clampInt(r.h, 1, gh - y)
    const floor = inFloor(r.floor)
    const horizontal = w >= h
    const length = horizontal ? w : h
    const bayCount = Number(r.bayCount) > 0 ? Math.min(Math.round(Number(r.bayCount)), length) : length
    if (bayCount <= 0) continue
    for (let i = 0; i < bayCount; i++) {
      const pos = Math.round(((i + 0.5) * length) / bayCount - 0.5)
      const bx = horizontal ? x + pos : x
      const by = horizontal ? y : y + pos
      const key = cellKey(floor, bx, by)
      if (seen.has(key) || blockedCellKeys.has(key)) continue
      seen.add(key)
      pushBin(bx, by, floor, r.storageTypeHint ?? '')
    }
  }

  // Legacy per-cell racks — shares the same seen-set/dedup so a stored
  // extraction from before the rackRows schema still normalizes correctly.
  for (const r of raw.racks ?? []) {
    const x = clampInt(r.x, 0, gw - 1)
    const y = clampInt(r.y, 0, gh - 1)
    const floor = inFloor(r.floor)
    const key = cellKey(floor, x, y)
    if (seen.has(key) || blockedCellKeys.has(key)) continue
    seen.add(key)
    pushBin(x, y, floor, r.storageTypeHint ?? '')
  }

  // Pallet areas → one NormalizedPalletArea per block, with 1×1 bins
  // pre-generated per free cell (skipping anything already seen/blocked).
  // These are intentionally NOT folded into `draft.placements` — the import
  // modal appends them only for areas the operator marks storable.
  const palletAreas: NormalizedPalletArea[] = []
  for (const a of raw.palletAreas ?? []) {
    const x = clampInt(a.x, 0, gw - 1)
    const y = clampInt(a.y, 0, gh - 1)
    const w = clampInt(a.w, 1, gw - x)
    const h = clampInt(a.h, 1, gh - y)
    const floor = inFloor(a.floor)
    const areaPlacements: NormalizedPlacement[] = []
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const bx = x + dx
        const by = y + dy
        const key = cellKey(floor, bx, by)
        if (seen.has(key) || blockedCellKeys.has(key)) continue
        seen.add(key)
        areaPlacements.push({
          client_ref: `fp${seq++}`,
          new_bin: {
            parent_id: opts.warehouseId,
            kind: 'BIN',
            code: makeBinCode(bx, by, floor, 'P'),
            name: `Pallet ${bx},${by}`,
            zone_profile_id: zoneProfileAt(bx, by, floor),
            // storage_type_id deliberately unset — the modal backfills the
            // operator's chosen storage form for storable areas.
          },
          floor, x: bx, y: by, w: 1, h: 1, rotation: 0,
        })
      }
    }
    palletAreas.push({ code: a.code, floor, x, y, w, h, placements: areaPlacements })
  }

  return {
    gridWidth: gw,
    gridHeight: gh,
    floors,
    placements,
    objects: resolvedObjects,
    palletAreas,
    rackCount: placements.length,
    objectCount: resolvedObjects.filter((o) => o.object_type !== 'label').length,
    zoneCount: zoneRects.length,
    palletAreaCount: palletAreas.length,
  }
}
