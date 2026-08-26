// Off-home — stock sitting outside its product's assigned slotting blocks.
//
// The tidy-up half of slotting. Rules steer NEW stock; this is the list a rule
// written today produces from stock already on the racking.
//
// ONE STAGE, unlike Putaway and Replenishment. Those are assign|walk because
// there is a real gap between deciding and doing — the goods are on a dock and
// the walker is elsewhere. Here the stock is already in a bin and the walker is
// standing at it, so an assign stage would add a state to abandon and no safety.
//
// Every task is DISMISSABLE with a reason, and that is not a courtesy. A rule
// is a statement about where things should live; a pallet that cannot move
// because it is double-stacked behind another is a fact about the floor. The
// operator has to be able to say so without the queue re-raising it forever.
//
// TWO LISTS, BECAUSE A DISMISSAL HAS TO BE FINDABLE. Left alone is not a log —
// it is the only surface from which a dismissal can be lifted. Without it the
// detector's quantity rule was the sole way back (more stock arriving in that
// bin), so a mis-tap, or a rule changed the following week, was unreachable.
// Restore lifts it and looks at the product again; the server re-runs the sweep
// rather than reinstating the old row, so what comes back is sized from the
// rack rather than from whenever the task was first raised.

import React, { useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, ArrowRight, X, Loader2, PackageSearch, Undo2, MessageSquareQuote,
} from 'lucide-react'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import { useWarehouseScope } from '../../context/WarehouseScopeContext'
import {
  useOffHomeTasks,
  useDetectOffHome,
  useAcceptOffHome,
  useDismissOffHome,
  useRestoreOffHome,
} from '../../hooks/queries/useOffHome'
import { useToasts } from '../../hooks/useToasts'
import { UserRole, type User } from '../../types'
import type { OffHomeTask, RestoreResult } from '../../services/supabase/offHomeService'
import { parseSubtab } from '../../lib/subtabUrl'
import { Modal } from '../ui'

interface OffHomeQueuePageProps {
  currentUser: User
}

type View = 'todo' | 'left'

const VIEWS: ReadonlyArray<View> = ['todo', 'left']

/** No media-query default, unlike Replenishment: there is no desk/walker split
 *  here — both lists are the same person's work, one stage. */
function defaultView(): View {
  if (typeof window === 'undefined') return 'todo'
  return parseSubtab<View>(window.location.search, VIEWS, 'todo')
}

function writeViewToUrl(next: View): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('subtab', next)
  window.history.replaceState({}, '', url.toString())
}

/** Compact relative-time label. A twin of the one in ReceiveStockView; kept
 *  local because it decides nothing — it only formats. */
const relativeTime = (iso: string | null): string => {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diffMs)) return ''
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** A restore that raised nothing is not a failure, and must not read like one.
 *  The server says which of the several reasons it was; say it back. */
function restoreExplanation(task: OffHomeTask, reason: RestoreResult['reason']): string {
  switch (reason) {
    case 'now_in_block':
      return `${task.productSku} is inside an assigned block now — nothing to move.`
    case 'no_stock':
      return `There is no free stock left in ${task.fromCode}.`
    case 'no_rule':
    case 'no_slotting_rules':
      return `${task.productSku} has no slotting rule any more, so nothing says where it belongs.`
    case 'still_dismissed':
      return `${task.productSku} has been left in ${task.fromCode} again since.`
    case 'no_published_layout':
      return 'This site has no published layout, so there are no bins to check.'
    default:
      return `${task.productSku} is no longer off-home.`
  }
}

const OffHomeQueuePage: React.FC<OffHomeQueuePageProps> = ({ currentUser }) => {
  const { data: warehouses } = useWarehouses()
  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive),
    [warehouses],
  )
  const { addToast } = useToasts()

  // Shares the app-wide scope, and — like the putaway and replenishment pages —
  // merely opening this tab must not clobber a shared 'all' scope.
  const { scope, setScope } = useWarehouseScope()
  const localFallback = useMemo(() => {
    if (currentUser.homeWarehouseId != null
        && activeWarehouses.some((w) => w.id === currentUser.homeWarehouseId)) {
      return currentUser.homeWarehouseId
    }
    return activeWarehouses[0]?.id ?? null
  }, [activeWarehouses, currentUser.homeWarehouseId])
  const warehouseId = scope !== 'all' ? scope : localFallback

  const { data: tasks, isLoading, error } = useOffHomeTasks(warehouseId)
  const { data: leftAlone, isLoading: leftLoading } = useOffHomeTasks(warehouseId, 'dismissed')
  const detect = useDetectOffHome()
  const accept = useAcceptOffHome()
  const dismiss = useDismissOffHome()
  const restore = useRestoreOffHome()

  const [view, setViewState] = useState<View>(defaultView)
  const setView = (next: View) => { setViewState(next); writeViewToUrl(next) }

  const [dismissing, setDismissing] = useState<OffHomeTask | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  // Warehouse staff may only move stock at their own site — the rule
  // mutate-offhome-task enforces server-side, mirrored here so the buttons are
  // disabled rather than failing on tap.
  const canWorkHere =
    currentUser.role !== UserRole.WAREHOUSE || currentUser.homeWarehouseId === warehouseId

  const runScan = async () => {
    if (warehouseId == null) return
    try {
      const r = await detect.mutateAsync({ warehouseId })
      addToast(
        r.reason === 'no_slotting_rules'
          ? 'No slotting rules here yet — nothing can be off-home until a rule says where things belong.'
          : r.reason === 'no_published_layout'
            ? 'This site has no published layout, so there are no bins to check.'
            : r.raised > 0
              ? `${r.raised} pallet${r.raised === 1 ? '' : 's'} sitting outside their block`
              : 'Everything is where its rules say it should be',
        r.raised > 0 ? 'info' : 'success',
      )
      // Never silent: a capped sweep that reported only its findings would read
      // as "that is all of it".
      if (r.truncated) {
        addToast(`Only the first ${r.scanned} products were checked — run it again to continue.`, 'info')
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not run the check.', 'error')
    }
  }

  const doAccept = async (task: OffHomeTask) => {
    if (warehouseId == null) return
    setBusyId(task.id)
    try {
      const r = await accept.mutateAsync({ warehouseId, taskId: task.id })
      addToast(`Moved ${r.moved} × ${task.productSku}`, 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not move that stock.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const doDismiss = async () => {
    if (warehouseId == null || !dismissing) return
    try {
      await dismiss.mutateAsync({ warehouseId, taskId: dismissing.id, reason: reason.trim() })
      addToast(`${dismissing.productSku} left where it is`, 'success')
      setDismissing(null)
      setReason('')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not dismiss that task.', 'error')
    }
  }

  const doRestore = async (task: OffHomeTask) => {
    if (warehouseId == null) return
    setBusyId(task.id)
    try {
      const r = await restore.mutateAsync({ warehouseId, taskId: task.id })
      if (r.reraised) {
        addToast(`${task.productSku} is back on the queue`, 'success')
        // Follow it: the operator pressed Restore to act on it, not to watch it
        // leave a list. If nothing was raised there is nothing to follow to.
        setView('todo')
      } else {
        addToast(restoreExplanation(task, r.reason), 'info')
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not put that back.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const rows = tasks ?? []
  const dismissedRows = leftAlone ?? []
  const listLoading = view === 'todo' ? isLoading : leftLoading

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-stone-500" /> Off-home stock
          </h2>
          <p className="mt-0.5 text-xs text-stone-500 max-w-[62ch]">
            Stock sitting outside the blocks its slotting rules assign. Moving it
            is optional — nothing here is wrong, it is just not where the rules say.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeWarehouses.length > 1 && (
            <select
              className="min-w-0 max-w-full truncate text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white"
              value={warehouseId ?? ''}
              onChange={(e) => setScope(Number(e.target.value))}
              aria-label="Warehouse"
            >
              {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={detect.isPending || warehouseId == null}
            className="btn-press inline-flex items-center gap-1.5 border border-stone-300 text-stone-700 font-medium py-2 px-4 rounded-lg hover:bg-stone-50 disabled:opacity-40"
          >
            {detect.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <RefreshCw className="w-4 h-4" />}
            Check now
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Off-home list"
        className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200"
      >
        {VIEWS.map((v) => {
          const count = v === 'todo' ? rows.length : dismissedRows.length
          return (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 touch-target-y rounded-md text-sm btn-press ${
                view === v ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {v === 'todo' ? 'To do' : 'Left alone'}
              {count > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-nexgen-blue text-white text-[10px] tabular-nums">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {view === 'left' && (
        <p className="text-xs text-stone-400 max-w-[68ch]">
          Tasks somebody decided to leave. They stay quiet while the bin holds
          the same stock or less; more arriving raises them again on its own.
          Restore lifts the decision now and checks the product again.
        </p>
      )}

      {!canWorkHere && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          This is not your home site, so you can look but not move anything.
        </p>
      )}

      {listLoading && (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-stone-100 animate-pulse" />)}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
          {error instanceof Error ? error.message : 'Could not load the queue.'}
        </p>
      )}

      {view === 'todo' && !isLoading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-200 px-4 py-12 text-center">
          <PackageSearch className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-2 text-sm text-stone-600">Nothing is off-home.</p>
          <p className="mt-1 text-xs text-stone-400 max-w-[46ch] mx-auto">
            Either everything matches its rules, or nothing has been checked yet.
            Press <span className="font-medium text-stone-500">Check now</span> to look.
          </p>
        </div>
      )}

      {view === 'todo' && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id} className="rounded-xl border border-stone-200 p-3 sm:p-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-800">
                    <span className="font-mono text-xs text-stone-500">{t.productSku}</span>
                    {' · '}{t.productName}
                  </p>
                  <p className="mt-1 text-xs text-stone-500 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono tabular-nums text-stone-700">{t.quantity}</span>
                    <span>in</span>
                    <span className="font-mono text-stone-700">{t.fromCode}</span>
                    <ArrowRight className="h-3 w-3 text-stone-300" />
                    <span>{t.blockNames.length > 0 ? t.blockNames.join(' or ') : 'an assigned block'}</span>
                  </p>
                  {t.ruleName && (
                    <p className="mt-0.5 text-[11px] text-stone-400">Rule: {t.ruleName}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => doAccept(t)}
                    disabled={!canWorkHere || busyId === t.id}
                    className="btn-press inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-stone-900 text-white disabled:opacity-40"
                  >
                    {busyId === t.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Move it
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDismissing(t); setReason('') }}
                    disabled={!canWorkHere}
                    className="btn-press inline-flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" /> Leave it
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === 'left' && !leftLoading && dismissedRows.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-200 px-4 py-12 text-center">
          <MessageSquareQuote className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-2 text-sm text-stone-600">Nothing has been left alone here.</p>
          <p className="mt-1 text-xs text-stone-400 max-w-[46ch] mx-auto">
            Tasks you dismiss from <span className="font-medium text-stone-500">To do</span> land
            here, with the reason, so they can be brought back.
          </p>
        </div>
      )}

      {view === 'left' && dismissedRows.length > 0 && (
        <ul className="space-y-2">
          {dismissedRows.map((t) => (
            <li key={t.id} className="rounded-xl border border-stone-200 bg-stone-50/60 p-3 sm:p-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-700">
                    <span className="font-mono text-xs text-stone-500">{t.productSku}</span>
                    {' · '}{t.productName}
                  </p>
                  <p className="mt-1 text-xs text-stone-500 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono tabular-nums text-stone-700">{t.quantity}</span>
                    <span>in</span>
                    <span className="font-mono text-stone-700">{t.fromCode}</span>
                    <span className="text-stone-400">· left {relativeTime(t.decidedAt)}</span>
                  </p>
                  {t.dismissedReason && (
                    <p className="mt-1 text-xs text-stone-600 italic">“{t.dismissedReason}”</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => doRestore(t)}
                    disabled={!canWorkHere || busyId === t.id}
                    className="btn-press inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-stone-800 disabled:opacity-40"
                  >
                    {busyId === t.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Undo2 className="w-3.5 h-3.5" strokeWidth={2.5} />}
                    Restore
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={dismissing !== null}
        onClose={() => setDismissing(null)}
        title={dismissing ? `Leave ${dismissing.productSku} where it is` : ''}
        dirty={reason.trim().length > 0}
        footer={({ requestClose }) => (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={requestClose} className="btn-press text-sm px-3 py-1.5 rounded-lg border border-stone-200">
              Cancel
            </button>
            <button
              type="button" onClick={doDismiss}
              disabled={!reason.trim() || dismiss.isPending}
              className="btn-press text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40"
            >
              {dismiss.isPending ? 'Saving…' : 'Leave it'}
            </button>
          </div>
        )}
      >
        <label className="block text-xs text-stone-500">
          Why is it staying?
          <input
            className="mt-1 w-full text-sm border border-stone-200 rounded px-2 py-1.5"
            value={reason}
            maxLength={300}
            placeholder="Double-stacked behind the Ryobi pallets"
            onChange={(e) => setReason(e.target.value)}
          />
          {/* A required reason, not an optional one: the next person to run the
              check needs to know why this is still here, and "somebody
              dismissed it" is not an answer. */}
          <span className="mt-1 block text-[10px] text-stone-400">
            Recorded against the task. It will not be raised again unless more
            stock arrives in this bin — a bigger pile is a different problem. You
            can bring it back any time from <span className="font-medium text-stone-500">Left alone</span>.
          </span>
        </label>
      </Modal>
    </div>
  )
}

export default OffHomeQueuePage
