// Settings → Warehouse → Storage Forms & Capacity.
//
// Dedicated screen for the storage-forms catalogue (mig 00061): each form (tall
// steel racks, bins, shelving, staging…) carries structured capacity
// (levels × positions → derived slots, or a flat slot count), a weight limit
// (enforced in putaway), physical dimensions, a palette colour, and a drawable
// flag so it can be placed on the Layout Designer. Editing a form's capacity
// prompts whether to retro-apply it to units already placed in published layouts.

import React, { useMemo, useState } from 'react'
import { Boxes, Plus, Pencil, Power, X, Snowflake, PencilRuler } from 'lucide-react'
import {
  useStorageTypes,
  useCreateStorageType,
  useUpdateStorageType,
  useDeactivateStorageType,
} from '../../../hooks/queries/useStorageTypes'
import { useToasts } from '../../../hooks/useToasts'
import { deriveCapacitySlots, capacityModeOf, type CapacityMode } from '../../../lib/storageFormCapacity'
import type { SlotUnit, StorageType } from '../../../types'

const SLOT_UNITS: SlotUnit[] = ['pallet', 'carton', 'each', 'uncounted']
const PRESET_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#78716c']

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
}

const emptyForm: FormState = {
  code: '', name: '', slotUnit: 'pallet', capacityMode: 'structured',
  levels: '', positionsPerLevel: '', flatSlots: '', weightCapacityKg: '',
  lengthCm: '', widthCm: '', heightCm: '', color: PRESET_COLORS[0], isDrawable: true, isCold: false, sortOrder: '100',
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
  }
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

  /** Build the create/update payload from the form (camelCase for the service). */
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
    }
  }

  const commitUpdate = async (id: number, patch: Record<string, unknown>, applyToExisting: boolean) => {
    const { appliedToUnits } = await updateType.mutateAsync({ id, patch, applyToExisting })
    setFormOpen(false)
    setPendingApply(null)
    addToast(
      applyToExisting && appliedToUnits > 0
        ? `Saved — capacity applied to ${appliedToUnits} existing unit${appliedToUnits === 1 ? '' : 's'}.`
        : 'Storage form saved.',
      'success',
    )
  }

  const save = async () => {
    setError(null)
    if (!editing && (!form.code.trim() || !form.name.trim())) { setError('Code and name are required.'); return }
    if (!form.name.trim()) { setError('Name is required.'); return }
    const weight = numOrNull(form.weightCapacityKg)
    if (weight != null && (!Number.isFinite(weight) || weight < 0)) { setError('Weight capacity must be a non-negative number.'); return }

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

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setFormOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-700">{editing ? `Edit ${editing.name}` : 'New storage form'}</h3>
              <button onClick={() => setFormOpen(false)} className="p-1.5 rounded-lg hover:bg-stone-100 btn-press" aria-label="Close">
                <X className="w-4 h-4 text-stone-500" />
              </button>
            </div>

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

            <div className="flex justify-end gap-2">
              <button className="text-sm px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retro-apply prompt ("ask each time") */}
      {pendingApply && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setPendingApply(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-stone-800">Apply capacity to existing units?</h3>
            <p className="text-xs text-stone-500">
              You changed this form's capacity or weight limit. Apply it to every unit of this form already placed in
              published layouts, or only to units drawn from now on?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                className="text-sm px-3 py-2 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50"
                disabled={updateType.isPending}
                onClick={() => commitUpdate(pendingApply.id, pendingApply.patch, true).catch((e) => setError(e instanceof Error ? e.message : 'Failed'))}
              >
                Apply to all existing units
              </button>
              <button
                className="text-sm px-3 py-2 border border-stone-200 rounded-lg btn-press disabled:opacity-50"
                disabled={updateType.isPending}
                onClick={() => commitUpdate(pendingApply.id, pendingApply.patch, false).catch((e) => setError(e instanceof Error ? e.message : 'Failed'))}
              >
                New units only
              </button>
              <button className="text-xs text-stone-500 hover:text-stone-700 mt-1" onClick={() => setPendingApply(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default StorageFormsView
