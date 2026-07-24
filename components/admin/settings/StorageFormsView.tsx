// Settings → Warehouse → Storage Forms & Capacity.
//
// Dedicated screen for the storage-forms catalogue (mig 00061): each form (tall
// steel racks, bins, shelving, staging…) carries structured capacity
// (levels × positions → derived slots, or a flat slot count), a weight limit
// (enforced in putaway), physical dimensions, a palette colour, and a drawable
// flag so it can be placed on the Layout Designer. Editing a form's capacity
// prompts whether to retro-apply it to units already placed in published layouts.

import React, { useMemo, useState } from 'react'
import { Boxes, Plus, Pencil, Power, Snowflake, PencilRuler, Layers, Trash2 } from 'lucide-react'
import { Button, Modal, Toggle } from '../../ui'
import {
  useStorageTypes,
  useCreateStorageType,
  useUpdateStorageType,
  useDeactivateStorageType,
} from '../../../hooks/queries/useStorageTypes'
import { useToasts } from '../../../hooks/useToasts'
import { deriveCapacitySlots, capacityModeOf, type CapacityMode } from '../../../lib/storageFormCapacity'
import type { LevelRole, RackLevel, SlotUnit, StorageType } from '../../../types'

const SLOT_UNITS: SlotUnit[] = ['pallet', 'carton', 'each', 'uncounted']
const PRESET_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#78716c']
const LEVEL_ROLES: LevelRole[] = ['pick', 'reserve', 'bulk']

interface FormState {
  code: string
  name: string
  slotUnit: SlotUnit
  capacityMode: CapacityMode
  levels: string
  positionsPerLevel: string
  flatSlots: string
  weightCapacityKg: string
  lengthCm: string
  widthCm: string
  heightCm: string
  color: string
  isDrawable: boolean
  isCold: boolean
  sortOrder: string
  // Rack levels (mig 00072): the STANDARD layout every rack drawn with this
  // form inherits. Opt-in — meaningless for Bulk Floor / Staging Area.
  hasLevels: boolean
  levelTemplate: RackLevel[]
}

const emptyForm: FormState = {
  code: '', name: '', slotUnit: 'pallet', capacityMode: 'structured',
  levels: '', positionsPerLevel: '', flatSlots: '', weightCapacityKg: '',
  lengthCm: '', widthCm: '', heightCm: '', color: PRESET_COLORS[0], isDrawable: true, isCold: false, sortOrder: '100',
  hasLevels: false, levelTemplate: [],
}

function toForm(t: StorageType): FormState {
  const mode = capacityModeOf(t)
  return {
    code: t.code,
    name: t.name,
    slotUnit: t.slotUnit,
    capacityMode: mode,
    levels: t.levels != null ? String(t.levels) : '',
    positionsPerLevel: t.positionsPerLevel != null ? String(t.positionsPerLevel) : '',
    flatSlots: mode === 'flat' && t.defaultCapacitySlots != null ? String(t.defaultCapacitySlots) : '',
    weightCapacityKg: t.weightCapacityKg != null ? String(t.weightCapacityKg) : '',
    lengthCm: t.lengthCm != null ? String(t.lengthCm) : '',
    widthCm: t.widthCm != null ? String(t.widthCm) : '',
    heightCm: t.heightCm != null ? String(t.heightCm) : '',
    color: t.color ?? PRESET_COLORS[0],
    isDrawable: t.isDrawable,
    isCold: t.attributes?.is_cold === true,
    sortOrder: String(t.sortOrder),
    // `hasLevels`/`levelTemplate` aren't wired through the adapter yet (mig
    // 00072 lands them on `storage_types`) — default to "no levels" until then.
    hasLevels: t.hasLevels ?? false,
    levelTemplate: t.levelTemplate ?? [],
  }
}

/** Renumber to a contiguous 1..N after an add/remove so `levelIndex` never
 *  has a gap — L1 is always the bottom level. */
function renumbered(levels: RackLevel[]): RackLevel[] {
  return levels.map((l, i) => ({ ...l, levelIndex: i + 1 }))
}

/** Compact standard-level-template editor. A drop-in swap for the shared
 *  `RackLevelEditor` (components/warehouse/levels/), which another agent is
 *  building for the per-rack case — that component isn't on disk yet, so this
 *  form-scoped editor stands in rather than shipping a broken import. */
function LevelTemplateEditor({
  levels,
  onChange,
}: {
  levels: RackLevel[]
  onChange: (next: RackLevel[]) => void
}) {
  const addLevel = () => onChange(renumbered([...levels, { levelIndex: levels.length + 1, role: 'pick' }]))
  const removeLevel = (index: number) => onChange(renumbered(levels.filter((_, i) => i !== index)))
  const setRole = (index: number, role: LevelRole) =>
    onChange(levels.map((l, i) => (i === index ? { ...l, role } : l)))
  const setCapacity = (index: number, value: string) =>
    onChange(levels.map((l, i) => (i === index ? { ...l, capacitySlots: value === '' ? undefined : Number(value) } : l)))
  const setWeight = (index: number, value: string) =>
    onChange(levels.map((l, i) => (i === index ? { ...l, weightCapacityKg: value === '' ? undefined : Number(value) } : l)))

  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-stone-600 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> Standard levels
        </p>
        <button
          type="button"
          onClick={addLevel}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-stone-200 text-stone-600 btn-press"
        >
          <Plus className="w-3.5 h-3.5" /> Add level
        </button>
      </div>
      <p className="text-[11px] text-stone-500">
        Every new rack drawn with this form starts with this layout — L1 is the bottom level. Individual racks can
        override it afterward without changing the standard.
      </p>

      {levels.length === 0 ? (
        <p className="text-xs text-stone-400 py-2">No levels defined yet. Add at least one.</p>
      ) : (
        <div className="space-y-1.5">
          {levels.map((level, i) => (
            <div key={i} className="flex items-center gap-2 bg-stone-50 rounded-md px-2 py-1.5">
              <span className="text-xs font-mono text-stone-500 w-8 shrink-0">L{level.levelIndex}</span>
              <select
                value={level.role}
                onChange={(e) => setRole(i, e.target.value as LevelRole)}
                aria-label={`Role for level ${level.levelIndex}`}
                className="flex-1 text-xs border border-stone-200 rounded px-2 py-1 bg-white"
              >
                {LEVEL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                type="number"
                min={0}
                placeholder="slots"
                value={level.capacitySlots ?? ''}
                onChange={(e) => setCapacity(i, e.target.value)}
                aria-label={`Capacity slots for level ${level.levelIndex}`}
                className="w-20 text-xs border border-stone-200 rounded px-2 py-1"
              />
              <input
                type="number"
                min={0}
                placeholder="kg"
                value={level.weightCapacityKg ?? ''}
                onChange={(e) => setWeight(i, e.target.value)}
                aria-label={`Weight capacity (kg) for level ${level.levelIndex}`}
                className="w-16 text-xs border border-stone-200 rounded px-2 py-1"
              />
              <button
                type="button"
                onClick={() => removeLevel(i)}
                className="p-1 rounded hover:bg-red-50 btn-press shrink-0"
                aria-label={`Remove level ${level.levelIndex}`}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s))

const StorageFormsView: React.FC = () => {
  const { data: types, isLoading, isError } = useStorageTypes()
  const createType = useCreateStorageType()
  const updateType = useUpdateStorageType()
  const deactivateType = useDeactivateStorageType()
  const { addToast } = useToasts()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StorageType | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  // Holds the resolved patch while the retro-apply choice is pending (edit only).
  const [pendingApply, setPendingApply] = useState<{ patch: Record<string, unknown>; id: number } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const openCreate = () => { setEditing(null); setForm(emptyForm); setError(null); setFormOpen(true) }
  const openEdit = (t: StorageType) => { setEditing(t); setForm(toForm(t)); setError(null); setFormOpen(true) }

  const derivedSlots = useMemo(
    () => deriveCapacitySlots({
      mode: form.capacityMode,
      levels: numOrNull(form.levels),
      positionsPerLevel: numOrNull(form.positionsPerLevel),
      flatSlots: numOrNull(form.flatSlots),
    }),
    [form.capacityMode, form.levels, form.positionsPerLevel, form.flatSlots],
  )

  // Drives the Modal's discard-confirm guard: compares the live form against
  // whatever it was seeded from (the edited type, or the blank template).
  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(editing ? toForm(editing) : emptyForm),
    [form, editing],
  )

  /** Build the create/update payload from the form (camelCase for the service).
   *  `hasLevels`/`levelTemplate` aren't in `StorageTypeInput` yet — another
   *  agent is extending `mutate-storage-type` to accept them (mig 00072); sent
   *  ahead of that landing so no further frontend change is needed once it does. */
  const buildPatch = () => {
    const structured = form.capacityMode === 'structured'
    return {
      name: form.name,
      slotUnit: form.slotUnit,
      defaultCapacitySlots: derivedSlots,
      levels: structured ? numOrNull(form.levels) : null,
      positionsPerLevel: structured ? numOrNull(form.positionsPerLevel) : null,
      weightCapacityKg: numOrNull(form.weightCapacityKg),
      lengthCm: numOrNull(form.lengthCm),
      widthCm: numOrNull(form.widthCm),
      heightCm: numOrNull(form.heightCm),
      color: form.color,
      isDrawable: form.isDrawable,
      attributes: form.isCold ? { is_cold: true } : {},
      sortOrder: Number(form.sortOrder) || 100,
      hasLevels: form.hasLevels,
      levelTemplate: form.hasLevels && form.levelTemplate.length > 0 ? form.levelTemplate : null,
    }
  }

  const commitUpdate = async (id: number, patch: Record<string, unknown>, applyToExisting: boolean) => {
    const { appliedToUnits } = await updateType.mutateAsync({ id, patch, applyToExisting })
    setFormOpen(false)
    setPendingApply(null)
    setApplyError(null)
    addToast(
      applyToExisting && appliedToUnits > 0
        ? `Saved — capacity applied to ${appliedToUnits} existing unit${appliedToUnits === 1 ? '' : 's'}.`
        : 'Storage form saved.',
      'success',
    )
  }

  const closeApplyPrompt = () => {
    setPendingApply(null)
    setApplyError(null)
  }

  /** Retro-apply confirm: surface failures on the prompt itself, and keep it open so
   *  the operator can retry or pick the other option. */
  const runApply = async (applyToExisting: boolean) => {
    if (!pendingApply) return
    setApplyError(null)
    try {
      await commitUpdate(pendingApply.id, pendingApply.patch, applyToExisting)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to save storage form.')
    }
  }

  const save = async () => {
    setError(null)
    if (!editing && (!form.code.trim() || !form.name.trim())) { setError('Code and name are required.'); return }
    if (!form.name.trim()) { setError('Name is required.'); return }
    const weight = numOrNull(form.weightCapacityKg)
    if (weight != null && (!Number.isFinite(weight) || weight < 0)) { setError('Weight capacity must be a non-negative number.'); return }
    if (form.hasLevels && form.levelTemplate.length === 0) { setError('Add at least one level, or turn levels off.'); return }

    const patch = buildPatch()
    try {
      if (editing) {
        // "Ask each time": if capacity or weight changed, prompt to retro-apply.
        const capacityChanged =
          (patch.defaultCapacitySlots ?? null) !== (editing.defaultCapacitySlots ?? null) ||
          (patch.weightCapacityKg ?? null) !== (editing.weightCapacityKg ?? null)
        if (capacityChanged) { setPendingApply({ patch, id: editing.id }); return }
        await commitUpdate(editing.id, patch, false)
      } else {
        await createType.mutateAsync({ code: form.code, ...patch } as any)
        setFormOpen(false)
        addToast('Storage form created.', 'success')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save storage form.')
    }
  }

  const saving = createType.isPending || updateType.isPending

  const capacityLabel = (t: StorageType): string => {
    if (t.levels != null && t.positionsPerLevel != null) {
      return `${t.levels}×${t.positionsPerLevel} = ${(t.levels * t.positionsPerLevel)} ${t.slotUnit} slots`
    }
    return t.defaultCapacitySlots != null ? `${t.defaultCapacitySlots} ${t.slotUnit} slots` : 'uncounted'
  }

  return (
    <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-nexgen-blue" />
          <h3 className="text-base font-display font-bold text-stone-900">Storage forms & capacity</h3>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
        >
          <Plus className="w-4 h-4" /> Add form
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Each form of storage (steel racks, bins, shelving, staging…) with its capacity, weight limit and
        dimensions. Drawable forms appear as tools in the Layout Designer; weight limits are enforced during putaway.
      </p>

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : isError ? (
        <p className="text-sm text-red-600">Couldn't load storage forms.</p>
      ) : (types ?? []).length === 0 ? (
        <div className="text-center py-8 text-sm text-stone-500">No storage forms yet. Add your first one.</div>
      ) : (
        <div className="space-y-2">
          {(types ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-stone-200 bg-white">
              <span className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: t.color ?? '#94a3b8' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-display font-bold text-stone-900 truncate">{t.name}</p>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{t.code}</span>
                  {t.isDrawable && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                      <PencilRuler className="w-3 h-3" /> Drawable
                    </span>
                  )}
                  {t.attributes?.is_cold === true && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700">
                      <Snowflake className="w-3 h-3" /> Cold
                    </span>
                  )}
                  {t.hasLevels && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
                      <Layers className="w-3 h-3" /> {(t.levelTemplate ?? []).length || '?'} levels
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  {capacityLabel(t)}
                  {t.weightCapacityKg != null && <span> · ≤ {t.weightCapacityKg} kg</span>}
                  {(t.lengthCm != null || t.widthCm != null || t.heightCm != null) && (
                    <span> · {t.lengthCm ?? '—'}×{t.widthCm ?? '—'}×{t.heightCm ?? '—'} cm</span>
                  )}
                </p>
              </div>
              <button onClick={() => openEdit(t)} className="p-2 rounded-lg hover:bg-stone-100 btn-press" aria-label={`Edit ${t.name}`}>
                <Pencil className="w-4 h-4 text-stone-500" />
              </button>
              <button
                onClick={() => deactivateType.mutate(t.id)}
                disabled={deactivateType.isPending}
                className="p-2 rounded-lg hover:bg-red-50 btn-press disabled:opacity-50"
                aria-label={`Deactivate ${t.name}`}
                title="Deactivate"
              >
                <Power className="w-4 h-4 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        title={editing ? `Edit ${editing.name}` : 'New storage form'}
        dirty={isDirty}
        discardConfirm={{
          title: 'Discard this storage form?',
          message: 'Your unsaved changes will be lost.',
          confirmLabel: 'Discard',
        }}
        footer={({ requestClose }) => (
          <div className="flex justify-end gap-2">
            <button className="text-sm px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={requestClose}>Cancel</button>
            <button className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create form'}
            </button>
          </div>
        )}
      >
          <div className="space-y-4">
            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-stone-500 col-span-2">
                Name
                <input className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Steel Pallet Rack" />
              </label>
              <label className="block text-xs text-stone-500">
                Code
                <input className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 font-mono disabled:bg-stone-50 disabled:text-stone-400"
                  value={form.code} disabled={!!editing} placeholder="PALLET_RACK"
                  onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </label>
              <label className="block text-xs text-stone-500">
                Slot unit
                <select className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5" value={form.slotUnit}
                  onChange={(e) => setForm({ ...form, slotUnit: e.target.value as SlotUnit })}>
                  {SLOT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            </div>

            {/* Capacity model */}
            <div className="rounded-lg border border-stone-200 p-3 space-y-2">
              <div className="flex items-center gap-4 text-xs font-medium text-stone-600">
                <span>Capacity</span>
                <label className="flex items-center gap-1.5 font-normal">
                  <input type="radio" checked={form.capacityMode === 'structured'} onChange={() => setForm({ ...form, capacityMode: 'structured' })} />
                  Structured (levels × positions)
                </label>
                <label className="flex items-center gap-1.5 font-normal">
                  <input type="radio" checked={form.capacityMode === 'flat'} onChange={() => setForm({ ...form, capacityMode: 'flat' })} />
                  Flat count
                </label>
              </div>
              {form.capacityMode === 'structured' ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs text-stone-500">
                    Levels
                    <input type="number" min={0} className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                      value={form.levels} onChange={(e) => setForm({ ...form, levels: e.target.value })} />
                  </label>
                  <label className="block text-xs text-stone-500">
                    Positions / level
                    <input type="number" min={0} className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                      value={form.positionsPerLevel} onChange={(e) => setForm({ ...form, positionsPerLevel: e.target.value })} />
                  </label>
                </div>
              ) : (
                <label className="block text-xs text-stone-500">
                  Slots
                  <input type="number" min={0} className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                    value={form.flatSlots} placeholder="—" onChange={(e) => setForm({ ...form, flatSlots: e.target.value })} />
                </label>
              )}
              <p className="text-[11px] text-stone-500">
                Effective capacity: <span className="font-mono font-semibold text-stone-700">{derivedSlots ?? 'uncounted'}</span>
                {derivedSlots != null && ` ${form.slotUnit} slots per unit`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-stone-500">
                Weight capacity (kg)
                <input type="number" min={0} className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.weightCapacityKg} placeholder="no limit" onChange={(e) => setForm({ ...form, weightCapacityKg: e.target.value })} />
              </label>
              <label className="block text-xs text-stone-500">
                Sort order
                <input type="number" className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
              </label>
              <div className="col-span-2">
                <p className="text-xs text-stone-500 mb-1">Dimensions (cm) — length × width × height</p>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" min={0} className="w-full text-sm border border-stone-200 rounded px-2 py-1.5" placeholder="L"
                    value={form.lengthCm} onChange={(e) => setForm({ ...form, lengthCm: e.target.value })} />
                  <input type="number" min={0} className="w-full text-sm border border-stone-200 rounded px-2 py-1.5" placeholder="W"
                    value={form.widthCm} onChange={(e) => setForm({ ...form, widthCm: e.target.value })} />
                  <input type="number" min={0} className="w-full text-sm border border-stone-200 rounded px-2 py-1.5" placeholder="H"
                    value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Colour + flags */}
            <div className="space-y-2">
              <p className="text-xs text-stone-500">Palette colour</p>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={`w-6 h-6 rounded-md border-2 btn-press ${form.color === c ? 'border-stone-800' : 'border-transparent'}`}
                    style={{ backgroundColor: c }} aria-label={`Colour ${c}`} />
                ))}
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="w-8 h-8 rounded border border-stone-200 bg-white p-0.5" aria-label="Custom colour" />
              </div>
              <div className="flex items-center gap-5 pt-1">
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input type="checkbox" checked={form.isDrawable} onChange={(e) => setForm({ ...form, isDrawable: e.target.checked })} />
                  Drawable in Layout Designer
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600">
                  <input type="checkbox" checked={form.isCold} onChange={(e) => setForm({ ...form, isCold: e.target.checked })} />
                  Cold storage
                </label>
              </div>
            </div>

            {/* Rack levels (mig 00072) */}
            <div className="rounded-lg border border-stone-200 p-3 space-y-3">
              <Toggle
                checked={form.hasLevels}
                onChange={(next) => setForm({ ...form, hasLevels: next, levelTemplate: next ? form.levelTemplate : [] })}
                label="This form has addressable levels"
                description="Splits every rack drawn with this form into individually-addressable levels, each with its own pick/reserve/bulk role. Leave off for forms where levels don't apply, like Bulk Floor or Staging Area."
              />
              {form.hasLevels && (
                <LevelTemplateEditor
                  levels={form.levelTemplate}
                  onChange={(next) => setForm({ ...form, levelTemplate: next })}
                />
              )}
            </div>
          </div>
      </Modal>

      {/* Retro-apply prompt ("ask each time") — three outcomes, so a Modal. */}
      <Modal
        open={pendingApply !== null}
        onClose={closeApplyPrompt}
        size="sm"
        title="Apply capacity to existing units?"
      >
        <p className="text-xs text-stone-500">
          You changed this form's capacity or weight limit. Apply it to every unit of this form already placed in
          published layouts, or only to units drawn from now on?
        </p>

        {/* This prompt owns its error. It used to write to the form modal's `error`,
            which renders underneath this overlay — so a failed apply left the prompt
            open over an error nobody could see. */}
        {applyError && (
          <p className="text-xs text-red-600 mt-3" role="alert">
            {applyError}
          </p>
        )}

        <div className="flex flex-col gap-2 pt-4">
          <Button loading={updateType.isPending} onClick={() => runApply(true)}>
            Apply to all existing units
          </Button>
          <Button variant="secondary" disabled={updateType.isPending} onClick={() => runApply(false)}>
            New units only
          </Button>
          <Button variant="ghost" size="sm" disabled={updateType.isPending} onClick={closeApplyPrompt}>
            Cancel
          </Button>
        </div>
      </Modal>
    </section>
  )
}

export default StorageFormsView
