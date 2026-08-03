// The designer's command surface, split into two clearly separated clusters so
// "what I draw with" never reads as "what I do to the document":
//   left  — paint tools (segmented, icon + label) + generate + floor switcher
//   right — document actions (Import, Clone, Simulate, Save, Publish, Archive)
// Presentational: all state + handlers come in as props.

import {
  MousePointer2, Footprints, BrickWall, DoorOpen, ArrowUpDown, Boxes, Eraser,
  Grid3x3, Copy, PlayCircle, Save, Upload, Archive, ImageUp,
  Waypoints, PackageOpen, Ban, Tag, SquareDashed,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ActiveArea, EditorTool } from './useLayoutEditorState'
import { STORAGE_UNIT } from './labels'

// Structural (non-storage) tools. Storage FORMS are rendered dynamically from the
// catalogue between these and Erase, so every drawable form gets its own tool.
const TOOLS: Array<{ tool: EditorTool; label: string; icon: LucideIcon }> = [
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'walkway', label: 'Walkway', icon: Footprints },
  { tool: 'wall', label: 'Wall', icon: BrickWall },
  { tool: 'dock', label: 'Dock', icon: DoorOpen },
  { tool: 'lift', label: 'Lift', icon: ArrowUpDown },
  { tool: 'conveyor', label: 'Conveyor', icon: Waypoints },
  { tool: 'staging', label: 'Staging floor', icon: PackageOpen },
  { tool: 'obstacle', label: 'Obstacle', icon: Ban },
  { tool: 'label', label: 'Label', icon: Tag },
]

/** A drawable storage form shown as its own paint tool. */
export interface ToolbarForm {
  id: number
  name: string
  color?: string
}

/** A zone profile offered as an area's meaning. */
export interface ToolbarZoneProfile {
  id: number
  name: string
}

interface LayoutToolbarProps {
  isDraft: boolean
  tool: EditorTool
  onSelectTool: (t: EditorTool) => void
  /** Drawable storage forms (mig 00061); each becomes a coloured paint tool. */
  forms: ToolbarForm[]
  activeFormId?: number | null
  onSelectForm: (id: number) => void
  onGenerate: () => void
  /** Named areas already drawn on this floor, so extending one is a click rather
   *  than retyping its name exactly (a typo would start a second area). */
  areaNames: string[]
  activeArea: ActiveArea | null
  onSelectArea: (area: ActiveArea) => void
  zoneProfiles: ToolbarZoneProfile[]
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
  isDraft, tool, onSelectTool, forms, activeFormId, onSelectForm, onGenerate,
  areaNames, activeArea, onSelectArea, zoneProfiles, floorCount, floor, onSetFloor,
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

          {/* Storage forms — one coloured tool per drawable form. */}
          {forms.length === 0 ? (
            <button
              type="button"
              onClick={() => onSelectTool('rack')}
              aria-pressed={tool === 'rack'}
              title={STORAGE_UNIT.singular}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
                tool === 'rack' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
              }`}
            >
              <Boxes className="h-4 w-4" strokeWidth={2} /> {STORAGE_UNIT.singular}
            </button>
          ) : (
            forms.map((f) => {
              const active = tool === 'rack' && activeFormId === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onSelectForm(f.id)}
                  aria-pressed={active}
                  title={f.name}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
                    active ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
                  }`}
                >
                  <span className="h-3 w-3 rounded-sm border border-black/10" style={{ backgroundColor: f.color ?? '#94a3b8' }} />
                  {f.name}
                </button>
              )
            })
          )}

          {/* Named area — its own tool because WHAT it paints (the area's name)
              is carried in state, exactly like the storage forms above. */}
          <button
            type="button"
            onClick={() => onSelectTool('area')}
            aria-pressed={tool === 'area'}
            title="Named area"
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
              tool === 'area' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
            }`}
          >
            <SquareDashed className="h-4 w-4" strokeWidth={2} /> Area
          </button>

          <button
            type="button"
            onClick={() => onSelectTool('erase')}
            aria-pressed={tool === 'erase'}
            title="Erase"
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
              tool === 'erase' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
            }`}
          >
            <Eraser className="h-4 w-4" strokeWidth={2} /> Erase
          </button>
        </div>
      )}

      {/* What the Area tool is currently painting. Shown only while that tool is
          held, so it doesn't compete for width the rest of the time — an area's
          NAME is its identity (cells sharing one merge into a single region), so
          this bar is the equivalent of picking which storage form to paint. */}
      {isDraft && tool === 'area' && (
        <div className="inline-flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-2 py-1.5">
          <span className="text-[11px] font-medium text-stone-400">Painting area</span>
          <input
            value={activeArea?.name ?? ''}
            onChange={(e) => onSelectArea({ name: e.target.value, zoneProfileId: activeArea?.zoneProfileId })}
            placeholder="Cold Storage"
            aria-label="Area name"
            className="w-40 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
          />
          <select
            value={activeArea?.zoneProfileId ?? ''}
            onChange={(e) =>
              onSelectArea({
                name: activeArea?.name ?? '',
                zoneProfileId: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            aria-label="Zone profile"
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
          >
            <option value="">No zone profile</option>
            {zoneProfiles.map((zp) => (
              <option key={zp.id} value={zp.id}>{zp.name}</option>
            ))}
          </select>
          {areaNames.length > 0 && (
            <>
              <span className="pl-1 text-[11px] text-stone-400">or extend</span>
              {areaNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSelectArea({ name, zoneProfileId: activeArea?.zoneProfileId })}
                  className={`rounded-full border px-2 py-0.5 text-[11px] btn-press ${
                    activeArea?.name === name
                      ? 'border-emerald-500/40 bg-white text-emerald-700'
                      : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </>
          )}
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
