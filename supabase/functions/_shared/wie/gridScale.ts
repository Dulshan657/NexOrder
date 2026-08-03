// Warehouse Intelligence Engine — grid scale.
//
// `warehouse_layouts.cell_size_m` says how many real metres one grid cell spans.
// It has existed since mig 00045 and defaulted to 1.0 forever because nothing
// ever sent it, which made every distance the engine reports a cell count wearing
// a metre suffix. This module is what makes it settable: it owns the arithmetic
// that converts between a building's real dimensions, a drawing resolution, and
// the integer grid — and the rescale that keeps existing geometry the same real
// size when the resolution changes.
//
// Pure per the _shared/wie contract (no Deno globals / I/O), because BOTH
// runtimes run it: mutate-layout performs the rescale, and LayoutPropertiesModal
// previews it before the operator commits. They must agree cell for cell — a
// modal that promises "×2, nothing refused" and a server that then refuses is
// worse than having no preview at all. Never fork it.
//
// EXACT RATIONAL ARITHMETIC, NOT FLOATS. cell_size_m is NUMERIC(6,2), so every
// scale is an exact number of hundredths and the factor between two of them is an
// exact fraction. `0.1 + 0.2 !== 0.3` reasoning has no place in a function that
// decides whether a rack lands on a whole cell: at 1.0 -> 0.75 the factor is 4/3,
// and a 3-cell rack becoming exactly 4 cells is an integer fact, not an epsilon
// comparison. Everything below works in hundredths of a metre for that reason.

/** Largest grid dimension, in cells. Mirrors mutate-layout's zod cap — imported
 *  by it rather than restated, so the UI's refusal and the server's rejection
 *  can never disagree about where the ceiling is.
 *
 *  200 cells is a 100 m wall at 0.5 m/cell, and LayoutCanvas was perf-tuned for
 *  120x80. Raising it is a deliberate change with a perf pass attached, not
 *  something to bump because one building didn't fit. */
export const MAX_GRID_CELLS = 200

/** An exact fraction. `num`/`den` are always positive and coprime. */
export interface Ratio {
  num: number
  den: number
}

/** A rectangle in grid cells, carrying a caller-chosen label used only to name it
 *  in a refusal ("Rack A-03"). The server passes a location code, the designer a
 *  clientRef-derived label. */
export interface ScaleItem {
  label: string
  x: number
  y: number
  w: number
  h: number
}

export type RescaleRefusal =
  /** A rectangle would land on a fractional cell (e.g. a 3-cell rack at 4/3). */
  | 'not_divisible'
  /** A rectangle would fall outside the new grid — only reachable on a shrink. */
  | 'out_of_bounds'
  /** The derived grid exceeds MAX_GRID_CELLS on at least one axis. */
  | 'grid_cap'
  /** A cell size that isn't a positive number of whole hundredths. */
  | 'invalid'

export interface RescaleOk {
  ok: true
  factor: Ratio
  gridWidth: number
  gridHeight: number
  placements: ScaleItem[]
  objects: ScaleItem[]
}

export interface RescaleRefused {
  ok: false
  reason: RescaleRefusal
  /** Labels of the items that caused the refusal; empty for 'grid_cap'/'invalid'. */
  offenders: string[]
  /** Operator-facing sentence, safe to render verbatim. */
  detail: string
}

export type RescaleResult = RescaleOk | RescaleRefused

export interface RescaleInput {
  placements: ScaleItem[]
  objects: ScaleItem[]
  fromCellM: number
  toCellM: number
  gridWidth: number
  gridHeight: number
  /** The new grid, when the operator changed the floor size in the same edit.
   *  Omitted, the grid is derived so the building keeps its real dimensions. */
  toGridWidth?: number
  toGridHeight?: number
}

// ── Hundredths ───────────────────────────────────────────────────────────────

/** Metres -> whole hundredths, or null when the value isn't a positive quantity
 *  that NUMERIC(6,2) can hold exactly. 0.505 is rejected rather than rounded:
 *  silently storing 0.51 would make every derived distance subtly wrong and the
 *  operator would have no way to see it. */
export function toHundredths(metres: number): number | null {
  if (!Number.isFinite(metres) || metres <= 0) return null
  const scaled = metres * 100
  const rounded = Math.round(scaled)
  // 1e-6 absorbs binary-representation dust (0.29 * 100 === 28.999999999999996)
  // without accepting a genuine third decimal place.
  if (Math.abs(scaled - rounded) > 1e-6) return null
  if (rounded > 999_999) return null // NUMERIC(6,2) holds at most 9999.99
  return rounded
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

/**
 * The exact factor by which grid coordinates multiply when the resolution moves
 * from `fromCellM` to `toCellM`. Going FINER (1.0 -> 0.5) returns 2/1, because a
 * rectangle needs twice as many of the smaller cells to cover the same ground.
 *
 * Returns null when either value isn't a clean NUMERIC(6,2) quantity.
 */
export function scaleFactor(fromCellM: number, toCellM: number): Ratio | null {
  const from = toHundredths(fromCellM)
  const to = toHundredths(toCellM)
  if (from === null || to === null) return null
  const d = gcd(from, to)
  return { num: from / d, den: to / d }
}

/** Apply a ratio to a cell count, or null when the result isn't a whole number.
 *
 *  `num`/`den` are coprime, so `den | v*num` reduces to `den | v` — but the
 *  multiplication is spelled out because that identity is exactly the kind of
 *  cleverness that reads as a bug six months later. */
export function applyRatio(value: number, factor: Ratio): number | null {
  const scaled = value * factor.num
  if (scaled % factor.den !== 0) return null
  return scaled / factor.den
}

// ── Floor size <-> grid ──────────────────────────────────────────────────────

export interface FloorSize {
  floorWidthM: number
  floorHeightM: number
}

export interface GridSize {
  gridWidth: number
  gridHeight: number
}

/**
 * Cells needed to cover a building at a given resolution. CEIL, not round: a
 * grid one cell short of the far wall cannot hold the rack standing against it,
 * and half a cell of slack costs nothing.
 *
 * Returns null on a non-representable cell size or a non-positive floor.
 */
export function deriveGrid(input: FloorSize & { cellSizeM: number }): GridSize | null {
  const cell = toHundredths(input.cellSizeM)
  const w = toHundredths(input.floorWidthM)
  const h = toHundredths(input.floorHeightM)
  if (cell === null || w === null || h === null) return null
  return {
    gridWidth: Math.ceil(w / cell),
    gridHeight: Math.ceil(h / cell),
  }
}

/** The building a grid describes, for the readout that lets an operator sanity-
 *  check the numbers against a tape measure. */
export function deriveFloorSize(input: GridSize & { cellSizeM: number }): FloorSize {
  return {
    floorWidthM: input.gridWidth * input.cellSizeM,
    floorHeightM: input.gridHeight * input.cellSizeM,
  }
}

/** True when a derived grid fits inside the cap on both axes. */
export function withinGridCap(grid: GridSize): boolean {
  return grid.gridWidth <= MAX_GRID_CELLS && grid.gridHeight <= MAX_GRID_CELLS
}

// ── Rescale ──────────────────────────────────────────────────────────────────

const MAX_OFFENDERS = 6

function refuse(reason: RescaleRefusal, offenders: string[], detail: string): RescaleRefused {
  return { ok: false, reason, offenders, detail }
}

function nameList(labels: string[]): string {
  const shown = labels.slice(0, MAX_OFFENDERS).join(', ')
  return labels.length > MAX_OFFENDERS ? `${shown} and ${labels.length - MAX_OFFENDERS} more` : shown
}

/**
 * Work out what a resolution change does to a layout's geometry, WITHOUT
 * applying it.
 *
 * The contract is "the drawing keeps meaning what it meant": a 2 m bay stays a
 * 2 m bay, so its cell footprint multiplies by the scale factor. Anything that
 * would land on a fractional cell is REFUSED with the offenders named, because
 * the alternatives are both worse — rounding silently resizes a rack that may
 * hold stock, and refusing without saying which rack leaves the operator poking
 * at resolutions until one sticks.
 *
 * Bounds are checked against the NEW grid. On a shrink this is the only thing
 * standing between the operator and a bin stranded outside the floor plan, and a
 * stranded bin is a real `locations` row that may hold inventory, so it is never
 * moved or dropped for them.
 */
export function planRescale(input: RescaleInput): RescaleResult {
  const factor = scaleFactor(input.fromCellM, input.toCellM)
  if (factor === null) {
    return refuse('invalid', [], 'A resolution must be a positive number with at most two decimal places.')
  }

  const gridWidth = input.toGridWidth ?? Math.ceil((input.gridWidth * factor.num) / factor.den)
  const gridHeight = input.toGridHeight ?? Math.ceil((input.gridHeight * factor.num) / factor.den)

  if (!withinGridCap({ gridWidth, gridHeight })) {
    return refuse(
      'grid_cap',
      [],
      `${input.toCellM} m per cell would need a ${gridWidth} x ${gridHeight} grid; the maximum is ` +
        `${MAX_GRID_CELLS} x ${MAX_GRID_CELLS}. Use a coarser resolution or a smaller floor.`,
    )
  }

  const indivisible: string[] = []
  const scale = (items: ScaleItem[]): ScaleItem[] =>
    items.map((it) => {
      const x = applyRatio(it.x, factor)
      const y = applyRatio(it.y, factor)
      const w = applyRatio(it.w, factor)
      const h = applyRatio(it.h, factor)
      if (x === null || y === null || w === null || h === null) {
        indivisible.push(it.label)
        return it
      }
      return { label: it.label, x, y, w, h }
    })

  const placements = scale(input.placements)
  const objects = scale(input.objects)

  if (indivisible.length > 0) {
    return refuse(
      'not_divisible',
      indivisible,
      `At ${input.toCellM} m per cell these don't land on whole cells: ${nameList(indivisible)}. ` +
        `Pick a resolution that divides ${input.fromCellM} m evenly (halves and quarters always do).`,
    )
  }

  const outside = [...placements, ...objects]
    .filter((it) => it.x + it.w > gridWidth || it.y + it.h > gridHeight)
    .map((it) => it.label)

  if (outside.length > 0) {
    return refuse(
      'out_of_bounds',
      outside,
      `These would fall outside a ${gridWidth} x ${gridHeight} grid: ${nameList(outside)}. ` +
        'Move or remove them first, or keep the floor large enough to hold them.',
    )
  }

  return { ok: true, factor, gridWidth, gridHeight, placements, objects }
}

/**
 * Bounds-only check, for an edit that resizes the floor at an UNCHANGED
 * resolution. `planRescale` with from === to returns a 1/1 factor and does the
 * same work, but naming this case separately keeps the modal's messaging honest:
 * nothing is being rescaled, so it must not say anything about rescaling.
 */
export function findOutOfBounds(
  items: ScaleItem[],
  grid: GridSize,
): string[] {
  return items.filter((it) => it.x + it.w > grid.gridWidth || it.y + it.h > grid.gridHeight).map((it) => it.label)
}

// ── Display ──────────────────────────────────────────────────────────────────

/** The round metre values a scale bar is allowed to show, ascending. */
const NICE_METRES = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]

export interface ScaleBar {
  /** The round distance the bar represents. */
  metres: number
  /** How wide to draw it, in px, at the caller's current zoom. */
  px: number
}

/**
 * Pick the nicest round distance whose bar lands near `targetPx`, and how wide
 * to draw it. Shared by both canvases so the designer and the read-only viewer
 * can't disagree about how long 5 m looks.
 */
export function scaleBarFor(pxPerCell: number, cellSizeM: number, targetPx = 120): ScaleBar {
  const pxPerMetre = pxPerCell / cellSizeM
  if (!Number.isFinite(pxPerMetre) || pxPerMetre <= 0) return { metres: 1, px: targetPx }
  // Largest nice value that still fits the target, else the smallest we have.
  let chosen = NICE_METRES[0]
  for (const m of NICE_METRES) {
    if (m * pxPerMetre <= targetPx) chosen = m
    else break
  }
  return { metres: chosen, px: chosen * pxPerMetre }
}

/**
 * Label every Nth cell on a ruler so labels stay at least `minLabelPx` apart.
 * Returns the cell stride, always at least 1.
 */
export function rulerStride(pxPerCell: number, minLabelPx = 40): number {
  if (!Number.isFinite(pxPerCell) || pxPerCell <= 0) return 1
  return Math.max(1, Math.ceil(minLabelPx / pxPerCell))
}
