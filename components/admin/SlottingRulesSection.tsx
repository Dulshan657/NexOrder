// Settings → Warehouse → Slotting rules.
//
// Where an operator says "the Milwaukee goes in aisle C, and if C is full, the
// mezzanine". Before mig 00115 the only product-to-place constraint in the
// system was zone_profiles.allowed_categories — an exact-string match on a
// free-text category, with no ranking and no notion of brand or SKU.
//
// TWO LISTS, ONE FEATURE, AND THE ORDER MATTERS. Blocks come first because a
// rule cannot be written until one exists, which is the order an operator sets
// them up in — the same argument that puts Level Roles above Zone Profiles in
// this tab.
//
// THE MATCH COUNT IS NOT DECORATION. `match_category` has no FK (categories are
// free text since 00069), so renaming a category silently stops a rule matching
// and there is nothing else on any screen that would ever show it. A zero here
// is the only symptom.
//
// Ranking is up/down buttons, not drag. This app carries no dnd library and
// adding one for at most twenty rows would be the largest dependency in the
// feature; buttons are also keyboard-reachable, which a drag handle is not.

import React, { useMemo, useState } from 'react'
import {
  Boxes, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Lock, ShieldAlert, X,
} from 'lucide-react'
import { Modal, Toggle } from '../ui'
import {
  useSlottingRows,
  useSaveSlottingRule,
  useDeleteSlottingRule,
  useDeleteSlottingBlock,
} from '../../hooks/queries/useSlottingRules'
import type { SlottingRuleRow, SlottingBlockRow } from '../../services/supabase/slottingRulesService'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import { useProducts } from '../../hooks/queries/useProducts'
import { useSuppliers } from '../../hooks/queries/useSuppliers'
import { brandOptions, categoryOptions } from '../../lib/productTaxonomy'
import { useToasts } from '../../hooks/useToasts'

interface RuleForm {
  name: string
  matchProductId: string
  matchBrand: string
  matchCategory: string
  matchSupplierId: string
  enforcement: 'hard' | 'soft'
  reserveEmpty: boolean
  isActive: boolean
  blockIds: number[]
}

const emptyRule: RuleForm = {
  name: '',
  matchProductId: '',
  matchBrand: '',
  matchCategory: '',
  matchSupplierId: '',
  enforcement: 'soft',
  reserveEmpty: false,
  isActive: true,
  blockIds: [],
}

function toForm(r: SlottingRuleRow): RuleForm {
  return {
    name: r.name,
    matchProductId: r.matchProductId != null ? String(r.matchProductId) : '',
    matchBrand: r.matchBrand ?? '',
    matchCategory: r.matchCategory ?? '',
    matchSupplierId: r.matchSupplierId != null ? String(r.matchSupplierId) : '',
    enforcement: r.enforcement,
    reserveEmpty: r.reserveEmpty,
    isActive: r.isActive,
    blockIds: r.blocks.map((b) => b.id),
  }
}

/** The four axes in ladder order, as a sentence an operator can read back. */
function describeMatch(r: SlottingRuleRow): string {
  const parts: string[] = []
  if (r.matchProductSku) parts.push(`SKU ${r.matchProductSku}`)
  else if (r.matchProductId != null) parts.push(`product #${r.matchProductId}`)
  if (r.matchBrand) parts.push(`brand ${r.matchBrand}`)
  if (r.matchCategory) parts.push(`category ${r.matchCategory}`)
  if (r.matchSupplierName) parts.push(`supplier ${r.matchSupplierName}`)
  else if (r.matchSupplierId != null) parts.push(`supplier #${r.matchSupplierId}`)
  return parts.join(' + ')
}

const SlottingRulesSection: React.FC = () => {
  const { addToast } = useToasts()
  const { data: warehouses } = useWarehouses()
  const racked = useMemo(
    () => (warehouses ?? []).filter((w: any) => w.isActive !== false),
    [warehouses],
  )
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const activeWarehouseId = warehouseId ?? (racked.length > 0 ? racked[0].id : null)

  const { data, isLoading, error } = useSlottingRows(activeWarehouseId)
  const { data: products } = useProducts()
  const { data: suppliers } = useSuppliers()

  const saveRule = useSaveSlottingRule()
  const deleteRule = useDeleteSlottingRule()
  const deleteBlock = useDeleteSlottingBlock()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SlottingRuleRow | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyRule)
  const [formError, setFormError] = useState<string | null>(null)

  const blocks = data?.blocks ?? []
  const rules = data?.rules ?? []
  const blockById = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks],
  )

  const brands = useMemo(() => brandOptions(products), [products])
  const categories = useMemo(() => categoryOptions(products), [products])

  const openNew = () => {
    setEditing(null)
    setForm(emptyRule)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (r: SlottingRuleRow) => {
    setEditing(r)
    setForm(toForm(r))
    setFormError(null)
    setFormOpen(true)
  }

  const dirty = formOpen
    && JSON.stringify(form) !== JSON.stringify(editing ? toForm(editing) : emptyRule)

  const moveBlock = (index: number, delta: number) => {
    const next = [...form.blockIds]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setForm({ ...form, blockIds: next })
  }

  const save = async () => {
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Give the rule a name — it is what the putaway task will show the operator.')
      return
    }
    const axes = [form.matchProductId, form.matchBrand.trim(), form.matchCategory.trim(), form.matchSupplierId]
    if (axes.every((a) => !a)) {
      setFormError('Choose at least one of product, brand, category or supplier.')
      return
    }
    if (activeWarehouseId == null) return

    try {
      const res = await saveRule.mutateAsync({
        warehouseId: activeWarehouseId,
        id: editing?.id ?? null,
        name: form.name.trim(),
        matchProductId: form.matchProductId ? Number(form.matchProductId) : null,
        matchBrand: form.matchBrand.trim() || null,
        matchCategory: form.matchCategory.trim() || null,
        matchSupplierId: form.matchSupplierId ? Number(form.matchSupplierId) : null,
        enforcement: form.enforcement,
        reserveEmpty: form.reserveEmpty,
        isActive: form.isActive,
        blockIds: form.blockIds,
      })
      const warnings = 'warnings' in res ? res.warnings : []
      addToast(`${form.name.trim()} saved`, 'success')
      // Warnings are reported AFTER the save, never instead of it: a rule that
      // matches nothing yet is a legitimate thing to set up before a catalogue
      // import, so this informs rather than blocks.
      for (const w of warnings) addToast(w, 'info')
      setFormOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save.')
    }
  }

  const removeRule = async (r: SlottingRuleRow) => {
    if (activeWarehouseId == null) return
    try {
      await deleteRule.mutateAsync({ warehouseId: activeWarehouseId, id: r.id })
      addToast(`${r.name} removed`, 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to remove the rule.', 'error')
    }
  }

  const removeBlock = async (b: SlottingBlockRow) => {
    if (activeWarehouseId == null) return
    try {
      await deleteBlock.mutateAsync({ warehouseId: activeWarehouseId, id: b.id })
      addToast(`${b.name} removed`, 'success')
    } catch (e) {
      // The server refuses and NAMES the rules using it; surface that verbatim
      // rather than a generic failure.
      addToast(e instanceof Error ? e.message : 'Failed to remove the block.', 'error')
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5">
      <header className="flex flex-wrap items-center gap-3 mb-1">
        <Boxes size={18} className="text-stone-500 shrink-0" />
        <h3 className="font-display font-semibold text-stone-800">Slotting rules</h3>
        <div className="ml-auto flex items-center gap-2">
          {racked.length > 1 && (
            <select
              className="text-sm border border-stone-200 rounded px-2 py-1.5 bg-white"
              value={activeWarehouseId ?? ''}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              aria-label="Warehouse"
            >
              {racked.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={openNew}
            disabled={activeWarehouseId == null}
            className="btn-press inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40"
          >
            <Plus size={15} /> New rule
          </button>
        </div>
      </header>

      <p className="text-xs text-stone-500 mb-4 max-w-[70ch]">
        Which products belong in which part of this warehouse. Putaway fills a
        product&apos;s blocks in the order you rank them, then falls through to
        anywhere else and flags what it placed as off-home.
      </p>

      {isLoading && (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-stone-100 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
          {error instanceof Error ? error.message : 'Could not load slotting rules.'}
        </p>
      )}

      {!isLoading && !error && (
        <div className="space-y-6">
          {/* ── Rules ─────────────────────────────────────────────────────── */}
          {rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center">
              <p className="text-sm text-stone-600">No slotting rules yet.</p>
              <p className="text-xs text-stone-400 mt-1 max-w-[46ch] mx-auto">
                Until one exists, putaway chooses purely on travel distance and
                capacity — which is exactly how it behaved before this feature.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {rules.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-stone-800 text-sm">{r.name}</span>
                      {r.enforcement === 'hard' && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          <ShieldAlert size={11} /> Hard
                        </span>
                      )}
                      {r.reserveEmpty && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-200 text-stone-700">
                          <Lock size={11} /> Reserved
                        </span>
                      )}
                      {!r.isActive && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                          Off
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5">{describeMatch(r)}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {r.blocks.length === 0
                        ? 'No blocks — this rule does nothing yet.'
                        : r.blocks.map((b, i) => `${i + 1}. ${b.name}`).join('  →  ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`font-mono text-xs tabular-nums ${r.matchCount === 0 ? 'text-amber-600' : 'text-stone-500'}`}
                      title={r.matchCount === 0
                        ? 'This rule matches no products. A renamed category or brand does exactly this.'
                        : `${r.matchCount} product(s) match this rule`}
                    >
                      {r.matchCount} match{r.matchCount === 1 ? '' : 'es'}
                    </span>
                    <button
                      type="button" onClick={() => openEdit(r)}
                      className="btn-press p-1.5 rounded hover:bg-stone-100 text-stone-500"
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button" onClick={() => removeRule(r)}
                      className="btn-press p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-600"
                      aria-label={`Remove ${r.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* ── Blocks ────────────────────────────────────────────────────── */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">
              Blocks
            </h4>
            {blocks.length === 0 ? (
              <p className="text-xs text-stone-400">
                None yet. Draw one on the warehouse map — select the racks, then name them.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100 border-t border-stone-100">
                {blocks.map((b) => (
                  <li key={b.id} className="py-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-stone-800">{b.name}</span>
                      {b.sourceKind === 'area' && b.sourceAreaName && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-stone-400">
                          from area {b.sourceAreaName}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-stone-500">
                      {b.binCount} bin{b.binCount === 1 ? '' : 's'}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-stone-400 w-16 text-right">
                      {b.ruleCount} rule{b.ruleCount === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button" onClick={() => removeBlock(b)}
                      className="btn-press p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-600"
                      aria-label={`Remove ${b.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New slotting rule'}
        dirty={dirty}
        footer={({ requestClose }) => (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={requestClose} className="btn-press text-sm px-3 py-1.5 rounded-lg border border-stone-200">
              Cancel
            </button>
            <button
              type="button" onClick={save} disabled={saveRule.isPending}
              className="btn-press text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40"
            >
              {saveRule.isPending ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        )}
      >
        <div className="space-y-4">
          {formError && (
            <p role="alert" className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}

          <label className="block text-xs text-stone-500">
            Name
            <input
              className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
              value={form.name}
              placeholder="Milwaukee power tools"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <span className="text-[10px] text-stone-400">Shown on the putaway task, so name it the way you would say it.</span>
          </label>

          <fieldset className="border border-stone-200 rounded-lg p-3">
            <legend className="text-xs text-stone-500 px-1">What it applies to</legend>
            <p className="text-[10px] text-stone-400 mb-2">
              Anything you fill in must ALL be true. The most specific rule wins:
              SKU beats brand beats category beats supplier.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-stone-500">
                Brand
                <input
                  list="slotting-brands"
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.matchBrand}
                  placeholder="Any"
                  onChange={(e) => setForm({ ...form, matchBrand: e.target.value })}
                />
                {/* ONE shared datalist, not one per row: a per-row <select> of
                    several hundred options froze the replenishment grid hard
                    enough that Chrome could not be scripted. */}
                <datalist id="slotting-brands">
                  {brands.map((b) => <option key={b} value={b} />)}
                </datalist>
              </label>

              <label className="block text-xs text-stone-500">
                Category
                <input
                  list="slotting-categories"
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
                  value={form.matchCategory}
                  placeholder="Any"
                  onChange={(e) => setForm({ ...form, matchCategory: e.target.value })}
                />
                <datalist id="slotting-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>

              <label className="block text-xs text-stone-500">
                Supplier
                <select
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 bg-white"
                  value={form.matchSupplierId}
                  onChange={(e) => setForm({ ...form, matchSupplierId: e.target.value })}
                >
                  <option value="">Any</option>
                  {(suppliers ?? []).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-stone-500">
                Single product
                <select
                  className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 bg-white"
                  value={form.matchProductId}
                  onChange={(e) => setForm({ ...form, matchProductId: e.target.value })}
                >
                  <option value="">Any</option>
                  {(products ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                  ))}
                </select>
                <span className="text-[10px] text-stone-400">Overrides that product&apos;s brand rule.</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="border border-stone-200 rounded-lg p-3">
            <legend className="text-xs text-stone-500 px-1">Where it goes</legend>
            {blocks.length === 0 ? (
              <p className="text-xs text-stone-400">
                No blocks exist yet — draw one on the warehouse map first.
              </p>
            ) : (
              <>
                {form.blockIds.length > 0 && (
                  <ol className="space-y-1 mb-2">
                    {form.blockIds.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs tabular-nums text-stone-400 w-5">{i + 1}.</span>
                        <span className="flex-1 min-w-0 truncate text-stone-800">
                          {blockById.get(id)?.name ?? `Block ${id}`}
                        </span>
                        <span className="font-mono text-[10px] text-stone-400">
                          {blockById.get(id)?.binCount ?? 0} bins
                        </span>
                        <button
                          type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0}
                          className="btn-press p-1 rounded hover:bg-stone-100 text-stone-500 disabled:opacity-25"
                          aria-label={`Move ${blockById.get(id)?.name ?? 'block'} up`}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button" onClick={() => moveBlock(i, 1)} disabled={i === form.blockIds.length - 1}
                          className="btn-press p-1 rounded hover:bg-stone-100 text-stone-500 disabled:opacity-25"
                          aria-label={`Move ${blockById.get(id)?.name ?? 'block'} down`}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, blockIds: form.blockIds.filter((b) => b !== id) })}
                          className="btn-press p-1 rounded hover:bg-red-50 text-stone-400 hover:text-red-600"
                          aria-label={`Remove ${blockById.get(id)?.name ?? 'block'} from this rule`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-[10px] text-stone-400 mb-2">
                  Filled top to bottom. Below the last one, stock goes anywhere legal and is flagged off-home.
                </p>
                <select
                  className="w-full text-sm border border-stone-200 rounded px-2 py-1.5 bg-white"
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value)
                    if (id) setForm({ ...form, blockIds: [...form.blockIds, id] })
                  }}
                >
                  <option value="">Add a block…</option>
                  {blocks.filter((b) => !form.blockIds.includes(b.id)).map((b) => (
                    <option key={b.id} value={b.id}>{b.name} ({b.binCount} bins)</option>
                  ))}
                </select>
              </>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-stone-500">
              If the blocks are full
              <select
                className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5 bg-white"
                value={form.enforcement}
                onChange={(e) => setForm({ ...form, enforcement: e.target.value as 'hard' | 'soft' })}
              >
                <option value="soft">Put it elsewhere and flag it (recommended)</option>
                <option value="hard">Refuse — leave it for manual placement</option>
              </select>
              <span className="text-[10px] text-stone-400">
                {form.enforcement === 'hard'
                  ? 'A scan into a bin outside these blocks is refused, with a recorded override.'
                  : 'The engine prefers these blocks; nothing is ever refused.'}
              </span>
            </label>

            <Toggle
              checked={form.reserveEmpty}
              onChange={(v: boolean) => setForm({ ...form, reserveEmpty: v })}
              label="Hold the space empty"
              description={form.reserveEmpty
                ? 'Nothing else may use these bins, even while they sit empty.'
                : 'Other stock may fill these bins when empty, flagged so it gets moved.'}
            />
          </div>

          <div className="pt-1">
            <Toggle
              checked={form.isActive}
              onChange={(v: boolean) => setForm({ ...form, isActive: v })}
              label="Rule is active"
              description="Turn off to stop it steering putaway without losing its configuration."
            />
          </div>
        </div>
      </Modal>
    </section>
  )
}

export default SlottingRulesSection
