// The putaway DESK (NX-0007), for Admin/Manager: the suggested lines nobody has
// carried yet. There is no Assign step any more (the home bin is the plan, and
// the floor completes a suggestion directly), so the desk does three things:
//   * Change bin  - redirect a suggestion before anyone walks it (NX-0006);
//   * Place now   - Admin only: decide and move in one step, no walk (CSV
//                   opening stock, desk corrections);
//   * Shortages   - resolve what the floor flagged short (PutawayShortList).
//
// This file stays an orchestrator: row rendering lives in putaway/PutawayRow,
// bin selection in putaway/BinPickerSheet, and the list logic (search, filter,
// receipt grouping) in the pure putaway/putawayGrouping module.
//
// One search box, no scan dock: the floor scans on the Put away tab. The box
// matches barcodes and plate codes too, so a scan typed into it still lands.

import React, { useMemo, useState } from 'react';
import { PackageOpen, Search, Layers } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getPendingPutaways, type PendingPutawayRow } from '../../services/supabase/putawayQueueService';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useDecidePutaway, useRedirectPutaway, useRerunPutaway } from '../../hooks/queries/usePutawayRecommendation';
import { putawayKeys } from '../../hooks/queries/putawayKeys';
import { useToastActions } from '../../hooks/useToasts';
import { PutawayRow } from './putaway/PutawayRow';
import { BinPickerSheet } from './putaway/BinPickerSheet';
import { PutawayShortList } from './putaway/PutawayShortList';
import { filterQueue, groupByReceipt, type QueueStateFilter } from './putaway/putawayGrouping';
import { buildDisplayLookup, displayFor } from '@/lib/locationLookup';

interface PutawayQueueViewProps {
  warehouseId: number;
  /** Place now is Admin only (NX-0007). */
  isAdmin?: boolean;
}

const PutawayQueueView: React.FC<PutawayQueueViewProps> = ({ warehouseId, isAdmin = false }) => {
  const queueQuery = useQuery({
    queryKey: putawayKeys.byWarehouse(warehouseId),
    queryFn: () => getPendingPutaways(warehouseId),
    enabled: warehouseId != null,
    // This screen must never show a stale cache after a receipt lands new
    // recommendations — always treat data as stale and re-read on mount
    // (switching tabs back into Putaway, or a fresh warehouse selection).
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const locationsQuery = useWarehouseLocations(warehouseId);
  const decide = useDecidePutaway();
  const redirect = useRedirectPutaway();
  const rerun = useRerunPutaway();
  const { addToast } = useToastActions();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [picking, setPicking] = useState<PendingPutawayRow | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<QueueStateFilter>('all');
  const [grouped, setGrouped] = useState(false);

  // Both halves of a location's identity (mig 00094). `select('*')` already
  // brings the name back, so carrying it costs nothing.
  const binById = useMemo(() => buildDisplayLookup(locationsQuery.data), [locationsQuery.data]);

  const rows = queueQuery.data ?? [];
  const visible = useMemo(
    () => filterQueue(rows, { query: search, state: stateFilter, binById }),
    [rows, search, stateFilter, binById],
  );
  const groups = useMemo(() => (grouped ? groupByReceipt(visible) : null), [grouped, visible]);

  const busy = decide.isPending || redirect.isPending || rerun.isPending;

  const binFor = (r: PendingPutawayRow) =>
    r.recommendedLocationId ? displayFor(binById, r.recommendedLocationId) : null;

  // Place now: the one-step path (decide AND move), Admin only.
  const placeNow = async (r: PendingPutawayRow) => {
    try {
      await decide.mutateAsync({ recommendationId: r.id, decision: 'accept' });
      addToast('Placed', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to put away', 'error');
    }
  };

  // Change bin: the suggestion now points at the desk's bin. Nothing moves; the
  // floor scans it to the new bin like any other suggestion.
  const commitRedirect = async (chosenLocationId: number) => {
    const target = picking;
    if (!target) return;
    try {
      await redirect.mutateAsync({ recommendationId: target.id, chosenLocationId });
      setPicking(null);
      addToast('Bin changed - the floor will be sent there', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not change the bin', 'error');
    }
  };

  const rerunRow = async (r: PendingPutawayRow) => {
    try {
      await rerun.mutateAsync({
        warehouseId,
        recommendationId: r.id,
        productId: r.productId,
        quantity: r.quantity,
        goodsReceiptId: r.receipt?.id,
      });
      addToast('Recommendation refreshed', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to re-run', 'error');
    }
  };

  const renderRow = (r: PendingPutawayRow) => (
    <PutawayRow
      key={r.id}
      row={r}
      bin={binFor(r)}
      binById={binById}
      expanded={expanded === r.id}
      busy={busy}
      onToggleExplanation={() => setExpanded(expanded === r.id ? null : r.id)}
      onPlaceNow={isAdmin ? () => placeNow(r) : undefined}
      onChooseBin={() => setPicking(r)}
      onRerun={() => rerunRow(r)}
    />
  );

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-50">
          <PackageOpen className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Putaway desk</h1>
          <p className="text-xs text-stone-600 mt-0.5">Change where a line goes before anyone carries it, and resolve shortages.</p>
        </div>
      </div>

      <PutawayShortList warehouseId={warehouseId} />

      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-stone-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or scan: product, barcode, plate, supplier or bin"
              aria-label="Search the putaway queue"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as QueueStateFilter)}
            aria-label="Filter by placeability"
            className="px-2.5 py-2 rounded-lg border border-stone-200 bg-white text-sm text-stone-700"
          >
            <option value="all">All lines</option>
            <option value="placeable">Has a bin</option>
            <option value="unplaceable">No eligible bin</option>
          </select>
          <button
            onClick={() => setGrouped(!grouped)}
            aria-pressed={grouped}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border btn-press ${
              grouped ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 text-stone-600'
            }`}
          >
            <Layers className="w-4 h-4" /> By receipt
          </button>
        </div>
      )}

      {queueQuery.isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : queueQuery.isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load the putaway queue.</p>
          <p className="text-xs text-stone-600 mt-1">Check your connection and try again.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">Nothing to put away</p>
          <p className="text-xs text-stone-600 mt-1">Recommendations from received stock will appear here.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">No lines match those filters</p>
          <p className="text-xs text-stone-600 mt-1">{rows.length} line{rows.length === 1 ? '' : 's'} are still queued.</p>
        </div>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => {
            return (
              <div key={g.receiptId ?? 'unlinked'} className="glass-card rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-stone-50/70 border-b border-stone-100 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-700 truncate">
                      {g.supplierName ? `${g.supplierName} · ` : ''}{g.label}
                    </p>
                    <p className="text-xs text-stone-600">
                      {g.receivedDate ? `${g.receivedDate} · ` : ''}
                      {g.rows.length} line{g.rows.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-stone-100">{g.rows.map(renderRow)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
          {visible.map(renderRow)}
        </div>
      )}

      {picking && (
        <BinPickerSheet
          open
          warehouseId={warehouseId}
          row={picking}
          busy={redirect.isPending}
          onClose={() => setPicking(null)}
          onConfirm={(chosenLocationId: number) => commitRedirect(chosenLocationId)}
        />
      )}

    </div>
  );
};

export default PutawayQueueView;
