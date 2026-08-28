// The walk: assigned putaway tasks, in the order they should be walked.
//
// A "run" is derived, not stored — it is simply every task currently assigned
// at this warehouse, sequenced by the WIE engine from the dock
// (recommend-putaway-route → sequencePickRoute). Nobody claims a run, so two
// people can walk at once; wie_complete_putaway_tx's row lock makes the loser
// of a race get a clean "someone else already placed this" rather than a double
// transfer.
//
// A warehouse with no published layout answers `legacy` and the tasks are
// listed oldest-first instead. That is the correct answer for a bulk site, not
// a degraded one — there are no aisles to optimise a walk through.

import React, { useMemo, useState } from 'react';
import { Footprints, MapPin, PackageOpen, Search } from 'lucide-react';
import { useAssignedPutaways, usePutawayRoute } from '../../hooks/queries/usePutawayWalk';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { PutawayStopCard } from './putaway/PutawayStopCard';
import { PutawayScanFinder } from './putaway/PutawayScanFinder';
import StickyScanBar from './StickyScanBar';
import { buildDisplayLookup, displayFor, searchTextFor } from '@/lib/locationLookup';

/** Stable identity for "no twins", so a card without any is not handed a fresh
 *  array on every render of the walk. */
const EMPTY_TWINS: ReadonlyArray<{ huCode: string; quantity: number }> = [];

interface PutawayWalkViewProps {
  warehouseId: number;
  /** False for a Warehouse-role user looking at someone else's site. */
  canPlace?: boolean;
}

const PutawayWalkView: React.FC<PutawayWalkViewProps> = ({ warehouseId, canPlace = true }) => {
  const tasksQuery = useAssignedPutaways(warehouseId);
  const routeQuery = usePutawayRoute(warehouseId);
  const locationsQuery = useWarehouseLocations(warehouseId);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const binById = useMemo(() => buildDisplayLookup(locationsQuery.data), [locationsQuery.data]);

  const tasks = tasksQuery.data ?? [];

  // Sequence, leg distance AND the bin's code per task, when the engine could
  // route them. Tasks the route doesn't mention (a bin missing from the
  // published layout) still appear — the pallet exists whether or not the map
  // knows where the bay is.
  //
  // `code` is kept, not dropped, and it is the one that gets rendered. It comes
  // from `wie_putaway_stops`, which live-joins `locations` on the server; the
  // client map is built from `getWarehouseLocations`, which is cached for five
  // minutes, is invalidated by no putaway mutation, and deliberately includes
  // RETIRED bins. Rendering the map's copy meant the card could name a bin under
  // a code the server would not accept — and `PutawayStopCard` feeds that same
  // string into its client-side scan check, so the browser would reject a scan
  // of the CORRECT current sticker before `complete-putaway` (which reads the
  // live code) ever saw it.
  const routeById = useMemo(() => {
    const m = new Map<number, { sequence: number; legDistanceM: number; reachable: boolean; code: string }>();
    if (routeQuery.data?.mode === 'engine') {
      for (const s of routeQuery.data.stops) {
        m.set(s.recId, { sequence: s.sequence, legDistanceM: s.legDistanceM, reachable: s.reachable, code: s.code });
      }
    }
    return m;
  }, [routeQuery.data]);

  /**
   * The bin to render for a task: the server's live code, with the cached map
   * supplying only the friendly NAME (which no RPC returns) and the retired
   * flag. On a `legacy` site there is no route, so the map is all there is.
   */
  const binFor = useMemo(() => (row: { id: number; assignedLocationId: number | null }) => {
    const cached = displayFor(binById, row.assignedLocationId);
    const live = routeById.get(row.id)?.code;
    if (!live) return cached;
    // A code disagreement means the cached list is stale; the name that came
    // with it belongs to the old code and must not be shown beside the new one.
    if (cached && cached.code !== live) return { code: live, name: null, isActive: cached.isActive };
    return cached ? { ...cached, code: live } : { code: live, name: null };
  }, [binById, routeById]);

  const ordered = useMemo(() => {
    const withRoute = tasks.map((row) => ({ row, stop: routeById.get(row.id) ?? null }));
    if (routeById.size === 0) return withRoute;
    return [...withRoute].sort((a, b) => {
      // Unrouted stops sink to the bottom rather than jumping to the front on a
      // missing sequence number.
      const as = a.stop?.sequence ?? Number.MAX_SAFE_INTEGER;
      const bs = b.stop?.sequence ?? Number.MAX_SAFE_INTEGER;
      return as - bs;
    });
  }, [tasks, routeById]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(({ row }) => {
      // Code AND name: an operator reading "Chiller · Rack 7" off the card
      // will search for that, not for NEXG-B-9-4.
      const bin = searchTextFor(binFor(row));
      return (
        (row.product?.name ?? '').toLowerCase().includes(q) ||
        (row.product?.sku ?? '').toLowerCase().includes(q) ||
        (row.huCode ?? '').toLowerCase().includes(q) ||
        bin.includes(q)
      );
    });
  }, [ordered, search, binFor]);

  /**
   * Per task: the OTHER unlabelled plates of the same product that are also in
   * this walk.
   *
   * A product barcode identifies a SKU. When two unlabelled plates of that SKU
   * are queued at once — which is the ordinary result of two receipts of the
   * same line — barcode evidence cannot say which of them is in the operator's
   * hands, and closing one task rather than the other is a coin toss the system
   * would record as certainty. The stop says so instead.
   *
   * Computed here because only the walk holds every stop; the card sees one.
   * Cheap: the walk is tens of rows, not thousands.
   */
  const twinsById = useMemo(() => {
    const m = new Map<number, Array<{ huCode: string; quantity: number }>>();
    const unlabelled = tasks.filter((t) => t.huCode && !t.huLabelPrinted);
    for (const row of unlabelled) {
      const twins = unlabelled
        .filter((t) => t.id !== row.id && t.productId === row.productId)
        .map((t) => ({ huCode: t.huCode as string, quantity: t.quantity }));
      if (twins.length > 0) m.set(row.id, twins);
    }
    return m;
  }, [tasks]);

  const totalDistance = routeQuery.data?.mode === 'engine' ? routeQuery.data.totalDistanceM : null;

  return (
    <div className="space-y-4">
      {/* Scan a plate, SKU or bin and jump straight to its task — the reason a
          walker has a phone in their hand at all. */}
      {tasks.length > 0 && (
        <StickyScanBar>
          <PutawayScanFinder
            rows={tasks}
            locations={locationsQuery.data ?? []}
            binIdOf={(row) => row.assignedLocationId}
            onFound={(id) => { setActiveId(id); setSearch(''); }}
            onFilter={setSearch}
          />
        </StickyScanBar>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <Footprints className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />
            <span className="tabular-nums font-medium">{tasks.length}</span>
            <span className="text-stone-500">stop{tasks.length === 1 ? '' : 's'}</span>
            {totalDistance != null && totalDistance > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <span className="tabular-nums">{Math.round(totalDistance)}m</span>
              </>
            )}
          </div>
          <div className="relative flex-1 min-w-0 sm:max-w-xs sm:ml-auto">
            <Search className="w-4 h-4 text-stone-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by product, plate or bin"
              aria-label="Filter the walk"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
            />
          </div>
        </div>
      )}

      {routeQuery.data?.mode === 'engine' && routeQuery.data.unreachableCount > 0 && (
        <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {routeQuery.data.unreachableCount} bin
          {routeQuery.data.unreachableCount === 1 ? ' is' : 's are'} not placed in the current layout, so
          {routeQuery.data.unreachableCount === 1 ? ' it' : ' they'} could not be routed — listed last.
        </p>
      )}

      {tasksQuery.isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : tasksQuery.isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load the walk.</p>
          <p className="text-xs text-stone-500 mt-1">Check your connection and try again.</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">Nothing to carry</p>
          <p className="text-xs text-stone-500 mt-1">
            Assign lines on the Assign tab and they'll show up here as stops.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">No stops match that filter</p>
          <p className="text-xs text-stone-500 mt-1">{tasks.length} still to place.</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
          {visible.map(({ row, stop }) => (
            <PutawayStopCard
              key={row.id}
              row={row}
              bin={binFor(row)}
              sequence={stop?.sequence ?? null}
              legDistanceM={stop?.legDistanceM ?? null}
              reachable={stop?.reachable ?? true}
              active={activeId === row.id}
              disabled={!canPlace}
              warehouseId={warehouseId}
              unlabelledTwins={twinsById.get(row.id) ?? EMPTY_TWINS}
              onActivate={() => setActiveId(row.id)}
              onDone={() => setActiveId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default PutawayWalkView;
