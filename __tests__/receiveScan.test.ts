// Receiving is the one surface where all three namespaces turn up in the same
// minute, so it is the one where "what did that code mean" has to be answered
// out loud rather than guessed.

import { describe, it, expect } from 'vitest'
import { buildScanIndex } from '@/lib/scan/resolveScan'
import { describeReceiveRefusal, resolveReceiveScan } from '@/lib/scan/receiveScan'

const index = buildScanIndex({
  products: [
    { id: 10, sku: 'AYM-CHL-001', name: 'Sweet Chilli Sauce 435ml', barcode: '9312345678907' },
    { id: 11, sku: 'V2F-MINCE-001', name: 'Plant-Based Mince 1kg', barcode: '012345678905' },
  ],
  locations: [
    { id: 1, code: 'MAIN-F01-R05', name: 'F01 right bay 05', isActive: true },
    { id: 2, code: 'MAIN', name: 'Main Warehouse', isActive: true },
  ],
  handlingUnits: [{ id: 99, code: 'HU-000242' }],
})

const WAREHOUSES = new Map([['MAIN', 1], ['WIE-DEMO', 2]])

describe('resolveReceiveScan', () => {
  it('resolves our own SKU to the product', () => {
    const t = resolveReceiveScan('AYM-CHL-001', index, WAREHOUSES)
    expect(t).toMatchObject({ kind: 'product', matchedOn: 'sku' })
    if (t.kind === 'product') expect(t.product.id).toBe(10)
  })

  it("resolves a supplier's carton barcode to the product", () => {
    const t = resolveReceiveScan('9312345678907', index, WAREHOUSES)
    expect(t).toMatchObject({ kind: 'product', matchedOn: 'barcode' })
  })

  it('folds a UPC-A carton onto the EAN-13 the product stores', () => {
    // The product holds the 12-digit spelling; the gun reads it as 13 with the
    // leading zero. Same number, and barcodeVariants is what makes them agree.
    const t = resolveReceiveScan('0012345678905', index, WAREHOUSES)
    expect(t).toMatchObject({ kind: 'product' })
    if (t.kind === 'product') expect(t.product.id).toBe(11)
  })

  it('tolerates the control characters a wedge gun appends', () => {
    const t = resolveReceiveScan('  aym-chl-001\r\n', index, WAREHOUSES)
    expect(t).toMatchObject({ kind: 'product' })
  })

  it('resolves a site root to a destination', () => {
    // MAIN is BOTH a locations row and a warehouse root. The warehouse reading
    // has to win, or the destination could never be scanned at all.
    const t = resolveReceiveScan('MAIN', index, WAREHOUSES)
    expect(t).toEqual({ kind: 'warehouse', warehouseId: 1, code: 'MAIN' })
  })

  it('recognises a bin and refuses it for the right reason', () => {
    const t = resolveReceiveScan('MAIN-F01-R05', index, WAREHOUSES)
    expect(t).toEqual({ kind: 'bin', code: 'MAIN-F01-R05' })
    expect(describeReceiveRefusal(t)).toContain('Putaway')
  })

  it('recognises a pallet label and explains that receiving mints it', () => {
    const t = resolveReceiveScan('HU-000242', index, WAREHOUSES)
    expect(t).toEqual({ kind: 'handlingUnit', code: 'HU-000242' })
    expect(describeReceiveRefusal(t)).toMatch(/creates the pallet/i)
  })

  it('reports an unknown code with what it actually read', () => {
    const t = resolveReceiveScan('NOPE-1', index, WAREHOUSES)
    expect(t).toEqual({ kind: 'unknown', normalized: 'NOPE-1' })
    expect(describeReceiveRefusal(t)).toContain('NOPE-1')
  })

  it('treats blank input as nothing rather than as unknown', () => {
    expect(resolveReceiveScan('   ', index, WAREHOUSES).kind).toBe('empty')
    expect(describeReceiveRefusal({ kind: 'empty' })).toBeNull()
  })

  it('prefers the product when a code names both a product and a bin', () => {
    // At a dock the likely reading of any code is "the thing I am holding", and
    // every other candidate is refused on this screen anyway — so this resolves
    // the collision without ever choosing between two plausible intentions.
    const collide = buildScanIndex({
      products: [{ id: 20, sku: 'MAIN-F01-R05', name: 'Awkwardly named', barcode: null }],
      locations: [{ id: 1, code: 'MAIN-F01-R05', name: 'A bay', isActive: true }],
    })
    expect(resolveReceiveScan('MAIN-F01-R05', collide, new Map()).kind).toBe('product')
  })

  it('reports a genuine ambiguity between two non-product readings', () => {
    const collide = buildScanIndex({
      locations: [{ id: 1, code: 'X-1', name: 'A bay', isActive: true }],
      handlingUnits: [{ id: 2, code: 'X-1' }],
    })
    const t = resolveReceiveScan('X-1', collide, new Map())
    expect(t.kind).toBe('ambiguous')
    expect(describeReceiveRefusal(t)).toMatch(/more than one/i)
  })

  it('does not need locations in the index to resolve a destination', () => {
    // The receiving screen builds its index from the product catalogue; the
    // warehouse map is passed separately precisely so this still works.
    const productsOnly = buildScanIndex({ products: [{ id: 1, sku: 'A-1', name: 'A', barcode: null }] })
    expect(resolveReceiveScan('WIE-DEMO', productsOnly, WAREHOUSES)).toMatchObject({
      kind: 'warehouse',
      warehouseId: 2,
    })
  })
})
