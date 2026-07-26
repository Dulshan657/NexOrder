// Replenishment — the page shell.
//
// Clones PutawayQueuePage's structure (warehouse picker + assign|walk tabs +
// the site guard) because it is the same shape of work: a desk decides, a walker
// carries. The difference is which end varies. In putaway the desk chooses the
// DESTINATION; here the destination is the pick slot that is low — that is the
// entire reason the task exists — and what the desk chooses is which reserve or
// bulk bin to pull FROM.

import React, { useMemo, useState } from 'react';
import { ClipboardList, Footprints, ArrowDownToLine, RefreshCw } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';
import {
  useReplenTasks,
  usePendingReplenCounts,
  useDetectReplenishment,
} from '../../hooks/queries/useReplenishment';
import { useToasts } from '../../hooks/useToasts';
import { UserRole, type User } from '../../types';
import ReplenQueueView from './ReplenQueueView';
import ReplenWalkView from './ReplenWalkView';

type Stage = 'assign' | 'walk';

/** A phone in an aisle is a walker; a wide screen is someone at a desk. */
function defaultStage(): Stage {
  if (typeof window === 'undefined') return 'assign';
  return window.matchMedia('(max-width: 767px)').matches ? 'walk' : 'assign';
}

interface ReplenQueuePageProps {
  currentUser: User;
}

// RLS (`wie_replen_tasks_select_ops`) only lets these roles read the table.
const CAN_VIEW_REPLEN = new Set<UserRole>([UserRole.ADMIN, UserRole.MANAGER, UserRole.WAREHOUSE]);

const ReplenQueuePage: React.FC<ReplenQueuePageProps> = ({ currentUser }) => {
  const { data: warehouses } = useWarehouses();
  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive),
    [warehouses],
  );

  const countsEnabled = CAN_VIEW_REPLEN.has(currentUser.role);
  const { data: counts } = usePendingReplenCounts(countsEnabled);
  const { addToast } = useToasts();
  const detect = useDetectReplenishment();

  // Shares the app-wide warehouse scope. Same rule as the putaway page: merely
  // opening this tab must not clobber a shared 'all' scope, so under 'all' we
  // display a local default (the picker's own site, else the first active one)
  // without writing it back. Choosing a site from the selector DOES write back.
  const { scope, setScope } = useWarehouseScope();
  const localFallback = useMemo(() => {
    if (currentUser.homeWarehouseId != null
        && activeWarehouses.some((w) => w.id === currentUser.homeWarehouseId)) {
      return currentUser.homeWarehouseId;
    }
    // Prefer a site that actually has work waiting, so the page opens on
    // something to do rather than on an empty queue.
    const withWork = activeWarehouses.find((w) => (counts?.get(w.id) ?? 0) > 0);
    return withWork?.id ?? activeWarehouses[0]?.id ?? null;
  }, [activeWarehouses, counts, currentUser.homeWarehouseId]);

  const effectiveWarehouseId = scope !== 'all' ? scope : localFallback;

  const [stage, setStage] = useState<Stage>(defaultStage);
  const { data: tasks } = useReplenTasks(effectiveWarehouseId);
  const assignedCount = (tasks ?? []).filter((t) => t.status === 'assigned').length;
  const suggestedCount = (tasks ?? []).filter((t) => t.status === 'suggested').length;

  // Warehouse staff may only move stock at their own site — the same rule
  // complete-replenishment enforces server-side, mirrored here so buttons are
  // disabled rather than failing on tap.
  const canWorkHere =
    currentUser.role !== UserRole.WAREHOUSE ||
    currentUser.homeWarehouseId === effectiveWarehouseId;

  const runScan = async () => {
    if (effectiveWarehouseId == null) return;
    try {
      const result = await detect.mutateAsync({ warehouseId: effectiveWarehouseId });
      const raised = result?.raised ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      addToast(
        raised > 0
          ? `${raised} replenishment${raised === 1 ? '' : 's'} raised`
          : skipped > 0
            ? `Nothing to raise — ${skipped} slot${skipped === 1 ? '' : 's'} could not be refilled`
            : 'Every pick zone is above its minimum',
        raised > 0 ? 'success' : 'info',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Scan failed', 'error');
    }
  };

  const optionLabel = (w: { id: number; name: string; code: string }): string => {
    const base = `${w.name} (${w.code})`;
    if (!countsEnabled) return base;
    const pending = counts?.get(w.id) ?? 0;
    return `${base} — ${pending > 0 ? `${pending} pending` : 'none'}`;
  };

  return (
    <div className="bg-white min-h-screen">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <span className="font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => e.target.value && setScope(Number(e.target.value))}
            className="text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          >
            <option value="">Select a warehouse…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>{optionLabel(w)}</option>
            ))}
          </select>
        </label>

        {effectiveWarehouseId != null && (
          <button
            type="button"
            onClick={runScan}
            disabled={detect.isPending}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 min-h-[40px] rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${detect.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {detect.isPending ? 'Scanning…' : 'Scan for shortfalls'}
          </button>
        )}
      </div>

      {effectiveWarehouseId != null ? (
        <>
          <div className="px-4 sm:px-6 lg:px-8 pt-4">
            <div
              role="tablist"
              aria-label="Replenishment stage"
              className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200"
            >
              {(['assign', 'walk'] as const).map((t) => {
                const badge = t === 'assign' ? suggestedCount : assignedCount;
                return (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={stage === t}
                    onClick={() => setStage(t)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] rounded-md text-sm btn-press ${
                      stage === t ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                    }`}
                  >
                    {t === 'assign'
                      ? <><ClipboardList className="w-4 h-4" aria-hidden="true" /> Assign</>
                      : <><Footprints className="w-4 h-4" aria-hidden="true" /> Walk</>}
                    {badge > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-nexgen-blue text-white text-[10px] tabular-nums">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-stone-400">
              {stage === 'assign'
                ? 'Decide which bin each top-up comes from. Nothing moves until someone carries it.'
                : 'Pull from the source bin and place it in the pick zone. This is when the stock moves.'}
            </p>
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
            {stage === 'assign' ? (
              <ReplenQueueView warehouseId={effectiveWarehouseId} canWork={canWorkHere} />
            ) : (
              <ReplenWalkView warehouseId={effectiveWarehouseId} canWork={canWorkHere} />
            )}
          </div>
        </>
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="glass-card rounded-xl p-10 text-center">
            <ArrowDownToLine className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to see its replenishment queue</p>
            <p className="text-xs text-stone-400 mt-1">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReplenQueuePage;
