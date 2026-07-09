import { describe, it, expect } from 'vitest'

import { parseFileToRecords, stripRowId, MAX_IMPORT_FILE_SIZE_BYTES } from '../components/admin/import/csvImportShared'

function makeFakeFile(opts: { name: string; size: number; text: string }): File {
  let textWasRead = false
  const file = {
    name: opts.name,
    size: opts.size,
    text: async () => {
      textWasRead = true
      return opts.text
    },
    get wasRead() {
      return textWasRead
    },
  }
  return file as unknown as File
}

describe('parseFileToRecords file-size guard (FIX 6)', () => {
  it('rejects a file over the size cap before ever calling file.text()', async () => {
    const file = makeFakeFile({
      name: 'huge.csv',
      size: MAX_IMPORT_FILE_SIZE_BYTES + 1,
      text: 'sku,name\nAYM-1,Test\n',
    })

    await expect(parseFileToRecords(file)).rejects.toThrow(/10MB/)
    expect((file as unknown as { wasRead: boolean }).wasRead).toBe(false)
  })

  it('accepts a file at exactly the size cap', async () => {
    const file = makeFakeFile({
      name: 'ok.csv',
      size: MAX_IMPORT_FILE_SIZE_BYTES,
      text: 'sku,name\nAYM-1,Test\n',
    })

    const result = await parseFileToRecords(file)
    expect(result.records).toHaveLength(1)
  })
})

describe('parseFileToRecords __rowId tagging (FIX 6)', () => {
  it('tags every parsed record with a unique __rowId', async () => {
    const file = makeFakeFile({
      name: 'multi.csv',
      size: 100,
      text: 'sku,name\nAYM-1,First\nAYM-2,Second\nAYM-3,Third\n',
    })

    const result = await parseFileToRecords(file)
    expect(result.records).toHaveLength(3)
    const rowIds = result.records.map((r) => r.__rowId)
    expect(new Set(rowIds).size).toBe(3) // all unique
    rowIds.forEach((id) => expect(typeof id).toBe('string'))
  })

  it('keeps the underlying CSV fields intact alongside __rowId', async () => {
    const file = makeFakeFile({ name: 'one.csv', size: 50, text: 'sku,name\nAYM-1,Widget\n' })
    const result = await parseFileToRecords(file)
    expect(result.records[0]).toMatchObject({ sku: 'AYM-1', name: 'Widget' })
    expect(result.records[0]).toHaveProperty('__rowId')
  })
})

describe('stripRowId', () => {
  it('removes __rowId but keeps every other field', () => {
    const record = { sku: 'AYM-1', name: 'Test', __rowId: '3' }
    const stripped = stripRowId(record)
    expect(stripped).toEqual({ sku: 'AYM-1', name: 'Test' })
    expect(stripped).not.toHaveProperty('__rowId')
  })

  it('is a no-op on a record without __rowId', () => {
    const record = { sku: 'AYM-1', name: 'Test' }
    expect(stripRowId(record)).toEqual(record)
  })
})
