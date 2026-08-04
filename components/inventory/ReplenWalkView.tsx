// Replenishment — the floor stage.
//
// The assigned tasks, sequenced into a shortest-travel round from the dock by
// the same engine that routes pickers. One card per task: the walker pulls from
// the source bin and places in the pick zone, and the stock moves when they
// confirm.
//
// A site with no published layout gets the same list unsequenced, which is
// exactly what a bulk warehouse wants — there is no map to route against.

import React, { useMemo, useState } from 'react';
import { Footprints, Route } from 'lucide-react';
import { useReplenRoute, useReplenTasks } from '../../hooks/queries/useReplenishment';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import ReplenStopCard from './replen/ReplenStopCard';
import type { DisplayLocation } from '@/lib/locationDisplay';
import type { ReplenRouteStop } from '../../services/supabase/replenRouteService';

interface ReplenWalkViewProps {
  warehouseId: number;
  canWork: boolean;
}

const ReplenWalkView: React.FC<ReplenWalkViewProps> = ({ warehouseId, canWork }) => {
  const { data: route, isLoading } = useReplenRoute(warehouseId);
  const { data: tasks } = useReplenTasks(warehouseId);
  const { data: locations } = useWarehouseLocations(warehouseId);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  // Keyed by CODE, because that is what recommend-replen-route returns for both
  // ends of a stop. The names ride along on a query this screen already makes.
  const binByCode = useMemo(() => {
    const m = new Map<string, DisplayLocation>();
    for (const l of locations ?? []) m.set(l.code, { code: l.code, name: l.name });
    return m;
  }, [locations]);

  // A warehouse with no published layout still has work to do; fabricate flat
  // stops from the task rows so the card renders identically, just unsequenced.
  const stops: ReplenRouteStop[] = useMemo(() => {
    if (route?.mode === 'engine') return route.stops;
    return (tasks ?? [])
      .filter((t) => t.status === 'assigned')
      .map((t, i) => ({
        sequence: i + 1,
        taskId: t.id,
        locationId: t.assignedFromLocationId ?? 0,
        code: t.assignedFromCode ?? '—',
        legDistanceM: 0,
        placeLegM: 0,
        reachable: true,
        toLocationId: t.toLocationId,
        toCode: t.toCode ?? '—',
        sameNode: false,
        productId: t.productId,
        qtyBase: t.quantity,
        huCode: t.huCode,
        huType: null,
        sku: t.sku,
        productName: t.productName,
      }));
  }, [route, tasks]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return stops;
    return stops.filter((s) =>
      [
        s.productName, s.sku, s.code, s.toCode, s.huCode,
        // Names too (mig 00094): an operator reading "Chiller · Rack 7" off the
        // card will search for that, not for NEXG-B-9-4.
        binByCode.get(s.code)?.name, binByCode.get(s.toCode)?.name,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [stops, filter, binByCode]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => <div key={i} className="h-28 rounded-xl bg-stone-100 animate-pulse" />)}
      </div>
    );
  }

  if (stops.length === 0) {
    return (
      <div className="glass-card rounded-xl p-10 text-center">
        <Footprints className="w-9 h-9 text-stone-300 mx-auto mb-3" />
        <p className="text-sm text-stone-600">Nothing assigned to walk</p>
        <p className="text-xs text-stone-400 mt-1">
          Assign a replenishment on the Assign tab and it appears here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a product, bin or plate…"
          className="flex-1 min-w-[200px] text-sm rounded-lg border border-stone-200 px-3 py-2 min-h-[44px]"
        />
        {route?.mode === 'engine' && route.totalDistanceM > 0 && (
          <p className="text-xs text-stone-500 inline-flex items-center gap-1.5">
            <Route className="w-3.5 h-3.5" aria-hidden="true" />
            {Math.round(route.totalDistanceM)} m round trip
            {route.unreachableCount > 0 && (
              <span className="text-amber-700"> · {route.unreachableCount} off the map</span>
            )}
          </p>
        )}
      </div>

      {route?.mode === 'legacy' && (
        <p className="text-xs text-stone-400">
          This site has no published layout, so the run is listed in the order it was assigned.
        </p>
      )}

      {visible.map((stop) => (
        <ReplenStopCard
          key={stop.taskId}
          stop={stop}
          fromLocation={binByCode.get(stop.code)}
          toLocation={binByCode.get(stop.toCode)}
          active={activeTaskId === stop.taskId}
          disabled={!canWork}
          onActivate={() => setActiveTaskId(stop.taskId)}
          onDone={() => setActiveTaskId(null)}
        />
      ))}

      {!canWork && (
        <p className="text-xs text-stone-400">
          You can only replenish at your own warehouse.
        </p>
      )}
    </div>
  );
};

export default ReplenWalkView;
