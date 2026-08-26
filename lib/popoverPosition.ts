// Where a trigger-anchored floating panel actually goes on a small screen.
//
// PURE, and deliberately so: every input is a plain number, so the decision is
// unit-testable without a DOM and without a browser. The consumers read the
// trigger's `getBoundingClientRect()` and the viewport, and pass numbers in.
//
// This exists because the same clamp kept being written once and forgotten
// everywhere else. `components/ui/Tooltip.tsx` got the HORIZONTAL half right and
// has no vertical half at all; `components/NotificationCenter.tsx` had a
// `max-w-[calc(100vw-1.5rem)]` that computed to 336px on a 360px screen while
// the panel it guarded was 288px wide — so it never engaged, and nothing
// clamped the panel's LEFT OFFSET, which was the thing actually running 48px
// off the edge of the handheld.
//
// The rule this encodes: a panel is clamped INTO the viewport, never merely
// capped in size. A width cap alone does nothing about where the box starts.

export interface TriggerRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface PopoverPlacementInput {
  /** The trigger's viewport-relative rect. */
  trigger: TriggerRect
  /** The width the panel wants. Narrowed if the viewport cannot hold it. */
  preferredWidth: number
  viewportWidth: number
  viewportHeight: number
  /** Which of the trigger's edges the panel prefers to line up with. */
  align?: 'left' | 'right'
  /** Gap kept between the panel and every viewport edge. */
  margin?: number
  /** Gap between the trigger and the panel. */
  gap?: number
  /** The tallest the panel would ever want to be. */
  preferredMaxHeight?: number
}

export interface PopoverPlacement {
  left: number
  top: number
  width: number
  /** Always finite: what the panel may occupy without leaving the viewport. */
  maxHeight: number
  placement: 'below' | 'above'
}

function clamp(value: number, min: number, max: number): number {
  // `max < min` happens when the panel is wider than the space available, which
  // on a 360px screen is the normal case rather than an edge case. Pinning to
  // `min` keeps the LEFT edge on screen — losing the right edge of a panel is
  // recoverable by scrolling it; losing the left edge hides the text's start.
  if (max < min) return min
  return Math.max(min, Math.min(value, max))
}

export function placePopover({
  trigger,
  preferredWidth,
  viewportWidth,
  viewportHeight,
  align = 'left',
  margin = 8,
  gap = 6,
  preferredMaxHeight = Number.POSITIVE_INFINITY,
}: PopoverPlacementInput): PopoverPlacement {
  const width = Math.min(preferredWidth, Math.max(0, viewportWidth - margin * 2))

  const preferredLeft = align === 'right' ? trigger.right - width : trigger.left
  const left = clamp(preferredLeft, margin, viewportWidth - width - margin)

  const spaceBelow = viewportHeight - trigger.bottom - gap - margin
  const spaceAbove = trigger.top - gap - margin

  // Flip only when below is BOTH too small for the content and worse than
  // above. A panel that flips whenever it merely could is disorienting — the
  // notification list should not jump sides because one row was added.
  const wantsMore = preferredMaxHeight > spaceBelow
  const flip = wantsMore && spaceAbove > spaceBelow

  if (flip) {
    const maxHeight = Math.max(0, Math.min(preferredMaxHeight, spaceAbove))
    return { left, top: Math.max(margin, trigger.top - gap - maxHeight), width, maxHeight, placement: 'above' }
  }

  return {
    left,
    top: trigger.bottom + gap,
    width,
    maxHeight: Math.max(0, Math.min(preferredMaxHeight, spaceBelow)),
    placement: 'below',
  }
}
