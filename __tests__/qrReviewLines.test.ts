import { describe, expect, it } from 'vitest'
import {
  QR_MAX_LINE_QUANTITY,
  clampQuantity,
  itemsToSend,
  lineKey,
  sameLines,
  toLineInputs,
  withQuantity,
  withoutLine,
} from '@/lib/qr/reviewLines'
import type { QrOrderRequestItem } from '@/types'

const stored: QrOrderRequestItem[] = [
  { productId: 1, quantity: 2, packSize: null, uomId: null, productName: 'Cream', productSku: 'C-1' },
  { productId: 2, quantity: 3, packSize: 12, uomId: 5, productName: 'Butter' },
]

describe('toLineInputs', () => {
  it('keeps only what the server takes -- the name snapshot is never an input', () => {
    expect(toLineInputs(stored)).toEqual([
      { productId: 1, quantity: 2, packSize: null, uomId: null },
      { productId: 2, quantity: 3, packSize: 12, uomId: 5 },
    ])
  })
})

describe('sameLines / itemsToSend', () => {
  const original = toLineInputs(stored)

  it('an untouched draft sends nothing: "as requested"', () => {
    expect(itemsToSend(original, [...original])).toBeUndefined()
  })

  it('a changed quantity sends the whole edited list', () => {
    const draft = withQuantity(original, 0, 5)
    expect(itemsToSend(original, draft)).toEqual([
      { productId: 1, quantity: 5, packSize: null, uomId: null },
      { productId: 2, quantity: 3, packSize: 12, uomId: 5 },
    ])
  })

  it('a removed line counts as an edit', () => {
    expect(itemsToSend(original, withoutLine(original, 1))).toEqual([original[0]])
  })

  it('an emptied draft is sent as [] (the modal refuses to approve it before this)', () => {
    expect(itemsToSend(original, [])).toEqual([])
  })

  it('treats a missing uomId/packSize the same as null', () => {
    expect(sameLines([{ productId: 1, quantity: 1 }], [{ productId: 1, quantity: 1, uomId: null, packSize: null }])).toBe(true)
  })

  it('a put-back edit is no edit', () => {
    expect(itemsToSend(original, withQuantity(withQuantity(original, 0, 9), 0, 2))).toBeUndefined()
  })
})

describe('immutability', () => {
  it('never mutates the list it is given', () => {
    const original = toLineInputs(stored)
    const frozen = JSON.stringify(original)
    withQuantity(original, 0, 7)
    withoutLine(original, 0)
    expect(JSON.stringify(original)).toBe(frozen)
  })

  it('an out-of-range index changes nothing', () => {
    const original = toLineInputs(stored)
    expect(withQuantity(original, 9, 4)).toEqual(original)
    expect(withoutLine(original, 9)).toEqual(original)
  })
})

describe('clampQuantity', () => {
  it('keeps a quantity to a whole number the server accepts', () => {
    expect(clampQuantity(0)).toBe(1)
    expect(clampQuantity(-3)).toBe(1)
    expect(clampQuantity(2.6)).toBe(3)
    expect(clampQuantity(Number.NaN)).toBe(1)
    expect(clampQuantity(QR_MAX_LINE_QUANTITY + 1)).toBe(QR_MAX_LINE_QUANTITY)
  })
})

describe('lineKey', () => {
  it('tells apart the same product ordered in different units', () => {
    expect(lineKey({ productId: 1, uomId: 2, packSize: null })).not.toBe(lineKey({ productId: 1, uomId: 3, packSize: null }))
    expect(lineKey({ productId: 1 })).toBe(lineKey({ productId: 1, uomId: null, packSize: null }))
  })
})
