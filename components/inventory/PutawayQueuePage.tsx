// Wrapper around <PutawayQueueView> that owns the warehouse picker: which site
// opens by default (resolvePutawayWarehouse — deep link, then home warehouse,
// then whichever site actually has pending work, then the first active site)
// and the ?wh= deep link so a post-receipt "Go to putaway" CTA (ReceiveStockView
// -> AdminView -> here) and a page refresh both land on the right warehouse.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Footprints, PackageOpen } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { usePendingPutawayCounts } from '../../hooks/queries/usePendingPutawayCounts';
import { useAssignedPutaways } from '../../hooks/queries/usePutawayWalk';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';
import { resolvePutawayWarehouse } from './putawayWarehouse';
import { UserRole, type User } from '../../types';
import PutawayQueueView from './PutawayQueueView';
import PutawayWalkView from './PutawayWalkView';

type Stage = 'assign' | 'walk';

/** A phone in an aisle is a walker; a wide screen is someone at a desk. Just a
 *  starting tab — either user can switch, and the choice sticks for the session. */
function defaultStage(): Stage {
  if (typeof window === 'undefined') return 'assign';
  return window.matchMedia('(max-width: 767px)').matches ? 'walk' : 'assign';
}

interface PutawayQueuePageProps {
  currentUser: User;
}

// RLS (`wie_putaway_recommendations_select_ops`) only lets these roles read
// the table the counts come from — asking for anyone else just errors.
const CAN_VIEW_PUTAWAY_COUNTS = new Set<UserRole>([UserRole.ADMIN, UserRole.MANAGER, UserRole.WAREHOUSE]);

const PutawayQueuePage: React.FC<PutawayQueuePageProps> = ({ currentUser }) => {
  const { data: warehouses } = useWarehouses();
  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive),
    [warehouses],
  );

  const countsEnabled = CAN_VIEW_PUTAWAY_COUNTS.has(currentUser.role);
  const { data: counts } = usePendingPutawayCounts(countsEnabled);

  // Shares the app-wide warehouse scope with Stock/Products/Dashboard/Warehouse
  // (see WarehouseScopeContext). Same rule as WarehousePage: merely opening this
  // tab must not clobber a shared 'all' scope for those other tabs, so under
  // 'all' we only *display* a local default (resolvePutawayWarehouse — prefers
  // a site with actual pending work); we never call setScope for it. Picking a
  // site via the selector below DOES write back — that's intended.
  const { scope, setScope } = useWarehouseScope();

  // Wait for counts to settle before computing the "has pending work" default
  // — otherwise every load would show the first active warehouse before the
  // count that should have won even arrives.
  const countsReady = !countsEnabled || counts !== undefined;
  const localFallback = useMemo(
    () =>
      countsReady
        ? resolvePutawayWarehouse({
            deepLinkId: null,
            homeWarehouseId: currentUser.homeWarehouseId,
            counts: counts ?? {},
            activeWarehouses,
          })
        : null,
    [countsReady, counts, activeWarehouses, currentUser.homeWarehouseId],
  );

  const effectiveWarehouseId = scope !== 'all' ? scope : localFallback;

  const [stage, setStage] = useState<Stage>(defaultStage);
  // Drives the Walk tab's badge. Cheap: the walk view reads the same query key,
  // so opening the tab costs no second round trip.
  const { data: assignedTasks } = useAssignedPutaways(effectiveWarehouseId);
  const assignedCount = assignedTasks?.length ?? 0;
  // Warehouse staff can only place stock at their own site (the same rule
  // complete-putaway enforces server-side, mirrored here so the buttons are
  // disabled rather than failing on tap).
  const canPlaceHere =
    currentUser.role !== UserRole.WAREHOUSE ||
    currentUser.homeWarehouseId === effectiveWarehouseId;

  // A post-receipt "Go to putaway" CTA (ReceiveStockView -> AdminView ->
  // openPutaway) sets `?wh=<id>` then switches tabs. The scope provider only
  // reads `?wh=` at its own init, so a fresh page load honours the link, but an
  // in-session tab switch wouldn't. Adopt a valid deep link into the shared
  // scope exactly once, but only while scope is still 'all' — an explicit site
  // already in the shared scope must never be overridden by a stale link.
  const deepLinkAdopted = useRef(false);
  useEffect(() => {
    if (deepLinkAdopted.current) return;
    if (scope !== 'all') {
      deepLinkAdopted.current = true;
      return;
    }
    if (activeWarehouses.length === 0) return;
    if (typeof window === 'undefined') return;

    const raw = new URLSearchParams(window.location.search).get('wh');
    const deepLinkId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    if (deepLinkId != null && activeWarehouses.some((w) => w.id === deepLinkId)) {
      deepLinkAdopted.current = true;
      setScope(deepLinkId);
    }
  }, [scope, activeWarehouses, setScope]);

  const pickWarehouse = (id: number | null) => {
    if (id != null) setScope(id);
  };

  const optionLabel = (w: { id: number; name: string; code: string }): string => {
    const base = `${w.name} (${w.code})`;
    if (!countsEnabled) return base;
    const pending = counts?.[w.id] ?? 0;
    return `${base} — ${pending > 0 ? `${pending} pending` : 'none'}`;
  };

  return (
    <div className="bg-white min-h-svh">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8">
        {/* Clamped for the reason spelled out in StocktakePage: a native
            <select> sizes to its widest OPTION, so this ran 53px off a 360px
            screen and worsened with every site added. `min-w-0` is what lets
            `max-w-full` bite. */}
        <label className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-stone-600">
          <span className="shrink-0 font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => pickWarehouse(e.target.value ? Number(e.target.value) : null)}
            className="min-w-0 max-w-full truncate text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          >
            <option value="">Select a warehouse…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {optionLabel(w)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {effectiveWarehouseId != null ? (
        <>
          <div className="px-4 sm:px-6 lg:px-8 pt-4">
            <div
              role="tablist"
              aria-label="Putaway stage"
              className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200"
            >
              {(['assign', 'walk'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={stage === t}
                  onClick={() => setStage(t)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] rounded-md text-sm btn-press ${
                    stage === t ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  {t === 'assign' ? (
                    <><ClipboardList className="w-4 h-4" aria-hidden="true" /> Assign</>
                  ) : (
                    <>
                      <Footprints className="w-4 h-4" aria-hidden="true" /> Walk
                      {assignedCount > 0 && (
                        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-nexgen-blue text-white text-[10px] tabular-nums">
                          {assignedCount}
                        </span>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-400">
              {stage === 'assign'
                ? 'Decide which bin each line goes to. Nothing moves until someone carries it.'
                : 'Carry each pallet to its bin and scan to confirm. This is when the stock moves.'}
            </p>
          </div>

          {stage === 'assign' ? (
            <PutawayQueueView warehouseId={effectiveWarehouseId} />
          ) : (
            <div className="p-4 sm:p-6 lg:p-8">
              <PutawayWalkView warehouseId={effectiveWarehouseId} canPlace={canPlaceHere} />
            </div>
          )}
        </>
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="glass-card rounded-xl p-10 text-center">
            <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to see its putaway queue</p>
            <p className="text-xs text-stone-400 mt-1">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PutawayQueuePage;
