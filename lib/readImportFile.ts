// An uploaded file -> the text `import-qb-invoices` parses.
//
// The server only ever reads text, so Excel becomes exactly what the same data
// saved as CSV would be: a true date becomes YYYY-MM-DD and a number stays plain.
// `read-excel-file` is imported only when an Excel file arrives, so it is a chunk of
// its own that nobody else downloads.

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  QB_COLUMNS,
  countDataRows,
} from '@/supabase/functions/_shared/qbImport/parseInvoices'

export type ReadImportResult = { ok: true; text: string } | { ok: false; reason: string }

export const IMPORT_PO_TEMPLATE_FILENAME = 'import-po-template.csv'

export const IMPORT_PO_TEMPLATE_HEADERS: string[] = Object.values(QB_COLUMNS)

/** Made-up rows showing the shape of each column. */
export const IMPORT_PO_TEMPLATE_ROWS: string[][] = [
  ['INV-1001', '05/03/2026', 'Example Cafe', 'Example Product A', '3', '$12.50'],
  ['INV-1001', '05/03/2026', 'Example Cafe', 'Example Product B', '1', '$1,234.50'],
  ['INV-1002', '2026-03-06', 'Example Bistro, Pier 2', 'Example Product A', '12', '$12.50'],
]

const MEGABYTES = MAX_IMPORT_BYTES / (1024 * 1024)
const TOO_LARGE = `This file is over the ${MEGABYTES} MB limit. Split it into smaller files.`
const tooManyRows = (rows: number): string =>
  `This file has ${rows.toLocaleString('en-AU')} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString('en-AU')}. Split it into smaller files.`

const extensionOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A date reads the same in any time zone: the package builds it in UTC. A cell holding
 *  a formula error such as #N/A reaches here as empty, because the package drops the
 *  error and offers no way to see it, so it reads the same as a blank cell. */
function excelCellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? '' : cell.toISOString().slice(0, 10)
  return String(cell)
}

export function excelRowsToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map((row) => {
      const cells = row.map(excelCellToText)
      return cells.every((cell) => cell === '') ? '' : cells.map(csvCell).join(',')
    })
    .join('\n')
}

const hasData = (rows: readonly (readonly unknown[])[]): boolean =>
  rows.some((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''))

async function readExcel(file: File): Promise<ReadImportResult> {
  try {
    const { default: readExcelFile } = await import('read-excel-file/browser')
    const sheets = await readExcelFile(file)
    const filled = sheets.filter((sheet) => hasData(sheet.data))
    // Reading only the first would silently drop whatever the others hold.
    if (filled.length > 1) {
      return { ok: false, reason: `This workbook has ${filled.length} sheets with data. Keep the invoices on one sheet and upload again.` }
    }
    return { ok: true, text: excelRowsToCsv(filled[0]?.data ?? []) }
  } catch {
    return { ok: false, reason: 'We could not read this Excel file. Open it and save it again as .xlsx or CSV.' }
  }
}

async function readCsv(file: File): Promise<ReadImportResult> {
  const text = await file.text().catch(() => null)
  if (text === null) return { ok: false, reason: 'We could not read this file. Check it is still there and try again.' }
  // A file in an older encoding decodes with this mark where each accented letter was,
  // and a mangled customer or product name would then fail to match.
  if (text.includes('\uFFFD')) {
    return { ok: false, reason: 'This CSV is not saved as UTF-8, so some names cannot be read. Save it as "CSV UTF-8" and upload again.' }
  }
  return { ok: true, text }
}

function withinLimits(result: ReadImportResult): ReadImportResult {
  if (!result.ok) return result
  if (new Blob([result.text]).size > MAX_IMPORT_BYTES) return { ok: false, reason: TOO_LARGE }
  const rows = countDataRows(result.text)
  return rows > MAX_IMPORT_ROWS ? { ok: false, reason: tooManyRows(rows) } : result
}

export async function readImportFile(file: File): Promise<ReadImportResult> {
  const extension = extensionOf(file.name)
  if (extension === 'xls') {
    return { ok: false, reason: 'Old .xls files cannot be read. Open it in Excel and save it as .xlsx or CSV.' }
  }
  if (extension !== 'csv' && extension !== 'xlsx') {
    return { ok: false, reason: 'Choose a CSV or Excel (.xlsx) file.' }
  }
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, reason: TOO_LARGE }
  return withinLimits(extension === 'xlsx' ? await readExcel(file) : await readCsv(file))
}
