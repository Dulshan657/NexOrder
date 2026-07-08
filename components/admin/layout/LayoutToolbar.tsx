// The designer's command surface, split into two clearly separated clusters so
// "what I draw with" never reads as "what I do to the document":
//   left  — paint tools (segmented, icon + label) + generate + floor switcher
//   right — document actions (Import, Clone, Simulate, Save, Publish, Archive)
// Presentational: all state + handlers come in as props.

import {
  MousePointer2, Footprints, BrickWall, DoorOpen, ArrowUpDown, Boxes, Eraser,
  Grid3x3, Copy, PlayCircle, Save, Upload, Archive, ImageUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { EditorTool } from './useLayoutEditorState'
import { STORAGE_UNIT } from './labels'

const TOOLS: Array<{ tool: EditorTool; label: string; icon: LucideIcon }> = [
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'walkway', label: 'Walkway', icon: Footprints },
  { tool: 'wall', label: 'Wall', icon: BrickWall },
  { tool: 'dock', label: 'Dock', icon: DoorOpen },
  { tool: 'lift', label: 'Lift', icon: ArrowUpDown },
  { tool: 'rack', label: STORAGE_UNIT.singular, icon: Boxes },
  { tool: 'erase', label: 'Erase', icon: Eraser },
]

interface LayoutToolbarProps {
  isDraft: boolean
  tool: EditorTool
  onSelectTool: (t: EditorTool) => void
  onGenerate: () => void
  floorCount: number
  floor: number
  onSetFloor: (f: number) => void
  dirty: boolean
  saving: boolean
  publishing: boolean
  simulating: boolean
  onSave: () => void
  onPublish: () => void
  onClone: () => void
  onSimulate: () => void
  onArchive: () => void
  /** P5 floor-plan import; hidden until wired. */
  onImport?: () => void
}

const actionBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 btn-press'

export function LayoutToolbar({
  isDraft, tool, onSelectTool, onGenerate, floorCount, floor, onSetFloor,
  dirty, saving, publishing, simulating, onSave, onPublish, onClone, onSimulate, onArchive, onImport,
}: LayoutToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ── Paint tools ─────────────────────────────────────────────────── */}
      {isDraft && (
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-stone-200 bg-stone-50 p-1">
          {TOOLS.map(({ tool: t, label, icon: Icon }) => {
            const active = tool === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => onSelectTool(t)}
                aria-pressed={active}
                title={label}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
                  active ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                {label}
              </button>
            )
          })}
        </div>
      )}

      {isDraft && (
        <button type="button" className={actionBtn} onClick={onGenerate}>
          <Grid3x3 className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Generate {STORAGE_UNIT.lowerPlural}
        </button>
      )}

      {floorCount > 1 && (
        <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5">
          <span className="pl-1.5 text-[11px] font-medium text-stone-400">Floor</span>
          {Array.from({ length: floorCount }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSetFloor(i)}
              className={`min-w-[28px] rounded-md px-2 py-1 text-xs font-semibold transition-colors btn-press ${
                floor === i ? 'bg-nexgen-blue text-white shadow-sm' : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* ── Document actions ────────────────────────────────────────────── */}
      <div className="inline-flex flex-wrap items-center gap-1.5">
        {onImport && (
          <button type="button" className={actionBtn} onClick={onImport}>
            <ImageUp className="h-4 w-4 text-emerald-600" strokeWidth={2} /> Import floor plan
          </button>
        )}
        <button type="button" className={actionBtn} onClick={onClone}>
          <Copy className="h-4 w-4" strokeWidth={2} /> Clone
        </button>
        <button type="button" className={actionBtn} onClick={onSimulate} disabled={simulating}>
          <PlayCircle className="h-4 w-4" strokeWidth={2} /> {simulating ? 'Simulating…' : 'Simulate'}
        </button>
        {isDraft && (
          <>
            <button type="button" className={actionBtn} onClick={onSave} disabled={saving || !dirty}>
              <Save className="h-4 w-4" strokeWidth={2} /> {dirty ? 'Save' : 'Saved'}
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing || saving}
              title={dirty ? 'Saves your changes, then publishes' : 'Publish this layout'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 btn-press"
            >
              <Upload className="h-4 w-4" strokeWidth={2} /> {publishing ? 'Publishing…' : dirty ? 'Save & Publish' : 'Publish'}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onArchive}
          title="Archive layout"
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 btn-press"
        >
          <Archive className="h-4 w-4" strokeWidth={2} /> Archive
        </button>
      </div>
    </div>
  )
}
