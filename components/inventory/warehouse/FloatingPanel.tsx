// Generic collapsible shell for panels in the row below the Warehouse map
// (Locations tree, Bin detail): anything with meaningful body content uses
// this so collapse behavior, the `.glass-card` surface, and the a11y contract
// stay consistent — the panels no longer float over the map (see
// RackedWorkspace), so this now just supplies sizing/scroll classes via
// `className`, e.g. `max-h-[70vh]`.
//
// Collapse uses the grid-rows trick (0fr -> 1fr) so it animates without a
// hardcoded max-height; the collapsed body carries `hidden` (not just an
// opacity/height-0 style) so it drops out of the tab order.

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface FloatingPanelProps {
  /** Unique id — used to wire aria-controls to the collapsible body. */
  id: string
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  /** Sizing/layout classes, e.g. "max-h-[70vh]" so a long tree scrolls internally instead of running the page long. */
  className?: string
  /** Extra classes on the scrollable body (padding overrides, etc). */
  bodyClassName?: string
  /** Handle on the outer element, for callers that need to scroll this panel
   *  into view. Deliberately a ref rather than an id on the container: the panel
   *  is a grid item, and wrapping it in a positioned div to get a handle would
   *  change how it stretches in the row. */
  containerRef?: { current: HTMLDivElement | null }
  children: ReactNode
}

export function FloatingPanel({
  id,
  title,
  icon,
  defaultOpen = true,
  className = '',
  bodyClassName = '',
  containerRef,
  children,
}: FloatingPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = `${id}-body`

  return (
    <div ref={containerRef} className={`glass-card flex flex-col rounded-xl ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full shrink-0 items-center gap-2 rounded-t-xl px-3 py-2 text-left text-xs font-semibold text-stone-700 btn-press hover:bg-stone-50"
      >
        {icon}
        <span className="flex-1 truncate">{title}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-500" />
        )}
      </button>
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-rows] duration-[250ms] ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        {/* The body is the scroll box, so it has to be bounded by this row and not
            by its own content. It used to be a plain block child of an
            `overflow-hidden` div: that div was exactly as tall as the row, the
            body grew to its content inside it, and the wrapper clipped it. The
            body was never taller than itself, so there was nothing for a wheel to
            scroll and the wheel went to the page (NX-0033, C7). Making this a flex
            column that may shrink (`min-h-0`) and the body its `flex-1` child makes
            the row the bound. `overflow-hidden` stays for the collapse animation:
            the body's own padding and border cannot shrink to a 0fr row. */}
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div
            id={bodyId}
            hidden={!open}
            className={`min-h-0 flex-1 overflow-y-auto border-t border-stone-200/80 px-3 py-2 ${bodyClassName}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
