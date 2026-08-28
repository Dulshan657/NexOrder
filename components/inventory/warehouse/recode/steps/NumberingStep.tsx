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
//
// Three groups, hairline-separated: the SCHEME, where it STARTS, and the site-admin
// acts. The last two used to sit at the same visual weight as the first, which made
// "save this as the site default" — a decision about the warehouse, not about this
// sweep — look like part of the sweep.

import { Check, ChevronDown } from 'lucide-react'
import { Callout, NumberInput, Select } from '@/components/ui'
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
import { MINI_BUTTON, SECTION_LABEL } from '../recodeChrome'

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

/** `example` and `note` are split because only one of them is code. Setting the
 *  English half in JetBrains Mono alongside it was a misuse of the mono face. */
const STYLES: Array<{ key: NumberingStyle; label: string; example: string; note: string }> = [
  {
    key: 'row-col',
    label: 'Row & column',
    example: 'BULK-1-1, BULK-1-2, BULK-2-1',
    note: 'Restarts for every block',
  },
  {
    key: 'sequence',
    label: 'One running number',
    example: 'BULK-01, BULK-02',
    note: 'Shortest code, so the widest bars',
  },
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
    <div className="flex flex-col gap-4">
      {/* ── Group A: the scheme ───────────────────────────────────────────── */}
      {!advanced && (
        <section className="flex flex-col gap-2">
          <p className={SECTION_LABEL}>Numbering</p>
          {STYLES.map((s) => {
            const active = style === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyle(s.key)}
                aria-pressed={active}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left btn-press transition-colors ${
                  active
                    ? 'border-nexgen-blue bg-nexgen-blue/[0.07] ring-1 ring-nexgen-blue/20'
                    : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-nexgen-blue bg-nexgen-blue text-white' : 'border-stone-300 bg-white'
                  }`}
                >
                  {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-stone-800">{s.label}</span>
                  <span className="mt-0.5 block font-mono text-xs text-stone-600">{s.example}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">{s.note}</span>
                </span>
              </button>
            )
          })}
          {style === 'custom' && (
            <p className="text-xs leading-relaxed text-stone-500">
              This site uses a pattern of its own. Open Advanced below to change it.
            </p>
          )}
        </section>
      )}

      {/* ── Group B: where it starts. Only rendered when the template can honour it. */}
      {controls.origin && (
        <section className="border-t border-stone-100 pt-4">
          <p className={SECTION_LABEL}>Where numbering starts</p>
          <div className="mt-2 flex items-start gap-3">
            <div className="grid grid-cols-2 gap-1">
              {CORNERS.map((row) => row.map((corner) => {
                const active = origin === corner
                return (
                  <button
                    key={corner}
                    type="button"
                    onClick={() => onOrigin(corner)}
                    aria-pressed={active}
                    aria-label={CODE_ORIGIN_LABELS[corner]}
                    title={CODE_ORIGIN_LABELS[corner]}
                    // `relative` + an absolutely-positioned dot. This used to be
                    // inline marginTop/marginLeft fighting `ml-auto`/`mt-auto`
                    // classes, which is exactly why the picker looked hand-drawn.
                    className={`relative h-11 w-11 rounded-lg border btn-press transition-colors ${
                      active
                        ? 'border-nexgen-blue bg-nexgen-blue/10 ring-1 ring-nexgen-blue/20'
                        : 'border-stone-200 bg-white hover:bg-stone-50'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute h-2 w-2 rounded-full ${active ? 'bg-nexgen-blue' : 'bg-stone-300'} ${
                        corner.startsWith('n') ? 'top-1.5' : 'bottom-1.5'
                      } ${corner.endsWith('w') ? 'left-1.5' : 'right-1.5'}`}
                    />
                  </button>
                )
              }))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-stone-500">
                {CODE_ORIGIN_LABELS[origin]} is 1-1.
              </p>
              {/* `break-all`, not `truncate`: this IS the picker's feedback loop, and
                  a wrapped sample is far better than a clipped one. */}
              {samples.length > 0 && (
                <p className="mt-1 break-all font-mono text-xs text-stone-700">
                  {samples.join(' · ')}
                </p>
              )}
            </div>
          </div>

        </section>
      )}

      {/* Fill order and Start at are a SIBLING section, not nested inside the origin
          picker above. They happen to imply each other today — visibleControls turns
          all three on for `{n}` — but relying on that would make a future change to
          one silently hide the others.

          And emphatically NOT inside the Advanced disclosure below. visibleControls
          renders a control only when its token is in the template, so when one of
          these IS on screen it demonstrably changes the result, which makes it a
          primary decision. Collapsing it would be a softer version of the bug this
          whole step exists to prevent: a control the operator cannot find is not much
          better than one that does nothing. Advanced holds the SITE-admin acts. */}
      {(controls.order || controls.startAt) && (
        <section className="flex flex-wrap gap-3 border-t border-stone-100 pt-4">
          {controls.order && (
            <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-stone-700">Fill order</span>
              <Select dense value={order} onChange={(e: any) => onOrder(e.target.value as CodeOrder)}>
                {CODE_ORDERS.map((o) => (
                  <option key={o} value={o}>{CODE_ORDER_LABELS[o]}</option>
                ))}
              </Select>
            </label>
          )}
          {controls.startAt && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-stone-700">Start at</span>
              <NumberInput
                dense
                min={1}
                max={9999}
                value={startAt ?? ''}
                onChange={(e: any) => onStart(e.target.value === '' ? null : Number(e.target.value))}
                className="w-24 font-mono"
              />
              <span className="text-[11px] text-stone-500">Blank continues the block</span>
            </label>
          )}
        </section>
      )}

      {/* The replacement for a control that did nothing: say so, in its place. Kept
          OUTSIDE the Advanced disclosure below — it exists to explain an absence, so
          hiding it inside something collapsed would recreate the original bug. */}
      {controls.note && <Callout dense>{controls.note}</Callout>}

      {/* ── Group C: site administration, demoted. ────────────────────────── */}
      <section className="border-t border-stone-100 pt-3">
        <button
          type="button"
          onClick={() => onAdvanced(!advanced)}
          aria-expanded={advanced}
          className="flex w-full items-center gap-1.5 text-xs font-medium text-stone-500 btn-press hover:text-stone-700"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          Advanced
        </button>

        {advanced && (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-stone-700">Pattern</span>
              <input
                value={template}
                onChange={(e) => onTemplate(e.target.value)}
                maxLength={64}
                spellCheck={false}
                aria-invalid={issue ? true : undefined}
                className={`rounded-md border bg-white px-2.5 py-1.5 font-mono text-xs text-stone-800 outline-none focus:border-nexgen-blue focus:ring-2 focus:ring-nexgen-blue/20 ${
                  issue ? 'border-rose-300' : 'border-stone-300'
                }`}
              />
              <span className="flex flex-wrap gap-1 pt-0.5">
                {['{wh}', '{block}', '{row}', '{col}', '{n}', '{x}', '{y}', '{floor}'].map((t) => (
                  <span key={t} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">
                    {t}
                  </span>
                ))}
              </span>
              <span className="text-xs text-stone-500">Add padding as {'{n:02}'}.</span>
              {issue && <span className="text-xs text-rose-600" role="alert">{issue}</span>}
            </label>

            {/* A SEPARATE act with its own audit row, never folded into the sweep
                that suggested it: one records a decision about the site, the other
                records a rewrite of its bins. */}
            <button
              type="button"
              onClick={onSaveDefault}
              disabled={savingDefault || isSiteDefault || !!issue}
              className={`${MINI_BUTTON} self-start`}
            >
              {savingDefault
                ? 'Saving…'
                : isSiteDefault
                  ? 'This is the site default'
                  : "Save as this site's default"}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
