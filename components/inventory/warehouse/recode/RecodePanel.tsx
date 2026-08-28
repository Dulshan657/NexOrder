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

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Info, Loader2, X } from 'lucide-react'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'
import type { SheetPresetName } from '@/lib/labels/sizing'
import type { CodeOrder, CodeOrigin } from '@/lib/codePattern'
import type { RecodeSelectionState, RecodeStep, RecodeTool } from './useRecodeSelection'
import type { BlockCensusRow } from './recodeGeometry'
import { stepSatisfaction, type VisibleControls } from './recodePlanView'
import { RecodeStepRail } from './RecodeStepRail'
import { SelectStep } from './steps/SelectStep'
import { BlockStep } from './steps/BlockStep'
import { NumberingStep } from './steps/NumberingStep'
import { ReviewStep } from './steps/ReviewStep'
import { RecodeSuccessPanel } from './RecodeSuccessPanel'

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

  const satisfaction = stepSatisfaction({
    selectedCount: state.selected.size,
    block: state.block,
    template: props.template,
    hasPreview: !!preview,
    refusedTotal: preview?.refusedTotal ?? 0,
    willRecode: preview?.willRecode ?? 0,
  })

  /* Which way the body should slide. A ref rather than state: it is read during the
     render that follows a step change and must never itself cause one. */
  const prevStep = useRef<number>(typeof state.step === 'number' ? state.step : 4)
  const stepNum = typeof state.step === 'number' ? state.step : 5
  const dir = stepNum >= prevStep.current ? 1 : -1
  prevStep.current = stepNum

  /* Below `lg` the panel is a docked sheet, and a collapsed one still has to show
     where you are and why Apply is blocked — so only the rail and the body collapse.
     Re-opened on every step change so navigating always reveals what it landed on,
     and never inside a step, so it does not fight a deliberate collapse. */
  const [open, setOpen] = useState(true)
  useEffect(() => { setOpen(true) }, [state.step])

  const pct = props.total > 0 ? Math.round((props.swept / props.total) * 100) : 0

  return (
    <aside
      aria-label="Recode bins"
      className={
        'rc-panel-in flex min-h-0 flex-col overflow-hidden border border-stone-200/80 shadow-elevated ' +
        // Mobile: a sheet docked to the bottom of the viewport. `sticky`, never
        // `fixed` — so check:overlays stays green honestly rather than by dodging
        // its regex, and so the map above stays live and paintable, which a scrim
        // and a focus trap (i.e. components/ui/Sheet) would both destroy.
        // `svh` so a collapsing mobile URL bar cannot clip the footer.
        'sticky bottom-0 z-20 max-h-[68svh] rounded-t-2xl bg-white/95 backdrop-blur-md ' +
        'lg:static lg:z-auto lg:max-h-full lg:rounded-xl lg:bg-white/80 lg:shadow-card'
      }
    >
      {/* Grab handle — mobile only; on desktop the panel is a column that is always
          open, so `lg:grid-rows-[1fr]` below forces it regardless of this state. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="recode-body"
        className="group flex w-full shrink-0 justify-center py-2 btn-press lg:hidden"
      >
        <span className="sr-only">{open ? 'Collapse the recode panel' : 'Expand the recode panel'}</span>
        <span className="h-1 w-9 rounded-full bg-stone-300 transition-colors group-hover:bg-stone-400" />
      </button>

      <header className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-1 lg:pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold leading-tight tracking-tight text-stone-900">
            Recode bins
          </h2>
          {/* Standing site context — true on all four steps, so it belongs to the
              panel and not to step 1, where it used to compete with the selection
              count for the same glance. */}
          {props.total > 0 && (
            <p className="mt-0.5 text-xs text-stone-500">
              <span className="font-medium tabular-nums text-stone-600">{props.swept}</span>
              {' of '}
              <span className="tabular-nums">{props.total}</span> recoded
              <span className="text-stone-500"> &middot; {props.total - props.swept} to go</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Close recode"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-stone-500 btn-press hover:bg-stone-100 hover:text-stone-600"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      {props.total > 0 && (
        <div className="h-1 w-full shrink-0 bg-stone-100" aria-hidden="true">
          <div className="rc-rail-fill h-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* min-h-0 on BOTH this and the body: without it here the 0fr row cannot
          collapse a flex child, and without it below flexbox refuses to shrink the
          scroller. */}
      <div
        className={`grid min-h-0 rc-sheet-collapsible lg:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          {!done ? (
            <RecodeStepRail step={state.step} satisfaction={satisfaction} onGotoStep={props.onGotoStep} />
          ) : (
            /* Not hidden on `done` — dropping the rail entirely made the panel
               visibly collapse at the moment it should feel finished. */
            <div className="shrink-0 border-b border-stone-200/80 px-4 pb-3 pt-2.5">
              <div className="h-0.5 w-full rounded-full bg-emerald-400" aria-hidden="true" />
            </div>
          )}

      {/* The overlay rule applies here too even though this is not an overlay: the
          body is the only scroller, so the footer can never be pushed out of reach.
          min-h-0 is load-bearing — without it flexbox refuses to shrink the body. */}
      <div
        id="recode-body"
        key={String(state.step)}
        style={{ '--rc-dir': dir } as any}
        className="rc-step-in min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
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
            blocks={props.blocks}
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
        </div>
      </div>

      {!done && (
        <footer className="shrink-0 border-t border-stone-200/80 bg-white/70 px-4 py-3 backdrop-blur-sm">
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
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-500" strokeWidth={2} aria-hidden="true" />
                    ) : blocked.tone === 'problem' ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Info className="h-3.5 w-3.5 shrink-0 text-stone-500" strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">{blocked.reason}</span>
                    {navigable && (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-500" strokeWidth={2} aria-hidden="true" />
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
              data-testid="recode-apply"
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
