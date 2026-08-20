// The recode selection, drawn OVER the map rather than inside it.
//
// ── Why this is not a WarehouseCanvas prop ───────────────────────────────────
//
// The canvas memoizes its whole scene on everything except the pan offset, so a drag
// is one `<g transform>` update instead of 945 bin re-renders. A prop that changes on
// every painted cell — which is exactly what a live selection is — would bust that
// memo once per cell, and the resulting freeze is documented: it was bad enough on
// MAIN that Chrome could not be scripted.
//
// So the selection and its ghost numbers live in a sibling layer that does its own
// `left: tx + x*px` arithmetic against the viewport, the same way MarqueeBand and
// BinHoverCard already do. It re-renders freely; the 945 bins underneath do not.
//
// Consequence worth knowing: this draws ON TOP of the bins, including on top of a
// rack's level spine. That is deliberate — while a sweep is running, what the bin
// will be CALLED is the only thing the operator is there to read.
//
// ── Geometry is independent of the plan, and that is load-bearing ────────────
//
// The boxes used to ride on the ghost labels, which are EMPTY whenever `planRecode`
// returns null — no block name typed yet, a refusal, anything. So "can you see what
// you selected" silently depended on "could the codes be computed", and the answer
// to the first question is never allowed to be no. `cells` now comes straight off the
// selection; `ghosts` only supplies text for the cells that have any.

import { BASE_CELL } from '@/components/admin/layout/layoutPalette'

/** One selected unit's footprint. A levelled rack is ONE cell here, not one per
 *  level: a rack is a single unit to a sweep, and lighting up four coincident level
 *  rects to say so was a workaround for living inside the canvas. */
export interface SelectionCell {
  locationId: number
  floor: number
  x: number
  y: number
  w: number
  h: number
}

export interface MapSelectionLayerProps {
  cells: readonly SelectionCell[]
  /** locationId → the ghost code, already trimmed of the run's shared prefix.
   *  Absent for a cell whose code could not be planned; the box still draws. */
  ghosts: ReadonlyMap<number, string>
  floor: number
  viewport: { scale: number; tx: number; ty: number }
  /** Ghost text is hidden below this many pixels per cell — an unreadable smear of
   *  numbers is worse than the bins' own labels, which are still underneath. */
  minTextPx?: number
}

/** Matches the canvas's own gate for drawing a bin's code. */
const DEFAULT_MIN_TEXT_PX = 26

export function MapSelectionLayer({
  cells,
  ghosts,
  floor,
  viewport,
  minTextPx = DEFAULT_MIN_TEXT_PX,
}: MapSelectionLayerProps) {
  const px = BASE_CELL * viewport.scale
  const showText = px >= minTextPx
  const onFloor = cells.filter((c) => c.floor === floor)
  if (onFloor.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {onFloor.map((c) => {
        const w = c.w * px
        const h = c.h * px
        const text = ghosts.get(c.locationId)
        return (
          <div
            // Keyed by locationId so React reuses the node for a cell it has already
            // drawn. That is what makes `wh-sweep-in` fire ONLY on newly selected
            // units: paint over bins you already own and nothing moves, paint new
            // ones and they pop. The union semantics, made visible, for one keyframe.
            key={c.locationId}
            className="wh-sweep-cell wh-sweep-in absolute flex items-center justify-center rounded-[2px]"
            style={{
              left: viewport.tx + c.x * px,
              top: viewport.ty + c.y * px,
              width: w,
              height: h,
            }}
          >
            {showText && text && (
              <span
                className="max-w-full truncate px-0.5 font-mono font-semibold leading-none text-nexgen-blue"
                // Scaled to the cell rather than a fixed class, so the number stays
                // proportionate across the whole zoom range. Capped so a single
                // enormous cell does not render a billboard.
                style={{ fontSize: Math.min(16, Math.max(8, Math.floor(Math.min(w, h) * 0.42))) }}
              >
                {text}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
