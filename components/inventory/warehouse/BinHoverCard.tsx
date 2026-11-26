// The card that floats over a hovered cell (NX-0047).
//
// HTML rather than SVG, and owned by the stage rather than the canvas, for the
// reasons MapStage's banner gives: placing it needs the viewport transform, and
// HTML gives it wrapping and a shadow an SVG <text> cannot.
//
// ── Placement ──────────────────────────────────────────────────────────────
// It used to be translated a full card-height above the cell and nothing else, so on a
// top-row cell it rendered above the map's edge and was clipped by the stage's
// `overflow-hidden`; on an edge cell it lost a side. `lib/popoverPosition` is the
// one module that clamps a trigger-anchored panel on both axes, so this uses it
// — with the map's own box standing in for the viewport, since the stage clips.
//
// `placePopover` prefers BELOW its trigger. A hover card wants the opposite: the
// pointer came from somewhere, most often from below, and a card under the cell
// covers the row the operator is about to move to. So the cell is handed over
// mirrored top-to-bottom; "below" in the mirrored box is above in the real one,
// and the flip it makes when that side cannot hold the card is the flip to
// below. Its rule is shared with Tooltip and NotificationCenter and is not
// changed here.

import type { BinHover, BinInfo } from './WarehouseCanvas'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import { placePopover } from '@/lib/popoverPosition'
import { locationSubtitle, locationTitle } from '@/lib/locationDisplay'
import { occupancyFill } from './warehouseOverlays'

const CARD_WIDTH = 232
const CARD_MARGIN = 8
const CARD_GAP = 8
/** Name, code, fill line, bar, contents. Generous on purpose: over-estimating
 *  only makes the flip more eager; under-estimating clips the card. */
const CARD_ESTIMATED_HEIGHT = 112

export interface HoverCardBounds {
  width: number
  height: number
}

export interface HoverCardPlacement {
  left: number
  width: number
  /** Exactly one of these is set: the card hangs from whichever edge faces the cell. */
  top?: number
  bottom?: number
}

/** Where the card goes, in the map container's own coordinates. Pure. */
export function placeHoverCard(
  hover: Pick<BinHover, 'x' | 'y' | 'w' | 'h'>,
  viewport: { scale: number; tx: number; ty: number },
  bounds: HoverCardBounds,
): HoverCardPlacement {
  const px = BASE_CELL * viewport.scale
  const cellTop = viewport.ty + hover.y * px
  const cellBottom = cellTop + hover.h * px
  const centre = viewport.tx + (hover.x + hover.w / 2) * px

  // Not measured yet (or a test DOM with no layout): there is no box to clamp
  // into, so hang the card under the cell rather than collapse it to zero width.
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { left: centre - CARD_WIDTH / 2, width: CARD_WIDTH, top: cellBottom + CARD_GAP }
  }

  const placed = placePopover({
    trigger: {
      left: centre - CARD_WIDTH / 2,
      right: centre + CARD_WIDTH / 2,
      // Mirrored: measured from the container's BOTTOM edge.
      top: bounds.height - cellBottom,
      bottom: bounds.height - cellTop,
    },
    preferredWidth: CARD_WIDTH,
    viewportWidth: bounds.width,
    viewportHeight: bounds.height,
    margin: CARD_MARGIN,
    gap: CARD_GAP,
    preferredMaxHeight: CARD_ESTIMATED_HEIGHT,
  })

  // Whichever side it lands on, the card stays inside the box. When the cell is
  // so tall that neither side has room, that means it overlaps the cell — which
  // is safe, because the card is `pointer-events-none`.
  const furthest = Math.max(CARD_MARGIN, bounds.height - CARD_MARGIN - CARD_ESTIMATED_HEIGHT)
  const into = (value: number) => Math.max(CARD_MARGIN, Math.min(value, furthest))

  // Mirrored "below" is real ABOVE: `placed.top` is then the distance from the
  // container's bottom edge to the card's bottom edge.
  if (placed.placement === 'below') {
    return { left: placed.left, width: placed.width, bottom: into(placed.top) }
  }
  // Flipped: real BELOW the cell, hung from its top edge so a card shorter than
  // the estimate still sits tight against the cell.
  return { left: placed.left, width: placed.width, top: into(cellBottom + CARD_GAP) }
}

interface BinHoverCardProps {
  hover: BinHover
  info: BinInfo
  viewport: { scale: number; tx: number; ty: number }
  /** The map container's client box. */
  bounds: HoverCardBounds
}

function capacityLine(hover: BinHover, info: BinInfo): string {
  const fill = hover.fillPct != null ? `${Math.round(hover.fillPct * 100)}% full` : 'No capacity set'
  const capacity = info.capacitySlots ? ` of ${info.capacitySlots} ${info.slotKind ?? 'slot'}s` : ''
  return `${fill}${capacity}`
}

/**
 * `pointer-events-none` is essential: the card can overlap the cell that spawned
 * it, and an interactive card would steal the pointerleave and strobe. For the
 * same reason it is `aria-hidden` — the cell's own <title> is the accessible text.
 */
export function BinHoverCard({ hover, info, viewport, bounds }: BinHoverCardProps) {
  const placement = placeHoverCard(hover, viewport, bounds)
  const title = locationTitle(info)
  const code = locationSubtitle(info)
  const pct = hover.fillPct == null ? null : Math.max(0, Math.min(1, hover.fillPct))

  return (
    <div
      aria-hidden="true"
      className="map-panel pointer-events-none absolute z-30 px-3 py-2.5 text-xs leading-snug text-stone-600"
      style={placement}
    >
      {/* With no friendly name the title IS the code, so it is set in mono and
          the second line is dropped rather than printed twice. */}
      <p className={`truncate text-sm font-semibold text-stone-900 ${code ? '' : 'font-mono font-medium'}`}>{title}</p>
      {code && <p className="truncate font-mono text-stone-600">{code}</p>}
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="tabular-nums">{capacityLine(hover, info)}</span>
        {hover.levelCount > 0 && <span className="shrink-0 tabular-nums">{hover.levelCount} levels</span>}
      </div>
      {pct != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full ring-1 ring-inset ring-stone-900/15"
            style={{ width: `${pct * 100}%`, backgroundColor: occupancyFill(pct) }}
          />
        </div>
      )}
      <p className="mt-1.5 truncate">
        {info.contentsCount > 0
          ? <>{info.topSku}{info.contentsCount > 1 && ` +${info.contentsCount - 1} more`}</>
          : 'Empty'}
      </p>
    </div>
  )
}
