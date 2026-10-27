// The Putaway screen. Owns the warehouse picker: which site opens by default
// (resolvePutawayWarehouse — deep link, then home warehouse, then whichever site
// actually has pending work, then the first active site) and the ?wh= deep link
// so "Put away now" after a receipt (ReceiveStockView -> AdminView -> here) and
// a page refresh both land on the right warehouse.
//
// NX-0007: there is no Assign step any more. One scan-first screen for everyone
// (PutawayWalkView), a Scan / Guide toggle remembered per device, a ?receipt=
// filter for "Put away now", and, for Admin/Manager, a Desk view to change a
// suggested bin, Place now, and resolve shortages (PutawayQueueView).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Compass, PackageOpen, ScanLine, X } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { usePendingPutawayCounts } from '../../hooks/queries/usePendingPutawayCounts';
import { useWarehouseScope } from '../../context/WarehouseScopeContext';
import { resolvePutawayWarehouse } from './putawayWarehouse';
import { UserRole, type User } from '../../types';
import PutawayQueueView from './PutawayQueueView';
import PutawayWalkView, { type PutawayMode } from './PutawayWalkView';

type View = 'floor' | 'desk';

/** Per device, not per user: Guide suits a handheld in an aisle, Scan a desk
 *  with a USB gun. A convenience only, so storage that throws (private mode,
 *  blocked site data) silently falls back to Scan. */
const MODE_KEY = 'nexorder.putaway.mode';
function readMode(): PutawayMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'guide' ? 'guide' : 'scan';
  } catch {
    return 'scan';
  }
}
function writeMode(mode: PutawayMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* a convenience, not state: nothing to do */
  }
}

function readReceiptParam(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('receipt');
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
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

  const isDesk = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;
  const [view, setView] = useState<View>('floor');
  const [mode, setModeState] = useState<PutawayMode>(readMode);
  const setMode = (next: PutawayMode) => {
    setModeState(next);
    writeMode(next);
  };
  const [receiptId, setReceiptId] = useState<number | null>(readReceiptParam);
  const clearReceipt = () => {
    setReceiptId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('receipt');
    window.history.replaceState({}, '', url.toString());
  };
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
          <div className="px-4 sm:px-6 lg:px-8 pt-4 flex flex-wrap items-center gap-2">
            {isDesk && (
              <div role="tablist" aria-label="Putaway view" className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200">
                {(['floor', 'desk'] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 touch-target-y rounded-md text-sm btn-press ${
                      view === v ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {v === 'floor'
                      ? <><ScanLine className="w-4 h-4" aria-hidden="true" /> Put away</>
                      : <><ClipboardList className="w-4 h-4" aria-hidden="true" /> Desk</>}
                  </button>
                ))}
              </div>
            )}

            {view === 'floor' && (
              <div role="radiogroup" aria-label="How to work the list" className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200">
                {(['scan', 'guide'] as const).map((m) => (
                  <label
                    key={m}
                    className={`inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 touch-target-y rounded-md text-sm ${
                      mode === m ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    <input
                      type="radio"
                      name="putaway-mode"
                      value={m}
                      checked={mode === m}
                      onChange={() => setMode(m)}
                      aria-label={m === 'scan' ? 'Scan' : 'Guide'}
                      className="sr-only"
                    />
                    {m === 'scan'
                      ? <><ScanLine className="w-4 h-4" aria-hidden="true" /> Scan</>
                      : <><Compass className="w-4 h-4" aria-hidden="true" /> Guide</>}
                  </label>
                ))}
              </div>
            )}

            {view === 'floor' && receiptId != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-nexgen-blue/10 pl-3 pr-1 py-0.5 text-sm text-nexgen-blue-dark">
                This delivery only
                <button
                  type="button"
                  onClick={clearReceipt}
                  className="touch-target inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-white/70"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Show all
                </button>
              </span>
            )}
          </div>

          {view === 'desk' && isDesk ? (
            <PutawayQueueView warehouseId={effectiveWarehouseId} isAdmin={currentUser.role === UserRole.ADMIN} />
          ) : (
            <div className="p-4 sm:p-6 lg:p-8">
              <PutawayWalkView
                warehouseId={effectiveWarehouseId}
                canPlace={canPlaceHere}
                mode={mode}
                receiptId={receiptId}
              />
            </div>
          )}
        </>
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="glass-card rounded-xl p-10 text-center">
            <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to see its putaway queue</p>
            <p className="text-xs text-stone-500 mt-1">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PutawayQueuePage;
