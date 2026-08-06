// The annotate-mode bar above the live warehouse map (migs 00095/00097).
//
// Deliberately reads like the designer's own "Painting area" / "Sign text" bars
// (LayoutToolbar.tsx) — same controls in the same order, because an operator who
// has drawn a layout should not have to learn a second vocabulary to relabel one.
//
// TWO LAYERS, ONE BAR. The Areas | Signs toggle switches which picture the brush
// and eraser touch. They are separate server actions with separate consequences,
// and the prose under each layer says so — but they are one mode here, because
// "put a word on the floor" and "name this region" are the same errand from where
// the operator is standing.
//
// Renaming an area is not a control here. paint_areas reads the before-picture
// from the database, so "erased Chiller, painted Cold Room over the same cells"
// IS a rename as far as the cascade is concerned — the operator types the new
// name and paints over it, and the server derives the rest. A SIGN does have a
// rename, on the map itself (click its text), because a sign has no cascade to
// derive anything from and retyping five characters should not mean repainting.

import { Eraser, Paintbrush, Trash2, Undo2 } from 'lucide-react'
import { MAX_AREA_NAME, areaNameIssue } from '@/lib/locationNaming'
import { MAX_SIGN_NAME, signNameIssue } from '@/lib/signPaint'
import type { AnnotationLayer, AreaBrush } from './useAreaPaintState'

interface ZoneProfileOption {
  id: number
  name: string
}

interface AreaPaintToolbarProps {
  brush: AreaBrush
  signBrush: string
  layer: AnnotationLayer
  mode: 'paint' | 'erase'
  areaNames: string[]
  signNames: string[]
  zoneProfiles: ZoneProfileOption[]
  dirty: boolean
  canUndo: boolean
  saving: boolean
  /** Set when this site also has a DRAFT layout in flight. */
  draftWarning: string | null
  onLayer: (layer: AnnotationLayer) => void
  onBrushName: (name: string) => void
  onBrushProfile: (zoneProfileId: number | null) => void
  onSignBrush: (name: string) => void
  onMode: (mode: 'paint' | 'erase') => void
  onEraseArea: (name: string) => void
  onEraseSign: (name: string) => void
  onUndo: () => void
  onCancel: () => void
  onSave: () => void
}

export function AreaPaintToolbar({
  brush,
  signBrush,
  layer,
  mode,
  areaNames,
  signNames,
  zoneProfiles,
  dirty,
  canUndo,
  saving,
  draftWarning,
  onLayer,
  onBrushName,
  onBrushProfile,
  onSignBrush,
  onMode,
  onEraseArea,
  onEraseSign,
  onUndo,
  onCancel,
  onSave,
}: AreaPaintToolbarProps) {
  const signLayer = layer === 'sign'
  const issue = signLayer
    ? (signBrush.trim() ? signNameIssue(signBrush) : null)
    : (brush.name.trim() ? areaNameIssue(brush.name) : null)
  // The chips and the "Erase «X»" button both key off whichever layer is live.
  const activeText = (signLayer ? signBrush : brush.name).trim()
  const namesOnLayer = signLayer ? signNames : areaNames
  const brushIsExisting = namesOnLayer.includes(activeText)

  const layerBtn = (value: AnnotationLayer, text: string) => (
    <button
      type="button"
      onClick={() => onLayer(value)}
      aria-pressed={layer === value}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors btn-press ${
        layer === value
          ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40'
          : 'text-stone-600 hover:bg-white/70'
      }`}
    >
      {text}
    </button>
  )

  return (
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          Annotating
        </span>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-emerald-200/70 bg-emerald-100/50 p-0.5">
          {layerBtn('area', 'Areas')}
          {layerBtn('sign', 'Signs')}
        </div>

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
            {saving ? 'Checking…' : 'Save'}
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

        {signLayer ? (
          <input
            value={signBrush}
            onChange={(e) => onSignBrush(e.target.value)}
            placeholder="Inbound Staging"
            aria-label="Sign text"
            maxLength={MAX_SIGN_NAME}
            className="w-48 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
          />
        ) : (
          <>
            <input
              value={brush.name}
              onChange={(e) => onBrushName(e.target.value)}
              placeholder="Cold Storage"
              aria-label="Area name"
              maxLength={MAX_AREA_NAME}
              className="w-40 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
            />
            {/* No zone-profile control on the sign layer, and that is not an
                omission: a sign carries no zone intent, and offering one here
                would make it an area by the back door. */}
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
          </>
        )}

        {brushIsExisting && (
          <button
            type="button"
            onClick={() => (signLayer ? onEraseSign(activeText) : onEraseArea(activeText))}
            title={`Remove every cell of “${activeText}”`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-600 btn-press"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} /> Erase “{activeText}”
          </button>
        )}
      </div>

      {namesOnLayer.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-stone-500">or extend</span>
          {namesOnLayer.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => (signLayer ? onSignBrush(name) : onBrushName(name))}
              className={`rounded-full border px-2 py-0.5 text-[11px] btn-press ${
                activeText === name
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
        Drag to {signLayer ? 'place a sign' : 'paint'} on this floor. Hold{' '}
        <kbd className="rounded border border-stone-300 bg-white px-1">Alt</kbd> to pan, or use the
        arrow keys; Ctrl/⌘ + scroll still zooms. Nothing is saved until you press Save.{' '}
        {signLayer
          // The distinction the whole two-layer split exists to make. Said here,
          // where the operator is about to act, not only in the confirm dialog.
          ? 'A sign is wayfinding text only — it renames no bin, sets no zone and needs no republish.'
          : 'An area names the bins inside it and can move them between zones — Save will show you exactly what changes.'}
      </p>
    </div>
  )
}
