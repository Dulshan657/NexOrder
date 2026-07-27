// Admin management for zone profiles — the operational semantics the putaway
// optimizer uses (priority weight + allowed-category gate + utilization target).
// The 8 standard profiles are seeded; operators can add their own custom types
// (mig 00057 made zone_type free text). Custom types work with priority + category
// rules but carry no built-in hazard/temperature logic. Rendered in Settings.

import React, { useMemo, useState } from 'react';
import { Layers, Plus, Pencil, Power } from 'lucide-react';
import {
  useZoneProfiles,
  useCreateZoneProfile,
  useUpdateZoneProfile,
  useDeactivateZoneProfile,
} from '../../hooks/queries/useZoneProfiles';
import { Button, Modal } from '../ui';
import type { ZoneProfile } from '../../types';

interface FormState {
  name: string;
  zoneType: string;
  priorityWeight: number;
  allowedCategories: string; // comma-separated; '' = any
  maxUtilizationPct: string;  // percent 0–100; '' = none
}

const emptyForm: FormState = { name: '', zoneType: '', priorityWeight: 0.5, allowedCategories: '', maxUtilizationPct: '' };

function toForm(p: ZoneProfile): FormState {
  return {
    name: p.name,
    zoneType: p.zoneType,
    priorityWeight: p.priorityWeight,
    allowedCategories: (p.allowedCategories ?? []).join(', '),
    maxUtilizationPct: p.maxUtilizationPct != null ? String(Math.round(p.maxUtilizationPct * 100)) : '',
  };
}

const ZoneProfilesSection: React.FC = () => {
  const { data: profiles, isLoading, isError } = useZoneProfiles();
  const createProfile = useCreateZoneProfile();
  const updateProfile = useUpdateZoneProfile();
  const deactivateProfile = useDeactivateZoneProfile();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ZoneProfile | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  // Dirty baseline. This section outlives any one dialog, so the baseline is captured
  // each time the dialog opens rather than once at mount.
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => (Object.keys(initialForm) as (keyof FormState)[]).some((key) => form[key] !== initialForm[key]),
    [form, initialForm],
  );

  const openForm = (profile: ZoneProfile | null) => {
    const next = profile ? toForm(profile) : emptyForm;
    setEditing(profile);
    setForm(next);
    setInitialForm(next);
    setError(null);
    setFormOpen(true);
  };

  const parseCategories = (raw: string): string[] | null => {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : null;
  };

  const save = async () => {
    setError(null);
    if (!form.name.trim() || !form.zoneType.trim()) { setError('Name and zone type are required.'); return; }
    const util = form.maxUtilizationPct.trim() === '' ? null : Number(form.maxUtilizationPct) / 100;
    if (util != null && (!Number.isFinite(util) || util < 0 || util > 1)) {
      setError('Utilization target must be between 0 and 100%.'); return;
    }
    const payload = {
      name: form.name,
      zoneType: form.zoneType,
      priorityWeight: form.priorityWeight,
      allowedCategories: parseCategories(form.allowedCategories),
      maxUtilizationPct: util,
    };
    try {
      if (editing) await updateProfile.mutateAsync({ id: editing.id, patch: payload });
      else await createProfile.mutateAsync(payload);
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save zone profile.');
    }
  };

  const deactivate = async (p: ZoneProfile) => {
    setRowError(null);
    try {
      await deactivateProfile.mutateAsync(p.id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to deactivate.');
    }
  };

  const saving = createProfile.isPending || updateProfile.isPending;

  return (
    <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-nexgen-blue" />
          <h3 className="text-base font-display font-bold text-stone-900">Zone profiles</h3>
        </div>
        <button
          onClick={() => openForm(null)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
        >
          <Plus className="w-4 h-4" /> Add profile
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        Zone semantics the putaway optimizer prefers toward. Assign a profile to a zone in the Layout Designer.
        Custom types work with priority and category rules — they don't add built-in hazard/temperature logic.
      </p>

      {rowError && <p className="text-sm text-red-600 mb-3">{rowError}</p>}

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : isError ? (
        <p className="text-sm text-red-600">Couldn't load zone profiles.</p>
      ) : (profiles ?? []).length === 0 ? (
        <div className="text-center py-8 text-sm text-stone-500">No zone profiles yet. Add your first one.</div>
      ) : (
        <div className="space-y-2">
          {(profiles ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-stone-200 bg-white">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-display font-bold text-stone-900 truncate">{p.name}</p>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{p.zoneType}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    priority {p.priorityWeight.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-0.5 truncate">
                  {p.allowedCategories && p.allowedCategories.length > 0
                    ? `Only: ${p.allowedCategories.join(', ')}`
                    : 'Any category'}
                  {p.maxUtilizationPct != null ? ` · target ${Math.round(p.maxUtilizationPct * 100)}%` : ''}
                </p>
              </div>
              <button onClick={() => openForm(p)} className="p-2 rounded-lg hover:bg-stone-100 btn-press" aria-label={`Edit ${p.name}`}>
                <Pencil className="w-4 h-4 text-stone-500" />
              </button>
              <button
                onClick={() => deactivate(p)}
                disabled={deactivateProfile.isPending}
                className="p-2 rounded-lg hover:bg-red-50 btn-press disabled:opacity-50"
                aria-label={`Deactivate ${p.name}`}
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
        size="md"
        dirty={isDirty}
        title={editing ? `Edit ${editing.name}` : 'New zone profile'}
        footer={({ requestClose }) => (
          <>
            <Button variant="secondary" onClick={requestClose}>Cancel</Button>
            <Button onClick={save} loading={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create profile'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-stone-500">
                Name
                <input
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block text-xs text-stone-500">
                Zone type
                <input
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 font-mono"
                  value={form.zoneType}
                  placeholder="fast_moving"
                  onChange={(e) => setForm({ ...form, zoneType: e.target.value })}
                />
              </label>
            </div>

            <label className="block text-xs text-stone-500">
              Priority weight — <span className="font-mono text-stone-700">{form.priorityWeight.toFixed(2)}</span>
              <input
                type="range" min={0} max={1} step={0.05}
                className="mt-1 w-full"
                value={form.priorityWeight}
                onChange={(e) => setForm({ ...form, priorityWeight: Number(e.target.value) })}
              />
              <span className="text-[10px] text-stone-400">Higher = the optimizer prefers this zone.</span>
            </label>

            <label className="block text-xs text-stone-500">
              Allowed categories (comma-separated; blank = any)
              <input
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                value={form.allowedCategories}
                placeholder="Fish, Noodles"
                onChange={(e) => setForm({ ...form, allowedCategories: e.target.value })}
              />
            </label>

            <label className="block text-xs text-stone-500">
              Max utilization target (%, optional)
              <input
                type="number" min={0} max={100}
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                value={form.maxUtilizationPct}
                placeholder="—"
                onChange={(e) => setForm({ ...form, maxUtilizationPct: e.target.value })}
              />
            </label>
          </div>
        </div>
      </Modal>
    </section>
  );
};

export default ZoneProfilesSection;
