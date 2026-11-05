// Upload a QuickBooks invoice export, see what it would do, then confirm.
//
// The button says PO at the owner's request; the file holds customer invoices.
// Nothing is written until Confirm. The commit sends the same text and the server
// works everything out again, so this screen decides nothing itself.
import React, { useState } from 'react';
import { CheckCircle2, Download, FileUp } from 'lucide-react';
import { Button, Callout, Modal } from '@/components/ui';
import { downloadCsv } from '@/lib/csvExport';
import {
  IMPORT_PO_TEMPLATE_FILENAME,
  IMPORT_PO_TEMPLATE_HEADERS,
  IMPORT_PO_TEMPLATE_ROWS,
  readImportFile,
} from '@/lib/readImportFile';
import { useImportPoCommit, useImportPoPreview } from '@/hooks/queries/useImportPo';
import type { InvoiceDifference, InvoiceVerdict } from '@/supabase/functions/_shared/qbImport/classifyInvoices';
import type { ImportOk, InvoiceOutcome, InvoiceResult } from '@/supabase/functions/_shared/qbImport/runImport';

type ChangedVerdict = Extract<InvoiceVerdict, { kind: 'changed' }>;
type RejectedVerdict = Extract<InvoiceVerdict, { kind: 'rejected' }>;

const SECTION_HEADING = 'text-sm font-semibold text-stone-800';
const LIST_BOX = 'max-h-56 overflow-y-auto rounded-lg border border-stone-200 divide-y divide-stone-100 text-sm text-stone-700';
const LIST_ROW = 'px-3 py-2';

const OUTCOME_LABELS: Record<InvoiceOutcome, string> = {
  added: 'Added to the Pick Queue',
  updated: 'Updated',
  flagged: 'Differences stored',
  unchanged: 'Unchanged',
  finished: 'Finished: now in the Pick Queue',
  skipped: 'Skipped',
  rejected: 'Rejected',
  refused: 'Not updated',
  failed: 'Failed',
};

const OUTCOME_TONES: Record<InvoiceOutcome, string> = {
  added: 'text-emerald-800',
  updated: 'text-emerald-800',
  finished: 'text-emerald-800',
  flagged: 'text-amber-800',
  refused: 'text-amber-800',
  unchanged: 'text-stone-600',
  skipped: 'text-stone-600',
  rejected: 'text-red-700',
  failed: 'text-red-700',
};

const priced = (quantity: number, unitPrice: number): string => `${quantity} at $${unitPrice.toFixed(2)}`;

function describeDifference(difference: InvoiceDifference): string {
  switch (difference.kind) {
    case 'added':
      return `Added: ${difference.qbProductName}, ${priced(difference.quantity, difference.unitPrice)}`;
    case 'removed':
      return `Removed: product #${difference.productId}, ${priced(difference.quantity, difference.unitPrice)}`;
    case 'altered':
      return `${difference.qbProductName}: ${priced(difference.from.quantity, difference.from.unitPrice)} becomes ${priced(difference.to.quantity, difference.to.unitPrice)}`;
    case 'customer':
      return `Customer changes from #${difference.fromHorecaId} to #${difference.toHorecaId}`;
  }
}

const hasWork = (preview: ImportOk): boolean =>
  preview.counts.added > 0 ||
  preview.counts.changed > 0 ||
  preview.unfinishedInvoices.length > 0 ||
  preview.staleFlagInvoices.length > 0;

const Counts: React.FC<{ preview: ImportOk }> = ({ preview }) => {
  const { added, unchanged, changed, skipped, rejected } = preview.counts;
  const tiles: Array<[string, number]> = [
    ['Added', added],
    ['Unchanged', unchanged],
    ['Changed', changed],
    ['Skipped', skipped],
    ['Rejected', rejected],
  ];
  return (
    <ul aria-label="What this file will do" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {tiles.map(([label, value]) => (
        <li key={label} className="rounded-lg border border-stone-200 px-3 py-2">
          <span className="block text-xs text-stone-500">{label}</span>
          <span className="block text-lg font-semibold text-stone-900 tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  );
};

const ChangedList: React.FC<{
  verdicts: ChangedVerdict[];
  selected: ReadonlySet<string>;
  onToggle: (invoiceNumber: string) => void;
}> = ({ verdicts, selected, onToggle }) => (
  <section className="space-y-1.5">
    <h3 className={SECTION_HEADING}>Changed invoices</h3>
    <p className="text-xs text-stone-500">Tick an invoice to update its order. Anything not ticked keeps its order as it is, and the differences are stored for the office.</p>
    <ul aria-label="Changed invoices" className={LIST_BOX}>
      {verdicts.map((verdict) => (
        <li key={verdict.invoiceNumber} className={LIST_ROW}>
          {verdict.editable ? (
            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                aria-label={`Update ${verdict.invoiceNumber}`}
                checked={selected.has(verdict.invoiceNumber)}
                onChange={() => onToggle(verdict.invoiceNumber)}
              />
              Update {verdict.invoiceNumber}
            </label>
          ) : (
            <p>
              <span className="font-medium">{verdict.invoiceNumber}</span>
              <span className="text-stone-500"> cannot be edited now. Its differences will be stored for the office.</span>
            </p>
          )}
          <ul className="mt-1 ml-6 list-disc text-xs text-stone-600">
            {verdict.differences.map((difference, index) => (
              <li key={index}>{describeDifference(difference)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  </section>
);

const SkippedList: React.FC<{ preview: ImportOk }> = ({ preview }) => (
  <section className="space-y-1.5">
    <h3 className={SECTION_HEADING}>Skipped lines</h3>
    <p className="text-xs text-stone-500">These lines are not in the product map, or have no product, and are not imported.</p>
    <ul aria-label="Skipped lines" className={LIST_BOX}>
      {preview.skippedLines.map((line, index) => (
        <li key={`${line.invoiceNumber}-${index}`} className={LIST_ROW}>
          {line.invoiceNumber}: {line.name}
        </li>
      ))}
    </ul>
  </section>
);

const RejectedList: React.FC<{ verdicts: RejectedVerdict[]; preview: ImportOk }> = ({ verdicts, preview }) => (
  <section className="space-y-1.5">
    <h3 className={SECTION_HEADING}>Rejected</h3>
    <p className="text-xs text-stone-500">Nothing from these is imported. Fix them in the file and upload it again.</p>
    <ul aria-label="Rejected" className={LIST_BOX}>
      {verdicts.map((verdict) => (
        <li key={verdict.invoiceNumber} className={LIST_ROW}>
          <span className="font-medium">{verdict.invoiceNumber}</span>
          <ul className="mt-1 ml-4 list-disc text-xs text-red-700">
            {verdict.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </li>
      ))}
      {preview.unattachedRowErrors.map((error) => (
        <li key={error.rowNumber} className={`${LIST_ROW} text-xs text-red-700`}>
          Row {error.rowNumber}: {error.message}
        </li>
      ))}
    </ul>
  </section>
);

const Preview: React.FC<{
  preview: ImportOk;
  selected: ReadonlySet<string>;
  onToggle: (invoiceNumber: string) => void;
}> = ({ preview, selected, onToggle }) => {
  const changed = preview.verdicts.filter((verdict): verdict is ChangedVerdict => verdict.kind === 'changed');
  const rejected = preview.verdicts.filter((verdict): verdict is RejectedVerdict => verdict.kind === 'rejected');
  return (
    <div className="space-y-4">
      <Counts preview={preview} />
      {preview.unfinishedInvoices.length > 0 && (
        <Callout tone="info" dense title="Earlier orders to finish">
          Confirm moves these to the Pick Queue: {preview.unfinishedInvoices.join(', ')}.
        </Callout>
      )}
      {preview.staleFlagInvoices.length > 0 && (
        <Callout tone="info" dense title="Old differences to clear">
          These match their orders again, so Confirm clears what was stored: {preview.staleFlagInvoices.join(', ')}.
        </Callout>
      )}
      {changed.length > 0 && <ChangedList verdicts={changed} selected={selected} onToggle={onToggle} />}
      {preview.skippedLines.length > 0 && <SkippedList preview={preview} />}
      {preview.counts.rejected > 0 && <RejectedList verdicts={rejected} preview={preview} />}
      {!hasWork(preview) && <p className="text-sm text-stone-600">There is nothing to import from this file.</p>}
    </div>
  );
};

const ResultRow: React.FC<{ result: InvoiceResult }> = ({ result }) => (
  <li className={LIST_ROW}>
    <span className="font-medium">{result.invoiceNumber}</span>
    <span className={`ml-2 ${OUTCOME_TONES[result.outcome]}`}>{OUTCOME_LABELS[result.outcome]}</span>
    {result.message && <p className="text-xs text-stone-600 mt-0.5">{result.message}</p>}
  </li>
);

const Results: React.FC<{ committed: ImportOk }> = ({ committed }) => {
  const failed = committed.resultCounts?.failed ?? 0;
  return (
    <div className="space-y-4">
      <Callout tone={failed > 0 ? 'warning' : 'success'} icon={<CheckCircle2 className="h-4 w-4" />} title="Import finished">
        {failed > 0
          ? `${failed} ${failed === 1 ? 'invoice' : 'invoices'} failed. The others are saved.`
          : 'Every invoice was handled.'}
      </Callout>
      <section className="space-y-1.5">
        <h3 className={SECTION_HEADING}>Results</h3>
        <ul aria-label="Results" className={LIST_BOX}>
          {(committed.results ?? []).map((result) => (
            <ResultRow key={result.invoiceNumber} result={result} />
          ))}
        </ul>
      </section>
      {(committed.ignoredApplyChanges ?? []).length > 0 && (
        <section className="space-y-1.5">
          <h3 className={SECTION_HEADING}>Selections not applied</h3>
          <ul aria-label="Selections not applied" className={LIST_BOX}>
            {(committed.ignoredApplyChanges ?? []).map((entry) => (
              <li key={entry.invoiceNumber} className={LIST_ROW}>
                {entry.invoiceNumber}: {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const FilePicker: React.FC<{ disabled: boolean; onFile: (file: File) => void }> = ({ disabled, onFile }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <label htmlFor="import-po-file" className="flex items-center gap-2 text-sm font-medium text-stone-700 mb-1">
        <FileUp className="h-4 w-4" aria-hidden="true" />
        Choose a CSV or Excel file
      </label>
      <input
        id="import-po-file"
        aria-label="Choose a CSV or Excel file"
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled}
        className="block text-sm text-stone-600"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
    </div>
    <Button
      variant="secondary"
      size="sm"
      icon={<Download className="h-4 w-4" />}
      onClick={() => downloadCsv(IMPORT_PO_TEMPLATE_HEADERS, IMPORT_PO_TEMPLATE_ROWS, IMPORT_PO_TEMPLATE_FILENAME)}
    >
      Download template
    </Button>
  </div>
);

const errorText = (error: unknown): string | null =>
  error ? (error instanceof Error ? error.message : 'The import could not be completed.') : null;

const toggled = (set: ReadonlySet<string>, value: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

export const ImportPoView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const previewMutation = useImportPoPreview();
  const commitMutation = useImportPoCommit();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const preview = previewMutation.data ?? null;
  const committed = commitMutation.data ?? null;
  const busy = previewMutation.isPending || commitMutation.isPending;

  const handleFile = async (file: File) => {
    previewMutation.reset();
    commitMutation.reset();
    setSelected(new Set());
    setCsvText(null);
    const read = await readImportFile(file);
    if (read.ok === false) {
      setRefusal(read.reason);
      return;
    }
    setRefusal(null);
    setCsvText(read.text);
    previewMutation.mutate(read.text);
  };

  const fileErrors = preview?.fileErrors ?? [];
  const problem = refusal ?? errorText(previewMutation.error) ?? errorText(commitMutation.error);
  const canConfirm = !committed && preview !== null && csvText !== null && fileErrors.length === 0 && hasWork(preview);

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title="Import PO"
      description="Upload QuickBooks invoices. Nothing is saved until you confirm."
      dismissOnBackdrop={!busy}
      dismissOnEsc={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {committed ? 'Close' : 'Cancel'}
          </Button>
          {canConfirm && (
            <Button
              variant="primary"
              loading={commitMutation.isPending}
              disabled={busy}
              onClick={() => commitMutation.mutate({ csvText, applyChanges: [...selected] })}
            >
              Confirm import
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <FilePicker disabled={busy} onFile={handleFile} />
        <p aria-live="polite" className="text-sm text-stone-500">
          {previewMutation.isPending ? 'Reading the file…' : commitMutation.isPending ? 'Importing…' : ''}
        </p>
        {problem && (
          <div role="alert">
            <Callout tone="danger" dense>{problem}</Callout>
          </div>
        )}
        {fileErrors.length > 0 && (
          <div role="alert">
            <Callout tone="danger" dense title="This file cannot be imported">
              <ul className="list-disc ml-4">
                {fileErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        {committed && <Results committed={committed} />}
        {!committed && preview && fileErrors.length === 0 && (
          <Preview preview={preview} selected={selected} onToggle={(invoiceNumber) => setSelected((set) => toggled(set, invoiceNumber))} />
        )}
      </div>
    </Modal>
  );
};

export default ImportPoView;
