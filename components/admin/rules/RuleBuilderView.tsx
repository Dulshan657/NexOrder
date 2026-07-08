// Visual builder for WIE putaway rules — structured pickers only (no free-form
// logic). Emits the exact RuleDefinition JSON the engine evaluates, and a live
// "test" panel runs that engine client-side against a sample product+bin so the
// author sees the effect before saving.

import { useMemo, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { CATEGORIES } from '@/constants'
import { useWieRules, useUpsertWieRule, useDeleteWieRule } from '@/hooks/queries/useWieRules'
import { useToasts } from '@/hooks/useToasts'
import { evaluateRules, type RuleContext } from '@/supabase/functions/_shared/wie/rules'
import type { CandidateBin, RuleDefinition, SkuProfile } from '@/supabase/functions/_shared/wie/types'
import type { WieRule, WieRuleCondition, WieRuleOp } from '@/types'

const SUBJECTS = ['product', 'bin', 'zone'] as const
const PRODUCT_ATTRS = ['category', 'hazardClass', 'tempMin', 'tempMax', 'handlingType', 'stackable']
const BIN_ATTRS = ['zoneTag', 'zoneType', 'capacitySlots', 'usedSlots', 'hasSameProduct']
const OPS: WieRuleOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists']

const emptyCondition = (): WieRuleCondition => ({ subject: 'product', attr: 'category', op: 'eq', value: '' })

interface DraftRule {
  id?: number
  name: string
  enforcement: 'hard' | 'soft'
  priority: number
  conditionLogic: 'and' | 'or'
  conditions: WieRuleCondition[]
  effect: 'require' | 'forbid' | 'boost' | 'penalty'
  targetAttr: string
  targetOp: WieRuleOp
  targetValue: string
  delta: number
}

function emptyDraft(): DraftRule {
  return {
    name: '', enforcement: 'hard', priority: 100, conditionLogic: 'and',
    conditions: [emptyCondition()], effect: 'require', targetAttr: 'zoneTag', targetOp: 'eq',
    targetValue: '', delta: 0.2,
  }
}

function draftToDefinition(d: DraftRule): RuleDefinition {
  const conditions = d.conditions.map((c) => ({
    subject: c.subject, attr: c.attr, op: c.op,
    value: c.op === 'exists' ? undefined : coerce(String(c.value ?? '')),
  }))
  const action = d.enforcement === 'hard'
    ? { effect: d.effect, target: { scope: 'bin' as const, attr: d.targetAttr, op: d.targetOp, value: coerce(d.targetValue) } }
    : { effect: d.effect, delta: d.delta }
  return { id: d.id ?? 0, name: d.name, enforcement: d.enforcement, priority: d.priority, conditions, conditionLogic: d.conditionLogic, action }
}

// Coerce a string field to number/boolean when it clearly is one.
function coerce(v: string): unknown {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return v
}

function sampleSku(category: string, hazard: string): SkuProfile {
  return {
    productId: 0, code: 'TEST', name: 'Test', sizeFactor: 1, weightKg: null,
    category: category || null, hazardClass: hazard || null, tempMin: null, tempMax: null,
    handlingType: null, stackable: null, velocityClass: null,
  }
}

function sampleBin(zoneTag: string, hasSame: boolean): CandidateBin {
  return {
    locationId: 0, code: 'TEST-BIN', zoneId: null, zoneTag: zoneTag || null, capacitySlots: 100,
    usedSlots: 0, weightCapacityKg: null, usedWeightKg: 0, graphNodeId: 0, accessOffsetM: 0, hasSameProduct: hasSame, distanceFromDockM: 10,
    zoneType: zoneTag || null, zonePriorityWeight: 0.5, zoneAllowedCategories: null, zoneMaxUtilizationPct: null,
    occupantCategories: [], pickVisits30d: 0,
  }
}

export function RuleBuilderView() {
  const { data: rules } = useWieRules()
  const upsert = useUpsertWieRule()
  const del = useDeleteWieRule()
  const { addToast } = useToasts()
  const [draft, setDraft] = useState<DraftRule | null>(null)

  // Live-test inputs.
  const [testCategory, setTestCategory] = useState('')
  const [testHazard, setTestHazard] = useState('')
  const [testZone, setTestZone] = useState('')
  const [testHasSame, setTestHasSame] = useState(false)

  const testResult = useMemo(() => {
    if (!draft) return null
    const ctx: RuleContext = { sku: sampleSku(testCategory, testHazard), bin: sampleBin(testZone, testHasSame) }
    const res = evaluateRules([draftToDefinition(draft)], ctx)
    if (res.hardViolation) return { kind: 'veto' as const, text: res.hardViolation.reason }
    if (res.softTriggers.length > 0) return { kind: 'soft' as const, text: `${res.softTriggers[0].effect} ${res.softTriggers[0].delta}` }
    return { kind: 'pass' as const, text: 'No effect on this sample' }
  }, [draft, testCategory, testHazard, testZone, testHasSame])

  const putawayRules = (rules ?? []).filter((r) => r.ruleType === 'putaway')

  const startEdit = (r: WieRule) => {
    const def = r.definition
    setDraft({
      id: r.id, name: r.name, enforcement: r.enforcement, priority: r.priority,
      conditionLogic: def.conditionLogic ?? 'and',
      conditions: def.conditions, // may be empty = applies to all products
      effect: def.action.effect, targetAttr: def.action.target?.attr ?? 'zoneTag',
      targetOp: def.action.target?.op ?? 'eq', targetValue: String(def.action.target?.value ?? ''),
      delta: def.action.delta ?? 0.2,
    })
  }

  // Flipping enforcement must reset the effect to a valid option for it.
  const setEnforcement = (enforcement: 'hard' | 'soft') =>
    draft && setDraft({ ...draft, enforcement, effect: enforcement === 'hard' ? 'require' : 'boost' })

  const save = async () => {
    if (!draft || !draft.name.trim()) return
    try {
      await upsert.mutateAsync({
        id: draft.id, name: draft.name.trim(), rule_type: 'putaway', enforcement: draft.enforcement,
        priority: draft.priority, definition: draftToDefinition(draft), is_active: true,
      })
      setDraft(null)
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to save rule', 'error')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Rule list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-stone-700">Putaway rules</h4>
          <button className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg btn-press" onClick={() => setDraft(emptyDraft())}>
            + New rule
          </button>
        </div>
        {putawayRules.length === 0 && <p className="text-xs text-stone-400">No rules yet.</p>}
        {putawayRules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-2 border border-stone-200 rounded-lg bg-white">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-stone-800 truncate">{r.name}</p>
              <p className="text-[10px] text-stone-400">
                {r.enforcement} · priority {r.priority} · {r.isActive ? 'active' : 'off'}
              </p>
            </div>
            <button className="text-[11px] text-stone-500 hover:text-stone-800 btn-press" onClick={() => startEdit(r)}>Edit</button>
            <button className="p-1 text-stone-400 hover:text-red-600 btn-press" onClick={() => del.mutate(r.id)} aria-label="Delete rule">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Editor + live test */}
      {draft && (
        <div className="space-y-3 p-3 border border-stone-200 rounded-lg bg-stone-50">
          <input
            className="w-full text-sm border border-stone-200 rounded px-2 py-1"
            placeholder="Rule name" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <select className="border border-stone-200 rounded px-2 py-1" value={draft.enforcement} onChange={(e) => setEnforcement(e.target.value as 'hard' | 'soft')}>
              <option value="hard">hard</option>
              <option value="soft">soft</option>
            </select>
            <input type="number" className="border border-stone-200 rounded px-2 py-1" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} placeholder="priority" />
            <select className="border border-stone-200 rounded px-2 py-1" value={draft.conditionLogic} onChange={(e) => setDraft({ ...draft, conditionLogic: e.target.value as 'and' | 'or' })}>
              <option value="and">match ALL</option>
              <option value="or">match ANY</option>
            </select>
          </div>

          {/* Conditions */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-stone-500">IF</p>
            {draft.conditions.length === 0 && (
              <p className="text-[11px] text-stone-400 italic">Applies to all products.</p>
            )}
            {draft.conditions.map((c, i) => {
              const attrs = c.subject === 'product' ? PRODUCT_ATTRS : BIN_ATTRS
              const patchCond = (patch: Partial<WieRuleCondition>) => {
                const conds = draft.conditions.map((cc, ci) => (ci === i ? { ...cc, ...patch } : cc))
                setDraft({ ...draft, conditions: conds })
              }
              return (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <select className="border border-stone-200 rounded px-1 py-1" value={c.subject} onChange={(e) => patchCond({ subject: e.target.value as WieRuleCondition['subject'] })}>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="border border-stone-200 rounded px-1 py-1" value={c.attr} onChange={(e) => patchCond({ attr: e.target.value })}>
                    {attrs.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select className="border border-stone-200 rounded px-1 py-1" value={c.op} onChange={(e) => patchCond({ op: e.target.value as WieRuleOp })}>
                    {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  {c.op !== 'exists' && (
                    <input className="border border-stone-200 rounded px-1 py-1 w-24" value={String(c.value ?? '')} onChange={(e) => patchCond({ value: e.target.value })} placeholder="value" />
                  )}
                  <button className="p-1 text-stone-400 hover:text-red-600" onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, ci) => ci !== i) })} aria-label="Remove condition">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
            <button className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800" onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, emptyCondition()] })}>
              <Plus className="w-3 h-3" /> condition
            </button>
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-stone-500">THEN</p>
            <div className="flex items-center gap-1 text-xs">
              <select className="border border-stone-200 rounded px-1 py-1" value={draft.effect} onChange={(e) => setDraft({ ...draft, effect: e.target.value as DraftRule['effect'] })}>
                {(draft.enforcement === 'hard' ? ['require', 'forbid'] : ['boost', 'penalty']).map((ef) => <option key={ef} value={ef}>{ef}</option>)}
              </select>
              {draft.enforcement === 'hard' ? (
                <>
                  <select className="border border-stone-200 rounded px-1 py-1" value={draft.targetAttr} onChange={(e) => setDraft({ ...draft, targetAttr: e.target.value })}>
                    {BIN_ATTRS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select className="border border-stone-200 rounded px-1 py-1" value={draft.targetOp} onChange={(e) => setDraft({ ...draft, targetOp: e.target.value as WieRuleOp })}>
                    {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input className="border border-stone-200 rounded px-1 py-1 w-24" value={draft.targetValue} onChange={(e) => setDraft({ ...draft, targetValue: e.target.value })} placeholder="value" />
                </>
              ) : (
                <input type="number" step="0.05" className="border border-stone-200 rounded px-1 py-1 w-24" value={draft.delta} onChange={(e) => setDraft({ ...draft, delta: Number(e.target.value) })} placeholder="delta" />
              )}
            </div>
          </div>

          {/* Live test */}
          <div className="p-2 rounded-lg bg-white border border-stone-200 space-y-2">
            <p className="text-[11px] font-medium text-stone-500">Test against a sample</p>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <select className="border border-stone-200 rounded px-1 py-1" value={testCategory} onChange={(e) => setTestCategory(e.target.value)}>
                <option value="">(no category)</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="border border-stone-200 rounded px-1 py-1" placeholder="hazard class" value={testHazard} onChange={(e) => setTestHazard(e.target.value)} />
              <input className="border border-stone-200 rounded px-1 py-1" placeholder="bin zone tag" value={testZone} onChange={(e) => setTestZone(e.target.value)} />
              <label className="flex items-center gap-1 text-stone-500"><input type="checkbox" checked={testHasSame} onChange={(e) => setTestHasSame(e.target.checked)} /> has same product</label>
            </div>
            {testResult && (
              <p className={`text-[11px] ${testResult.kind === 'veto' ? 'text-red-600' : testResult.kind === 'soft' ? 'text-violet-600' : 'text-stone-400'}`}>
                {testResult.kind === 'veto' ? '✕ rejects: ' : testResult.kind === 'soft' ? '▲ adjusts: ' : ''}{testResult.text}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button className="text-xs px-3 py-1.5 border border-stone-200 rounded-lg btn-press" onClick={() => setDraft(null)}>Cancel</button>
            <button className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40" onClick={save} disabled={!draft.name.trim() || upsert.isPending}>Save rule</button>
          </div>
        </div>
      )}
    </div>
  )
}
