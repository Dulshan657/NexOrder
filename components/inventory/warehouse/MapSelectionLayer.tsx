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

import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import type { GhostLabel } from './recode/recodePlanView'

export interface MapSelectionLayerProps {
  ghosts: readonly GhostLabel[]
  floor: number
  viewport: { scale: number; tx: number; ty: number }
  /** Ghost text is hidden below this many pixels per cell — an unreadable smear of
   *  numbers is worse than the bins' own labels, which are still underneath. */
  minTextPx?: number
}

/** Matches the canvas's own gate for drawing a bin's code. */
const DEFAULT_MIN_TEXT_PX = 26

export function MapSelectionLayer({
  ghosts,
  floor,
  viewport,
  minTextPx = DEFAULT_MIN_TEXT_PX,
}: MapSelectionLayerProps) {
  const px = BASE_CELL * viewport.scale
  const showText = px >= minTextPx
  const onFloor = ghosts.filter((g) => g.floor === floor)
  if (onFloor.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {onFloor.map((g) => {
        const w = g.w * px
        const h = g.h * px
        return (
          <div
            key={g.locationId}
            className="absolute flex items-center justify-center rounded-[2px] border-2 border-nexgen-blue bg-nexgen-blue/15"
            style={{
              left: viewport.tx + g.x * px,
              top: viewport.ty + g.y * px,
              width: w,
              height: h,
            }}
          >
            {showText && (
              <span
                className="max-w-full truncate px-0.5 font-mono font-semibold leading-none text-nexgen-blue"
                // Scaled to the cell rather than a fixed class, so the number stays
                // proportionate across the whole zoom range. Capped so a single
                // enormous cell does not render a billboard.
                style={{ fontSize: Math.min(16, Math.max(8, Math.floor(Math.min(w, h) * 0.42))) }}
              >
                {g.text}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
