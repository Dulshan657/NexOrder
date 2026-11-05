import { describe, expect, it } from 'vitest'

import {
  MAX_IMPORT_ROWS,
  QB_COLUMNS,
  countDataRows,
  parseInvoices,
} from '../../supabase/functions/_shared/qbImport/parseInvoices'

const HEADER = 'Invoice Number,Invoice Date,Customer,Product,Quantity,Unit Price'
const csv = (...rows: string[]): string => [HEADER, ...rows].join('\n')

describe('parseInvoices', () => {
  it('reads the six columns, a byte order mark, quoted commas and money', () => {
    const text = `\uFEFF${HEADER}\r\n"INV-1",05/03/2026,"Harbour Bistro, Pier 2","Widget ""Large"" Box","1,200","$1,234.50"\r\n`
    const { lines, errors } = parseInvoices(text)

    expect(errors).toEqual([])
    expect(lines).toEqual([
      {
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-03-05',
        customerName: 'Harbour Bistro, Pier 2',
        qbProductName: 'Widget "Large" Box',
        quantity: 1200,
        unitPrice: 1234.5,
        rowNumber: 2,
      },
    ])
  })

  it('reads both date formats and refuses an ambiguous or unreal date', () => {
    const dates = (date: string) => parseInvoices(csv(`INV-1,${date},Cafe,Widget,1,2.00`))

    expect(dates('5/3/2026').lines[0].invoiceDate).toBe('2026-03-05')
    expect(dates('05/03/2026').lines[0].invoiceDate).toBe('2026-03-05')
    expect(dates('2026-03-05').lines[0].invoiceDate).toBe('2026-03-05')
    expect(dates('29/02/2028').lines[0].invoiceDate).toBe('2028-02-29')

    for (const bad of ['13/13/2026', '31/02/2026', '29/02/2026', '2026-13-01', '2026-3-5', '05/03/26', '05-03-2026', 'March 5', '']) {
      const { lines, errors } = dates(bad)
      expect(lines, bad).toEqual([])
      expect(errors, bad).toHaveLength(1)
      expect(errors[0], bad).toMatchObject({ rowNumber: 2, invoiceNumber: 'INV-1' })
    }
  })

  it('refuses a missing column by name', () => {
    const { lines, errors } = parseInvoices('Invoice Number,Invoice Date,Customer,Product\nINV-1,05/03/2026,Cafe,Widget')

    expect(lines).toEqual([])
    const messages = errors.map((error) => error.message).join('\n')
    expect(messages).toContain('Quantity')
    expect(messages).toContain('Unit Price')
    expect(messages).not.toContain('Customer')
    expect(errors.every((error) => error.rowNumber === null)).toBe(true)
  })

  it('reports a bad row by number without shifting columns', () => {
    const { lines, errors, rowInvoice } = parseInvoices(
      csv(
        'INV-1,05/03/2026,Cafe,Widget,3,2.00',
        // An unquoted comma in the customer: every later cell has moved along one.
        'INV-2,05/03/2026,Cafe, Pier 2,Widget,3,2.00',
        '',
        'INV-3,05/03/2026,Cafe,Widget,lots,2.00',
        'INV-4,05/03/2026,Cafe,Widget,3,two dollars',
      ),
    )

    expect(lines.map((line) => line.rowNumber)).toEqual([2])
    expect(errors.map((error) => [error.rowNumber, error.invoiceNumber])).toEqual([
      [3, 'INV-2'],
      [5, 'INV-3'],
      [6, 'INV-4'],
    ])
    expect(errors[1].message).toContain('lots')
    expect(errors[2].message).toContain('two dollars')
    expect(rowInvoice.get(5)).toBe('INV-3')
  })

  it('reports a row with no invoice number', () => {
    const { lines, errors, rowInvoice } = parseInvoices(
      csv('INV-1,05/03/2026,Cafe,Widget,3,2.00', ' ,05/03/2026,Cafe,Gadget,1,2.00', 'INV-1,05/03/2026,Cafe,Sprocket,1,2.00'),
    )

    expect(lines.map((line) => [line.invoiceNumber, line.qbProductName])).toEqual([
      ['INV-1', 'Widget'],
      ['INV-1', 'Sprocket'],
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ rowNumber: 3, invoiceNumber: null })
    expect(errors[0].message).toMatch(/invoice number/i)
    expect(rowInvoice.has(3)).toBe(false)
  })

  it('matches columns ignoring case and outer spaces, in any order, and ignores unknown ones', () => {
    const { lines, errors } = parseInvoices(
      ' unit price ,MEMO,quantity,PRODUCT, customer,invoice date,Invoice Number\n$2.50,"note, here",4,Widget,Cafe,2026-03-05,INV-1',
    )
    expect(errors).toEqual([])
    expect(lines[0]).toMatchObject({ invoiceNumber: 'INV-1', quantity: 4, unitPrice: 2.5, qbProductName: 'Widget', customerName: 'Cafe' })
  })

  it('refuses a column named twice rather than guessing which one to read', () => {
    const { lines, errors } = parseInvoices(`${HEADER},Customer\nINV-1,05/03/2026,Cafe,Widget,1,2.00,Other`)
    expect(lines).toEqual([])
    expect(errors[0].message).toContain('Customer')
  })

  it('keeps credit notes and negative quantities as lines for the classifier', () => {
    const { lines, errors } = parseInvoices(csv('CN-1,05/03/2026,Cafe,Widget,-3,"-$1,250.00"'))
    expect(errors).toEqual([])
    expect(lines[0]).toMatchObject({ quantity: -3, unitPrice: -1250 })
  })

  it('keeps a fractional quantity as a line for the classifier', () => {
    expect(parseInvoices(csv('INV-1,05/03/2026,Cafe,Widget,1.5,2')).lines[0].quantity).toBe(1.5)
  })

  it('refuses money and quantities that only look like numbers', () => {
    for (const bad of ['1e3', '1,2,3', '12,34', '$', '--5', 'Infinity', '0x10', '1.2.3']) {
      const { errors } = parseInvoices(csv(`INV-1,05/03/2026,Cafe,Widget,1,"${bad}"`))
      expect(errors, bad).toHaveLength(1)
      expect(errors[0].message, bad).toContain(bad)
    }
    expect(parseInvoices(csv('INV-1,05/03/2026,Cafe,Widget,$3,1')).errors).toHaveLength(1)
  })

  it('reports a line with no product rather than skipping it unnamed', () => {
    const { lines, errors } = parseInvoices(csv('INV-1,05/03/2026,Cafe,,3,2.00'))
    expect(lines).toEqual([])
    expect(errors[0]).toMatchObject({ rowNumber: 2, invoiceNumber: 'INV-1' })
  })

  it('leaves a blank customer for the classifier, which ignores it on other brands', () => {
    const { lines, errors } = parseInvoices(csv('INV-1,05/03/2026,,Widget,3,2.00'))
    expect(errors).toEqual([])
    expect(lines[0].customerName).toBe('')
  })

  it('skips blank rows while keeping the real row numbers, and allows trailing empty cells', () => {
    const { lines, errors } = parseInvoices(csv(',,,,,', 'INV-1,05/03/2026,Cafe,Widget,3,2.00,,,', '', 'INV-1,05/03/2026,Cafe,Gadget,1,2.00'))
    expect(errors).toEqual([])
    expect(lines.map((line) => line.rowNumber)).toEqual([3, 5])
  })

  it('counts a quoted line break as part of its row, not a new row', () => {
    const { lines, errors } = parseInvoices(csv('INV-1,05/03/2026,"Cafe\nPier 2",Widget,3,2.00', 'INV-2,05/03/2026,Cafe,Widget,3,2.00'))
    expect(errors).toEqual([])
    expect(lines.map((line) => [line.invoiceNumber, line.rowNumber])).toEqual([
      ['INV-1', 2],
      ['INV-2', 3],
    ])
  })

  it('refuses a quote that is never closed rather than swallowing the rows after it', () => {
    const { lines, errors } = parseInvoices(csv('INV-1,05/03/2026,"Cafe,Widget,3,2.00', 'INV-2,05/03/2026,Cafe,Widget,3,2.00'))
    expect(lines).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].rowNumber).toBeNull()
    expect(errors[0].message).toMatch(/quote/i)
    expect(errors[0].message).toContain('row 2')
  })

  it('names an empty file, and reads a header with no rows as nothing to do', () => {
    for (const empty of ['', '\uFEFF', '\r\n\r\n', ' , ,\n']) {
      const { lines, errors } = parseInvoices(empty)
      expect(lines).toEqual([])
      expect(errors[0].rowNumber).toBeNull()
      expect(errors[0].message).toMatch(/empty/i)
    }
    expect(parseInvoices(HEADER)).toMatchObject({ lines: [], errors: [] })
  })

  it('refuses a file over the row limit', () => {
    const row = 'INV-1,05/03/2026,Cafe,Widget,3,2.00'
    const { lines, errors } = parseInvoices(csv(...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => row)))
    expect(lines).toEqual([])
    expect(errors[0].rowNumber).toBeNull()
    expect(errors[0].message).toContain('20,000')
    expect(parseInvoices(csv(...Array.from({ length: MAX_IMPORT_ROWS }, () => row))).errors).toEqual([])
  })

  it('counts rows without the header or blank rows', () => {
    expect(countDataRows(csv('a,b', '', 'c,d'))).toBe(2)
    expect(countDataRows('')).toBe(0)
  })

  it('keeps the six column names in one exported constant', () => {
    expect(Object.values(QB_COLUMNS)).toEqual(['Invoice Number', 'Invoice Date', 'Customer', 'Product', 'Quantity', 'Unit Price'])
  })
})
