// Replenishment min/max, for a whole warehouse at once (onboarding gap H3).
//
// Replenishment is complete and silent until a product has a min, a max and a
// pick-zone home bin. Until now the only way to write one was inside a single
// product's form, one site at a time — work nobody finishes for a 200-SKU
// catalogue, which is why the queue stays empty and nothing explains why.
//
// Two deliberate separations run through this screen:
//   * SAVING NUMBERS AND ARMING ARE DIFFERENT ACTS. Saving leaves
//     replen_enabled exactly as it was; arming is its own button with its own
//     confirmation. Setting up a site should not quietly fill the floor's queue.
//   * FILLING NEVER OVERWRITES. The suggestion only lands in rows that are still
//     empty, and a CSV merges — a blank cell leaves the stored figure alone.

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Upload, Save, Zap } from 'lucide-react';
import { useReplenConfig, useBulkSetHomeBins, useReplenDryRun } from '../../../hooks/queries/useReplenConfig';
import { useWarehouseLocations } from '../../../hooks/queries/useWarehouseLocations';
import { useLevelRoles } from '../../../hooks/queries/useLevelRoles';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { useToasts } from '../../../hooks/useToasts';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import ReplenPolicyBar from './ReplenPolicyBar';
import ReplenSetupRow, { type BinOption } from './ReplenSetupRow';
import { applyReplenCsv, exportReplenCsv } from './replenCsv';
import {
  DEFAULT_REPLEN_POLICY,
  MAX_BULK_REPLEN_ROWS,
  draftFigures,
  draftVerdict,
  formatEntry,
  initialDraft,
  isDraftDirty,
  proposeHomeBins,
  suggestionFor,
  type ArmAction,
  type ReplenDraft,
  type ReplenPolicy,
} from '../../../lib/replenPolicy';

interface ReplenSetupViewProps {
  warehouseId: number;
  warehouseName: string;
}

type Filter = 'here' | 'unset' | 'armed' | 'all';

const ReplenSetupView: React.FC<ReplenSetupViewProps> = ({ warehouseId, warehouseName }) => {
  const { data: config, isLoading, error } = useReplenConfig(warehouseId);
  const { data: locations } = useWarehouseLocations(warehouseId);
  const { data: levelRoles = [] } = useLevelRoles();
  const { addToast } = useToasts();
  const save = useBulkSetHomeBins();
  const dryRun = useReplenDryRun();
  const fileInput = useRef<HTMLInputElement>(null);

  const [policy, setPolicy] = useLocalStorage<ReplenPolicy>(
    `replen_policy_${warehouseId}`, DEFAULT_REPLEN_POLICY,
  );
  const [drafts, setDrafts] = useState<Record<number, ReplenDraft>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Null until the operator picks one, so the default can follow the data. A
  // site being configured BEFORE its opening count holds nothing yet, and
  // defaulting to "held here" opened an empty grid on exactly the site this
  // screen exists for.
  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState('');
  const [confirmArm, setConfirmArm] = useState<ArmAction | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const rows = config?.rows ?? [];
  const freeBins = config?.freeBins ?? [];

  const pickZoneKeys = useMemo(
    () => new Set(levelRoles.filter((r) => r.isPickZone && r.isActive).map((r) => r.key)),
    [levelRoles],
  );

  const bins: BinOption[] = useMemo(() => (locations ?? [])
    .filter((l) => l.isActive && l.kind !== 'RACK' && l.kind !== 'ZONE' && l.kind !== 'AISLE')
    .map((l) => ({
      id: l.id, code: l.code, name: l.name, levelRole: l.levelRole ?? null,
      isPickZone: Boolean(l.levelRole && pickZoneKeys.has(l.levelRole)),
    })), [locations, pickZoneKeys]);

  const warehouseBinIds = useMemo(() => new Set(bins.map((b) => b.id)), [bins]);
  const pickZoneBinIds = useMemo(
    () => new Set(bins.filter((b) => b.isPickZone).map((b) => b.id)), [bins],
  );
  const binById = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins]);
  const binIdByCode = useMemo(
    () => new Map(bins.map((b) => [b.code.toLowerCase(), b.id])), [bins],
  );
  const rowByProduct = useMemo(() => new Map(rows.map((r) => [r.productId, r])), [rows]);

  // ONE datalist for the whole grid. Every row's bin input points at it by id;
  // a per-row option list is what froze the tab on a 158-row site.
  const binListId = `replen-bins-${warehouseId}`;
  const binCodeOf = React.useCallback(
    (binId: number | null) => (binId != null ? binById.get(binId)?.code ?? '' : ''),
    [binById],
  );
  const resolveBinCode = React.useCallback(
    (code: string) => binIdByCode.get(code.trim().toLowerCase()) ?? null,
    [binIdByCode],
  );
  /** Capacity by bin id, as a map: a `find` per row per render is 200 × 2000
   *  scans on a real site, which is felt on every keystroke. */
  const capacityByBin = useMemo(() => new Map(
    (locations ?? []).map((l) => [l.id, {
      capacitySlots: l.capacitySlots ?? null,
      slotKind: (l.slotKind ?? null) as 'pallet' | 'carton' | null,
    }]),
  ), [locations]);

  // Proposals are computed over EVERY row, not the filtered view: a free bin
  // handed to a hidden row must not be offered again to a visible one.
  const proposals = useMemo(() => proposeHomeBins(rows, freeBins), [rows, freeBins]);

  const draftOf = (productId: number): ReplenDraft => {
    const existing = drafts[productId];
    if (existing) return existing;
    const row = rowByProduct.get(productId);
    return row ? initialDraft(row, proposals.get(productId)) : { binId: null, minText: '', maxText: '' };
  };

  const heldHereCount = useMemo(() => rows.filter((r) => r.stockedHere).length, [rows]);
  const effectiveFilter: Filter = filter ?? (heldHereCount > 0 ? 'here' : 'all');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !row.sku.toLowerCase().includes(needle) && !row.name.toLowerCase().includes(needle)) {
        return false;
      }
      if (effectiveFilter === 'here') return row.stockedHere;
      if (effectiveFilter === 'unset') return row.minQty == null || row.maxQty == null;
      if (effectiveFilter === 'armed') return row.replenEnabled;
      return true;
    });
  }, [rows, search, effectiveFilter]);

  const setDraft = (productId: number, next: ReplenDraft) => {
    setDrafts((prev) => ({ ...prev, [productId]: next }));
  };

  const suggestionOf = (productId: number) => {
    const row = rowByProduct.get(productId);
    if (!row) return null;
    const draft = draftOf(productId);
    // Size against the slot the row is actually pointed at — which may be a bin
    // the operator has just picked, not the stored or proposed one. Suggesting
    // against a bin the row is no longer aimed at would be worse than silence.
    const capacity = draft.binId != null
      ? capacityByBin.get(draft.binId) ?? null
      : proposals.get(productId) ?? null;
    return suggestionFor(row, policy, capacity);
  };

  const fillable = visible.filter((row) => {
    const draft = draftOf(row.productId);
    if (draft.minText.trim() !== '' && draft.maxText.trim() !== '') return false;
    const suggestion = suggestionOf(row.productId);
    return suggestion?.basis === 'capacity';
  });

  const fillEmpty = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of fillable) {
        const draft = draftOf(row.productId);
        const suggestion = suggestionOf(row.productId);
        if (!suggestion || suggestion.basis !== 'capacity') continue;
        next[row.productId] = {
          binId: draft.binId,
          // Only the empty cell is written. A half-typed row keeps what its
          // author typed.
          minText: draft.minText.trim() === '' ? formatEntry(suggestion.minQty, row) : draft.minText,
          maxText: draft.maxText.trim() === '' ? formatEntry(suggestion.maxQty, row) : draft.maxText,
        };
      }
      return next;
    });
  };

  /**
   * Rows that differ from what is stored and would be accepted as they stand.
   *
   * A PROPOSED bin on an otherwise empty row does NOT count. Every unslotted SKU
   * gets a proposal the moment the grid loads, so counting them made "Save"
   * offer to commit 118 home-bin assignments nobody had looked at. A proposal
   * becomes real work when the operator fills the figures in or picks a
   * different bin — both of which this still catches.
   */
  const pending = useMemo(() => visible.filter((row) => {
    const draft = draftOf(row.productId);
    if (!isDraftDirty(row, draft)) return false;
    const untouchedProposal =
      draftFigures(row, draft).empty && draft.binId === (proposals.get(row.productId)?.binId ?? null);
    if (untouchedProposal) return false;
    return draftVerdict(row, draft, { warehouseBinIds, pickZoneBinIds, action: 'leave' }).ok;
  }), [visible, drafts, warehouseBinIds, pickZoneBinIds, rows, proposals]);

  const blocked = useMemo(() => visible.filter((row) => {
    const draft = draftOf(row.productId);
    if (draftFigures(row, draft).empty && draft.binId === row.homeBinId) return false;
    return !draftVerdict(row, draft, { warehouseBinIds, pickZoneBinIds, action: 'leave' }).ok;
  }).length, [visible, drafts, warehouseBinIds, pickZoneBinIds, rows, proposals]);

  const selectedRows = visible.filter((r) => selected.has(r.productId));

  const submit = async (which: typeof pending, action: ArmAction) => {
    const payload = which
      .map((row) => {
        const draft = draftOf(row.productId);
        const figures = draftFigures(row, draft);
        return {
          productId: row.productId,
          binId: draft.binId as number,
          minQty: figures.minQty,
          maxQty: figures.maxQty,
        };
      })
      .filter((r) => r.binId != null);

    if (payload.length === 0) {
      addToast('Nothing to save', 'info');
      return;
    }

    let applied = 0;
    const failures: Array<{ productId: number; reason: string }> = [];
    // Chunked to the same cap the Edge Function validates against.
    for (let i = 0; i < payload.length; i += MAX_BULK_REPLEN_ROWS) {
      const chunk = payload.slice(i, i + MAX_BULK_REPLEN_ROWS);
      try {
        const result = await save.mutateAsync({
          warehouseId,
          rows: chunk,
          replenEnabled: action === 'leave' ? undefined : action === 'arm',
        });
        applied += result.applied;
        failures.push(...result.failed);
      } catch (e) {
        addToast(e instanceof Error ? e.message : 'Could not save', 'error');
        return;
      }
    }

    setDrafts({});
    setSelected(new Set());
    setProblems(failures.map((f) => {
      const row = rows.find((r) => r.productId === f.productId);
      return `${row?.sku ?? f.productId}: ${f.reason}`;
    }));

    if (action === 'arm') {
      // The dry run is only meaningful once the rows ARE armed — the detector
      // reads replen_enabled and would otherwise report the status quo. It
      // writes nothing, so this is still a preview: no task exists until a scan,
      // a pick or a putaway runs the detector for real.
      try {
        const result = await dryRun.mutateAsync({ warehouseId });
        addToast(
          `${applied} product${applied === 1 ? '' : 's'} armed — the next scan would raise ${result?.raised ?? 0} top-up${(result?.raised ?? 0) === 1 ? '' : 's'}.`,
          'success',
        );
      } catch {
        addToast(`${applied} product${applied === 1 ? '' : 's'} armed`, 'success');
      }
    } else {
      addToast(
        `${applied} slot${applied === 1 ? '' : 's'} saved${failures.length ? `, ${failures.length} refused` : ''}`,
        failures.length ? 'info' : 'success',
      );
    }
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const result = applyReplenCsv(text, rows, drafts, binIdByCode);
      setDrafts((prev) => ({ ...prev, ...result.drafts }));
      setProblems(result.problems);
      addToast(
        `${result.matched} row${result.matched === 1 ? '' : 's'} read from the file${result.problems.length ? `, ${result.problems.length} to check` : ''}`,
        result.matched > 0 ? 'success' : 'info',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not read that file', 'error');
    }
  };

  if (error) {
    return (
      <div className="glass-card rounded-xl p-6 text-sm text-red-600">
        {error instanceof Error ? error.message : 'Could not load replenishment configuration'}
      </div>
    );
  }
  if (isLoading) return <div className="text-sm text-stone-500 p-4">Loading products…</div>;

  const armedCount = rows.filter((r) => r.replenEnabled).length;
  const noPickZones = pickZoneBinIds.size === 0;

  return (
    <div className="space-y-4">
      {noPickZones && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-800">
            <strong>{warehouseName} has no pick-zone levels.</strong> Replenishment refills a pick zone, so
            nothing here can be armed until at least one rack level carries a pick-zone role. Slots can still
            be named — they will be used for put-away suggestions.
          </p>
        </div>
      )}

      <ReplenPolicyBar
        policy={policy}
        onChange={setPolicy}
        fillableCount={fillable.length}
        onFill={fillEmpty}
        disabled={save.isPending}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU or name…"
          className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 w-56"
        />
        <div role="tablist" aria-label="Filter" className="inline-flex p-0.5 rounded-lg bg-stone-100 border border-stone-200">
          {([
            ['here', `Held here (${heldHereCount})`],
            ['unset', 'No min/max'],
            ['armed', `Replenishing (${armedCount})`],
            ['all', `All (${config?.productCount ?? rows.length})`],
          ] as Array<[Filter, string]>).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={effectiveFilter === key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1.5 rounded-md text-xs btn-press ${
                effectiveFilter === key ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportReplenCsv(
              visible, drafts, binCodeOf,
              `replenishment-${warehouseName.replace(/\W+/g, '-').toLowerCase()}.csv`,
            )}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 touch-target-y rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press"
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Export
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 touch-target-y rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press"
          >
            <Upload className="w-4 h-4" aria-hidden="true" /> Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800 mb-1">{problems.length} to check</p>
          <ul className="text-[11px] text-amber-800 space-y-0.5 max-h-32 overflow-y-auto">
            {problems.slice(0, 25).map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          <button type="button" onClick={() => setProblems([])} className="text-[11px] text-amber-700 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      <datalist id={binListId}>
        {bins.map((b) => (
          <option key={b.id} value={b.code}>
            {b.name}{b.isPickZone ? ' · pick zone' : ''}
          </option>
        ))}
      </datalist>

      <div className="glass-card rounded-xl overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-100">
            <tr>
              <th className="px-2 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select every visible row"
                  checked={visible.length > 0 && selected.size === visible.length}
                  onChange={(e) => setSelected(e.target.checked
                    ? new Set(visible.map((r) => r.productId))
                    : new Set())}
                />
              </th>
              <th className="px-2 py-2 font-medium">Product</th>
              <th className="px-2 py-2 font-medium text-right">Here</th>
              <th className="px-2 py-2 font-medium">Home bin</th>
              <th className="px-2 py-2 font-medium">Min</th>
              <th className="px-2 py-2 font-medium">Max</th>
              <th className="px-2 py-2 font-medium">Suggested</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((row) => (
              <ReplenSetupRow
                key={row.productId}
                row={row}
                draft={draftOf(row.productId)}
                verdict={draftVerdict(row, draftOf(row.productId), {
                  warehouseBinIds, pickZoneBinIds, action: 'leave',
                })}
                suggestion={suggestionOf(row.productId)}
                proposal={proposals.get(row.productId) ?? null}
                binListId={binListId}
                binCodeOf={binCodeOf}
                resolveBinCode={resolveBinCode}
                selected={selected.has(row.productId)}
                onSelect={(checked) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(row.productId); else next.delete(row.productId);
                  return next;
                })}
                onChange={(next) => setDraft(row.productId, next)}
                onUseSuggestion={() => {
                  const suggestion = suggestionOf(row.productId);
                  if (!suggestion || suggestion.basis !== 'capacity') return;
                  const draft = draftOf(row.productId);
                  setDraft(row.productId, {
                    binId: draft.binId,
                    minText: formatEntry(suggestion.minQty, row),
                    maxText: formatEntry(suggestion.maxQty, row),
                  });
                }}
              />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="text-sm text-stone-500 p-6 text-center">
            No products match this filter.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-stone-100 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-stone-500">
          {pending.length} row{pending.length === 1 ? '' : 's'} changed
          {blocked > 0 && <span className="text-red-600"> · {blocked} need fixing</span>}
          {selected.size > 0 && <span> · {selected.size} selected</span>}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmArm(selectedRows.some((r) => r.replenEnabled) ? 'disarm' : 'arm')}
            disabled={save.isPending || selected.size === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 touch-target-y rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 btn-press disabled:opacity-40"
          >
            <Zap className="w-4 h-4" aria-hidden="true" />
            {selectedRows.some((r) => r.replenEnabled) ? 'Turn off' : 'Turn on'} for {selected.size}
          </button>
          <button
            type="button"
            onClick={() => submit(pending, 'leave')}
            disabled={save.isPending || pending.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-1.5 touch-target-y rounded-lg bg-nexgen-blue text-white btn-press disabled:opacity-40"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {save.isPending ? 'Saving…' : `Save ${pending.length}`}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmArm !== null}
        tone="primary"
        busy={save.isPending}
        title={confirmArm === 'disarm' ? 'Turn replenishment off?' : 'Turn replenishment on?'}
        message={confirmArm === 'disarm'
          ? `${selected.size} product${selected.size === 1 ? '' : 's'} will stop raising top-up tasks. Their minimum and maximum are kept.`
          : `${selected.size} product${selected.size === 1 ? '' : 's'} will start raising top-up tasks whenever their pick slot falls to its minimum — including after every pick and put-away. Their current figures are saved first.`}
        confirmLabel={confirmArm === 'disarm' ? 'Turn off' : 'Turn on'}
        onConfirm={() => {
          const action = confirmArm ?? 'leave';
          setConfirmArm(null);
          submit(selectedRows, action);
        }}
        onCancel={() => setConfirmArm(null)}
      />
    </div>
  );
};

export default ReplenSetupView;
