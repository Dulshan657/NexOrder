// Bulk catalog importer: CSV → editable preview grid → mutate-product's
// bulk-create action. Cloned structurally from FloorPlanImportModal (overlay,
// dropzone, progress/result areas, two-stage footer, double-submit guard).
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FileUp, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Product, Supplier } from '@/types';
import { Button, Modal } from '@/components/ui';
import { categoryOptions } from '@/lib/productTaxonomy';
import { downloadCsv } from '@/lib/csvExport';
import { validateCatalogRow, type CatalogImportContext, type RowResult } from '@/lib/productImportRow';
import { useBulkCreateProducts } from '@/hooks/queries/useProducts';
import {
  MAX_IMPORT_ROWS,
  parseFileToRecords,
  stripRowId,
  ImportDropzone,
  ImportErrorBanner,
  ImportResultStatGrid,
} from '@/components/admin/import/csvImportShared';
import { ProductPreviewRow, type ProductServerError } from '@/components/admin/import/ProductPreviewRow';

interface ProductImportModalProps {
  suppliers: Supplier[];
  /** The catalog, so categories operators created inline are accepted by the importer. */
  catalog?: Product[];
  onClose: () => void;
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

type ValidRowResult = Extract<RowResult, { ok: true }>;

const TEMPLATE_HEADERS = [
  'sku', 'name', 'description', 'price', 'category', 'unit', 'supplier_name',
  // Multi-supplier columns (mig 00070), both ';'-delimited and optional.
  // `supplier_skus` is positional over [supplier_name, ...additional_suppliers].
  'additional_suppliers', 'supplier_skus',
  'carton_size', 'cubic_meters_unit', 'cubic_meters_carton', 'length_cm',
  'width_cm', 'height_cm', 'size_factor', 'image_url',
];

interface ImportOutcomeSummary {
  created: number;
  skipped: number;
  total: number;
}

export function ProductImportModal({ suppliers, catalog, onClose, addToast }: ProductImportModalProps) {
  const bulkCreate = useBulkCreateProducts();

  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rowCapError, setRowCapError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [serverErrors, setServerErrors] = useState<Map<number, ProductServerError> | null>(null);
  const [importOutcome, setImportOutcome] = useState<ImportOutcomeSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Guards a fast double-click of Import from firing two overlapping mutations.
  const creatingRef = useRef(false);

  const ctx = useMemo<CatalogImportContext>(() => ({
    suppliersByName: new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id])),
    // Built-in categories plus every one already in use, so an inline-created
    // category doesn't get rejected on the next CSV import.
    categories: new Set(categoryOptions(catalog)),
  }), [suppliers, catalog]);

  const resetOutcome = () => {
    setServerErrors(null);
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
    // The row changed, so any stale server-side failure no longer applies to it.
    setServerErrors((prev) => {
      if (!prev || !prev.has(index)) return prev;
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }, []);

  // Recomputed on every edit — pure JS over up to MAX_IMPORT_ROWS records, not
  // a DOM concern, so no memo-breaking risk for the (memoized) grid rows below.
  const summary = useMemo(() => {
    if (!records) return null;
    let valid = 0;
    let invalid = 0;
    const creatingSuppliers = new Set<string>();
    for (const rec of records) {
      const result = validateCatalogRow(stripRowId(rec), ctx);
      if (result.ok) {
        valid++;
        // Counts every new supplier on the row, primary or additional.
        for (const name of result.newSupplierNames) creatingSuppliers.add(name);
      } else {
        invalid++;
      }
    }
    return { valid, invalid, creatingSuppliers: [...creatingSuppliers] };
  }, [records, ctx]);

  const handleDownloadTemplate = () => {
    const sampleSupplier = suppliers[0]?.name ?? 'Example Supplier';
    const sampleRow = [
      'AYM-EXAMPLE-001', 'Example Product', 'Optional description', '9.99', 'Other', 'each',
      sampleSupplier,
      // e.g. "Beta Foods;Gamma Trading" with part numbers lined up per supplier.
      '', '',
      '12', '0.0010', '0.0120', '10', '10', '10', '1', '',
    ];
    downloadCsv(TEMPLATE_HEADERS, [sampleRow], 'product-import-template.csv');
  };

  const handleImport = async () => {
    if (!records || creatingRef.current) return;
    creatingRef.current = true;
    setImportError(null);
    try {
      const entries = records
        .map((rec, idx) => ({ idx, result: validateCatalogRow(stripRowId(rec), ctx) }))
        .filter((e): e is { idx: number; result: ValidRowResult } => e.result.ok === true);

      if (entries.length === 0) {
        setImportError('No valid rows to import — fix the highlighted errors first.');
        return;
      }

      const rows = entries.map((e) => e.result.row);
      const outcomes = await bulkCreate.mutateAsync(rows);

      const nextServerErrors = new Map<number, ProductServerError>();
      const succeededIdx = new Set<number>();
      let created = 0;
      outcomes.forEach((o) => {
        const entry = entries[o.index];
        if (!entry) return;
        if (o.ok) {
          created++;
          succeededIdx.add(entry.idx);
        } else {
          nextServerErrors.set(entry.idx, { error: o.error ?? 'Import failed', code: o.code });
        }
      });

      setServerErrors(nextServerErrors);
      // Drop the rows that made it in; keep everything else (invalid-before-
      // import rows + server-rejected rows) visible so the operator can fix
      // and re-run just the remainder.
      setRecords((prev) => (prev ? prev.filter((_, i) => !succeededIdx.has(i)) : prev));
      setImportOutcome({ created, skipped: outcomes.length - created, total: outcomes.length });
      if (created > 0) addToast?.(`Imported ${created} product${created === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Bulk product import failed.');
    } finally {
      creatingRef.current = false;
    }
  };

  const busy = bulkCreate.isPending;
  const canImport = !!summary && summary.valid > 0 && !busy;
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
        message: 'The rows parsed from your CSV have not been imported yet.',
      }}
      icon={<FileUp className="w-4 h-4 text-nexgen-blue" />}
      title="Bulk import products"
      footer={({ requestClose }) => (
        <>
          <Button variant="secondary" onClick={requestClose}>
            {records ? 'Close' : 'Cancel'}
          </Button>
          {records && (
            <Button
              onClick={handleImport}
              disabled={!canImport}
              loading={busy}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              {busy ? 'Importing…' : `Import ${summary?.valid ?? 0} product${summary?.valid === 1 ? '' : 's'}`}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            Upload a CSV of products to create in bulk. Unknown suppliers are created automatically.
            For an item you buy from several suppliers, list the others in <code className="font-mono">additional_suppliers</code> (separated by <code className="font-mono">;</code>)
            and their part numbers in <code className="font-mono">supplier_skus</code>, in the same order.
          </p>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-nexgen-blue hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download template
          </button>
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

            {summary.creatingSuppliers.length > 0 && (
              <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-xs text-stone-600">
                Will create {summary.creatingSuppliers.length} new supplier{summary.creatingSuppliers.length === 1 ? '' : 's'}:{' '}
                {summary.creatingSuppliers.join(', ')}
              </div>
            )}

            <div className="rounded-xl border border-stone-200 overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-stone-50 z-10">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2">SKU</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Unit</th>
                    <th className="px-2 py-2">Supplier</th>
                    <th className="px-2 py-2">Carton</th>
                    <th className="px-2 py-2">m³/unit</th>
                    <th className="px-2 py-2">m³/ctn</th>
                    <th className="px-2 py-2">L cm</th>
                    <th className="px-2 py-2">W cm</th>
                    <th className="px-2 py-2">H cm</th>
                    <th className="px-2 py-2">Size factor</th>
                    <th className="px-2 py-2">Image URL</th>
                    <th className="px-2 py-2">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {records.map((rec, i) => (
                    <ProductPreviewRow
                      key={rec.__rowId ?? i}
                      index={i}
                      record={rec}
                      ctx={ctx}
                      onChange={updateRecord}
                      serverError={serverErrors?.get(i)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {importError && <ImportErrorBanner message={importError} />}

        {importOutcome && (
          <ImportResultStatGrid
            items={[
              { label: 'Created', value: importOutcome.created, tone: 'success' },
              { label: 'Skipped', value: importOutcome.skipped, tone: importOutcome.skipped > 0 ? 'error' : 'default' },
              { label: 'Total', value: importOutcome.total },
            ]}
          />
        )}
      </div>
    </Modal>
  );
}

export default ProductImportModal;
