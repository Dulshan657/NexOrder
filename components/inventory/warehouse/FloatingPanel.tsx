// Generic collapsible shell for every panel that floats over the Warehouse
// map: KPI/overlay chrome uses plain positioned wrappers, but anything with
// meaningful body content (overlays, tree, bin detail) uses this so collapse
// behavior, the `.map-panel` surface, and the a11y contract stay consistent.
//
// Positioning is entirely up to the caller via `className` — e.g.
// `md:absolute md:top-4 md:left-4 md:bottom-4 md:w-72`. Below `md` this
// renders as a normal static block (no `md:` classes apply), so panels stack
// in document flow; at `md+` the caller's `md:absolute` (plus top/bottom or
// top/left anchoring) takes it out of flow and floats it over the map. This
// means panel height at `md+` comes from CSS anchoring (top+bottom), not a
// magic max-height number.
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
  /** Positioning + sizing classes, e.g. "md:absolute md:top-4 md:right-4 md:bottom-4 md:w-80". */
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
    <div className={`map-panel flex flex-col ${className}`}>
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
