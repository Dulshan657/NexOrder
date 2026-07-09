// RFC-4180-ish CSV reader mirroring the quoting rules of the writer in
// `lib/csvExport.ts` (double-quoted fields, `""` as an escaped quote).
//
// Behavior decisions (documented + covered by __tests__/csvImport.test.ts):
//  - A leading BOM is stripped before parsing.
//  - CRLF, LF, and CR record separators are all accepted.
//  - A single unescaped `"` toggles quote-mode wherever it appears in a
//    field (not just at the start), so a malformed quote like `"a"b`
//    concatenates to `ab` rather than throwing — CSV exports from Excel/
//    Sheets are messy and we'd rather degrade gracefully than hard-fail
//    the whole import over one stray quote.
//  - Ragged rows are normalized to the header width: short rows are padded
//    with '', long rows are truncated.
//  - Trailing blank line(s) from a final newline are dropped.
//  - A header line with zero commas but at least one semicolon is almost
//    certainly a semicolon-delimited (Excel regional-settings) export —
//    that's rejected with a clear error rather than parsed as one giant
//    column.
//  - A U+FFFD replacement character anywhere in the text usually means the
//    file was decoded with the wrong charset (mojibake). That's surfaced as
//    a non-fatal warning (`warnings`), not a thrown error, since the data
//    may still be usable.

const BOM = '﻿'
const REPLACEMENT_CHAR = '�'

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  warnings: string[]
}

function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let sawAnyChar = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    sawAnyChar = true
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += ch
    }
  }

  if (sawAnyChar && (field !== '' || record.length > 0)) {
    record.push(field)
    records.push(record)
  }

  // Drop any trailing record(s) that are just a single empty field — these
  // come from trailing newline(s) at the end of the file, not real rows.
  while (records.length > 0) {
    const last = records[records.length - 1]
    if (last.length === 1 && last[0] === '') {
      records.pop()
    } else {
      break
    }
  }

  return records
}

function padRow(row: string[], width: number): string[] {
  if (row.length === width) return row
  if (row.length > width) return row.slice(0, width)
  return [...row, ...Array(width - row.length).fill('')]
}

export function parseCsv(text: string): ParsedCsv {
  const stripped = text.startsWith(BOM) ? text.slice(1) : text

  const headerLine = stripped.split(/\r\n|\r|\n/, 1)[0] ?? ''
  const commaCount = (headerLine.match(/,/g) ?? []).length
  const semicolonCount = (headerLine.match(/;/g) ?? []).length
  if (commaCount === 0 && semicolonCount >= 1) {
    throw new Error('expected comma-delimited CSV, found semicolons')
  }

  const warnings: string[] = []
  if (stripped.includes(REPLACEMENT_CHAR)) {
    warnings.push('File may contain mojibake (invalid character encoding detected).')
  }

  const [headers = [], ...rows] = parseRecords(stripped)
  const width = headers.length
  return { headers, rows: rows.map((row) => padRow(row, width)), warnings }
}

/** Case/space/underscore-insensitive header canonicalization, e.g. "Supplier Name" -> "supplier_name". */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, '_')
}

/** Header-keyed records: keys normalized via `normalizeHeader`, values trimmed. */
export function toRecords(parsed: ParsedCsv): Record<string, string>[] {
  const keys = parsed.headers.map(normalizeHeader)
  return parsed.rows.map((row) => {
    const rec: Record<string, string> = {}
    keys.forEach((key, i) => {
      rec[key] = (row[i] ?? '').trim()
    })
    return rec
  })
}
