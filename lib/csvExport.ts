// CSV export helpers shared between admin tables (Orders, Audit Log).
//
// Builds RFC-4180-style CSV: every value is double-quoted; embedded
// double quotes are escaped by doubling them. Newlines are preserved
// literally — most spreadsheet apps accept that.

const escape = (val: string): string => `"${val.replace(/"/g, '""')}"`;

export function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

export function downloadCsv(headers: string[], rows: string[][], filename: string): void {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
