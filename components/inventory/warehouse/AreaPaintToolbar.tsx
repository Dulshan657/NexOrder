// The paint-mode bar above the live warehouse map (mig 00095).
//
// Deliberately reads like the designer's own "Painting area" bar
// (LayoutToolbar.tsx) — same controls in the same order, because an operator who
// has drawn a layout should not have to learn a second vocabulary to relabel one.
//
// Renaming an area is not a control here. paint_areas reads the before-picture
// from the database, so "erased Chiller, painted Cold Room over the same cells"
// IS a rename as far as the cascade is concerned — the operator types the new
// name and paints over it, and the server derives the rest.

import { Eraser, Paintbrush, Trash2, Undo2 } from 'lucide-react'
import { MAX_AREA_NAME, areaNameIssue } from '@/lib/locationNaming'
import type { AreaBrush } from './useAreaPaintState'

interface ZoneProfileOption {
  id: number
  name: string
}

interface AreaPaintToolbarProps {
  brush: AreaBrush
  mode: 'paint' | 'erase'
  areaNames: string[]
  zoneProfiles: ZoneProfileOption[]
  dirty: boolean
  canUndo: boolean
  saving: boolean
  /** Set when this site also has a DRAFT layout in flight. */
  draftWarning: string | null
  onBrushName: (name: string) => void
  onBrushProfile: (zoneProfileId: number | null) => void
  onMode: (mode: 'paint' | 'erase') => void
  onEraseArea: (name: string) => void
  onUndo: () => void
  onCancel: () => void
  onSave: () => void
}

export function AreaPaintToolbar({
  brush,
  mode,
  areaNames,
  zoneProfiles,
  dirty,
  canUndo,
  saving,
  draftWarning,
  onBrushName,
  onBrushProfile,
  onMode,
  onEraseArea,
  onUndo,
  onCancel,
  onSave,
}: AreaPaintToolbarProps) {
  const issue = brush.name.trim() ? areaNameIssue(brush.name) : null
  const brushIsExisting = areaNames.includes(brush.name.trim())

  return (
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          Painting areas
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 btn-press disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" strokeWidth={2} /> Undo
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white btn-press disabled:opacity-40"
          >
            {saving ? 'Checking…' : 'Save areas'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onMode('paint')}
          aria-pressed={mode === 'paint'}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
            mode === 'paint'
              ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40'
              : 'text-stone-600 hover:bg-white/70'
          }`}
        >
          <Paintbrush className="h-4 w-4" strokeWidth={2} /> Paint
        </button>
        <button
          type="button"
          onClick={() => onMode('erase')}
          aria-pressed={mode === 'erase'}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
            mode === 'erase'
              ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40'
              : 'text-stone-600 hover:bg-white/70'
          }`}
        >
          <Eraser className="h-4 w-4" strokeWidth={2} /> Erase
        </button>

        <input
          value={brush.name}
          onChange={(e) => onBrushName(e.target.value)}
          placeholder="Cold Storage"
          aria-label="Area name"
          maxLength={MAX_AREA_NAME}
          className="w-40 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
        />
        <select
          value={brush.zoneProfileId ?? ''}
          onChange={(e) => onBrushProfile(e.target.value ? Number(e.target.value) : null)}
          aria-label="Zone profile"
          className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
        >
          <option value="">No zone profile</option>
          {zoneProfiles.map((zp) => (
            <option key={zp.id} value={zp.id}>{zp.name}</option>
          ))}
        </select>

        {brushIsExisting && (
          <button
            type="button"
            onClick={() => onEraseArea(brush.name.trim())}
            title={`Remove every cell of “${brush.name.trim()}”`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-600 btn-press"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} /> Erase “{brush.name.trim()}”
          </button>
        )}
      </div>

      {areaNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-stone-500">or extend</span>
          {areaNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onBrushName(name)}
              className={`rounded-full border px-2 py-0.5 text-[11px] btn-press ${
                brush.name.trim() === name
                  ? 'border-emerald-500/40 bg-white text-emerald-700'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {issue && <p className="text-[11px] text-rose-600">{issue}</p>}

      {draftWarning && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
          {draftWarning}
        </p>
      )}

      <p className="text-[11px] leading-snug text-stone-500">
        Drag to paint on this floor. Hold <kbd className="rounded border border-stone-300 bg-white px-1">Alt</kbd> to
        pan, or use the arrow keys; Ctrl/⌘ + scroll still zooms. Nothing is saved, and no bin is
        renamed, until you press Save areas.
      </p>
    </div>
  )
}
