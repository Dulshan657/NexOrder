// Text of a QuickBooks invoice export -> invoice lines, or a reason per row.
//
// EVERYTHING SPECIFIC TO THE FILE FORMAT LIVES HERE. The format is a best guess
// until a real export arrives, so the column names are one constant and nothing
// else in the import knows them.
//
// A ROW IS NEVER REPAIRED. A cell that is not what its column needs is reported by
// row number. A row with more filled cells than the header has columns has moved
// along (an unquoted comma), so it is an error rather than a guess at which cell
// is which. Credit notes and negative quantities are valid here: the classifier
// rejects them on mapped lines and ignores them on other brands.
//
// TWO KINDS OF BAD ROW. No invoice number, a bad date or extra cells mean the row
// cannot be trusted at all. A bad quantity or price, or a blank product, may only
// mean a freight or discount line. Whether that matters depends on whether the
// product is the tenant's, which this file cannot know, so those rows are also
// listed in `doubtfulRows` for `runImport` to decide.
//
// PURITY: no platform globals, no I/O, no clock, and no imports but types, so the
// browser, the Deno function and Vitest all load this one file.

import type { QbLine } from './types.ts'

/** The header each field is read from. Matched ignoring case and outer spaces. */
export const QB_COLUMNS = {
  invoiceNumber: 'Invoice Number',
  invoiceDate: 'Invoice Date',
  customerName: 'Customer',
  qbProductName: 'Product',
  quantity: 'Quantity',
  unitPrice: 'Unit Price',
} as const

/** Shared with `lib/readImportFile.ts`, so the browser and the server refuse alike. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 20_000

type QbField = keyof typeof QB_COLUMNS

export interface QbParseError {
  /** The file's row, counting the header as row 1. Null when the whole file is refused. */
  rowNumber: number | null
  /** Known whenever the row names one, so the whole invoice can be rejected. */
  invoiceNumber: string | null
  message: string
}

export interface QbParseResult {
  lines: QbLine[]
  errors: QbParseError[]
  /** The invoice each non-blank row names, good or bad. A row naming none is absent. */
  rowInvoice: ReadonlyMap<number, string>
  /** Rows in `errors` only for a bad quantity or price or a blank product. An unreadable
   *  value is NaN. Their structure and date are sound. */
  doubtfulRows: QbLine[]
}

interface CsvRow {
  rowNumber: number
  cells: string[]
}

interface Tokenised {
  rows: CsvRow[]
  /** The row an opening quote was never closed on, if any. */
  unclosedQuoteRow: number | null
}

// ---------------------------------------------------------------------------
// Text -> rows
// ---------------------------------------------------------------------------

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** One row's cells starting at `start`, and where the next row starts. */
function readRow(text: string, start: number): { cells: string[]; next: number; closed: boolean } {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 2
        continue
      }
      if (ch === '"') quoted = false
      else cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      const next = ch === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1
      return { cells: [...cells, cell], next, closed: true }
    } else {
      cell += ch
    }
    i += 1
  }
  return { cells: [...cells, cell], next: text.length, closed: !quoted }
}

function tokenise(rawText: string): Tokenised {
  const text = stripBom(rawText)
  const rows: CsvRow[] = []
  let position = 0
  let rowNumber = 1
  while (position < text.length) {
    const { cells, next, closed } = readRow(text, position)
    if (!closed) return { rows, unclosedQuoteRow: rowNumber }
    rows.push({ rowNumber, cells: cells.map((cell) => cell.trim()) })
    position = next
    rowNumber += 1
  }
  return { rows, unclosedQuoteRow: null }
}

const isBlank = (row: CsvRow): boolean => row.cells.every((cell) => cell === '')

/** How many rows of data the text holds: not the header, not blank rows. */
export function countDataRows(text: string): number {
  const filled = tokenise(text).rows.filter((row) => !isBlank(row))
  return Math.max(filled.length - 1, 0)
}

// ---------------------------------------------------------------------------
// Header -> which cell holds which field
// ---------------------------------------------------------------------------

type ColumnIndex = Record<QbField, number>

const fileError = (message: string): QbParseError => ({ rowNumber: null, invoiceNumber: null, message })

function headerProblems(positions: ReadonlyMap<QbField, number[]>): QbParseError[] {
  const fields = Object.keys(QB_COLUMNS) as QbField[]
  return fields.flatMap((field) => {
    const found = positions.get(field) ?? []
    if (found.length === 1) return []
    return [
      fileError(
        found.length === 0
          ? `The file has no "${QB_COLUMNS[field]}" column.`
          : `The file has more than one "${QB_COLUMNS[field]}" column.`,
      ),
    ]
  })
}

function readHeader(header: CsvRow): { columns: ColumnIndex | null; errors: QbParseError[] } {
  const fields = Object.keys(QB_COLUMNS) as QbField[]
  const titles = header.cells.map((cell) => cell.toLowerCase())
  const positions = new Map(
    fields.map((field): [QbField, number[]] => [
      field,
      titles.flatMap((title, index) => (title === QB_COLUMNS[field].toLowerCase() ? [index] : [])),
    ]),
  )
  const errors = headerProblems(positions)
  if (errors.length > 0) return { columns: null, errors }
  const entries = fields.map((field) => [field, (positions.get(field) ?? [0])[0]])
  return { columns: Object.fromEntries(entries) as ColumnIndex, errors: [] }
}

// ---------------------------------------------------------------------------
// Cells -> values
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return day >= 1 && day <= DAYS_IN_MONTH[month - 1] + (leap && month === 2 ? 1 : 0)
}

/** `DD/MM/YYYY` (one-digit day or month allowed) or `YYYY-MM-DD`, as ISO; else null. */
export function parseDateCell(text: string): string | null {
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const parts = dayFirst ? [dayFirst[3], dayFirst[2], dayFirst[1]] : iso ? [iso[1], iso[2], iso[3]] : null
  if (!parts) return null
  const [year, month, day] = parts.map(Number)
  if (!isRealCalendarDate(year, month, day)) return null
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
}

const PLAIN_NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/
const MONEY = /^(-?)\$(-?)(.*)$/

/** `(12.50)` is how an accounting export writes a credit: the value, negated. */
function readBracketed(text: string, read: (inner: string) => number | null): number | null {
  const inner = /^\((.*)\)$/.exec(text)?.[1]
  if (inner === undefined) return read(text)
  if (/[-()]/.test(inner)) return null
  const value = read(inner)
  return value === null ? null : 0 - value
}

function readUnsignedForm(text: string): number | null {
  if (!/\d/.test(text) || !PLAIN_NUMBER.test(text)) return null
  const value = Number(text.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

const parsePlainNumber = (text: string): number | null => readBracketed(text, readUnsignedForm)

function readMoneyForm(text: string): number | null {
  const money = MONEY.exec(text)
  if (!money) return parsePlainNumber(text)
  if (money[1] && money[2]) return null
  return parsePlainNumber(`${money[1] || money[2]}${money[3]}`)
}

/** `$1,234.50`, `-$5`, `$-5`, `($5)`, `$(5)` or a plain number; else null. */
const parseMoneyCell = (text: string): number | null => readBracketed(text, readMoneyForm)

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

type RowProblem = string

function shiftProblem(row: CsvRow, columnCount: number): RowProblem[] {
  const filled = row.cells.reduce((last, cell, index) => (cell === '' ? last : index + 1), 0)
  return filled > columnCount
    ? [`has ${filled} cells but the header has ${columnCount} columns; a comma in a name may need quotes`]
    : []
}

interface RowValues {
  invoiceDate: string | null
  quantity: number | null
  unitPrice: number | null
  badDate: RowProblem[]
  badValues: RowProblem[]
}

function readValues(cell: (field: QbField) => string): RowValues {
  const invoiceDate = parseDateCell(cell('invoiceDate'))
  const quantity = parsePlainNumber(cell('quantity'))
  const unitPrice = parseMoneyCell(cell('unitPrice'))
  const badDate = invoiceDate === null ? [`invoice date "${cell('invoiceDate')}" is not a date written as DD/MM/YYYY or YYYY-MM-DD`] : []
  const badValues = [
    ...(cell('qbProductName') === '' ? ['has no product'] : []),
    ...(quantity === null ? [`quantity "${cell('quantity')}" is not a number`] : []),
    ...(unitPrice === null ? [`unit price "${cell('unitPrice')}" is not an amount of money`] : []),
  ]
  return { invoiceDate, quantity, unitPrice, badDate, badValues }
}

interface RowResult {
  line: QbLine | null
  errors: QbParseError[]
  doubtful: QbLine | null
}

function parseRow(row: CsvRow, columns: ColumnIndex, columnCount: number): RowResult {
  const cell = (field: QbField): string => row.cells[columns[field]] ?? ''
  const { rowNumber } = row
  const invoiceNumber = cell('invoiceNumber')
  if (invoiceNumber === '') {
    return { line: null, doubtful: null, errors: [{ rowNumber, invoiceNumber: null, message: 'has no invoice number' }] }
  }
  const asErrors = (problems: RowProblem[]): QbParseError[] => problems.map((message) => ({ rowNumber, invoiceNumber, message }))
  const shifted = shiftProblem(row, columnCount)
  if (shifted.length > 0) return { line: null, doubtful: null, errors: asErrors(shifted) }
  const { invoiceDate, quantity, unitPrice, badDate, badValues } = readValues(cell)
  if (invoiceDate === null) return { line: null, doubtful: null, errors: asErrors([...badDate, ...badValues]) }
  const line: QbLine = {
    invoiceNumber,
    invoiceDate,
    customerName: cell('customerName'),
    qbProductName: cell('qbProductName'),
    quantity: quantity ?? Number.NaN,
    unitPrice: unitPrice ?? Number.NaN,
    rowNumber,
  }
  return badValues.length > 0
    ? { line: null, doubtful: line, errors: asErrors(badValues) }
    : { line, doubtful: null, errors: [] }
}

function invoiceOfRows(rows: readonly CsvRow[], columns: ColumnIndex): Map<number, string> {
  return new Map(
    rows.flatMap((row): Array<[number, string]> => {
      const invoiceNumber = row.cells[columns.invoiceNumber] ?? ''
      return invoiceNumber === '' ? [] : [[row.rowNumber, invoiceNumber]]
    }),
  )
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

const refused = (errors: QbParseError[]): QbParseResult => ({ lines: [], errors, rowInvoice: new Map(), doubtfulRows: [] })

export function parseInvoices(csvText: string): QbParseResult {
  const { rows, unclosedQuoteRow } = tokenise(csvText)
  if (unclosedQuoteRow !== null) {
    return refused([fileError(`A quote opened on row ${unclosedQuoteRow} is never closed, so the rows after it cannot be read.`)])
  }

  const [header, ...dataRows] = rows.filter((row) => !isBlank(row))
  if (!header) return refused([fileError('The file is empty.')])

  const { columns, errors: headerErrors } = readHeader(header)
  if (!columns) return refused(headerErrors)

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return refused([
      fileError(`The file has ${dataRows.length.toLocaleString('en-AU')} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString('en-AU')}.`),
    ])
  }

  const results = dataRows.map((row) => parseRow(row, columns, header.cells.length))
  return {
    lines: results.flatMap((result) => (result.line ? [result.line] : [])),
    errors: results.flatMap((result) => result.errors),
    rowInvoice: invoiceOfRows(dataRows, columns),
    doubtfulRows: results.flatMap((result) => (result.doubtful ? [result.doubtful] : [])),
  }
}
