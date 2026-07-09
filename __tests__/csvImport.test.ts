import { describe, it, expect } from 'vitest'

import { parseCsv, toRecords, normalizeHeader } from '../lib/csvImport'

describe('parseCsv', () => {
  it('parses a simple comma-delimited file', () => {
    const result = parseCsv('h1,h2\nv1,v2')
    expect(result.headers).toEqual(['h1', 'h2'])
    expect(result.rows).toEqual([['v1', 'v2']])
  })

  it('strips a leading BOM', () => {
    const result = parseCsv('﻿h1,h2\nv1,v2')
    expect(result.headers).toEqual(['h1', 'h2'])
  })

  it('handles CRLF line endings', () => {
    const result = parseCsv('h1,h2\r\nv1,v2\r\n')
    expect(result.headers).toEqual(['h1', 'h2'])
    expect(result.rows).toEqual([['v1', 'v2']])
  })

  it('handles bare LF line endings with no trailing newline', () => {
    const result = parseCsv('h1,h2\nv1,v2')
    expect(result.rows).toEqual([['v1', 'v2']])
  })

  it('ignores a single trailing empty line', () => {
    const result = parseCsv('h1,h2\nv1,v2\n')
    expect(result.rows).toHaveLength(1)
  })

  it('ignores multiple trailing blank lines', () => {
    const result = parseCsv('h1,h2\nv1,v2\n\n\n')
    expect(result.rows).toHaveLength(1)
  })

  it('parses a quoted field containing a comma', () => {
    const result = parseCsv('h1,h2\n"a,b",c')
    expect(result.rows).toEqual([['a,b', 'c']])
  })

  it('parses a quoted field containing an embedded newline', () => {
    const result = parseCsv('h1,h2\n"line1\nline2",v2')
    expect(result.rows).toEqual([['line1\nline2', 'v2']])
  })

  it('unescapes doubled quotes inside a quoted field', () => {
    const result = parseCsv('h1,h2\n"a""b",c')
    expect(result.rows).toEqual([['a"b', 'c']])
  })

  it('pads ragged short rows with empty strings to header width', () => {
    const result = parseCsv('h1,h2,h3\nv1,v2')
    expect(result.rows).toEqual([['v1', 'v2', '']])
  })

  it('truncates ragged long rows to header width', () => {
    const result = parseCsv('h1,h2\nv1,v2,v3')
    expect(result.rows).toEqual([['v1', 'v2']])
  })

  it('documented behavior: an unescaped quote toggles quote-mode wherever it appears, so a malformed quote like "a"b concatenates', () => {
    const result = parseCsv('h1,h2\n"a"b,c')
    expect(result.rows).toEqual([['ab', 'c']])
  })

  it('throws a clear error for a semicolon-delimited file', () => {
    expect(() => parseCsv('h1;h2;h3\nv1;v2;v3')).toThrow(
      'expected comma-delimited CSV, found semicolons',
    )
  })

  it('does not misfire the semicolon check when commas are present', () => {
    expect(() => parseCsv('h1,h2\nv1;still,v2')).not.toThrow()
  })

  it('exposes a warning when the text contains a mojibake replacement character', () => {
    const result = parseCsv('h1,h2\n�,v2')
    expect(result.warnings.length).toBeGreaterThan(0)
    // still parses the data despite the warning
    expect(result.rows).toEqual([['�', 'v2']])
  })

  it('has no warnings for clean input', () => {
    const result = parseCsv('h1,h2\nv1,v2')
    expect(result.warnings).toEqual([])
  })
})

describe('normalizeHeader', () => {
  it('lowercases and trims', () => {
    expect(normalizeHeader(' SKU ')).toBe('sku')
  })

  it('converts spaces to underscores', () => {
    expect(normalizeHeader('Supplier Name')).toBe('supplier_name')
  })

  it('collapses repeated spaces/underscores into one underscore', () => {
    expect(normalizeHeader('Product   Name')).toBe('product_name')
    expect(normalizeHeader('foo__bar')).toBe('foo_bar')
  })

  it('is a no-op on an already-normalized header', () => {
    expect(normalizeHeader('already_snake_case')).toBe('already_snake_case')
  })
})

describe('toRecords', () => {
  it('builds header-keyed records with normalized keys and trimmed values', () => {
    const parsed = parseCsv('SKU, Price\nABC-1, 4.90\n')
    const records = toRecords(parsed)
    expect(records).toEqual([{ sku: 'ABC-1', price: '4.90' }])
  })

  it('produces one record per row, empty string for padded ragged fields', () => {
    const parsed = parseCsv('a,b,c\n1,2')
    const records = toRecords(parsed)
    expect(records).toEqual([{ a: '1', b: '2', c: '' }])
  })
})
