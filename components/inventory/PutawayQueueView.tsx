// Standing queue of pending putaway recommendations for a warehouse (rows the
// engine produced at receipt time but nobody has actioned yet).
//
// This file stays an orchestrator: row rendering lives in putaway/PutawayRow,
// bin selection in putaway/BinPickerSheet, and the list logic (search, filter,
// receipt grouping) in the pure putaway/putawayGrouping module.

import React, { useMemo, useState } from 'react';
import { PackageOpen, Search, Layers, CheckCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getPendingPutaways, type PendingPutawayRow } from '../../services/supabase/putawayQueueService';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useDecidePutaway, useRerunPutaway } from '../../hooks/queries/usePutawayRecommendation';
import { putawayKeys } from '../../hooks/queries/putawayKeys';
import { useToasts } from '../../hooks/useToasts';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PutawayRow } from './putaway/PutawayRow';
import { BinPickerSheet } from './putaway/BinPickerSheet';
import { PutawayScanFinder } from './putaway/PutawayScanFinder';
import { filterQueue, groupByReceipt, placeableRows, type QueueStateFilter } from './putaway/putawayGrouping';
import { trimNumber } from './putaway/putawayFormat';
import { buildDisplayLookup, displayFor } from '@/lib/locationLookup';

interface PutawayQueueViewProps {
  warehouseId: number;
}

const PutawayQueueView: React.FC<PutawayQueueViewProps> = ({ warehouseId }) => {
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
  const rerun = useRerunPutaway();
  const { addToast } = useToasts();

  const [expanded, setExpanded] = useState<number | null>(null);
  const [picking, setPicking] = useState<PendingPutawayRow | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<QueueStateFilter>('all');
  const [grouped, setGrouped] = useState(false);
  const [confirmAll, setConfirmAll] = useState<PendingPutawayRow[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Both halves of a location's identity (mig 00094). `select('*')` already
  // brings the name back, so carrying it costs nothing.
  const binById = useMemo(() => buildDisplayLookup(locationsQuery.data), [locationsQuery.data]);

  const rows = queueQuery.data ?? [];
  const visible = useMemo(
    () => filterQueue(rows, { query: search, state: stateFilter, binById }),
    [rows, search, stateFilter, binById],
  );
  const groups = useMemo(() => (grouped ? groupByReceipt(visible) : null), [grouped, visible]);

  const busy = decide.isPending || rerun.isPending || bulkBusy;

  const binFor = (r: PendingPutawayRow) =>
    r.recommendedLocationId ? displayFor(binById, r.recommendedLocationId) : null;

  // Assign = decide the bin, move nothing; the line becomes a stop on the Walk
  // run and the stock stays on the dock until someone carries it (mig 00080).
  // Place now = the pre-00080 one-step path, still right for desk/bulk work.
  const decideRow = async (r: PendingPutawayRow, assignOnly: boolean) => {
    try {
      // useDecidePutaway's onSuccess invalidates putawayKeys.all, which
      // refetches this (active) query automatically — no manual refetch needed.
      await decide.mutateAsync({ recommendationId: r.id, decision: 'accept', assignOnly });
      if (assignOnly) addToast('Assigned — it\'s on the walk now', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to put away', 'error');
    }
  };

  const commitOverride = async (chosenLocationId: number, baseQty: number, roleOverride = false) => {
    const target = picking;
    if (!target) return;
    try {
      const { remainderQty } = await decide.mutateAsync({
        recommendationId: target.id,
        decision: 'override',
        chosenLocationId,
        // Only send a quantity for a genuine partial, so a full putaway keeps
        // taking the server's "whole remaining quantity" path.
        quantity: baseQty < target.quantity ? baseQty : undefined,
        // Operator chose a level whose role this SKU isn't allowed on (mig
        // 00072). Only sent when true, so a normal putaway is unchanged and the
        // server keeps enforcing the hard never-mix rule by default.
        roleOverride: roleOverride || undefined,
        // Picking a bin by hand is still a DESK decision — someone chose where
        // it should go, not where it now is. It joins the walk like any other
        // assignment rather than teleporting the pallet.
        assignOnly: true,
      });
      setPicking(null);
      addToast(
        remainderQty > 0
          ? `Assigned — ${trimNumber(remainderQty)} still queued`
          : 'Assigned — it\'s on the walk now',
        'success',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to put away', 'error');
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

  // Sequential on purpose: decide-putaway is rate-limited to 120/min/user, and
  // a batch that keeps going past a failure is more useful than one that stops
  // — the operator gets a count and the failures stay in the queue.
  const assignAll = async (batch: PendingPutawayRow[]) => {
    setConfirmAll(null);
    setBulkBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const r of batch) {
      try {
        await decide.mutateAsync({ recommendationId: r.id, decision: 'accept', assignOnly: true });
        ok += 1;
      } catch (e) {
        failures.push(r.product?.name ?? `Product #${r.productId}`);
      }
    }
    setBulkBusy(false);
    if (failures.length === 0) {
      addToast(`Assigned ${ok} line${ok === 1 ? '' : 's'} to the walk`, 'success');
    } else {
      addToast(
        `Assigned ${ok} of ${batch.length} — ${failures.slice(0, 3).join(', ')}` +
          `${failures.length > 3 ? ` and ${failures.length - 3} more` : ''} failed`,
        'error',
      );
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
      onAssign={() => decideRow(r, true)}
      onPlaceNow={() => decideRow(r, false)}
      onChooseBin={() => setPicking(r)}
      onRerun={() => rerunRow(r)}
    />
  );

  const allPlaceable = placeableRows(visible);

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-50">
          <PackageOpen className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Putaway</h1>
          <p className="text-xs text-stone-500 mt-0.5">Decide where each line goes. Nothing moves until someone carries it.</p>
        </div>
      </div>

      {/* Scan what's on the dock and jump to its line, instead of eye-matching a
          product name down a scrollable list with a pallet in your hands. */}
      {rows.length > 0 && (
        <PutawayScanFinder
          rows={rows}
          locations={locationsQuery.data ?? []}
          binIdOf={(row) => row.recommendedLocationId}
          onFound={(id) => { setExpanded(id); setSearch(''); }}
          onFilter={setSearch}
        />
      )}

      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, SKU, supplier or bin"
              aria-label="Search the putaway queue"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
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
          <button
            onClick={() => setConfirmAll(allPlaceable)}
            disabled={allPlaceable.length === 0 || busy}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
          >
            <CheckCheck className="w-4 h-4" /> Assign all ({allPlaceable.length})
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
          <p className="text-xs text-stone-400 mt-1">Check your connection and try again.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">Nothing to put away</p>
          <p className="text-xs text-stone-400 mt-1">Recommendations from received stock will appear here.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">No lines match those filters</p>
          <p className="text-xs text-stone-400 mt-1">{rows.length} line{rows.length === 1 ? '' : 's'} are still queued.</p>
        </div>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => {
            const groupPlaceable = placeableRows(g.rows);
            return (
              <div key={g.receiptId ?? 'unlinked'} className="glass-card rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-stone-50/70 border-b border-stone-100 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-700 truncate">
                      {g.supplierName ? `${g.supplierName} · ` : ''}{g.label}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      {g.receivedDate ? `${g.receivedDate} · ` : ''}
                      {g.rows.length} line{g.rows.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirmAll(groupPlaceable)}
                    disabled={groupPlaceable.length === 0 || busy}
                    className="text-xs px-2.5 py-1 border border-stone-200 text-stone-600 rounded-lg btn-press disabled:opacity-40 shrink-0"
                  >
                    Assign {groupPlaceable.length}
                  </button>
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
          busy={decide.isPending}
          onClose={() => setPicking(null)}
          onConfirm={commitOverride}
        />
      )}

      <ConfirmDialog
        open={confirmAll != null}
        title="Assign every recommended bin?"
        message={
          confirmAll
            ? `${confirmAll.length} line${confirmAll.length === 1 ? '' : 's'} go onto the walk, bound for the bins the engine picked. No stock moves until someone carries it. Lines with no eligible bin are left alone.`
            : undefined
        }
        confirmLabel="Assign them"
        busy={bulkBusy}
        onConfirm={() => confirmAll && assignAll(confirmAll)}
        onCancel={() => setConfirmAll(null)}
      />
    </div>
  );
};

export default PutawayQueueView;
