// Floor-plan import v2.1 — spatial accuracy fix.
//
// Two problems this module solves, both client-side:
//  1. The vision model freely picked gridWidth/gridHeight with only prompt
//     steering, so proportions drifted from the source image. `computeGridDims`
//     pins the grid to the image's own aspect ratio (aspect-fit into 120×80).
//  2. VLMs are weak at reading bare pixel coordinates. `drawGridOverlay` paints
//     a labeled red coordinate grid onto the (already-compressed) image before
//     upload so the model can read rectangle positions directly off in-image
//     labels instead of guessing. `renderDraftToBlob` renders the AI's own
//     draft back onto the SAME coordinate system for the render-and-reconcile
//     pass (source image + draft render + prior JSON → corrected JSON).
//
// All math (grid dims, gridline positions, label cadence, pixel conversion,
// render canvas sizing) is pure and exported for testing. Only the canvas
// painting touches the DOM/Canvas API.

import { MAX_GRID_WIDTH, MAX_GRID_HEIGHT } from '@/supabase/functions/_shared/floorplan/extractionSchema'
import { OBJECT_FILL } from '@/components/admin/layout/layoutPalette'
import type { LayoutObjectType } from '@/types'
import type { SaveObjectInput, SavePlacementInput } from '@/services/supabase/layoutService'

const MIN_GRID_DIM = 10
/** Thin gridlines every 5 cells. */
const THIN_STEP = 5
/** Heavy gridlines every 10 cells — same cadence carries the coordinate labels. */
const HEAVY_STEP = 10
const LABEL_STEP = HEAVY_STEP

/** Long axis of the rendered-draft canvas (render-and-reconcile pass), in px. */
const RENDER_LONG_AXIS_PX = 1600

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface GridDims {
  gridWidth: number
  gridHeight: number
}

/**
 * Aspect-fit the source image into a 120×80 max grid, maximizing one axis so
 * the grid's aspect ratio matches the image's — proportions become exact by
 * construction instead of a model guess.
 */
export function computeGridDims(imgW: number, imgH: number): GridDims {
  const ratio = imgW / imgH
  const wideThreshold = MAX_GRID_WIDTH / MAX_GRID_HEIGHT // 1.5
  if (ratio >= wideThreshold) {
    return {
      gridWidth: MAX_GRID_WIDTH,
      gridHeight: clamp(Math.round(MAX_GRID_WIDTH / ratio), MIN_GRID_DIM, MAX_GRID_HEIGHT),
    }
  }
  return {
    gridWidth: clamp(Math.round(MAX_GRID_HEIGHT * ratio), MIN_GRID_DIM, MAX_GRID_WIDTH),
    gridHeight: MAX_GRID_HEIGHT,
  }
}

/**
 * Cell-unit positions (0..cellCount inclusive) where a gridline of the given
 * cadence falls. Shared building block for thin/heavy lines and label cadence.
 */
export function gridLinePositions(cellCount: number, step: number): number[] {
  if (step <= 0 || cellCount <= 0) return [0]
  const positions: number[] = []
  for (let i = 0; i <= cellCount; i += step) positions.push(i)
  return positions
}

/** Thin gridline cell positions (every 5 cells) along an axis of `cellCount` cells. */
export function thinLinePositions(cellCount: number): number[] {
  return gridLinePositions(cellCount, THIN_STEP)
}

/** Heavy gridline cell positions (every 10 cells). */
export function heavyLinePositions(cellCount: number): number[] {
  return gridLinePositions(cellCount, HEAVY_STEP)
}

/** Cell positions that get a coordinate label — same cadence as heavy lines. */
export function labelPositions(cellCount: number): number[] {
  return gridLinePositions(cellCount, LABEL_STEP)
}

/** Convert a cell index along an axis with `totalCells` cells into a pixel
 *  offset in a canvas of `sizePx` pixels along that axis. */
export function cellToPixel(cellIndex: number, totalCells: number, sizePx: number): number {
  return (cellIndex / totalCells) * sizePx
}

/**
 * Pixel dims for the render-and-reconcile canvas: long axis ≈ 1600px, same
 * aspect ratio as the grid (so it lines up cell-for-cell with the overlay
 * drawn on the source scan).
 */
export function renderCanvasSize(gridWidth: number, gridHeight: number): { widthPx: number; heightPx: number } {
  if (gridWidth >= gridHeight) {
    return {
      widthPx: RENDER_LONG_AXIS_PX,
      heightPx: Math.max(1, Math.round((RENDER_LONG_AXIS_PX * gridHeight) / gridWidth)),
    }
  }
  return {
    widthPx: Math.max(1, Math.round((RENDER_LONG_AXIS_PX * gridWidth) / gridHeight)),
    heightPx: RENDER_LONG_AXIS_PX,
  }
}

/**
 * Rough on-canvas extent (px) of a coordinate label at the given font size —
 * sans-serif digits run about 0.6× font size wide. Only used to decide
 * whether a label would clip past the far edge, not for exact typesetting.
 */
export function estimateLabelExtent(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6
}

export interface LabelAnchor {
  /** Pixel offset to draw the label at along its axis. */
  pos: number
  /** 'start' = normal near-edge anchor (left/top); 'end' = flipped to the far
   *  edge (right-align for x labels, bottom-baseline for y labels) so the
   *  label draws inward instead of past the canvas boundary. */
  align: 'start' | 'end'
}

/**
 * Decide how to anchor an edge coordinate label along one axis so it always
 * draws fully on-canvas. A label whose near-edge origin (`pos + extent`)
 * would overshoot `sizePx` flips to an 'end' anchor pinned at the far edge
 * (minus margin) instead — this is what keeps the rightmost/bottommost label
 * (at cell 120/80, sitting exactly on the edge) visible instead of clipped.
 */
export function edgeLabelAnchor(pos: number, sizePx: number, extent: number, margin = 2): LabelAnchor {
  if (pos + extent + margin > sizePx) {
    return { pos: sizePx - margin, align: 'end' }
  }
  return { pos: clamp(pos + margin, 0, sizePx), align: 'start' }
}

// ── Canvas painting (impure) ─────────────────────────────────────────────────

interface OverlayGeometry {
  widthPx: number
  heightPx: number
  gridWidth: number
  gridHeight: number
}

/**
 * Paint the red coordinate-grid overlay — thin lines every 5 cells, heavier
 * lines every 10, and x/y cell-coordinate labels along all four edges — onto
 * an already-drawn canvas 2D context. Shared by `drawGridOverlay` (source
 * scan) and `renderDraftToBlob` (rendered draft) so both images carry the
 * identical coordinate reference the reconcile pass compares against.
 */
function paintGridOverlay(ctx: CanvasRenderingContext2D, geometry: OverlayGeometry): void {
  const { widthPx, heightPx, gridWidth, gridHeight } = geometry
  const fontSize = Math.max(12, widthPx / 120)

  ctx.save()
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize}px sans-serif`

  // Thin lines every 5 cells.
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(220,38,38,0.35)'
  for (const x of thinLinePositions(gridWidth)) {
    const px = cellToPixel(x, gridWidth, widthPx)
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, heightPx); ctx.stroke()
  }
  for (const y of thinLinePositions(gridHeight)) {
    const py = cellToPixel(y, gridHeight, heightPx)
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(widthPx, py); ctx.stroke()
  }

  // Heavier lines every 10 cells.
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(220,38,38,0.6)'
  for (const x of heavyLinePositions(gridWidth)) {
    const px = cellToPixel(x, gridWidth, widthPx)
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, heightPx); ctx.stroke()
  }
  for (const y of heavyLinePositions(gridHeight)) {
    const py = cellToPixel(y, gridHeight, heightPx)
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(widthPx, py); ctx.stroke()
  }

  // Coordinate labels along all four edges: white halo painted behind solid
  // red text so they stay legible over dark linework in the source scan.
  const drawLabel = (text: string, x: number, y: number, align: CanvasTextAlign) => {
    ctx.textAlign = align
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.strokeText(text, x, y)
    ctx.fillStyle = 'rgba(220,38,38,1)'
    ctx.fillText(text, x, y)
  }
  for (const x of labelPositions(gridWidth)) {
    const px = cellToPixel(x, gridWidth, widthPx)
    const anchor = edgeLabelAnchor(px, widthPx, estimateLabelExtent(String(x), fontSize))
    const align: CanvasTextAlign = anchor.align === 'end' ? 'right' : 'left'
    drawLabel(String(x), anchor.pos, 2, align) // top edge
    drawLabel(String(x), anchor.pos, heightPx - fontSize - 2, align) // bottom edge
  }
  for (const y of labelPositions(gridHeight)) {
    const py = cellToPixel(y, gridHeight, heightPx)
    const anchor = edgeLabelAnchor(py, heightPx, fontSize)
    ctx.textBaseline = anchor.align === 'end' ? 'bottom' : 'top'
    drawLabel(String(y), 2, anchor.pos, 'left') // left edge
    drawLabel(String(y), widthPx - fontSize * 2 - 2, anchor.pos, 'left') // right edge
    ctx.textBaseline = 'top'
  }
  ctx.restore()
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      'image/webp',
      quality,
    )
  })
}

function paintConveyorStripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = '#9a3412' // dark orange
  ctx.lineWidth = Math.max(2, Math.min(w, h) / 8)
  const step = ctx.lineWidth * 2
  for (let offset = -h; offset < w + h; offset += step) {
    ctx.beginPath()
    ctx.moveTo(x + offset, y)
    ctx.lineTo(x + offset + h, y + h)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draw the labeled red coordinate-grid overlay onto the (already-compressed)
 * source image. This overlaid copy is what gets uploaded — the AI only ever
 * sees the grid-labeled version; the modal's clean preview is unaffected
 * (it reads from the original `File` via `previewUrl`).
 */
export async function drawGridOverlay(image: Blob, gridWidth: number, gridHeight: number): Promise<Blob> {
  const bitmap = await createImageBitmap(image)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    paintGridOverlay(ctx, { widthPx: canvas.width, heightPx: canvas.height, gridWidth, gridHeight })
    return await canvasToBlob(canvas)
  } finally {
    bitmap.close?.()
  }
}

/** The subset of a floor-plan draft `renderDraftToBlob` needs to render. */
export interface DraftRenderInput {
  objects: SaveObjectInput[]
  placements: SavePlacementInput[]
  gridWidth: number
  gridHeight: number
}

/**
 * Render the AI's own draft to an image for the render-and-reconcile pass:
 * white background, `label` zone objects painted FIRST at reduced opacity
 * (they're informational overlays, not structure — painting them after would
 * occlude docks/walls with an opaque fill and corrupt the reconcile
 * comparison), then every other object at full opacity (conveyors get
 * diagonal stripes) on top of them, each placement as a green cell with a 1px
 * white gap, then the SAME red labeled gridline overlay as the source scan so
 * both images share one coordinate reference.
 */
export async function renderDraftToBlob(draft: DraftRenderInput): Promise<Blob> {
  const { objects, placements, gridWidth, gridHeight } = draft
  const { widthPx, heightPx } = renderCanvasSize(gridWidth, gridHeight)
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthPx, heightPx)

  const cellW = widthPx / gridWidth
  const cellH = heightPx / gridHeight

  const paintObject = (obj: DraftRenderInput['objects'][number]) => {
    const x = cellToPixel(obj.x, gridWidth, widthPx)
    const y = cellToPixel(obj.y, gridHeight, heightPx)
    const w = obj.w * cellW
    const h = obj.h * cellH
    ctx.fillStyle = OBJECT_FILL[obj.object_type as LayoutObjectType] ?? OBJECT_FILL.obstacle
    ctx.fillRect(x, y, w, h)
    if (obj.object_type === 'conveyor') paintConveyorStripes(ctx, x, y, w, h)
  }

  // Labels first, beneath everything, at reduced opacity — structure always
  // shows on top of them.
  ctx.save()
  ctx.globalAlpha = 0.5
  for (const obj of objects) {
    if (obj.object_type === 'label') paintObject(obj)
  }
  ctx.restore()

  for (const obj of objects) {
    if (obj.object_type !== 'label') paintObject(obj)
  }

  for (const p of placements) {
    const x = cellToPixel(p.x, gridWidth, widthPx)
    const y = cellToPixel(p.y, gridHeight, heightPx)
    const w = p.w * cellW
    const h = p.h * cellH
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
  }

  paintGridOverlay(ctx, { widthPx, heightPx, gridWidth, gridHeight })
  return canvasToBlob(canvas)
}
