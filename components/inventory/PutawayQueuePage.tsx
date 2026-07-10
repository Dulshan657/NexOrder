// Wrapper around <PutawayQueueView> that owns the warehouse picker: which site
// opens by default (resolvePutawayWarehouse — deep link, then home warehouse,
// then whichever site actually has pending work, then the first active site)
// and the ?wh= deep link so a post-receipt "Go to putaway" CTA (ReceiveStockView
// -> AdminView -> here) and a page refresh both land on the right warehouse.

import React, { useEffect, useMemo, useRef } from 'react';
import { PackageOpen } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { usePendingPutawayCounts } from '../../hooks/queries/usePendingPutawayCounts';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';
import { resolvePutawayWarehouse } from './putawayWarehouse';
import { UserRole, type User } from '../../types';
import PutawayQueueView from './PutawayQueueView';

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
    <div className="bg-white min-h-screen">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8">
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <span className="font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => pickWarehouse(e.target.value ? Number(e.target.value) : null)}
            className="text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
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
        <PutawayQueueView warehouseId={effectiveWarehouseId} />
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
