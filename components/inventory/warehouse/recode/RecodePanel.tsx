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

import { X } from 'lucide-react'
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
  blockSuggestion: string | null
  incumbentCount: number
  levelCodes: readonly string[]
  preview: RecodePreview | null
  previewing: boolean
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

/**
 * Why Apply cannot be pressed — or null when it can.
 *
 * Deliberately ordered by which the operator can act on FIRST. Telling someone with
 * an empty selection to review three refusals would be technically true and useless.
 */
export function applyBlockedReason(args: {
  selectedCount: number
  block: string
  preview: RecodePreview | null
  previewing: boolean
  applying: boolean
  ackPrinted: boolean
}): string | null {
  if (args.applying) return 'Applying…'
  if (args.selectedCount === 0) return 'Paint some bins on the map'
  if (!args.block.trim()) return 'Give the block a name'
  if (args.previewing) return 'Checking the new codes…'
  if (!args.preview) return 'Review the sweep first'
  if (args.preview.refusedTotal > 0) {
    return `Resolve ${args.preview.refusedTotal} problem${args.preview.refusedTotal === 1 ? '' : 's'}`
  }
  if (args.preview.labelPrinted > 0 && !args.ackPrinted) return 'Confirm the printed labels'
  if (args.preview.willRecode === 0) return 'Nothing would change'
  return null
}

export function RecodePanel(props: RecodePanelProps) {
  const { state, preview } = props
  const done = state.step === 'done'

  const blocked = applyBlockedReason({
    selectedCount: state.selected.size,
    block: state.block,
    preview,
    previewing: props.previewing,
    applying: props.applying,
    ackPrinted: props.ackPrinted,
  })

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
          />
        ) : (
          <ReviewStep
            preview={preview}
            loading={props.previewing}
            preset={props.preset}
            levelCodes={props.levelCodes}
            ackPrinted={props.ackPrinted}
            onAckPrinted={props.onAckPrinted}
            onGotoStep={props.onGotoStep}
            onUseSuggestedOrigin={props.onUseSuggestedOrigin}
            onRenumberBlock={props.onRenumberBlock}
          />
        )}
      </div>

      {!done && (
        <footer className="shrink-0 border-t border-stone-200 px-3 py-2">
          <div className="flex items-center gap-2">
            {state.step !== 4 ? (
              <button
                type="button"
                onClick={() => props.onGotoStep((state.step as number) + 1 as RecodeStep)}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => props.onGotoStep(3)}
                className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
              >
                Back
              </button>
            )}
            {/* Always rendered, at every step. Pressing it from step 1 takes you to
                Review, which is where the dry run happens — so the button is never
                a lie and never a dead end. */}
            <button
              type="button"
              onClick={props.onApply}
              disabled={!!blocked}
              className="ml-auto rounded-lg bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white btn-press disabled:opacity-40"
            >
              {props.applying
                ? 'Applying…'
                : preview && preview.willRecode > 0
                  ? `Recode ${preview.willRecode}`
                  : 'Recode'}
            </button>
          </div>
          {blocked && (
            <p className="mt-1 text-right text-[11px] text-stone-500">{blocked}</p>
          )}
        </footer>
      )}
    </aside>
  )
}
