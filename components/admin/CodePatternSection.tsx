// Settings → Warehouse → the code pattern a site mints bin codes from.
//
// `warehouse_code_patterns` shipped with 00107 and was written by NOTHING until
// now: the recode wizard read a template it could not save, and the toolbar's
// "(site default)" label was inaccurate on any site that somehow had one. This is
// the other half of that — set the convention once, up front, so the first sweep
// and the tenth open on the same thing.
//
// NO ROW IS THE ANSWER, not a missing one (00107). Clearing therefore DELETES the
// row rather than writing a sentinel, so "the built-in default" has exactly one
// representation in the table.
//
// Modelled on LevelRolesSection: one panel, a warehouse picker, live validation
// from the shared pure module, and a save that says what it did.

import { useEffect, useState } from 'react'
import { Hash } from 'lucide-react'
import { useWarehouses } from '@/hooks/queries/useWarehouses'
import { useWarehouseCodePattern, useSetWarehouseCodePattern } from '@/hooks/queries/useWarehouses'
import { useToasts } from '@/hooks/useToasts'
import {
  CODE_ORDERS,
  CODE_ORDER_LABELS,
  CODE_ORIGINS,
  CODE_ORIGIN_LABELS,
  WIZARD_DEFAULT_PATTERN,
  formatCode,
  sanitizeBlockInput,
  styleOfTemplate,
  templateForStyle,
  templateIssue,
  usedTokens,
  type CodeOrder,
  type CodeOrigin,
} from '@/lib/codePattern'

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm outline-none focus:border-nexgen-blue'

export function CodePatternSection() {
  const { data: warehouses = [] } = useWarehouses()
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const effectiveId = warehouseId ?? warehouses[0]?.id ?? null

  const stored = useWarehouseCodePattern(effectiveId)
  const save = useSetWarehouseCodePattern(effectiveId)
  const { addToast } = useToasts()

  const [template, setTemplate] = useState(WIZARD_DEFAULT_PATTERN.template)
  const [defaultBlock, setDefaultBlock] = useState(WIZARD_DEFAULT_PATTERN.defaultBlock)
  const [order, setOrder] = useState<CodeOrder>(WIZARD_DEFAULT_PATTERN.order)
  const [origin, setOrigin] = useState<CodeOrigin>(WIZARD_DEFAULT_PATTERN.origin)

  // Re-hydrate whenever the site changes or the stored row lands. An absent row
  // legitimately means the built-in default, so this falls back rather than
  // leaving whatever the previous site had in the fields.
  useEffect(() => {
    setTemplate(stored.data?.template ?? WIZARD_DEFAULT_PATTERN.template)
    setDefaultBlock(stored.data?.defaultBlock ?? WIZARD_DEFAULT_PATTERN.defaultBlock)
    setOrder((stored.data?.order as CodeOrder) ?? WIZARD_DEFAULT_PATTERN.order)
    setOrigin((stored.data?.origin as CodeOrigin) ?? WIZARD_DEFAULT_PATTERN.origin)
  }, [stored.data, effectiveId])

  const issue = templateIssue(template)
  const used = usedTokens(template)
  const wh = warehouses.find((w) => w.id === effectiveId)

  // The same renderer the server plans with, so this preview cannot be a
  // different answer from the codes a sweep actually mints.
  const preview = [1, 2, 3].map((n) =>
    formatCode(template, {
      wh: wh?.code ?? 'WH', block: defaultBlock,
      x: n, y: 1, n, row: 1, col: n, floor: 0,
    }),
  )

  const commit = (pattern: Parameters<typeof save.mutate>[0]) => {
    save.mutate(pattern, {
      onSuccess: () => addToast(
        pattern === null ? 'Back to the built-in pattern' : 'Code pattern saved', 'success',
      ),
      onError: (err) => addToast(
        err instanceof Error ? err.message : 'Could not save the pattern', 'error',
      ),
    })
  }

  return (
    <section className="glass-panel rounded-2xl p-5 sm:p-6">
      <header className="flex items-start gap-3 mb-5">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-nexgen-blue/10 flex items-center justify-center">
          <Hash className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-stone-900">Bin code pattern</h3>
          <p className="text-sm text-stone-500">
            How this site names its bins. The recode tool on the Warehouse tab opens on
            this, and an operator can still override it for one sweep.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cp-wh" className="block text-xs font-semibold text-stone-600 mb-1.5">
            Warehouse
          </label>
          <select
            id="cp-wh"
            value={effectiveId ?? ''}
            onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}
            className={inputCls}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cp-block" className="block text-xs font-semibold text-stone-600 mb-1.5">
            Default block
          </label>
          <input
            id="cp-block"
            value={defaultBlock}
            onChange={(e) => setDefaultBlock(sanitizeBlockInput(e.target.value))}
            className={`${inputCls} font-mono uppercase`}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="cp-style" className="block text-xs font-semibold text-stone-600 mb-1.5">
            Numbering
          </label>
          <select
            id="cp-style"
            value={styleOfTemplate(template)}
            onChange={(e) => {
              const next = e.target.value as 'row-col' | 'sequence' | 'custom'
              if (next !== 'custom') setTemplate(templateForStyle(next, { pad: 2, colFirst: false }))
            }}
            className={inputCls}
          >
            <option value="row-col">Row &amp; column within each block</option>
            <option value="sequence">One running number per block</option>
            <option value="custom">Custom pattern</option>
          </select>
        </div>

        {/* Only offered when the template can honour it — the same rule the recode
            wizard applies, and the reason "Start at" could once be set to no effect. */}
        {(used.has('row') || used.has('col') || used.has('n')) && (
          <div>
            <label htmlFor="cp-origin" className="block text-xs font-semibold text-stone-600 mb-1.5">
              Numbering starts at
            </label>
            <select
              id="cp-origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value as CodeOrigin)}
              className={inputCls}
            >
              {CODE_ORIGINS.map((o) => (
                <option key={o} value={o}>{CODE_ORIGIN_LABELS[o]}</option>
              ))}
            </select>
          </div>
        )}

        {used.has('n') && (
          <div>
            <label htmlFor="cp-order" className="block text-xs font-semibold text-stone-600 mb-1.5">
              Fill order
            </label>
            <select
              id="cp-order"
              value={order}
              onChange={(e) => setOrder(e.target.value as CodeOrder)}
              className={inputCls}
            >
              {CODE_ORDERS.map((o) => (
                <option key={o} value={o}>{CODE_ORDER_LABELS[o]}</option>
              ))}
            </select>
          </div>
        )}

        <div className="sm:col-span-2">
          <label htmlFor="cp-template" className="block text-xs font-semibold text-stone-600 mb-1.5">
            Pattern
          </label>
          <input
            id="cp-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            maxLength={64}
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-xs text-stone-500">
            {'{wh} {block} {row} {col} {n} {x} {y} {floor}'} · pad a number as {'{n:02}'}
          </p>
          {issue && <p className="mt-1 text-xs text-rose-600">{issue}</p>}
        </div>

        <div className="sm:col-span-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <p className="text-xs font-semibold text-stone-600">The first few codes</p>
          <p className="mt-1 font-mono text-sm text-stone-800">{preview.join(' · ')}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!issue || save.isPending || effectiveId == null}
          onClick={() => commit({
            template,
            defaultBlock,
            start: stored.data?.start ?? WIZARD_DEFAULT_PATTERN.start,
            order,
            origin,
          })}
          className="rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-medium text-white btn-press disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save pattern'}
        </button>
        {/* Clearing DELETES the row: "the built-in default" must have exactly one
            representation, or a sentinel row and an absent row would both mean it. */}
        {stored.data && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => commit(null)}
            className="rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40"
          >
            Reset to the built-in pattern
          </button>
        )}
        {!stored.data && !stored.isLoading && (
          <span className="text-xs text-stone-500">
            This site is on the built-in pattern.
          </span>
        )}
      </div>

      {/* Said plainly rather than implied: this is read by the recode tool only.
          Drawing a NEW bin still mints a grid code, and pretending otherwise would
          be the more expensive kind of wrong. */}
      <p className="mt-4 text-xs text-stone-500">
        This is used when you recode bins from the Warehouse map. Bins drawn in the
        layout designer are still given a grid code, and can be recoded afterwards.
      </p>
    </section>
  )
}

export default CodePatternSection
