// Shared level editor for a single rack — one component, two mounts (Layout
// Designer's PlacementInspector for drafts, the Warehouse tab's BinDetailPanel
// for live racks). Renders the rack front-on as a vertical stack, TOP level
// first (so L5 sits above L1, the way a person looks at a physical rack),
// even though the underlying `levels` array is ordered bottom-first (see the
// prop contract below) — that ordering matches `rackLevels.ts`'s convention.
//
// This is an inline panel, not an overlay: it renders no full-screen backdrop,
// so it needs no `<Modal>`/`<Sheet>`. (Don't write the literal backdrop class
// name in this file even in prose — scripts/check-overlays.mjs is a plain text
// scan and will fail CI on the comment.)

import { useId } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import type { LevelRole, RackLevel, LevelRoleRecord } from '@/types'
import { Field, Input, Select } from '@/components/ui'
import { defaultRoleKey, roleTint, sortedRoles } from '@/lib/levelRoles'
import type { RoleTint } from '@/lib/levelRoles'
import { addLevel, applyTemplate, matchesTemplate, rackCodeFromLevels, removeLevel, setLevelCapacity, setLevelRole } from './rackLevels'

/** Which surface this editor is mounted on.
 *
 *  'instance' — a real rack (Layout Designer draft or the Warehouse tab's live
 *  rack). Levels have location codes and may show a fill bar.
 *  'template'  — a storage form's STANDARD level layout in Settings. There are
 *  no codes and no stock, so neither is rendered.
 *
 *  The template mode exists to retire `LevelTemplateEditor`, the near-identical
 *  copy that lived inside StorageFormsView because this component did not exist
 *  yet. Both emitted `data-testid="level-role-select-<n>"`, so the E2E selectors
 *  collided; the testid is now mode-scoped. */
export type RackLevelEditorMode = 'instance' | 'template'

export interface RackLevelEditorProps {
  /** Bottom level first (levelIndex 1 = bottom). Rendered TOP level first. */
  levels: RackLevel[]
  /** The operator-managed role vocabulary (mig 00081), from useLevelRoles().
   *  Passed in rather than fetched so this component stays pure and testable —
   *  and so the same array drives the dropdown and the tints. */
  roles: LevelRoleRecord[]
  mode?: RackLevelEditorMode
  /** The storage form's standard template, for the "reset to standard" action. */
  template?: RackLevel[]
  /** Per-level fill fraction 0..1, keyed by levelIndex. Live surfaces pass this;
   *  the designer passes nothing. */
  fillByLevel?: ReadonlyMap<number, number>
  /** Per-level location code, keyed by levelIndex (live surfaces only). */
  codeByLevel?: ReadonlyMap<number, string>
  /** Which level is currently selected/highlighted, if any. */
  selectedLevelIndex?: number | null
  onSelectLevel?: (levelIndex: number | null) => void
  /** Omit or pass readOnly to render a non-editable stack. */
  readOnly?: boolean
  onChange?: (levels: RackLevel[]) => void
}

interface LevelRowProps {
  idPrefix: string
  mode: RackLevelEditorMode
  level: RackLevel
  roles: LevelRoleRecord[]
  tint: RoleTint
  code?: string
  fill?: number
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onSetRole: (role: LevelRole) => void
  onSetCapacity: (capacitySlots?: number) => void
  onSetWeight: (weightCapacityKg?: number) => void
  onRemove: () => void
}

// A plain function, not a JSX-invoked component: `RackLevelEditor` calls it
// directly inside `.map()` and puts `key` on the intrinsic `<div>` it returns.
// That sidesteps the repo's types gotcha (no `@types/react` means there's no
// `JSX.LibraryManagedAttributes` to exempt `key` from a component's declared
// props, so a real `key={...}` on a JSX-tag-invoked custom component fails
// type-checking here). It also means no hook calls live in here — `roleId`
// etc. are derived from `idPrefix` (set once, from `useId()`, by the caller)
// instead of calling `useId()` per row, which a variable-length `.map()`
// cannot do without breaking the rules of hooks.
function levelRow(props: LevelRowProps) {
  const { idPrefix, mode, level, roles, tint, code, fill, selected, readOnly, onSelect, onSetRole, onSetCapacity, onSetWeight, onRemove } = props
  const roleId = `${idPrefix}-role-${level.levelIndex}`
  const capId = `${idPrefix}-cap-${level.levelIndex}`
  const weightId = `${idPrefix}-weight-${level.levelIndex}`
  const displayCode = code ?? level.code ?? `L${level.levelIndex}`
  // A level may still carry a role an operator has since deactivated. Keep that
  // role selectable on THIS row so opening the editor cannot silently rewrite it
  // to something else the moment the form is saved.
  const options = sortedRoles(roles)
  const roleOptions = options.some((r) => r.key === level.role)
    ? options
    : [...options, ...roles.filter((r) => r.key === level.role)]

  return (
    <div
      key={level.levelIndex}
      role="listitem"
      data-testid={`level-row-${level.levelIndex}`}
      onClick={onSelect}
      className="rounded-lg border p-2 space-y-2 cursor-pointer transition-colors"
      style={{
        backgroundColor: tint.bg,
        borderColor: selected ? '#0f172a' : tint.border,
        borderWidth: selected ? 2 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono font-semibold" style={{ color: tint.text }}>
          L{level.levelIndex}{mode === 'instance' && (code || level.code) ? ` · ${displayCode}` : ''}
        </span>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Remove level ${level.levelIndex}`}
            className="text-stone-400 hover:text-red-600 btn-press"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2" onClick={(e) => e.stopPropagation()}>
        <Field label="Role" htmlFor={roleId}>
          <Select
            id={roleId}
            dense
            value={level.role}
            disabled={readOnly}
            onChange={(e) => onSetRole(e.target.value as LevelRole)}
            data-testid={`level-role-select-${mode}-${level.levelIndex}`}
          >
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.displayName}{r.isActive ? '' : ' (retired)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Capacity" htmlFor={capId}>
          <Input
            id={capId}
            dense
            type="number"
            min={0}
            value={level.capacitySlots ?? ''}
            disabled={readOnly}
            onChange={(e) => onSetCapacity(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </Field>
        <Field label="Weight (kg)" htmlFor={weightId}>
          <Input
            id={weightId}
            dense
            type="number"
            min={0}
            placeholder="no limit"
            value={level.weightCapacityKg ?? ''}
            disabled={readOnly}
            onChange={(e) => onSetWeight(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </Field>
      </div>

      {fill != null && (
        <div>
          <div className="h-1.5 rounded-full bg-white/70 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%`, backgroundColor: tint.bar }}
            />
          </div>
          <p className="text-[11px] text-stone-500 mt-0.5">{Math.round(fill * 100)}% full</p>
        </div>
      )}
    </div>
  )
}

export function RackLevelEditor(props: RackLevelEditorProps) {
  const {
    levels,
    roles,
    mode = 'instance',
    template,
    fillByLevel,
    codeByLevel,
    selectedLevelIndex = null,
    onSelectLevel,
    readOnly = false,
    onChange,
  } = props

  const idPrefix = useId()
  const topFirst = [...levels].sort((a, b) => b.levelIndex - a.levelIndex)
  const canResetToStandard = !readOnly && !!template && !matchesTemplate(levels, template)

  const emit = (next: RackLevel[]) => onChange?.(next)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Levels</h5>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {canResetToStandard && (
              <button
                type="button"
                className="text-[11px] flex items-center gap-1 text-stone-500 hover:text-stone-700 btn-press"
                onClick={() => emit(applyTemplate(template!, rackCodeFromLevels(levels)))}
              >
                <RotateCcw size={12} /> Reset to form standard
              </button>
            )}
            <button
              type="button"
              aria-label="Add level"
              className="text-[11px] flex items-center gap-1 text-emerald-700 hover:text-emerald-800 btn-press"
              onClick={() => emit(addLevel(levels, defaultRoleKey(roles)))}
            >
              <Plus size={12} /> Add level
            </button>
          </div>
        )}
      </div>

      <div role="list" className="space-y-1.5">
        {topFirst.map((level) => levelRow({
          idPrefix,
          mode,
          level,
          roles,
          tint: roleTint(roles, level.role),
          code: mode === 'instance' ? codeByLevel?.get(level.levelIndex) : undefined,
          fill: mode === 'instance' ? fillByLevel?.get(level.levelIndex) : undefined,
          selected: selectedLevelIndex === level.levelIndex,
          readOnly,
          onSelect: () => onSelectLevel?.(level.levelIndex),
          onSetRole: (role) => emit(setLevelRole(levels, level.levelIndex, role)),
          onSetCapacity: (capacitySlots) => emit(setLevelCapacity(levels, level.levelIndex, { capacitySlots })),
          onSetWeight: (weightCapacityKg) => emit(setLevelCapacity(levels, level.levelIndex, { weightCapacityKg })),
          onRemove: () => emit(removeLevel(levels, level.levelIndex)),
        }))}
      </div>
    </div>
  )
}
