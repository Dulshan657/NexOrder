// Settings → Warehouse → Level roles.
//
// The operator-managed vocabulary a rack level's role is drawn from (mig 00081).
// Before this, 'pick' | 'reserve' | 'bulk' was hardcoded in a SQL CHECK, a
// plpgsql RAISE, two TS unions, three zod enums and four arrays — so "Pick face"
// could not be renamed to "Pick Zone" without editing six screens, and a
// warehouse that wanted a Quarantine level could not have one.
//
// Three of the fields here are not cosmetic. Handling-unit routing decides where
// putaway steers a pallet vs a carton; the pick-zone flag is the destination
// replenishment refills and the bin order allocation prefers; the source rank is
// what feeds a pick zone. Editing any of them asks for a reason, which the
// server requires and writes to the audit trail.

import React, { useMemo, useState } from 'react'
import { Layers, Plus, Pencil, Trash2, Lock, ArrowDownToLine, PackageOpen } from 'lucide-react'
import { Modal, Toggle } from '../ui'
import {
  useLevelRoles,
  useCreateLevelRole,
  useUpdateLevelRole,
  useDeleteLevelRole,
} from '../../hooks/queries/useLevelRoles'
import { getLevelRoleUsage } from '../../services/supabase/levelRoleService'
import { sortedRoles } from '../../lib/levelRoles'
import type { LevelRoleRecord } from '../../lib/levelRoles'
import { useToasts } from '../../hooks/useToasts'

/** The handling-unit types the inventory model supports (mig 00075). Rendered as
 *  a matrix across roles rather than a per-role free-text field, so removing
 *  `pallet` from Reserve visibly reroutes every pallet instead of quietly doing
 *  it inside one row's edit form. */
const HU_TYPES: Array<{ key: string; label: string }> = [
  { key: 'pallet', label: 'Pallets' },
  { key: 'carton', label: 'Cartons' },
]

const PRESET_FILLS = ['#a7f3d0', '#c7d2fe', '#fde68a', '#fecaca', '#bae6fd', '#e9d5ff', '#d9f99d', '#e7e5e4']
const PRESET_STROKES = ['#059669', '#4f46e5', '#d97706', '#dc2626', '#0284c7', '#9333ea', '#65a30d', '#78716c']

interface FormState {
  key: string
  displayName: string
  description: string
  colorFill: string
  colorStroke: string
  sortOrder: string
  huTypes: string[]
  isPickZone: boolean
  replenSourceRank: string
  reason: string
}

const emptyForm: FormState = {
  key: '',
  displayName: '',
  description: '',
  colorFill: PRESET_FILLS[0],
  colorStroke: PRESET_STROKES[0],
  sortOrder: '100',
  huTypes: [],
  isPickZone: false,
  replenSourceRank: '',
  reason: '',
}

function toForm(r: LevelRoleRecord): FormState {
  return {
    key: r.key,
    displayName: r.displayName,
    description: r.description ?? '',
    colorFill: r.colorFill,
    colorStroke: r.colorStroke,
    sortOrder: String(r.sortOrder),
    huTypes: [...r.huTypes],
    isPickZone: r.isPickZone,
    replenSourceRank: r.replenSourceRank != null ? String(r.replenSourceRank) : '',
    reason: '',
  }
}

/** Whether this edit touches a field that changes putaway routing or order
 *  allocation company-wide. Mirrors the server's own SENSITIVE list — checked
 *  here only so the operator is asked BEFORE the request is refused. */
function touchesSensitive(form: FormState, before: LevelRoleRecord | null): boolean {
  if (!before) return false
  const rank = form.replenSourceRank.trim() === '' ? null : Number(form.replenSourceRank)
  return (
    form.isPickZone !== before.isPickZone ||
    rank !== before.replenSourceRank ||
    form.huTypes.slice().sort().join(',') !== before.huTypes.slice().sort().join(',')
  )
}

const LevelRolesSection: React.FC = () => {
  const { data: roles, isLoading, isError } = useLevelRoles()
  const createRole = useCreateLevelRole()
  const updateRole = useUpdateLevelRole()
  const deleteRole = useDeleteLevelRole()
  const { addToast } = useToasts()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LevelRoleRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LevelRoleRecord | null>(null)
  const [deleteUsage, setDeleteUsage] = useState<string | null>(null)

  const all = useMemo(() => sortedRoles(roles ?? []), [roles])
  const pickZoneCount = all.filter((r) => r.isPickZone).length

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setFormOpen(true)
  }
  const openEdit = (r: LevelRoleRecord) => {
    setEditing(r)
    setForm(toForm(r))
    setError(null)
    setFormOpen(true)
  }

  const dirty =
    formOpen &&
    JSON.stringify(form) !== JSON.stringify(editing ? toForm(editing) : emptyForm)

  const needsReason = touchesSensitive(form, editing)

  const save = async () => {
    setError(null)
    if (!form.displayName.trim()) {
      setError('A display name is required.')
      return
    }
    if (!editing && !form.key.trim()) {
      setError('A key is required. It is stored on every level that uses this role and can never be changed.')
      return
    }
    if (needsReason && !form.reason.trim()) {
      setError('Please give a reason — this change affects how stock is put away and how every order allocates.')
      return
    }
    const rank = form.replenSourceRank.trim() === '' ? null : Number(form.replenSourceRank)
    if (rank !== null && (!Number.isFinite(rank) || rank < 1)) {
      setError('Replenishment source order must be 1 or higher, or blank for "never a source".')
      return
    }

    const patch = {
      displayName: form.displayName.trim(),
      description: form.description.trim() || null,
      colorFill: form.colorFill,
      colorStroke: form.colorStroke,
      sortOrder: Number(form.sortOrder) || 100,
      huTypes: form.huTypes,
      isPickZone: form.isPickZone,
      replenSourceRank: rank,
      reason: form.reason.trim() || undefined,
    }

    try {
      if (editing) {
        await updateRole.mutateAsync({ key: editing.key, patch })
        addToast(`${patch.displayName} updated`, 'success')
      } else {
        await createRole.mutateAsync({ ...patch, key: form.key.trim() })
        addToast(`${patch.displayName} added`, 'success')
      }
      setFormOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    }
  }

  const askDelete = async (r: LevelRoleRecord) => {
    setRowError(null)
    setDeleteUsage(null)
    setConfirmDelete(r)
    // Show what is still pointing at this role before the operator commits to
    // deleting it, rather than only refusing afterwards.
    try {
      const u = await getLevelRoleUsage(r.key)
      const parts = [
        u.locations ? `${u.locations} location${u.locations === 1 ? '' : 's'}` : null,
        u.skuRules ? `${u.skuRules} product rule${u.skuRules === 1 ? '' : 's'}` : null,
        u.formLevels ? `${u.formLevels} storage form${u.formLevels === 1 ? '' : 's'}` : null,
        u.homeBins ? `${u.homeBins} home bin${u.homeBins === 1 ? '' : 's'}` : null,
      ].filter(Boolean)
      setDeleteUsage(parts.length > 0 ? parts.join(', ') : '')
    } catch {
      setDeleteUsage(null)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteRole.mutateAsync(confirmDelete.key)
      addToast(`${confirmDelete.displayName} deleted`, 'success')
      setConfirmDelete(null)
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to delete.')
      setConfirmDelete(null)
    }
  }

  const toggleHuType = (huType: string) => {
    setForm((f) => ({
      ...f,
      huTypes: f.huTypes.includes(huType)
        ? f.huTypes.filter((h) => h !== huType)
        : [...f.huTypes, huType],
    }))
  }

  const saving = createRole.isPending || updateRole.isPending

  return (
    <section className="bg-stone-50 p-6 rounded-xl border border-stone-200">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-nexgen-blue" />
          <h3 className="text-base font-display font-bold text-stone-900">Level roles</h3>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
        >
          <Plus className="w-4 h-4" /> Add role
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-4">
        What each level of a rack is for. A role's key is stored on every level that uses it and never changes — rename
        the role instead. Handling-unit routing, the pick zone and the replenishment order all change how stock moves,
        so editing them asks for a reason.
      </p>

      {rowError && <p className="text-sm text-red-600 mb-3">{rowError}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-stone-100 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-red-600">Couldn't load level roles.</p>
      ) : (
        <>
          {/* Handling-unit routing, as a matrix. A per-role field would hide the
              only thing that matters here: which role a given plate type lands
              on, and whether any role claims it at all. */}
          <div className="mb-4 overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="text-left font-medium px-3 py-2">Putaway routing</th>
                  {all.map((r) => (
                    <th key={r.key} className="px-3 py-2 font-medium whitespace-nowrap">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                        style={{ backgroundColor: r.colorStroke }}
                      />
                      {r.displayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HU_TYPES.map((hu) => {
                  const claimed = all.filter((r) => r.huTypes.includes(hu.key))
                  return (
                    <tr key={hu.key} className="border-b border-stone-100 last:border-0">
                      <td className="px-3 py-2 text-stone-600">
                        {hu.label}
                        {claimed.length === 0 && (
                          <span className="ml-2 text-[11px] text-amber-700">
                            no role claims these — putaway falls back to the product's own rule
                          </span>
                        )}
                      </td>
                      {all.map((r) => (
                        <td key={r.key} className="px-3 py-2 text-center">
                          {r.huTypes.includes(hu.key) ? (
                            <span className="text-emerald-600 font-semibold" aria-label={`${hu.label} go to ${r.displayName}`}>
                              ✓
                            </span>
                          ) : (
                            <span className="text-stone-300" aria-hidden="true">·</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            {all.map((r) => (
              <div key={r.key} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-stone-200 bg-white">
                <span
                  className="w-4 h-4 rounded shrink-0 border"
                  style={{ backgroundColor: r.colorFill, borderColor: r.colorStroke }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-display font-bold text-stone-900 truncate">{r.displayName}</p>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{r.key}</span>
                    {r.isSystem && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
                        <Lock className="w-3 h-3" /> Built-in
                      </span>
                    )}
                    {r.isPickZone && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        <PackageOpen className="w-3 h-3" /> Pick zone
                      </span>
                    )}
                    {r.replenSourceRank != null && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                        <ArrowDownToLine className="w-3 h-3" /> Replen source #{r.replenSourceRank}
                      </span>
                    )}
                    {!r.isActive && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-400">Retired</span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5 truncate">
                    {r.description || 'No description'}
                  </p>
                </div>
                <button
                  onClick={() => openEdit(r)}
                  className="p-2 rounded-lg hover:bg-stone-100 btn-press"
                  aria-label={`Edit ${r.displayName}`}
                >
                  <Pencil className="w-4 h-4 text-stone-500" />
                </button>
                <button
                  onClick={() => askDelete(r)}
                  disabled={r.isSystem || deleteRole.isPending}
                  className="p-2 rounded-lg hover:bg-red-50 btn-press disabled:opacity-30"
                  aria-label={`Delete ${r.displayName}`}
                  title={r.isSystem ? 'Built-in roles cannot be deleted' : 'Delete'}
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.displayName}` : 'New level role'}
        icon={<Layers className="w-4 h-4" />}
        size="lg"
        dirty={dirty}
        footer={({ requestClose }) => (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm btn-press"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-nexgen-blue px-3 py-1.5 text-sm font-semibold text-white btn-press disabled:opacity-50"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add role'}
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-stone-500">
              Display name
              <input
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                value={form.displayName}
                placeholder="Pick Zone"
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
              <span className="text-[10px] text-stone-400">What operators see, everywhere.</span>
            </label>
            <label className="block text-xs text-stone-500">
              Key
              <input
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 font-mono disabled:bg-stone-100 disabled:text-stone-400"
                value={form.key}
                placeholder="pick"
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              />
              <span className="text-[10px] text-stone-400">
                {editing ? 'Permanent — stored on every level using this role.' : 'Permanent once saved. Lowercase.'}
              </span>
            </label>
          </div>

          <label className="block text-xs text-stone-500">
            Description
            <input
              className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs text-stone-500">
              Fill colour
              <div className="mt-1 flex flex-wrap gap-1">
                {PRESET_FILLS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Fill ${c}`}
                    onClick={() => setForm({ ...form, colorFill: c })}
                    className="w-5 h-5 rounded border-2 btn-press"
                    style={{ backgroundColor: c, borderColor: form.colorFill === c ? '#0f172a' : 'transparent' }}
                  />
                ))}
              </div>
            </label>
            <label className="block text-xs text-stone-500">
              Outline colour
              <div className="mt-1 flex flex-wrap gap-1">
                {PRESET_STROKES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Outline ${c}`}
                    onClick={() => setForm({ ...form, colorStroke: c })}
                    className="w-5 h-5 rounded border-2 btn-press"
                    style={{ backgroundColor: c, borderColor: form.colorStroke === c ? '#0f172a' : 'transparent' }}
                  />
                ))}
              </div>
            </label>
            <label className="block text-xs text-stone-500">
              Display order
              <input
                type="number"
                min={0}
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
              <span className="text-[10px] text-stone-400">Lowest first. New levels default to the first role.</span>
            </label>
          </div>

          <fieldset className="border border-stone-200 rounded-lg p-3">
            <legend className="text-xs font-medium text-stone-600 px-1">Putaway routing</legend>
            <p className="text-[11px] text-stone-500 mb-2">
              Which kinds of unit belong on this role. Putaway steers arrivals here — unless the product's own rule says
              otherwise, which always wins.
            </p>
            <div className="flex items-center gap-4">
              {HU_TYPES.map((hu) => (
                <label key={hu.key} className="flex items-center gap-1.5 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={form.huTypes.includes(hu.key)}
                    onChange={() => toggleHuType(hu.key)}
                  />
                  {hu.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="border border-stone-200 rounded-lg p-3 space-y-3">
            <legend className="text-xs font-medium text-stone-600 px-1">Replenishment</legend>
            <Toggle
              checked={form.isPickZone}
              onChange={(next) => setForm({ ...form, isPickZone: next })}
              label="This is a pick zone"
              description="Replenishment refills levels with this role, and order allocation prefers drawing from them. At least one role must be a pick zone."
            />
            {editing?.isPickZone && !form.isPickZone && pickZoneCount <= 1 && (
              <p className="text-xs text-amber-700">
                This is currently the only pick zone. Mark another role as the pick zone first, or replenishment will
                have nowhere to point.
              </p>
            )}
            <label className="block text-xs text-stone-500">
              Replenishment source order
              <input
                type="number"
                min={1}
                placeholder="blank = never a source"
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                value={form.replenSourceRank}
                onChange={(e) => setForm({ ...form, replenSourceRank: e.target.value })}
              />
              <span className="text-[10px] text-stone-400">
                1 is drawn from first. Reserve is 1 and Bulk is 2, so a pick zone empties reserve before bulk.
              </span>
            </label>
          </fieldset>

          {needsReason && (
            <label className="block text-xs text-stone-500">
              Reason (required)
              <input
                className="mt-1 w-full text-sm border border-amber-300 rounded px-2 py-1.5"
                value={form.reason}
                placeholder="Why is this changing?"
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              <span className="text-[10px] text-amber-700">
                You've changed putaway routing, the pick zone, or the replenishment order. These affect every warehouse
                and every order, so the change is recorded with your reason.
              </span>
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? `Delete ${confirmDelete.displayName}?` : ''}
        size="sm"
        footer={({ requestClose }) => (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm btn-press"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doDelete}
              disabled={deleteRole.isPending || !!deleteUsage}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white btn-press disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      >
        {deleteUsage ? (
          <p className="text-sm text-stone-600">
            This role is still in use by <strong>{deleteUsage}</strong>. Reassign them before deleting it.
          </p>
        ) : (
          <p className="text-sm text-stone-600">
            Nothing is using this role, so deleting it is safe. This cannot be undone.
          </p>
        )}
      </Modal>
    </section>
  )
}

export default LevelRolesSection
