// Maps the grid's colours to meanings. Without it the palette is only decodable
// by matching cells back to toolbar buttons. Rendered under both the editor and
// the read-only viewer canvas, driven by the shared LEGEND_ITEMS so it can never
// disagree with what's actually drawn.

import { LEGEND_ITEMS, type LegendItem } from './layoutPalette'

function Swatch({ item }: { item: LegendItem }) {
  if (item.shape === 'outline') {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] bg-white"
        style={{ border: `2px solid ${item.stroke}` }}
        aria-hidden
      />
    )
  }
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: item.fill, border: item.stroke ? `1px solid ${item.stroke}` : undefined }}
      aria-hidden
    />
  )
}

interface LayoutLegendProps {
  /** Drawable storage forms (mig 00061); when given, they replace the generic
   *  "Rack" swatches so the legend matches the coloured forms on the canvas. */
  forms?: Array<{ id: number; name: string; color?: string }>
}

export function LayoutLegend({ forms }: LayoutLegendProps = {}) {
  const hasForms = (forms?.length ?? 0) > 0
  // With real forms, drop the generic rack rows; keep structure + selected state.
  const items = hasForms ? LEGEND_ITEMS.filter((i) => !i.key.startsWith('rack')) : LEGEND_ITEMS
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Legend</span>
      {hasForms &&
        forms!.map((f) => (
          <span key={`form-${f.id}`} className="inline-flex items-center gap-1.5 text-xs text-stone-600">
            <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] border border-black/10" style={{ backgroundColor: f.color ?? '#94a3b8' }} aria-hidden />
            {f.name}
          </span>
        ))}
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5 text-xs text-stone-600">
          <Swatch item={item} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
