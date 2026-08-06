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
import { MAX_AREA_NAME, areaNameIssue, sanitizeAreaName } from '@/lib/locationNaming'
import { MAX_SIGN_NAME, sanitizeSignName, signNameIssue } from '@/lib/signPaint'

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
]

/** Tools that survive on a PUBLISHED layout. Areas and signs carry no routing
 *  weight, so publishing does not freeze them (migs 00095/00097); everything in
 *  TOOLS above draws or subtracts walkable cells and is draft-only. */
const AREA_SCOPE_TOOLS: readonly EditorTool[] = ['select']

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
  /** Areas stay editable for the life of a layout (mig 00095) — they carry no
   *  routing weight, so publishing does not freeze them the way it freezes
   *  placements and walls. */
  canEditAreas?: boolean
  /** A PUBLISHED layout: only the area tools are live, and Save routes to
   *  `paint_areas` rather than `save_geometry`. */
  areaOnly?: boolean
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
  /** What the next rack painted into the active area will be called, e.g.
   *  "Chiller · Rack 8" (mig 00094). Shown so the naming is visible while the
   *  operator draws, not discovered afterwards. */
  nextRackName?: string
  /** Sign texts already placed on this floor, so extending one is a click rather
   *  than retyping it exactly (a typo would start a second sign). */
  signNames: string[]
  activeSign: string | null
  onSelectSign: (name: string) => void
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
  isDraft, canEditAreas = false, areaOnly = false,
  tool, onSelectTool, forms, activeFormId, onSelectForm, onGenerate,
  areaNames, activeArea, onSelectArea, nextRackName,
  signNames, activeSign, onSelectSign, zoneProfiles, floorCount, floor, onSetFloor,
  dirty, saving, publishing, simulating, onSave, onPublish, onClone, onSimulate, onArchive, onImport,
}: LayoutToolbarProps) {
  // Blank is not an "issue" while the box is still empty — the operator has not
  // typed anything wrong yet, and nagging before the first keystroke is noise.
  // The reducer still refuses the stroke, and the toast explains why.
  const areaIssue = activeArea?.name ? areaNameIssue(activeArea.name) : null
  const signIssue = activeSign ? signNameIssue(activeSign) : null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ── Paint tools ─────────────────────────────────────────────────────
          Gated on canEditAreas rather than isDraft, because Area and Erase live
          inside this strip: gating the strip on isDraft would hide the whole
          thing on a published layout and take the area tool with it. Everything
          that touches frozen geometry is gated individually below. */}
      {canEditAreas && (
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-stone-200 bg-stone-50 p-1">
          {(areaOnly ? TOOLS.filter((t) => AREA_SCOPE_TOOLS.includes(t.tool)) : TOOLS).map(({ tool: t, label, icon: Icon }) => {
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

          {/* Storage forms — one coloured tool per drawable form. Draft only:
              a placement carries the frozen routing graph. */}
          {!isDraft ? null : forms.length === 0 ? (
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

          {/* Floor sign (mig 00097) — sits beside Area rather than in TOOLS
              because, like Area, it survives publishing: a `label` row is inert
              in buildWalkableCells, so it freezes nothing. Everything left in
              TOOLS draws or subtracts walkable cells. */}
          <button
            type="button"
            onClick={() => onSelectTool('label')}
            aria-pressed={tool === 'label'}
            title="Floor sign"
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors btn-press ${
              tool === 'label' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/40' : 'text-stone-600 hover:bg-white/70'
            }`}
          >
            <Tag className="h-4 w-4" strokeWidth={2} /> Sign
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
      {canEditAreas && tool === 'area' && (
        <div className="inline-flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-2 py-1.5">
          <span className="text-[11px] font-medium text-stone-400">Painting area</span>
          {/* sanitize + maxLength + the inline issue hint below all mirror the
              live map's AreaPaintToolbar, which has had them since 00095. Their
              absence here is why a bad name (a "·", or 200 characters) only
              surfaced as a bare INVALID_INPUT after the operator had painted
              fifty cells — and why the stored value could differ from the
              "Next rack drawn here…" preview, which does sanitize. */}
          <input
            value={activeArea?.name ?? ''}
            onChange={(e) => onSelectArea({ name: sanitizeAreaName(e.target.value), zoneProfileId: activeArea?.zoneProfileId })}
            placeholder="Cold Storage"
            aria-label="Area name"
            maxLength={MAX_AREA_NAME}
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
          {/* Two things the operator cannot otherwise know. The first is what the
              area is FOR now that it names the bins inside it. The second is that
              a draft points at the same `locations` rows as the published layout,
              so a rename here reaches live pick lists before publish — true of
              the storage-form repoint too, but names are what people read. */}
          <p className="w-full pt-0.5 text-[11px] leading-snug text-stone-400">
            {areaIssue
              // Shown while typing, so a rejected name is discovered before the
              // painting rather than after it.
              ? <span className="font-medium text-amber-600">{areaIssue}</span>
              : <>
                  {!areaOnly && nextRackName
                    ? <>Next rack drawn here will be called <span className="font-medium text-stone-500">{nextRackName}</span>. </>
                    : null}
                  {areaOnly
                    ? 'This layout is live. Saving replaces its areas and offers to rename the bins inside them — nothing else on the plan is touched.'
                    : 'Renaming an area renames every bin inside it — including on the live map, before you publish.'}
                </>}
          </p>
        </div>
      )}

      {/* What the Sign tool is currently painting (mig 00097). Same shape as the
          area bar above and deliberately NOT merged with it: there is no zone
          profile here, and offering one would make a sign an area by the back
          door. The prose is the other half of the distinction — an operator who
          has just been told areas rename bins needs to know this one does not. */}
      {canEditAreas && tool === 'label' && (
        <div className="inline-flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-2 py-1.5">
          <span className="text-[11px] font-medium text-stone-400">Sign text</span>
          <input
            value={activeSign ?? ''}
            onChange={(e) => onSelectSign(sanitizeSignName(e.target.value))}
            placeholder="Inbound Staging"
            aria-label="Sign text"
            maxLength={MAX_SIGN_NAME}
            className="w-48 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
          />
          {signNames.length > 0 && (
            <>
              <span className="pl-1 text-[11px] text-stone-400">or extend</span>
              {signNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSelectSign(name)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] btn-press ${
                    activeSign === name
                      ? 'border-emerald-500/40 bg-white text-emerald-700'
                      : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </>
          )}
          <p className="w-full pt-0.5 text-[11px] leading-snug text-stone-400">
            {signIssue
              ? <span className="font-medium text-amber-600">{signIssue}</span>
              : 'A sign is wayfinding text only — it renames no bins, sets no zone and changes no routing. Drag across cells to size it.'}
          </p>
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
        {/* Save areas is the ONLY document action a published layout gets. It
            routes to `paint_areas`, never to save_geometry — that is a full
            replace of every placement and object plus an orphan sweep, and on a
            live site those rows hold stock. */}
        {areaOnly && (
          <button type="button" className={actionBtn} onClick={onSave} disabled={saving || !dirty}>
            <Save className="h-4 w-4" strokeWidth={2} /> {dirty ? 'Save areas' : 'Areas saved'}
          </button>
        )}
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
