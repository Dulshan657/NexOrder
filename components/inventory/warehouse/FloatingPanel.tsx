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
  children: ReactNode
}

export function FloatingPanel({
  id,
  title,
  icon,
  defaultOpen = true,
  className = '',
  bodyClassName = '',
  children,
}: FloatingPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = `${id}-body`

  return (
    <div className={`glass-card flex flex-col rounded-xl ${className}`}>
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
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        )}
      </button>
      <div
        className="grid min-h-0 flex-1 transition-[grid-template-rows] duration-[250ms] ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            id={bodyId}
            hidden={!open}
            className={`overflow-y-auto border-t border-stone-200/80 px-3 py-2 ${bodyClassName}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
