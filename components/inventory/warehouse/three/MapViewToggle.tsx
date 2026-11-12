// The live map's 2D / 3D switch (NX-0035). Not lazy — it is what asks for the
// lazy chunk. Styled as the same segmented control as OverlayControls.

export type MapView = '2d' | '3d'

export interface MapViewToggleProps {
  view: MapView
  onChange: (view: MapView) => void
  /** True mid-paint / mid-sweep: 3D cannot be entered from an editing mode. */
  disabled?: boolean
}

const OPTIONS: { view: MapView; label: string }[] = [
  { view: '2d', label: '2D' },
  { view: '3d', label: '3D' },
]

export function MapViewToggle({ view, onChange, disabled = false }: MapViewToggleProps) {
  return (
    <div role="group" aria-label="Map view" className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.view}
          type="button"
          aria-pressed={view === o.view}
          disabled={disabled}
          title={disabled ? 'Finish or cancel the current edit to switch view' : undefined}
          onClick={() => {
            if (!disabled && o.view !== view) onChange(o.view)
          }}
          className={`touch-target-y rounded-md px-2.5 py-1 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:text-stone-400 ${
            view === o.view ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
