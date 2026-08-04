// Replenishment — the desk stage.
//
// One row per pick slot that has fallen below its minimum, showing what the
// detector chose as the source and letting the operator confirm it or pick a
// different bin. Assigning moves NO stock; it claims the task for a walker.
//
// The "nothing was raised" panel is not decoration. The detector deliberately
// refuses to raise a task it cannot complete — most often because the reserve
// pallet exists but every unit on it is already allocated to an open order. An
// operator looking at an empty pick face with a full pallet one level up WILL
// report that as broken, so the reason has to be on screen.

import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, AlertTriangle, PackageOpen, Layers } from 'lucide-react';
import { useReplenTasks, useAssignReplenishment, useUnassignReplenishment, useDetectReplenishment } from '../../hooks/queries/useReplenishment';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useLevelRoles } from '../../hooks/queries/useLevelRoles';
import { roleLabel } from '../../lib/levelRoles';
import { useToasts } from '../../hooks/useToasts';
import type { ReplenSkipReason, ReplenTask } from '../../services/supabase/replenService';
import { buildDisplayLookup, displayFor } from '@/lib/locationLookup';
import { locationOneLine, locationTitle, type DisplayLocation } from '@/lib/locationDisplay';

interface ReplenQueueViewProps {
  warehouseId: number;
  canWork: boolean;
}

/** Operator-facing copy for why a short slot produced no task. */
const SKIP_COPY: Record<ReplenSkipReason, { title: string; detail: string }> = {
  source_reserved: {
    title: 'Stock is there, but reserved',
    detail:
      'Every unit in reserve and bulk is already allocated to an open order, so moving it would break those picks. It frees up as those orders are picked.',
  },
  no_source: {
    title: 'Nothing to pull from',
    detail: 'No reserve or bulk bin in this warehouse holds this product. It needs receiving before the pick zone can be refilled.',
  },
  slot_full: {
    title: 'Pick zone is already at its maximum',
    detail: 'The slot holds as much as it physically can, counting stock that is already allocated.',
  },
  bin_not_pick_zone: {
    title: 'Home bin is not a pick zone',
    detail: 'Replenishment refills a pick-zone level. Change the level role, or point this product at a different bin.',
  },
  no_pick_zone_configured: {
    title: 'No pick zone configured',
    detail: 'No active level role is marked as a pick zone, so replenishment has nowhere to point. Set one in Settings → Warehouse → Level roles.',
  },
};

const ReplenQueueView: React.FC<ReplenQueueViewProps> = ({ warehouseId, canWork }) => {
  const { data: tasks, isLoading } = useReplenTasks(warehouseId);
  const { data: locations } = useWarehouseLocations(warehouseId);
  const { data: levelRoles = [] } = useLevelRoles();
  const assign = useAssignReplenishment();
  const unassign = useUnassignReplenishment();
  const detect = useDetectReplenishment();
  const { addToast } = useToasts();

  const [sourceByTask, setSourceByTask] = useState<Record<number, number>>({});
  const [qtyByTask, setQtyByTask] = useState<Record<number, string>>({});

  // Two lookups because the two sources speak different languages: the skip
  // reasons from wie_replen_detect carry location IDs, while a task carries the
  // CODES its three FK-aliased joins selected. Neither returns a name, but the
  // warehouse locations are already cached here, so resolving both is free —
  // and far cheaper than a DROP FUNCTION on each of the replen RPCs.
  const binById = useMemo(() => buildDisplayLookup(locations), [locations]);
  const binByCode = useMemo(() => {
    const m = new Map<string, DisplayLocation>();
    for (const l of locations ?? []) m.set(l.code, { code: l.code, name: l.name });
    return m;
  }, [locations]);

  const suggested = useMemo(
    () => (tasks ?? []).filter((t) => t.status === 'suggested'),
    [tasks],
  );
  const assigned = useMemo(
    () => (tasks ?? []).filter((t) => t.status === 'assigned'),
    [tasks],
  );

  // Only bins whose level role is configured as a replenishment source are
  // offered — the same set the detector searched. A pick-to-pick top-up is
  // legal at the server, but offering it here would invite it by accident.
  const sourceOptions = useMemo(() => {
    const sourceRoleKeys = new Set(
      levelRoles.filter((r) => r.replenSourceRank != null && r.isActive).map((r) => r.key),
    );
    return (locations ?? []).filter(
      (l) => l.isActive && l.levelRole != null && sourceRoleKeys.has(l.levelRole),
    );
  }, [locations, levelRoles]);

  const doAssign = async (task: ReplenTask) => {
    const from = sourceByTask[task.id] ?? task.recommendedFromLocationId;
    if (from == null) {
      addToast('Choose which bin to pull from', 'error');
      return;
    }
    const raw = qtyByTask[task.id];
    const qty = raw && raw.trim() !== '' ? Number(raw) : undefined;
    if (qty != null && (!Number.isFinite(qty) || qty <= 0 || qty > task.quantity)) {
      addToast(`Enter a quantity between 1 and ${task.quantity}`, 'error');
      return;
    }
    try {
      await assign.mutateAsync({ taskId: task.id, fromLocationId: from, quantity: qty });
      addToast(
        qty != null && qty < task.quantity
          ? `${qty} assigned — ${task.quantity - qty} still queued`
          : 'Assigned to the walk',
        'success',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not assign', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-stone-100 animate-pulse" />)}
      </div>
    );
  }

  const skipped = (detect.data?.skipped ?? []) as Array<{ product_id: number; to_location_id: number; reason: ReplenSkipReason }>;

  return (
    <div className="space-y-6">
      {suggested.length === 0 && assigned.length === 0 && (
        <div className="glass-card rounded-xl p-10 text-center">
          <ArrowDownToLine className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">Every pick zone is above its minimum</p>
          <p className="text-xs text-stone-400 mt-1">
            Replenishments appear here automatically as picks drain a pick zone.
          </p>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            {skipped.length} pick {skipped.length === 1 ? 'zone is' : 'zones are'} short but could not be refilled
          </p>
          <ul className="mt-2 space-y-1.5">
            {skipped.map((s, i) => {
              const copy = SKIP_COPY[s.reason] ?? { title: s.reason, detail: '' };
              const slot = displayFor(binById, s.to_location_id);
              return (
                <li key={`${s.product_id}-${s.to_location_id}-${i}`} className="text-xs text-amber-900">
                  <span>{locationOneLine(slot)}</span>
                  {' — '}
                  <span className="font-medium">{copy.title}.</span> {copy.detail}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {suggested.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Waiting to be assigned
          </h4>
          {suggested.map((task) => {
            const chosen = sourceByTask[task.id] ?? task.recommendedFromLocationId ?? '';
            return (
              <div key={task.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-display font-bold text-stone-900 truncate">
                      {task.productName ?? `Product ${task.productId}`}
                    </p>
                    <p className="text-xs text-stone-500 font-mono">{task.sku}</p>
                    <p className="text-xs text-stone-500 mt-1">
                      <span className="font-medium text-emerald-700">
                        {locationTitle(binByCode.get(task.toCode) ?? { code: task.toCode })}
                      </span>
                      {' holds '}
                      <span className="tabular-nums">{task.slotOnHand ?? 0}</span>
                      {task.minQty != null && <> · min <span className="tabular-nums">{task.minQty}</span></>}
                      {task.maxQty != null && <> · refill to <span className="tabular-nums">{task.maxQty}</span></>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-display font-bold text-stone-900 tabular-nums">{task.quantity}</p>
                    <p className="text-[11px] text-stone-400">base units</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-stone-500 flex-1 min-w-[220px]">
                    Pull from
                    <select
                      value={chosen}
                      disabled={!canWork}
                      onChange={(e) => setSourceByTask((m) => ({ ...m, [task.id]: Number(e.target.value) }))}
                      className="mt-1 w-full text-sm rounded-lg border border-stone-200 bg-white px-2 py-1.5 min-h-[40px] disabled:bg-stone-50"
                    >
                      {task.recommendedFromLocationId != null
                        && !sourceOptions.some((l) => l.id === task.recommendedFromLocationId) && (
                        <option value={task.recommendedFromLocationId}>
                          {task.recommendedFromCode} (suggested)
                        </option>
                      )}
                      {sourceOptions.map((l) => (
                        <option key={l.id} value={l.id}>
                          {locationOneLine(l)} — {roleLabel(levelRoles, l.levelRole)}
                          {l.id === task.recommendedFromLocationId ? ' (suggested)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-stone-500 w-28">
                    Quantity
                    <input
                      type="number"
                      min={1}
                      max={task.quantity}
                      placeholder={String(task.quantity)}
                      disabled={!canWork}
                      value={qtyByTask[task.id] ?? ''}
                      onChange={(e) => setQtyByTask((m) => ({ ...m, [task.id]: e.target.value }))}
                      className="mt-1 w-full text-sm rounded-lg border border-stone-200 px-2 py-1.5 min-h-[40px] disabled:bg-stone-50"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => doAssign(task)}
                    disabled={!canWork || assign.isPending}
                    className="px-3 py-1.5 min-h-[40px] rounded-lg bg-nexgen-blue text-white text-sm font-semibold btn-press disabled:opacity-50"
                  >
                    Assign
                  </button>
                </div>
                {!canWork && (
                  <p className="mt-2 text-[11px] text-stone-400">
                    You can only replenish at your own warehouse.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assigned.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Out on the floor
          </h4>
          {assigned.map((task) => (
            <div key={task.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3 flex flex-wrap items-center gap-3">
              <Layers className="w-4 h-4 text-stone-400 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-stone-800 truncate">
                  {task.productName ?? `Product ${task.productId}`}
                  <span className="text-stone-400"> · </span>
                  <span className="tabular-nums">{task.quantity}</span>
                </p>
                <p className="text-xs text-stone-500">
                  {locationTitle(binByCode.get(task.assignedFromCode ?? '') ?? { code: task.assignedFromCode ?? '—' })}
                  {' → '}
                  {locationTitle(binByCode.get(task.toCode ?? '') ?? { code: task.toCode ?? '—' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => unassign.mutateAsync({ taskId: task.id }).catch((e) =>
                  addToast(e instanceof Error ? e.message : 'Could not put it back', 'error'))}
                disabled={!canWork || unassign.isPending}
                className="text-xs px-2.5 py-1.5 min-h-[36px] rounded-lg border border-stone-200 text-stone-600 btn-press disabled:opacity-50"
              >
                Put back on the queue
              </button>
            </div>
          ))}
        </div>
      )}

      {suggested.length === 0 && assigned.length > 0 && (
        <p className="text-xs text-stone-400 flex items-center gap-1.5">
          <PackageOpen className="w-3.5 h-3.5" aria-hidden="true" />
          Everything raised is already assigned — switch to Walk to move it.
        </p>
      )}
    </div>
  );
};

export default ReplenQueueView;
