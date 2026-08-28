// The warehouse setup checklist — the in-app mitigation for gap M2.
//
// Standing a warehouse up is strictly order-dependent and nothing in the UI
// said so. This panel derives where a site actually is in that chain, says why
// each step sits where it does, and links straight to it.
//
// Two deliberate restraints:
//   - it never blocks anything. A step out of order raises a warning at the
//     point of the mistake (see StockImportModal / PublishChecklist), not here;
//   - it opens COLLAPSED. The map is why this tab exists, and thirteen steps of
//     prose pushed it off the screen on every visit. There is still no dismiss
//     button — dismissal could hide a genuinely missing step, and collapsing
//     cannot, because the one visible line always carries the count and names
//     the next action.

import React, { useMemo } from 'react'
import { ChevronDown, ChevronRight, ClipboardList, CheckCircle2 } from 'lucide-react'
import { UserRole, type User } from '@/types'
import { useToasts } from '@/hooks/useToasts'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  useAcknowledgeSetupStep,
  useRevokeSetupStep,
  useWarehouseSetup,
} from '@/hooks/queries/useWarehouseSetup'
import { PHASE_LABELS, type NavTarget, type SetupPhase } from '@/lib/warehouseSetup/steps'
import { roleCanOpenTab } from '@/lib/adminTabUrl'
import { SetupStepRow } from './SetupStepRow'

interface WarehouseSetupPanelProps {
  warehouseId: number
  warehouseName: string
  currentUser: User
  /** Navigate to a tab, writing params first. Threaded from AdminView. */
  onNavigate?: (target: NavTarget, warehouseId: number) => void
}

const PHASE_ORDER: readonly SetupPhase[] = ['configure', 'map', 'load']

export function WarehouseSetupPanel({
  warehouseId,
  warehouseName,
  currentUser,
  onNavigate,
}: WarehouseSetupPanelProps) {
  const { addToast } = useToasts()
  const { summary, isLoading } = useWarehouseSetup(warehouseId)
  const acknowledge = useAcknowledgeSetupStep(warehouseId)
  const revoke = useRevokeSetupStep(warehouseId)

  // Collapsed on first view of a site, then the operator's choice sticks —
  // admin tabs unmount on switch, and onboarding means bouncing between here
  // and Settings constantly, so plain useState would re-collapse every return.
  //
  // Per-warehouse key, and WarehousePage remounts this component per warehouse
  // (keyed Fragment) BECAUSE OF THAT: useLocalStorage seeds `storedValue` in a
  // useState initialiser that runs once, while its key recomputes every render.
  // Without the remount, changing warehouse would write the previous site's
  // value under the new site's key.
  const [expanded, setExpanded] = useLocalStorage(`wh_setup_open_${warehouseId}`, false)

  const role = currentUser.role
  const canSee = role === UserRole.ADMIN || role === UserRole.MANAGER

  const grouped = useMemo(() => {
    if (!summary) return []
    return PHASE_ORDER.map((phase) => ({
      phase,
      steps: summary.steps.filter((s) => s.step.phase === phase),
    })).filter((g) => g.steps.length > 0)
  }, [summary])

  if (!canSee || isLoading || !summary || summary.totalCount === 0) return null

  const busy = acknowledge.isPending || revoke.isPending

  const onAck = (stepKey: string) => {
    acknowledge.mutate(
      { stepKey },
      {
        onSuccess: () => addToast('Step signed off', 'success'),
        onError: (e: unknown) =>
          addToast(e instanceof Error ? e.message : 'Could not record that sign-off', 'error'),
      },
    )
  }

  const onUndo = (stepKey: string) => {
    revoke.mutate(stepKey, {
      onSuccess: () => addToast('Sign-off removed', 'info'),
      onError: (e: unknown) =>
        addToast(e instanceof Error ? e.message : 'Could not undo that sign-off', 'error'),
    })
  }

  let displayIndex = 0

  return (
    <div className="glass-panel shadow-card rounded-2xl p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 text-left btn-press"
      >
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            summary.derivedComplete
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-blue-50 text-nexgen-blue'
          }`}
        >
          {summary.derivedComplete ? (
            <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
          ) : (
            <ClipboardList className="h-5 w-5" strokeWidth={2.5} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900">
            {summary.derivedComplete ? 'Setup complete' : 'Warehouse setup'}
            <span className="ml-2 font-normal text-stone-500">{warehouseName}</span>
          </p>
          {/* Naming the next action is what lets this collapse without hiding
              the answer. Falls back to the tally only when nothing is left. */}
          <p className="mt-0.5 truncate text-xs text-stone-500">
            {summary.currentTitle
              ? <>Next: <span className="text-stone-600">{summary.currentTitle}</span></>
              : `${summary.doneCount} of ${summary.totalCount} steps done`}
          </p>
        </div>

        {summary.remainingCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {summary.remainingCount} remaining
          </span>
        )}

        <span className="shrink-0 text-stone-500">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {grouped.map(({ phase, steps }) => (
            <div key={phase}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                {PHASE_LABELS[phase]}
              </p>
              <ul className="space-y-0.5">
                {steps.map((state) => {
                  displayIndex += 1
                  const target = state.step.target
                  // Settings is Admin-only in AdminView, so a Manager gets the
                  // step with its action disabled and told why, rather than a
                  // button that navigates to a blank page.
                  const reachable =
                    !!target && !!onNavigate && roleCanOpenTab(String(role), target.tab)
                  return (
                    // Fragment carries the key: there is no @types/react, so
                    // `key` on a typed local component is checked against its
                    // own props and errors.
                    <React.Fragment key={state.step.key}>
                      <SetupStepRow
                        state={state}
                        index={displayIndex}
                        busy={busy}
                        onNavigate={reachable ? () => onNavigate!(target!, warehouseId) : undefined}
                        onAcknowledge={() => onAck(state.step.key)}
                        onRevoke={() => onUndo(state.step.key)}
                        blockedReason={
                          target && !reachable ? 'An administrator needs to do this one' : undefined
                        }
                      />
                    </React.Fragment>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
