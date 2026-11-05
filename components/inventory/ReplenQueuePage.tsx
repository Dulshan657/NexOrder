// Replenishment — the page shell.
//
// Clones PutawayQueuePage's structure (warehouse picker + assign|walk tabs +
// the site guard) because it is the same shape of work: a desk decides, a walker
// carries. The difference is which end varies. In putaway the desk chooses the
// DESTINATION; here the destination is the pick slot that is low — that is the
// entire reason the task exists — and what the desk chooses is which reserve or
// bulk bin to pull FROM.

import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';
import {
  useReplenTasks,
  usePendingReplenCounts,
  useDetectReplenishment,
} from '../../hooks/queries/useReplenishment';
import { useToastActions } from '../../hooks/useToasts';
import { UserRole, type User } from '../../types';
import ReplenQueueView from './ReplenQueueView';
import ReplenWalkView from './ReplenWalkView';
import ReplenSetupView from './replen/ReplenSetupView';
import { parseSubtab } from '../../lib/subtabUrl';
import { ADMIN_TAB_LABELS } from '../../lib/adminTabUrl';
import { PageFrame } from '../../components/ui/PageFrame';
import { PageHeader } from '../../components/ui/PageHeader';
import { PageTabs } from '../../components/ui/PageTabs';

type Stage = 'assign' | 'walk' | 'setup';

const STAGES: ReadonlyArray<Stage> = ['assign', 'walk', 'setup'];

/** A phone in an aisle is a walker; a wide screen is someone at a desk. A
 *  `?subtab=` in the URL beats both — that is how the warehouse setup
 *  checklist's `replen_min_max` step lands straight on the grid. */
function defaultStage(): Stage {
  if (typeof window === 'undefined') return 'assign';
  const fromUrl = parseSubtab<Stage>(window.location.search, STAGES, 'assign');
  if (new URLSearchParams(window.location.search).get('subtab')) return fromUrl;
  return window.matchMedia('(max-width: 767px)').matches ? 'walk' : 'assign';
}

function writeStageToUrl(next: Stage): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('subtab', next);
  window.history.replaceState({}, '', url.toString());
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
  const { addToast } = useToastActions();
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

  // Setting min/max is configuration, not floor work: mutate-product-home-bin
  // allows Admin and Manager only, so Warehouse staff never see the tab rather
  // than meeting a refusal at the Save button.
  const canConfigure =
    currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;

  const [stage, setStageState] = useState<Stage>(() => {
    const initial = defaultStage();
    return initial === 'setup' && !canConfigure ? 'assign' : initial;
  });
  const setStage = (next: Stage) => {
    setStageState(next);
    writeStageToUrl(next);
  };
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
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS.Replenishment}
        description="Top up pick slots from reserve stock when they run low."
        actions={
          <>
            {/* Clamped for the reason spelled out in StocktakePage: a native
                <select> sizes to its widest OPTION, so this ran 53px off a 360px
                screen and worsened with every site added. `min-w-0` is what lets
                `max-w-full` bite. */}
            <label className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-stone-600">
              <span className="shrink-0 font-medium">Warehouse</span>
              <select
                value={effectiveWarehouseId ?? ''}
                onChange={(e) => e.target.value && setScope(Number(e.target.value))}
                className="min-w-0 max-w-full truncate text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
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
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 touch-target-y rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${detect.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
                {detect.isPending ? 'Scanning…' : 'Scan for shortfalls'}
              </button>
            )}
          </>
        }
      />

      {effectiveWarehouseId != null ? (
        <>
          <div>
            <PageTabs
              ariaLabel="Replenishment stage"
              tabs={[
                { id: 'assign' as Stage, label: 'Assign', badge: suggestedCount },
                { id: 'walk' as Stage, label: 'Walk', badge: assignedCount },
                ...(canConfigure ? [{ id: 'setup' as Stage, label: 'Min/max setup' }] : []),
              ]}
              activeId={stage}
              onChange={setStage}
            />
            <p className="mt-2 text-xs text-stone-500">
              {stage === 'assign'
                ? 'Decide which bin each top-up comes from. Nothing moves until someone carries it.'
                : stage === 'walk'
                  ? 'Pull from the source bin and place it in the pick zone. This is when the stock moves.'
                  : 'Nothing is replenished until a product has a minimum, a maximum and a pick-zone home bin. Set them here for the whole site at once.'}
            </p>
          </div>

          {stage === 'assign' && (
            <ReplenQueueView warehouseId={effectiveWarehouseId} canWork={canWorkHere} />
          )}
          {stage === 'walk' && (
            <ReplenWalkView warehouseId={effectiveWarehouseId} canWork={canWorkHere} />
          )}
          {stage === 'setup' && canConfigure && (
            <ReplenSetupView
              warehouseId={effectiveWarehouseId}
              warehouseName={
                activeWarehouses.find((w) => w.id === effectiveWarehouseId)?.name ?? 'this warehouse'
              }
            />
          )}
        </>
      ) : (
        <div className="py-16">
          <div className="glass-card rounded-xl p-10 text-center">
            <ArrowDownToLine className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to see its replenishment queue</p>
            <p className="text-xs text-stone-500 mt-1">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </PageFrame>
  );
};

export default ReplenQueuePage;
