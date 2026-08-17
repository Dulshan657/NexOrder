// Step 3 — how the numbers run.
//
// THIS IS WHERE THE REPORTED BUG WAS. The old toolbar rendered "Start at" and
// "Order" unconditionally, while the armed template was `{wh}-{block}-{x}-{y}` — a
// pattern with no counter, whose numbers are the bin's absolute position on the map
// grid. So the operator set them, nothing changed, and there was no way from inside
// the UI to discover why. `visibleControls` is the rule that makes that impossible:
// a control may only be rendered when its token is present in the template.
//
// The origin picker is the other half. `{row}`/`{col}` count within the painted
// block, and a block genuinely has four candidate corners — which one is 1-1 depends
// on where the dock is and which way the pickers walk. Only the operator knows, and
// the ghost numbers on the map redraw as they click, so the answer is visible rather
// than described.

import {
  CODE_ORDERS,
  CODE_ORDER_LABELS,
  CODE_ORIGIN_LABELS,
  styleOfTemplate,
  templateForStyle,
  templateIssue,
  type CodeOrder,
  type CodeOrigin,
  type NumberingStyle,
} from '@/lib/codePattern'
import type { VisibleControls } from '../recodePlanView'

export interface NumberingStepProps {
  template: string
  origin: CodeOrigin
  order: CodeOrder
  startAt: number | null
  advanced: boolean
  controls: VisibleControls
  /** Corner previews, so the picker shows what each choice does. */
  samples: readonly string[]
  onTemplate: (template: string | null) => void
  onOrigin: (origin: CodeOrigin) => void
  onOrder: (order: CodeOrder) => void
  onStart: (startAt: number | null) => void
  onAdvanced: (advanced: boolean) => void
  /** Store this scheme as the site's default, so the next sweep opens on it. */
  onSaveDefault: () => void
  savingDefault: boolean
  /** True once this scheme IS the stored default — nothing to save. */
  isSiteDefault: boolean
}

const STYLES: Array<{ key: NumberingStyle; label: string; hint: string }> = [
  { key: 'row-col', label: 'Row & column', hint: 'BULK-1-1, BULK-1-2, BULK-2-1 — restarts for every block' },
  { key: 'sequence', label: 'One running number', hint: 'BULK-01, BULK-02 — shortest code, widest bars' },
]

/** The four corners, laid out as they sit on the map. */
const CORNERS: CodeOrigin[][] = [['nw', 'ne'], ['sw', 'se']]

export function NumberingStep({
  template, origin, order, startAt, advanced, controls, samples,
  onTemplate, onOrigin, onOrder, onStart, onAdvanced,
  onSaveDefault, savingDefault, isSiteDefault,
}: NumberingStepProps) {
  const style = styleOfTemplate(template)
  const issue = templateIssue(template)
  // Padding is carried by the template itself, so it is read back rather than held
  // as separate state — two representations of one fact is two ways to disagree.
  const pad = /\{(?:n|row|col):0(\d)\}/.exec(template)?.[1]
  const colFirst = template.indexOf('{col') >= 0 && template.indexOf('{col') < template.indexOf('{row')

  const setStyle = (next: NumberingStyle) => {
    onTemplate(templateForStyle(next, { pad: pad ? Number(pad) : 0, colFirst }))
  }

  return (
    <div className="flex flex-col gap-3">
      {!advanced && (
        <div className="flex flex-col gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStyle(s.key)}
              aria-pressed={style === s.key}
              className={`rounded-lg border px-2.5 py-2 text-left btn-press ${
                style === s.key
                  ? 'border-nexgen-blue bg-nexgen-blue/10'
                  : 'border-stone-200 bg-white hover:bg-stone-50'
              }`}
            >
              <span className="block text-xs font-semibold text-stone-800">{s.label}</span>
              <span className="block font-mono text-[11px] text-stone-500">{s.hint}</span>
            </button>
          ))}
          {style === 'custom' && (
            <p className="text-[11px] text-stone-500">
              This site uses a pattern of its own. Open the pattern below to change it.
            </p>
          )}
        </div>
      )}

      {/* Only rendered when the template can actually honour it. */}
      {controls.origin && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            Where numbering starts
          </p>
          <div className="flex items-start gap-3">
            <div className="grid grid-cols-2 gap-1">
              {CORNERS.map((row) => row.map((corner) => (
                <button
                  key={corner}
                  type="button"
                  onClick={() => onOrigin(corner)}
                  aria-pressed={origin === corner}
                  aria-label={CODE_ORIGIN_LABELS[corner]}
                  title={CODE_ORIGIN_LABELS[corner]}
                  className={`h-8 w-8 rounded border btn-press ${
                    origin === corner
                      ? 'border-nexgen-blue bg-nexgen-blue/15'
                      : 'border-stone-200 bg-white hover:bg-stone-50'
                  }`}
                >
                  <span
                    className={`block h-2 w-2 rounded-full ${
                      origin === corner ? 'bg-nexgen-blue' : 'bg-stone-300'
                    } ${corner === 'ne' || corner === 'se' ? 'ml-auto' : ''} ${
                      corner === 'sw' || corner === 'se' ? 'mt-auto' : ''
                    }`}
                    style={{ marginTop: corner.startsWith('s') ? 16 : 2, marginLeft: corner.endsWith('e') ? 16 : 2 }}
                  />
                </button>
              )))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-stone-500">{CODE_ORIGIN_LABELS[origin]} is 1-1.</p>
              {samples.length > 0 && (
                <p className="mt-1 truncate font-mono text-[11px] text-stone-700">
                  {samples.join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {controls.order && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-600">Fill order</span>
          <select
            value={order}
            onChange={(e) => onOrder(e.target.value as CodeOrder)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-nexgen-blue"
          >
            {CODE_ORDERS.map((o) => (
              <option key={o} value={o}>{CODE_ORDER_LABELS[o]}</option>
            ))}
          </select>
        </label>
      )}

      {controls.startAt && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-600">
            Start at <span className="font-normal text-stone-400">— blank continues the block</span>
          </span>
          <input
            type="number"
            min={1}
            max={9999}
            value={startAt ?? ''}
            onChange={(e) => onStart(e.target.value === '' ? null : Number(e.target.value))}
            className="w-28 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-sm text-stone-800 outline-none focus:border-nexgen-blue"
          />
        </label>
      )}

      {/* The replacement for a control that did nothing: say so, in its place. */}
      {controls.note && (
        <p className="rounded-lg border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-600">
          {controls.note}
        </p>
      )}

      {/* A SEPARATE act with its own audit row, never folded into the sweep that
          suggested it: one records a decision about the site, the other records a
          rewrite of its bins. */}
      <button
        type="button"
        onClick={onSaveDefault}
        disabled={savingDefault || isSiteDefault || !!issue}
        className="self-start rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50 disabled:opacity-40"
      >
        {savingDefault
          ? 'Saving…'
          : isSiteDefault
            ? 'This is the site default'
            : "Save as this site's default"}
      </button>

      <button
        type="button"
        onClick={() => onAdvanced(!advanced)}
        className="self-start text-[11px] font-medium text-nexgen-blue btn-press hover:underline"
      >
        {advanced ? 'Hide the pattern' : 'Edit the pattern directly'}
      </button>

      {advanced && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-600">Pattern</span>
          <input
            value={template}
            onChange={(e) => onTemplate(e.target.value)}
            maxLength={64}
            spellCheck={false}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs text-stone-800 outline-none focus:border-nexgen-blue"
          />
          <span className="text-[11px] text-stone-500">
            {'{wh} {block} {row} {col} {n} {x} {y} {floor}'} · add padding as {'{n:02}'}
          </span>
          {issue && <span className="text-[11px] text-rose-600">{issue}</span>}
        </label>
      )}
    </div>
  )
}
