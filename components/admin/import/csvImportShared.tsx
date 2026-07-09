// Shared UI + parsing plumbing for the bulk-CSV importers (ProductImportModal,
// StockImportModal). Kept separate so the two modals don't duplicate the
// dropzone, the row-count guard, or the post-import result grid.
import React, { useRef, useState } from 'react';
import { UploadCloud, AlertTriangle } from 'lucide-react';
import { parseCsv, toRecords } from '@/lib/csvImport';

/** Hard cap on rows rendered as editable preview inputs. Above this, a CSV
 * import would mean thousands of live `<input>` elements — even memoized,
 * that's a bad time for the browser. Large files should be split. */
export const MAX_IMPORT_ROWS = 2000;

/** Hard cap on the raw file size, checked BEFORE `file.text()` is awaited.
 * A wrong/huge file (e.g. a mis-dragged video or DB dump) would otherwise
 * hang the tab reading and parsing megabytes of text before the row-count
 * guard above ever gets a chance to reject it. */
export const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export interface ParsedFile {
  fileName: string;
  records: Record<string, string>[];
  warnings: string[];
}

let rowIdCounter = 0;

/** Reads a File, parses it as CSV, and returns header-keyed records, each
 * tagged with a stable, monotonically increasing `__rowId`. React keys the
 * preview grid on `__rowId` rather than array index so that removing
 * succeeded rows after a partial import doesn't reassign DOM/component
 * instances to different data (see ProductImportModal / StockImportModal).
 * `__rowId` is for keying only — strip it before sending a row to a
 * validator or the server.
 * Rethrows `parseCsv`'s error (e.g. semicolon-delimited file) so the caller
 * can surface it as the error banner. */
export async function parseFileToRecords(file: File): Promise<ParsedFile> {
  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    const maxMb = MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `This file is ${fileMb}MB, which exceeds the ${maxMb}MB import limit. ` +
      'Split it into smaller files and import them separately.',
    );
  }
  const text = await file.text();
  const parsed = parseCsv(text);
  const records = toRecords(parsed).map((record) => ({ ...record, __rowId: String(rowIdCounter++) }));
  return { fileName: file.name, records, warnings: parsed.warnings };
}

/** Strips the internal `__rowId` key before a record is validated or sent to
 * the server, so it never leaks into a payload row. */
export function stripRowId(record: Record<string, string>): Record<string, string> {
  const { __rowId: _rowId, ...rest } = record;
  return rest;
}

interface ImportDropzoneProps {
  onFile: (file: File) => void;
  hint: string;
  disabled?: boolean;
}

/** Drag-drop + click-to-open CSV picker, styled after FloorPlanImportModal's
 * dropzone. Deliberately dumb — parsing/validation happens in the caller. */
export const ImportDropzone: React.FC<ImportDropzoneProps> = ({ onFile, hint, disabled }) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    if (!f) return;
    onFile(f);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) pick(e.dataTransfer.files[0] ?? null);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50 border-stone-200' : 'cursor-pointer border-stone-200 hover:bg-stone-50'
      } ${dragOver && !disabled ? 'border-emerald-400 bg-emerald-50' : ''}`}
    >
      <div className="flex flex-col items-center gap-2 text-stone-400">
        <UploadCloud className="h-8 w-8" />
        <p className="text-xs">{hint}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        disabled={disabled}
        onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }}
      />
    </div>
  );
};

interface ErrorBannerProps {
  message: string;
}

export const ImportErrorBanner: React.FC<ErrorBannerProps> = ({ message }) => (
  <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
  </div>
);

export interface StatItem {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'error';
}

const TONE_CLASS: Record<NonNullable<StatItem['tone']>, string> = {
  default: 'text-stone-900',
  success: 'text-emerald-600',
  error: 'text-red-600',
};

/** 3(+)-up result stat grid, e.g. Created / Skipped / Total. */
export const ImportResultStatGrid: React.FC<{ items: StatItem[] }> = ({ items }) => (
  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
    {items.map((item) => (
      <div key={item.label} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-center">
        <p className={`font-mono text-lg font-semibold ${TONE_CLASS[item.tone ?? 'default']}`}>{item.value}</p>
        <p className="text-[10px] uppercase tracking-wide text-stone-400">{item.label}</p>
      </div>
    ))}
  </div>
);
