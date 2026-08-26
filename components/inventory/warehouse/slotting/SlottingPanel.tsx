// The slotting block builder: a stepped side panel beside the live map.
//
// A grid SIBLING of the map, never an overlay — the map stays live and paintable
// throughout, which is the whole point of stepping rather than modalling, and it
// is why `npm run check:overlays` stays green honestly rather than by dodging its
// regex. On mobile it is a `sticky` docked sheet, never `fixed`, for the same
// reason: a scrim and a focus trap (i.e. components/ui/Sheet) would both destroy
// the thing being edited.
//
// Apply is rendered at EVERY step and says why it cannot be pressed when it
// cannot. That is not decoration — the recode sweep shipped with an Apply button
// that only appeared after a successful preview, and the reported bug was "I only
// see a Preview button and no button to apply". The button existed. Nothing on
// screen said so.

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, X, Check } from 'lucide-react'
import type { SlotSelectionState, SlotStep, SlotTool } from './useSlotSelection'
import { SlotStepRail, type SlotSatisfaction } from './SlotStepRail'
import { SlotSelectStep, SlotBlockStep, SlotRuleStep } from './SlotSteps'
import type { SlottingRuleRow } from '@/services/supabase/slottingRulesService'

export interface SlotApplied {
  blockName: string
  binCount: number
  ruleName: string | null
  ruleWasCreated: boolean
}

export interface SlottingPanelProps {
  state: SlotSelectionState
  /** Leaf bins the current selection expands to — a rack contributes its levels. */
  binCount: number
  areaNames: readonly string[]
  existingNames: readonly string[]
  rules: readonly SlottingRuleRow[]
  brands: readonly string[]
  saving: boolean
  error: string | null
  applied: SlotApplied | null
  onTool: (tool: SlotTool) => void
  onMode: (mode: 'add' | 'erase') => void
  onUndo: () => void
  onClear: () => void
  onSelectArea: (name: string) => void
  onName: (name: string) => void
  onAttachRule: (id: string) => void
  onNewRuleName: (name: string) => void
  onNewRuleBrand: (brand: string) => void
  onGotoStep: (step: SlotStep) => void
  onApply: () => void
  onCancel: () => void
  onBuildAnother: () => void
}

/** What is blocking Apply, or null.
 *
 *  `step` is what makes a blocker on ANOTHER step navigable rather than a dead
 *  end: the footer button becomes "Go to Name" instead of a greyed Apply with no
 *  explanation of where the problem is. */
function applyBlock(
  state: SlotSelectionState,
  saving: boolean,
): { reason: string; tone: 'busy' | 'todo' | 'problem'; step?: SlotStep } | null {
  if (saving) return { reason: 'Saving…', tone: 'busy' }
  if (state.selected.size === 0) {
    return { reason: 'Nothing selected yet — drag across some racking.', tone: 'todo', step: 1 }
  }
  if (!state.blockName.trim()) {
    return { reason: 'The block needs a name.', tone: 'todo', step: 2 }
  }
  // Half-filled is refused rather than guessed at: a rule with a name and no
  // brand would match nothing, and one with a brand and no name is unreadable in
  // the settings table and on a putaway task.
  const wantsNew = state.newRuleName.trim() !== '' || state.newRuleBrand.trim() !== ''
  if (wantsNew && !state.newRuleName.trim()) {
    return { reason: 'The new rule needs a name.', tone: 'todo', step: 3 }
  }
  if (wantsNew && !state.newRuleBrand.trim()) {
    return { reason: 'The new rule needs a brand to match on.', tone: 'todo', step: 3 }
  }
  return null
}

export function SlottingPanel(props: SlottingPanelProps) {
  const { state } = props
  const done = state.step === 'done'
  const stepNum = done ? 4 : state.step
  const blocked = applyBlock(state, props.saving)

  const satisfaction: SlotSatisfaction = {
    1: state.selected.size > 0,
    2: state.blockName.trim().length > 0,
    // Step 3 is genuinely optional — saving just the block is a valid outcome —
    // so it reads settled once the operator has made ANY decision there,
    // including the decision not to attach a rule at all.
    3: state.selected.size > 0 && state.blockName.trim().length > 0,
  }

  // Direction of the step transition, for the slide-in.
  const prevStep = useRef(stepNum)
  const dir = stepNum >= prevStep.current ? 1 : -1
  prevStep.current = stepNum

  // Below `lg` the panel is a docked sheet, and a collapsed one still has to show
  // where you are and why Apply is blocked — so only the rail and body collapse.
  const [open, setOpen] = useState(true)
  useEffect(() => { setOpen(true) }, [state.step])

  // `stepNum` is `number | 'done'`-shaped through SlotStep, so narrow off the
  // state rather than the display value.
  const nextStep: SlotStep | null =
    state.step === 1 ? 2 : state.step === 2 ? 3 : null

  return (
    <aside
      aria-label="Build a slotting block"
      className={
        'rc-panel-in flex min-h-0 flex-col overflow-hidden border border-stone-200/80 shadow-elevated ' +
        'sticky bottom-0 z-20 max-h-[68svh] rounded-t-2xl bg-white/95 backdrop-blur-md ' +
        'lg:static lg:z-auto lg:max-h-full lg:rounded-xl lg:bg-white/80 lg:shadow-card'
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="slot-body"
        className="group flex w-full shrink-0 justify-center py-2 btn-press lg:hidden"
      >
        <span className="sr-only">{open ? 'Collapse the panel' : 'Expand the panel'}</span>
        <span className="h-1 w-9 rounded-full bg-stone-300 transition-colors group-hover:bg-stone-400" />
      </button>

      <header className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-1 lg:pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold leading-tight tracking-tight text-stone-900">
            {state.blockId ? 'Edit block' : 'New slotting block'}
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            <span className="font-medium tabular-nums text-stone-600">{props.binCount}</span>
            {' bin'}{props.binCount === 1 ? '' : 's'} selected
          </p>
        </div>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Close"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-stone-400 btn-press hover:bg-stone-100 hover:text-stone-600"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div
        className={`grid min-h-0 rc-sheet-collapsible lg:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          {!done ? (
            <SlotStepRail step={state.step} satisfaction={satisfaction} onGotoStep={props.onGotoStep} />
          ) : (
            <div className="shrink-0 border-b border-stone-200/80 px-4 pb-3 pt-2.5">
              <div className="h-0.5 w-full rounded-full bg-emerald-400" aria-hidden="true" />
            </div>
          )}

          {/* The body is the only scroller, so the footer can never be pushed out
              of reach. min-h-0 is load-bearing — without it flexbox refuses to
              shrink it. */}
          <div
            id="slot-body"
            key={String(state.step)}
            style={{ '--rc-dir': dir } as any}
            className="rc-step-in min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          >
            {done && props.applied ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-800">
                      {props.applied.blockName} saved
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {props.applied.binCount} bin{props.applied.binCount === 1 ? '' : 's'}
                      {props.applied.ruleName
                        ? props.applied.ruleWasCreated
                          ? ` · new rule “${props.applied.ruleName}” points at it`
                          : ` · added to “${props.applied.ruleName}”`
                        : ' · not attached to a rule yet'}
                    </p>
                  </div>
                </div>
                {!props.applied.ruleName && (
                  <p className="text-xs leading-relaxed text-stone-500">
                    Nothing changes on the floor until a rule points at this block.
                    Settings → Warehouse → Slotting rules is where that happens.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={props.onBuildAnother}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
                  >
                    Build another
                  </button>
                  <button
                    type="button"
                    onClick={props.onCancel}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-2.5 py-1.5 text-xs font-medium text-white btn-press"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : state.step === 1 ? (
              <SlotSelectStep
                tool={state.tool}
                mode={state.mode}
                selectedCount={state.selected.size}
                binCount={props.binCount}
                canUndo={state.undo.length > 0}
                areaNames={props.areaNames}
                onTool={props.onTool}
                onMode={props.onMode}
                onUndo={props.onUndo}
                onClear={props.onClear}
                onSelectArea={props.onSelectArea}
              />
            ) : state.step === 2 ? (
              <SlotBlockStep
                name={state.blockName}
                binCount={props.binCount}
                existingNames={props.existingNames}
                editingExisting={state.blockId != null}
                onName={props.onName}
              />
            ) : (
              <SlotRuleStep
                blockName={state.blockName}
                attachRuleId={state.attachRuleId}
                newRuleName={state.newRuleName}
                newRuleBrand={state.newRuleBrand}
                rules={props.rules}
                brands={props.brands}
                onAttachRule={props.onAttachRule}
                onNewRuleName={props.onNewRuleName}
                onNewRuleBrand={props.onNewRuleBrand}
              />
            )}
          </div>
        </div>
      </div>

      {!done && (
        <footer className="shrink-0 border-t border-stone-200/80 bg-white/70 px-4 py-3 backdrop-blur-sm">
          {props.error && (
            <p role="alert" className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 ring-1 ring-rose-200">
              {props.error}
            </p>
          )}
          {blocked && (
            // The signpost: full width, above the buttons, tinted by what KIND of
            // blocker it is, and PRESSABLE when it names somewhere to go. A
            // disabled control with a reason is a signpost; one without is a dead
            // end, and an absent one is worse than either.
            <div id="slot-apply-reason" role="status" aria-live="polite" className="mb-2">
              {blocked.step && blocked.step !== state.step ? (
                <button
                  type="button"
                  onClick={() => props.onGotoStep(blocked.step as SlotStep)}
                  className="w-full rounded-lg bg-stone-100/80 px-2.5 py-1.5 text-left text-xs text-stone-600 btn-press hover:bg-stone-200/70"
                >
                  {blocked.reason}
                </button>
              ) : (
                <div
                  className={
                    'rounded-lg px-2.5 py-1.5 text-xs ' +
                    (blocked.tone === 'problem'
                      ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                      : 'bg-stone-100/80 text-stone-600')
                  }
                >
                  {blocked.reason}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {nextStep && (
              <button
                type="button"
                onClick={() => props.onGotoStep(nextStep)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 btn-press hover:bg-stone-50"
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={props.onApply}
              disabled={blocked !== null}
              aria-describedby={blocked ? 'slot-apply-reason' : undefined}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white btn-press disabled:cursor-not-allowed disabled:opacity-40"
            >
              {props.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {state.blockId ? 'Save block' : 'Create block'}
            </button>
          </div>
        </footer>
      )}
    </aside>
  )
}

export default SlottingPanel
