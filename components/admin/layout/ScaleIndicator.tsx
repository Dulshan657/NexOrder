import { scaleBarFor } from '@/supabase/functions/_shared/wie/gridScale'

// "How big is this really?" — answered the way every floor plan answers it.
//
// ONE COMPONENT, BOTH CANVASES. The designer (LayoutCanvas) and the read-only
// Warehouse-tab viewer (WarehouseCanvas) already share BASE_CELL from
// layoutPalette; they share this for the same reason. Two implementations of a
// scale bar would eventually disagree about how long 5 m looks, and a scale bar
// that disagrees with itself is worse than none.

export interface ScaleIndicatorProps {
  /** Rendered px per grid cell at the current zoom (BASE_CELL × zoom). */
  pxPerCell: number
  /** The layout's metres per cell. */
  cellSizeM: number
  className?: string
}

/** Trim trailing zeros: 1 m, 0.5 m, 1.2 m. */
const num = (v: number): string => String(Number(v.toFixed(2)))

export function ScaleIndicator({ pxPerCell, cellSizeM, className = '' }: ScaleIndicatorProps) {
  const bar = scaleBarFor(pxPerCell, cellSizeM)
  return (
    <div className={`flex items-center gap-2 text-xs text-stone-500 ${className}`} aria-label={`Scale: one cell is ${num(cellSizeM)} metres`}>
      <span className="font-mono">1 cell = {num(cellSizeM)} m</span>
      <span className="text-stone-300">|</span>
      {/* The bar is a measured length, so it must be drawn at exactly the px the
          maths produced — hence an inline width rather than a utility class. */}
      <span className="inline-flex items-end" style={{ width: Math.round(bar.px) }} title={`${num(bar.metres)} m`}>
        <span className="h-2 w-px bg-stone-400" />
        <span className="h-px flex-1 bg-stone-400" />
        <span className="h-2 w-px bg-stone-400" />
      </span>
      <span className="font-mono">{num(bar.metres)} m</span>
    </div>
  )
}
