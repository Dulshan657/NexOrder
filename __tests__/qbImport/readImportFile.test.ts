// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseInvoices,
} from '../../supabase/functions/_shared/qbImport/parseInvoices'
import { IMPORT_PO_TEMPLATE_HEADERS, IMPORT_PO_TEMPLATE_ROWS, readImportFile } from '../../lib/readImportFile'
import { buildCsv } from '../../lib/csvExport'

// A tiny made-up workbook. Its dates are true Excel dates, one built-in format and
// one custom day-first format; row 3 is blank; one date is typed as text.
const fixture = (): File =>
  new File([readFileSync(join(process.cwd(), '__tests__', 'fixtures', 'import-po-sample.xlsx'))], 'sample.xlsx')

const SAME_DATA_AS_CSV = [
  'Invoice Number,Invoice Date,Customer,Product,Quantity,Unit Price',
  'INV-1001,2026-03-05,"Harbour Bistro, Pier 2","Widget ""Large"" Box",3,1234.5',
  '',
  'INV-1001,2026-03-05,"Harbour Bistro, Pier 2",Gadget,12,2.25',
  'INV-1002,06/03/2026,Corner Cafe,Widget,1,0.5',
].join('\n')

const expectText = async (file: File): Promise<string> => {
  const result = await readImportFile(file)
  if (result.ok === false) throw new Error(`refused: ${result.reason}`)
  return result.text
}

const expectReason = async (file: File): Promise<string> => {
  const result = await readImportFile(file)
  if (result.ok === true) throw new Error('expected a refusal')
  return result.reason
}

describe('readImportFile', () => {
  it('gives the same text for Excel and CSV, including a true Excel date', async () => {
    const excel = await expectText(fixture())
    const plain = await expectText(new File([SAME_DATA_AS_CSV], 'sample.csv', { type: 'text/csv' }))

    expect(excel).toBe(plain)
    expect(excel).toContain('2026-03-05')

    const { lines, errors } = parseInvoices(excel)
    expect(errors).toEqual([])
    expect(lines.map((line) => [line.rowNumber, line.invoiceDate, line.quantity, line.unitPrice])).toEqual([
      [2, '2026-03-05', 3, 1234.5],
      [4, '2026-03-05', 12, 2.25],
      [5, '2026-03-06', 1, 0.5],
    ])
  })

  it('refuses a file over the size or row limit', async () => {
    const tooBig = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'big.csv')
    expect(await expectReason(tooBig)).toMatch(/5 MB/)
    expect(await expectReason(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'big.xlsx'))).toMatch(/5 MB/)

    const header = 'Invoice Number,Invoice Date,Customer,Product,Quantity,Unit Price'
    const row = 'INV-1,05/03/2026,Cafe,Widget,3,2.00'
    const rows = (count: number) => [header, ...Array.from({ length: count }, () => row)].join('\n')

    expect(await expectReason(new File([rows(MAX_IMPORT_ROWS + 1)], 'long.csv'))).toMatch(/20,000/)
    expect(await expectText(new File([rows(MAX_IMPORT_ROWS)], 'fits.csv'))).toContain(row)
  })

  it('refuses an old .xls with a message saying what to do', async () => {
    expect(await expectReason(new File(['x'], 'old.xls'))).toMatch(/\.xlsx/)
    expect(await expectReason(new File(['x'], 'OLD.XLS'))).toMatch(/\.xlsx/)
  })

  it('refuses any other kind of file', async () => {
    expect(await expectReason(new File(['x'], 'notes.pdf'))).toMatch(/CSV|Excel/i)
  })

  it('accepts an upper-case extension', async () => {
    expect(await expectText(new File(['a,b'], 'SAMPLE.CSV'))).toBe('a,b')
  })

  it('refuses a damaged Excel file with a reason rather than throwing', async () => {
    expect(await expectReason(new File(['this is not a workbook'], 'broken.xlsx'))).toMatch(/could not read/i)
  })

  it('refuses a CSV that is not UTF-8 rather than mangling names', async () => {
    const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x31])
    expect(await expectReason(new File([latin1], 'old.csv'))).toMatch(/UTF-8/)
  })

  it('offers a template that parses cleanly', () => {
    const { lines, errors } = parseInvoices(buildCsv(IMPORT_PO_TEMPLATE_HEADERS, IMPORT_PO_TEMPLATE_ROWS))
    expect(errors).toEqual([])
    expect(lines.length).toBeGreaterThan(0)
  })
})
