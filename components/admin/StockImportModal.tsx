// Bulk opening-stock importer: CSV → editable preview grid → receive-stock,
// chunked at 200 lines/receipt (the Edge Function's per-call cap). Structurally
// cloned from FloorPlanImportModal, same as ProductImportModal.
//
// receive-stock is atomic per invoke — a chunk either fully lands or throws.
// So unlike the product importer (which reports per-row outcomes), a failed
// chunk here is reported as a whole row-range, and its rows stay in the grid
// so the operator can just hit Import again to retry only what's left.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PackagePlus, Download, CheckCircle2, AlertTriangle, Warehouse as WarehouseIcon } from 'lucide-react';
import type { Product } from '@/types';
import { Button, Modal } from '@/components/ui';
import { downloadCsv } from '@/lib/csvExport';
import { validateStockRow, type StockImportContext, type StockRowResult, type StockImportLine } from '@/lib/stockImportRow';
import { useWarehouses } from '@/hooks/queries/useWarehouses';
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations';
import { useReceiveStock } from '@/hooks/queries/useReceiveStock';
import { useLayouts } from '@/hooks/queries/useLayouts';
import { useLayoutLabelStatus } from '@/hooks/queries/useLabelJobs';
import { decidePutaway } from '@/services/supabase/putawayService';
import { SelectInput } from '@/components/admin/settings/primitives';
import {
  MAX_IMPORT_ROWS,
  parseFileToRecords,
  stripRowId,
  ImportDropzone,
  ImportErrorBanner,
  ImportResultStatGrid,
} from '@/components/admin/import/csvImportShared';
import { StockPreviewRow, type StockRowProductInfo } from '@/components/admin/import/StockPreviewRow';

interface StockImportModalProps {
  products: Product[];
  onClose: () => void;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type ValidStockRow = Extract<StockRowResult, { ok: true }>;

const CHUNK_SIZE = 200;
const TEMPLATE_HEADERS = ['sku', 'quantity', 'bin_code', 'lot_code', 'expiry_date', 'barcode'];

// Bins a counted stocktake can legitimately name. The tree also holds
// WAREHOUSE/ZONE/AISLE/RACK nodes, which are containers rather than places you
// can stand a pallet in — offering them would let a count land on a node that
// holds no stock and confuse every fill calculation downstream.
const BIN_KINDS = new Set(['BIN', 'SHELF', 'BAY', 'STAGING']);

const todayIso = (): string => new Date().toISOString().slice(0, 10);

interface ChunkFailure {
  firstRow: number;
  lastRow: number;
  message: string;
}

interface StockImportOutcome {
  received: number;
  /** Of those received, how many landed in the bin the CSV named. Rows with no
   *  bin_code are received but never "placed", so this is always ≤ received. */
  placed: number;
  failed: number;
  total: number;
}

export function StockImportModal({ products, onClose, addToast }: StockImportModalProps) {
  const { data: warehouseRows } = useWarehouses();
  const receiveStock = useReceiveStock();

  const activeWarehouses = useMemo(() => (warehouseRows ?? []).filter((w) => w.isActive), [warehouseRows]);

  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [receivedDate, setReceivedDate] = useState<string>('');

  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rowCapError, setRowCapError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chunkFailures, setChunkFailures] = useState<ChunkFailure[]>([]);
  const [importOutcome, setImportOutcome] = useState<StockImportOutcome | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const creatingRef = useRef(false);

  // Bins of the SELECTED warehouse only. `locations.code` is globally unique,
  // so scoping the map here is what stops a code from a different site
  // resolving — the row is rejected by name instead.
  const { data: warehouseLocations } = useWarehouseLocations(warehouseId);

  // Ordering guardrail: a count by bin only works once the barcode labels are
  // physically on the racking, and `label_printed` is only set by the explicit
  // confirm step — generating the sheets does not set it. `byGroup.slots` is
  // exactly the bins (BIN/SHELF/BAY); the wayfinding and staging labels don't
  // gate a count. Racked sites only — a bulk site has no bins to label.
  const { data: destinationLayouts } = useLayouts(warehouseId);
  const publishedLayoutId = useMemo(
    () => destinationLayouts?.find((l) => l.status === 'published')?.id ?? null,
    [destinationLayouts],
  );
  const { data: labelStatus } = useLayoutLabelStatus(publishedLayoutId);
  const unconfirmedLabelCount = labelStatus?.byGroup.slots.outstanding ?? 0;

  const binIdByCode = useMemo(() => {
    const map = new Map<string, number>();
    for (const loc of warehouseLocations ?? []) {
      if (!loc.isActive || !BIN_KINDS.has(loc.kind)) continue;
      map.set(loc.code.trim(), loc.id);
    }
    return map;
  }, [warehouseLocations]);

  const ctx = useMemo<StockImportContext>(() => ({
    productIdBySku: new Map(products.map((p) => [p.sku.trim(), p.id])),
    binIdByCode,
  }), [products, binIdByCode]);

  const productMaps = useMemo(() => {
    const bySkuExact = new Map<string, Product>();
    const bySkuLower = new Map<string, Product>();
    for (const p of products) {
      const trimmed = p.sku.trim();
      bySkuExact.set(trimmed, p);
      bySkuLower.set(trimmed.toLowerCase(), p);
    }
    return { bySkuExact, bySkuLower };
  }, [products]);

  const resolveProduct = useCallback((sku: string): StockRowProductInfo | undefined => {
    const trimmed = sku.trim();
    const p = productMaps.bySkuExact.get(trimmed) ?? productMaps.bySkuLower.get(trimmed.toLowerCase());
    return p ? { name: p.name, cartonSize: p.cartonSize, currentOnHand: p.inventory } : undefined;
  }, [productMaps]);

  const resetOutcome = () => {
    setChunkFailures([]);
    setImportOutcome(null);
    setImportError(null);
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    setRowCapError(null);
    setWarnings([]);
    resetOutcome();
    try {
      const parsed = await parseFileToRecords(file);
      if (parsed.records.length === 0) {
        setParseError('That file has no data rows.');
        return;
      }
      if (parsed.records.length > MAX_IMPORT_ROWS) {
        setRowCapError(
          `This file has ${parsed.records.length} rows, which exceeds the ${MAX_IMPORT_ROWS}-row import limit. ` +
          'Split it into smaller files and import them separately.',
        );
        return;
      }
      setFileName(parsed.fileName);
      setRecords(parsed.records);
      setWarnings(parsed.warnings);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not parse this file as CSV.');
    }
  };

  const updateRecord = useCallback((index: number, patch: Record<string, string>) => {
    setRecords((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }, []);

  const summary = useMemo(() => {
    if (!records) return null;
    let valid = 0;
    let invalid = 0;
    for (const rec of records) {
      if (validateStockRow(stripRowId(rec), ctx).ok) valid++;
      else invalid++;
    }
    return { valid, invalid };
  }, [records, ctx]);

  const handleDownloadTemplate = () => {
    const sampleSku = products[0]?.sku ?? 'AYM-EXAMPLE-001';
    // The sample carries a bin_code so the column is discovered rather than
    // read about. Leaving it blank keeps the old behaviour (receive to root).
    const sampleBin = [...binIdByCode.keys()][0] ?? '';
    downloadCsv(TEMPLATE_HEADERS, [[sampleSku, '24', sampleBin, '', '', '']], 'opening-stock-template.csv');
  };

  const handleImport = async () => {
    if (!records || warehouseId == null || creatingRef.current) return;
    creatingRef.current = true;
    setSubmitting(true);
    setImportError(null);
    try {
      const entries = records
        .map((rec, idx) => ({ idx, result: validateStockRow(stripRowId(rec), ctx) }))
        .filter((e): e is { idx: number; result: ValidStockRow } => e.result.ok === true);

      if (entries.length === 0) {
        setImportError('No valid rows to import — fix the highlighted errors first.');
        return;
      }

      const baseReference = `Opening stock import ${fileName ?? 'file'} ${todayIso()}`;

      // Group by destination bin BEFORE chunking. Every line in a receipt then
      // shares one destination, which is what makes placement trivial: each
      // recommendation the server hands back belongs to this group's bin, so
      // there is no fragile matching of recommendations back to CSV rows.
      // Rows naming no bin land in the `null` group and behave exactly as they
      // always have — received to the root, put away by hand.
      const groups = new Map<number | null, typeof entries>();
      for (const e of entries) {
        const key = e.result.binLocationId ?? null;
        const bucket = groups.get(key);
        if (bucket) bucket.push(e);
        else groups.set(key, [e]);
      }

      const succeededIdx = new Set<number>();
      const failures: ChunkFailure[] = [];
      let receivedLines = 0;
      let placedLines = 0;

      for (const [binId, groupEntries] of groups) {
        const binCode = groupEntries[0].result.binCode;
        const chunks: Array<typeof entries> = [];
        for (let i = 0; i < groupEntries.length; i += CHUNK_SIZE) {
          chunks.push(groupEntries.slice(i, i + CHUNK_SIZE));
        }

        for (let c = 0; c < chunks.length; c++) {
          const chunk = chunks[c];
          const lines: StockImportLine[] = chunk.map((e) => e.result.line);
          const suffix = chunks.length > 1 ? ` (chunk ${c + 1}/${chunks.length})` : '';
          const reference = `${baseReference}${binCode ? ` → ${binCode}` : ''}${suffix}`;
          const rowRange = { firstRow: chunk[0].idx + 1, lastRow: chunk[chunk.length - 1].idx + 1 };

          let received;
          try {
            received = await receiveStock.mutateAsync({
              header: {
                supplier_name: 'Opening Balance',
                reference,
                location_id: warehouseId,
                ...(receivedDate ? { received_date: receivedDate } : {}),
              },
              lines,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to receive this batch of stock.';
            failures.push({ ...rowRange, message });
            continue;
          }

          // The stock is in the building from here on. These rows must leave the
          // grid even if placement fails below — re-importing them would receive
          // the same quantities a second time.
          chunk.forEach((e) => succeededIdx.add(e.idx));
          receivedLines += chunk.length;

          if (binId == null) continue;

          const recommendations =
            received.putaway?.mode === 'engine' ? received.putaway.recommendations : [];
          if (recommendations.length === 0) {
            failures.push({
              ...rowRange,
              message:
                `Received into the warehouse, but nothing could be placed into ${binCode}: this warehouse has no ` +
                'published layout, so the engine raised no putaway task. Publish the layout, then put these lines away from the Putaway queue.',
            });
            continue;
          }

          // roleOverride: an opening count records where stock PHYSICALLY is. If
          // the floor has pallets on a pick level, refusing the count would not
          // move them — it would just leave the system wrong about them.
          const placements = await Promise.allSettled(
            recommendations.map((rec) =>
              decidePutaway({
                recommendationId: rec.recommendationId,
                decision: 'override',
                chosenLocationId: binId,
                quantity: rec.quantity,
                roleOverride: true,
              }),
            ),
          );
          const rejected = placements.filter((p) => p.status === 'rejected');
          if (rejected.length === 0) {
            placedLines += chunk.length;
            continue;
          }
          const first = rejected[0] as PromiseRejectedResult;
          const reason = first.reason instanceof Error ? first.reason.message : String(first.reason);
          failures.push({
            ...rowRange,
            message:
              `Received into the warehouse, but ${rejected.length} of ${recommendations.length} placements into ` +
              `${binCode} failed (${reason}). The stock is at the warehouse root — finish it from the Putaway queue.`,
          });
        }
      }

      setRecords((prev) => (prev ? prev.filter((_, i) => !succeededIdx.has(i)) : prev));
      setChunkFailures(failures);
      const failedRows = entries.length - receivedLines;
      setImportOutcome({ received: receivedLines, placed: placedLines, failed: failedRows, total: entries.length });
      if (receivedLines > 0) {
        const placedNote = placedLines > 0 ? `, ${placedLines} placed into bins` : '';
        addToast?.(`Received ${receivedLines} line${receivedLines === 1 ? '' : 's'} into stock${placedNote}`, 'success');
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Opening-stock import failed.');
    } finally {
      creatingRef.current = false;
      setSubmitting(false);
    }
  };

  const canImport = !!summary && summary.valid > 0 && warehouseId != null && !submitting;
  // Rows still sitting in the preview grid are unimported work, so every dismiss
  // path (Escape, backdrop, X, Close) routes through the discard guard first.
  const hasPendingRows = (records?.length ?? 0) > 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      dirty={hasPendingRows}
      discardConfirm={{
        title: 'Discard this import?',
        message: 'The rows parsed from your CSV have not been received into stock yet.',
      }}
      icon={<PackagePlus className="w-4 h-4 text-nexgen-blue" />}
      title="Bulk import opening stock"
      footer={({ requestClose }) => (
        <>
          <Button variant="secondary" onClick={requestClose}>
            {records ? 'Close' : 'Cancel'}
          </Button>
          {records && (
            <Button
              onClick={handleImport}
              disabled={!canImport}
              loading={submitting}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {submitting ? 'Receiving…' : `Import ${summary?.valid ?? 0} row${summary?.valid === 1 ? '' : 's'}`}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            Upload a CSV of opening balances (quantities are <strong>base units</strong>, not cartons). Fill{' '}
            <strong>bin_code</strong> to land a counted stocktake straight into its bin; leave it blank and the stock
            arrives at the warehouse root for the Putaway queue. Receiving is additive, so re-running the same file
            twice will double the stock.
          </p>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-nexgen-blue hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download template
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-stone-50 border border-stone-200 p-3">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 mb-1.5">
              <WarehouseIcon className="w-3.5 h-3.5 text-stone-400" /> Destination warehouse <span className="text-red-500">*</span>
            </label>
            <SelectInput
              value={warehouseId ?? ''}
              onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Destination warehouse"
            >
              <option value="">Select a warehouse…</option>
              {activeWarehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </SelectInput>
            {activeWarehouses.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No active warehouse found — create one in Settings first.</p>
            )}
            {unconfirmedLabelCount > 0 && (
              // Ordering guardrail, not a block. A count keyed by bin_code is
              // only transcribable if the bins carry their codes on the floor;
              // confirming the label run is the statement that they do. The
              // import is still allowed — the operator may have applied labels
              // without confirming, and refusing would not put stickers up.
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                <span>
                  {unconfirmedLabelCount} bin{unconfirmedLabelCount === 1 ? '' : 's'} here still show as
                  unlabelled. Counting by <strong>bin_code</strong> before the barcode labels are on the racking
                  produces a count nobody can transcribe — confirm the label run first (Settings → Warehouse
                  → Print labels).
                </span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Received date (optional)</label>
            <input
              type="date"
              value={receivedDate}
              max={todayIso()}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 focus:border-nexgen-blue"
            />
            <p className="text-xs text-stone-400 mt-1">Leave blank to backdate opening balances to today.</p>
          </div>
        </div>

        {!records && (
          <ImportDropzone onFile={handleFile} hint="Drop a CSV here, or click to choose" />
        )}

        {parseError && <ImportErrorBanner message={parseError} />}
        {rowCapError && <ImportErrorBanner message={rowCapError} />}
        {warnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{warnings.map((w) => <p key={w}>{w}</p>)}</div>
          </div>
        )}

        {records && summary && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <p className="text-stone-500">
                {fileName} · {records.length} row{records.length === 1 ? '' : 's'}
              </p>
              <p>
                <span className="text-emerald-600 font-semibold">{summary.valid} valid</span>
                {' / '}
                <span className={summary.invalid > 0 ? 'text-red-600 font-semibold' : 'text-stone-400'}>
                  {summary.invalid} error{summary.invalid === 1 ? '' : 's'}
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-stone-200 overflow-x-auto max-h-[45svh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-stone-50 z-10">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2">SKU</th>
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Qty (base units)</th>
                    <th className="px-2 py-2">Current on-hand</th>
                    <th className="px-2 py-2">Carton size</th>
                    <th className="px-2 py-2">Bin</th>
                    <th className="px-2 py-2">Lot code</th>
                    <th className="px-2 py-2">Expiry</th>
                    <th className="px-2 py-2">Barcode</th>
                    <th className="px-2 py-2">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {records.map((rec, i) => (
                    <StockPreviewRow
                      key={rec.__rowId ?? i}
                      index={i}
                      record={rec}
                      ctx={ctx}
                      resolveProduct={resolveProduct}
                      onChange={updateRecord}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {importError && <ImportErrorBanner message={importError} />}

        {chunkFailures.length > 0 && (
          <div className="space-y-1.5">
            {chunkFailures.map((f) => (
              <ImportErrorBanner
                key={`${f.firstRow}-${f.lastRow}`}
                message={`Rows ${f.firstRow}–${f.lastRow} did not import: ${f.message}`}
              />
            ))}
          </div>
        )}

        {importOutcome && (
          <ImportResultStatGrid
            items={[
              { label: 'Received', value: importOutcome.received, tone: 'success' },
              { label: 'Placed in bins', value: importOutcome.placed, tone: importOutcome.placed > 0 ? 'success' : 'default' },
              { label: 'Failed', value: importOutcome.failed, tone: importOutcome.failed > 0 ? 'error' : 'default' },
              { label: 'Total', value: importOutcome.total },
            ]}
          />
        )}
      </div>
    </Modal>
  );
}

export default StockImportModal;
