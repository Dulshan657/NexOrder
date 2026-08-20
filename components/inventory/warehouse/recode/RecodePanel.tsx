// The code-sweep panel: a stepped side panel beside the live map.
//
// ── Why Apply is here, and visible at every step ─────────────────────────────
//
// It used to be `Recode {N}` inside a dialog that only opened after Preview
// succeeded, disabled on three separate conditions. The operator reported "I only
// see a Preview button and no button to apply" — the button existed; it did not read
// as one, because nothing on screen said it was there or what would reveal it.
//
// So the footer is always rendered, always says what it will do, and when it cannot
// be pressed it says WHY in one line. A disabled control with a reason is a
// signpost; a disabled control without one is a dead end, and an absent one is worse
// than either.
//
// The panel is a normal grid sibling of the map, NOT an overlay — the map stays live
// and paintable throughout, which is the whole point of stepping rather than
// modalling. It therefore never trips `npm run check:overlays`.

import { AlertTriangle, ArrowRight, Info, Loader2, X } from 'lucide-react'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'
import type { SheetPresetName } from '@/lib/labels/sizing'
import type { CodeOrder, CodeOrigin } from '@/lib/codePattern'
import type { RecodeSelectionState, RecodeStep, RecodeTool } from './useRecodeSelection'
import type { BlockCensusRow } from './recodeGeometry'
import type { VisibleControls } from './recodePlanView'
import { SelectStep } from './steps/SelectStep'
import { BlockStep } from './steps/BlockStep'
import { NumberingStep } from './steps/NumberingStep'
import { ReviewStep } from './steps/ReviewStep'
import { RecodeSuccessPanel } from './RecodeSuccessPanel'

const STEPS: Array<{ n: 1 | 2 | 3 | 4; label: string }> = [
  { n: 1, label: 'Select' },
  { n: 2, label: 'Block' },
  { n: 3, label: 'Numbering' },
  { n: 4, label: 'Review' },
]

export interface RecodeApplied {
  recoded: number
  levels: number
  labelPrintedReset: number
  block: string
}

export interface RecodePanelProps {
  state: RecodeSelectionState
  template: string
  controls: VisibleControls
  /** The first few codes, rendered client-side by the shared pure module. */
  samples: readonly string[]
  areaNames: readonly string[]
  spannedAreas: readonly string[]
  blocks: readonly BlockCensusRow[]
  swept: number
  total: number
  lastSweep: { block: string; rows: number } | null
  blockSuggestion: string | null
  incumbentCount: number
  levelCodes: readonly string[]
  preview: RecodePreview | null
  previewing: boolean
  /** Why the dry run failed, or null. Distinct from a null `preview`, which also
   *  covers "the server has not been asked yet". */
  previewError: string | null
  onRetryPreview: () => void
  applying: boolean
  reverting: boolean
  applied: RecodeApplied | null
  canRevert: boolean
  preset: SheetPresetName
  ackPrinted: boolean

  onTool: (tool: RecodeTool) => void
  onMode: (mode: 'add' | 'erase') => void
  onUndo: () => void
  onClear: () => void
  onSelectArea: (areaName: string) => void
  onSelectBlock: (block: string) => void
  onBlock: (block: string) => void
  onTemplate: (template: string | null) => void
  onOrigin: (origin: CodeOrigin) => void
  onOrder: (order: CodeOrder) => void
  onStart: (startAt: number | null) => void
  onAdvanced: (advanced: boolean) => void
  onSaveDefault: () => void
  savingDefault: boolean
  isSiteDefault: boolean
  onAckPrinted: (ack: boolean) => void
  onGotoStep: (step: RecodeStep) => void
  onUseSuggestedOrigin: () => void
  onRenumberBlock: () => void
  onApply: () => void
  onPrintLabels: () => void
  onRevert: () => void
  onSweepAnother: () => void
  onCancel: () => void
}

export type ApplyBlockTone = 'busy' | 'todo' | 'problem'

export interface ApplyBlock {
  /** The one-line reason. Identical to what applyBlockedReason returns. */
  reason: string
  tone: ApplyBlockTone
  /** Where the operator can go to fix it, or null when there is nowhere to go.
   *  Never `'done'` — a finished sweep has no blockers left to answer. */
  step: 1 | 2 | 3 | 4 | null
}

export interface ApplyBlockArgs {
  selectedCount: number
  block: string
  preview: RecodePreview | null
  previewing: boolean
  applying: boolean
  ackPrinted: boolean
}

/**
 * Why Apply cannot be pressed — or null when it can.
 *
 * Deliberately ordered by which the operator can act on FIRST. Telling someone with
 * an empty selection to review three refusals would be technically true and useless.
 *
 * Each blocker also names the step that ANSWERS it, which is what lets the footer
 * treat "the problem is elsewhere" as a destination rather than a refusal. Without
 * that distinction the button below was disabled on every step but 4, so the promise
 * three comments down — that pressing Apply from step 1 takes you to Review — was
 * describing a branch that could not fire.
 */
export function applyBlock(args: ApplyBlockArgs): ApplyBlock | null {
  if (args.applying) return { reason: 'Applying…', tone: 'busy', step: null }
  if (args.selectedCount === 0) {
    return { reason: 'Paint some bins on the map', tone: 'todo', step: 1 }
  }
  if (!args.block.trim()) return { reason: 'Give the block a name', tone: 'todo', step: 2 }
  if (args.previewing) return { reason: 'Checking the new codes…', tone: 'busy', step: null }
  if (!args.preview) return { reason: 'Review the sweep first', tone: 'todo', step: 4 }
  if (args.preview.refusedTotal > 0) {
    return {
      reason: `Resolve ${args.preview.refusedTotal} problem${args.preview.refusedTotal === 1 ? '' : 's'}`,
      tone: 'problem',
      step: 4,
    }
  }
  if (args.preview.labelPrinted > 0 && !args.ackPrinted) {
    return { reason: 'Confirm the printed labels', tone: 'problem', step: 4 }
  }
  if (args.preview.willRecode === 0) {
    return { reason: 'Nothing would change', tone: 'todo', step: null }
  }
  return null
}

/** The narrow view of the above — the reason alone, which is what any non-visual
 *  caller wants and what __tests__/recodePanelGating.test.ts pins. */
export function applyBlockedReason(args: ApplyBlockArgs): string | null {
  return applyBlock(args)?.reason ?? null
}

export function RecodePanel(props: RecodePanelProps) {
  const { state, preview } = props
  const done = state.step === 'done'

  const blocked = applyBlock({
    selectedCount: state.selected.size,
    block: state.block,
    preview,
    previewing: props.previewing,
    applying: props.applying,
    ackPrinted: props.ackPrinted,
  })

  /* A blocker on ANOTHER step is a destination, not a refusal: pressing Apply takes
     you there, which is runRecode's own first branch. Only a blocker you are already
     standing on — or one with nowhere to go, like "Applying…" — disables the button. */
  const navigable = !!blocked && blocked.step !== null && blocked.step !== state.step
  const applyDisabled = !!blocked && !navigable

  return (
    <aside
      aria-label="Recode bins"
      className="glass-panel flex max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-stone-200"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-stone-800">Recode bins</h2>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Close recode"
          className="ml-auto rounded p-1 text-stone-400 btn-press hover:bg-stone-100 hover:text-stone-600"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      {!done && (
        <nav aria-label="Steps" className="flex shrink-0 gap-1 border-b border-stone-200 px-3 py-2">
          {STEPS.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => props.onGotoStep(s.n)}
              aria-current={state.step === s.n ? 'step' : undefined}
              className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium btn-press ${
                state.step === s.n
                  ? 'bg-nexgen-blue/10 text-nexgen-blue'
                  : 'text-stone-500 hover:bg-stone-50'
              }`}
            >
              <span className="tabular-nums">{s.n}</span> {s.label}
            </button>
          ))}
        </nav>
      )}

      {/* The overlay rule applies here too even though this is not an overlay: the
          body is the only scroller, so the footer can never be pushed out of reach.
          min-h-0 is load-bearing — without it flexbox refuses to shrink the body. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {done && props.applied ? (
          <RecodeSuccessPanel
            recoded={props.applied.recoded}
            levels={props.applied.levels}
            labelPrintedReset={props.applied.labelPrintedReset}
            block={props.applied.block}
            reverting={props.reverting}
            canRevert={props.canRevert}
            onPrintLabels={props.onPrintLabels}
            onRevert={props.onRevert}
            onSweepAnother={props.onSweepAnother}
            onDone={props.onCancel}
          />
        ) : state.step === 1 ? (
          <SelectStep
            tool={state.tool}
            mode={state.mode}
            selectedCount={state.selected.size}
            canUndo={state.undo.length > 0}
            areaNames={props.areaNames}
            spannedAreas={props.spannedAreas}
            blocks={props.blocks}
            swept={props.swept}
            total={props.total}
            lastSweep={props.lastSweep}
            reverting={props.reverting}
            onRevert={props.onRevert}
            onTool={props.onTool}
            onMode={props.onMode}
            onUndo={props.onUndo}
            onClear={props.onClear}
            onSelectArea={props.onSelectArea}
            onSelectBlock={props.onSelectBlock}
          />
        ) : state.step === 2 ? (
          <BlockStep
            block={state.block}
            suggestion={props.blockSuggestion}
            samples={props.samples}
            incumbentCount={props.incumbentCount}
            onBlock={props.onBlock}
          />
        ) : state.step === 3 ? (
          <NumberingStep
            template={props.template}
            origin={state.origin}
            order={state.order}
            startAt={state.startAt}
            advanced={state.advanced}
            controls={props.controls}
            samples={props.samples}
            onTemplate={props.onTemplate}
            onOrigin={props.onOrigin}
            onOrder={props.onOrder}
            onStart={props.onStart}
            onAdvanced={props.onAdvanced}
            onSaveDefault={props.onSaveDefault}
            savingDefault={props.savingDefault}
            isSiteDefault={props.isSiteDefault}
          />
        ) : (
          <ReviewStep
            preview={preview}
            loading={props.previewing}
            preset={props.preset}
            levelCodes={props.levelCodes}
            ackPrinted={props.ackPrinted}
            onAckPrinted={props.onAckPrinted}
            previewError={props.previewError}
            onRetryPreview={props.onRetryPreview}
            selectedCount={state.selected.size}
            onGotoStep={props.onGotoStep}
            onUseSuggestedOrigin={props.onUseSuggestedOrigin}
            onRenumberBlock={props.onRenumberBlock}
          />
        )}
      </div>

      {!done && (
        <footer className="shrink-0 border-t border-stone-200 px-3 py-2">
          {blocked && (
            /* The signpost. Above the buttons and full width rather than an 11px
               right-aligned afterthought, tinted by what KIND of blocker it is, and
               pressable when it names somewhere to go. `role=status` so the reason a
               button went grey is announced, and `aria-describedby` binds the two. */
            <div id="recode-apply-reason" role="status" aria-live="polite" className="mb-2">
              {(() => {
                const tint = blocked.tone === 'problem'
                  ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                  : 'bg-stone-100/80 text-stone-600'
                const body = (
                  <>
                    {blocked.tone === 'busy' ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-400" strokeWidth={2} aria-hidden="true" />
                    ) : blocked.tone === 'problem' ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Info className="h-3.5 w-3.5 shrink-0 text-stone-400" strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">{blocked.reason}</span>
                    {navigable && (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-400" strokeWidth={2} aria-hidden="true" />
                    )}
                  </>
                )
                const shell = `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] ${tint}`
                /* A button only when there is somewhere to go — the live region is
                   the wrapper above, so the control keeps its own button role. */
                return navigable ? (
                  <button
                    type="button"
                    onClick={() => props.onGotoStep(blocked.step!)}
                    className={`${shell} btn-press hover:brightness-95`}
                  >
                    {body}
                  </button>
                ) : (
                  <p className={shell}>{body}</p>
                )
              })()}
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Back exists on 2 and 3 as well as 4. A flow you can only walk forwards
                from the footer is not a guided one. */}
            {state.step !== 1 && (
              <button
                type="button"
                onClick={() => props.onGotoStep(((state.step as number) - 1) as RecodeStep)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 btn-press hover:bg-stone-100 hover:text-stone-700"
              >
                Back
              </button>
            )}
            {state.step !== 4 && (
              <button
                type="button"
                onClick={() => props.onGotoStep(((state.step as number) + 1) as RecodeStep)}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
              >
                Next
              </button>
            )}
            {/* Always rendered, at every step. Pressing it from step 1 takes you to
                Review, which is where the dry run happens — so the button is never
                a lie and never a dead end. That only became TRUE when `navigable`
                stopped disabling it everywhere but step 4. */}
            <button
              type="button"
              onClick={props.onApply}
              disabled={applyDisabled}
              aria-describedby={blocked ? 'recode-apply-reason' : undefined}
              aria-busy={props.applying || undefined}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-nexgen-blue px-3.5 py-1.5 text-sm font-semibold text-white btn-press hover:bg-nexgen-blue-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500"
            >
              {props.applying && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {props.applying
                ? 'Applying…'
                : navigable
                  ? 'Review'
                  : preview && preview.willRecode > 0
                    ? `Recode ${preview.willRecode}`
                    : 'Recode'}
            </button>
          </div>
        </footer>
      )}
    </aside>
  )
}
