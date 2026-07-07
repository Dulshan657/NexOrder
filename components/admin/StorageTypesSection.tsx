// Admin management for the tenant-global storage-unit type catalogue (Pallet
// Rack, Shelving, Bulk Floor, Cold Room, …). Types supply default capacity/slot
// behaviour that pre-fills a rack when it's placed in the Layout Designer. Types
// are never hard-deleted (racks reference them) — deactivate hides them from the
// pickers. Rendered as a section in Settings, beside Warehouses.

import React, { useState } from 'react';
import { Boxes, Plus, Pencil, Power, X, Snowflake } from 'lucide-react';
import {
  useStorageTypes,
  useCreateStorageType,
  useUpdateStorageType,
  useDeactivateStorageType,
} from '../../hooks/queries/useStorageTypes';
import type { SlotUnit, StorageType } from '../../types';

const SLOT_UNITS: SlotUnit[] = ['pallet', 'carton', 'each', 'uncounted'];

interface FormState {
  code: string;
  name: string;
  slotUnit: SlotUnit;
  defaultCapacitySlots: string; // kept as string for the input; '' = none
  isCold: boolean;
  sortOrder: string;
}

const emptyForm: FormState = { code: '', name: '', slotUnit: 'pallet', defaultCapacitySlots: '', isCold: false, sortOrder: '100' };

function toForm(t: StorageType): FormState {
  return {
    code: t.code,
    name: t.name,
    slotUnit: t.slotUnit,
    defaultCapacitySlots: t.defaultCapacitySlots != null ? String(t.defaultCapacitySlots) : '',
    isCold: t.attributes?.is_cold === true,
    sortOrder: String(t.sortOrder),
  };
}

const StorageTypesSection: React.FC = () => {
  const { data: types, isLoading, isError } = useStorageTypes();
  const createType = useCreateStorageType();
  const updateType = useUpdateStorageType();
  const deactivateType = useDeactivateStorageType();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StorageType | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setError(null); setFormOpen(true); };
  const openEdit = (t: StorageType) => { setEditing(t); setForm(toForm(t)); setError(null); setFormOpen(true); };

  const save = async () => {
    setError(null);
    const capacity = form.defaultCapacitySlots.trim() === '' ? null : Number(form.defaultCapacitySlots);
    if (capacity != null && (!Number.isFinite(capacity) || capacity < 0)) {
      setError('Default capacity must be a non-negative number.');
      return;
    }
    const attributes = form.isCold ? { is_cold: true } : {};
    const sortOrder = Number(form.sortOrder) || 100;
    try {
      if (editing) {
        await updateType.mutateAsync({
          id: editing.id,
          patch: { name: form.name, slotUnit: form.slotUnit, defaultCapacitySlots: capacity, attributes, sortOrder },
        });
      } else {
        if (!form.code.trim() || !form.name.trim()) { setError('Code and name are required.'); return; }
        await createType.mutateAsync({
          code: form.code, name: form.name, slotUnit: form.slotUnit,
          defaultCapacitySlots: capacity, attributes, sortOrder,
        });
      }
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save storage type.');
    }
  };

  const saving = createType.isPending || updateType.isPending;

  return (
    <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-nexgen-blue" />
          <h3 className="text-base font-display font-bold text-stone-900">Storage types</h3>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
        >
          <Plus className="w-4 h-4" /> Add type
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Physical storage kinds used across the warehouses. Choosing one when placing a rack in the Layout
        Designer pre-fills its capacity and slot unit.
      </p>

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : isError ? (
        <p className="text-sm text-red-600">Couldn't load storage types.</p>
      ) : (types ?? []).length === 0 ? (
        <div className="text-center py-8 text-sm text-stone-500">No storage types yet. Add your first one.</div>
      ) : (
        <div className="space-y-2">
          {(types ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-stone-200 bg-white">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-display font-bold text-stone-900 truncate">{t.name}</p>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{t.code}</span>
                  {t.attributes?.is_cold === true && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700">
                      <Snowflake className="w-3 h-3" /> Cold
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 mt-0.5">
                  {t.slotUnit} · {t.defaultCapacitySlots != null ? `${t.defaultCapacitySlots} default slots` : 'uncounted'}
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
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-700">{editing ? `Edit ${editing.name}` : 'New storage type'}</h3>
              <button onClick={() => setFormOpen(false)} className="p-1.5 rounded-lg hover:bg-stone-100 btn-press" aria-label="Close">
                <X className="w-4 h-4 text-stone-500" />
              </button>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-stone-500 col-span-2">
                Name
                <input
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block text-xs text-stone-500">
                Code
                <input
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 font-mono disabled:bg-stone-50 disabled:text-stone-400"
                  value={form.code}
                  disabled={!!editing}
                  placeholder="PALLET_RACK"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <label className="block text-xs text-stone-500">
                Slot unit
                <select
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.slotUnit}
                  onChange={(e) => setForm({ ...form, slotUnit: e.target.value as SlotUnit })}
                >
                  {SLOT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="block text-xs text-stone-500">
                Default capacity (slots)
                <input
                  type="number" min={0}
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.defaultCapacitySlots}
                  placeholder="—"
                  onChange={(e) => setForm({ ...form, defaultCapacitySlots: e.target.value })}
                />
              </label>
              <label className="block text-xs text-stone-500">
                Sort order
                <input
                  type="number"
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-stone-600 col-span-2 mt-1">
                <input type="checkbox" checked={form.isCold} onChange={(e) => setForm({ ...form, isCold: e.target.checked })} />
                Cold storage
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button className="text-sm px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={() => setFormOpen(false)}>Cancel</button>
              <button
                className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-50"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StorageTypesSection;
