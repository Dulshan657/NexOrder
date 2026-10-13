// describeShortage -- the words an approver reads when a held order asks for more
// than is in stock.
//
// The server counts stock in BASE units ("42 of X available, 48 requested") while
// the line's stepper counts in whatever the kitchen ordered in (4 cartons of 12).
// These pin the translation: the same shortage said in the line's own unit, with the
// base-unit figure kept in brackets so the two readings can be checked against each
// other, plus the largest quantity that WOULD fit (the one-tap "Set to N" fix).

import { describe, expect, it } from 'vitest'

import { describeShortage } from '@/lib/qr/describeShortage'

const NAME = 'Rice Noodles 200g'

const carton = (quantity: number, packSize = 12) => ({ quantity, packSize, uomId: null })
const loose = (quantity: number) => ({ quantity, packSize: null, uomId: null })

describe('describeShortage: a carton line', () => {
  it('says it in cartons, keeps the units, and offers the cartons that fit', () => {
    const d = describeShortage({ productName: NAME, available: 42, requested: 48, lines: [carton(4)] })

    expect(d.headline).toBe(
      'Only 3 cartons of Rice Noodles 200g in stock (42 units). This order asks for 4 cartons (48 units).',
    )
    expect(d.lineNote).toBe('Only 3 cartons in stock (42 units)')
    expect(d.maxQty).toBe(3)
  })

  it('uses the singular for exactly one', () => {
    const d = describeShortage({ productName: NAME, available: 14, requested: 24, lines: [carton(2)] })

    expect(d.headline).toBe(
      'Only 1 carton of Rice Noodles 200g in stock (14 units). This order asks for 2 cartons (24 units).',
    )
    expect(d.lineNote).toBe('Only 1 carton in stock (14 units)')
    expect(d.maxQty).toBe(1)
  })

  it('uses the singular when the order asks for one carton and the shelf has less than one', () => {
    const d = describeShortage({ productName: NAME, available: 5, requested: 12, lines: [carton(1)] })

    expect(d.headline).toBe(
      'None of Rice Noodles 200g in stock as full cartons (5 units). This order asks for 1 carton (12 units).',
    )
  })

  it('floors the cartons: 42 units is three whole cartons of 12, never 3.5', () => {
    const d = describeShortage({ productName: NAME, available: 47, requested: 48, lines: [carton(4)] })

    expect(d.maxQty).toBe(3)
  })

  it('says there are no FULL cartons, and offers removal, when the stock is under one carton', () => {
    const d = describeShortage({ productName: NAME, available: 6, requested: 48, lines: [carton(4)] })

    expect(d.headline).toBe(
      'None of Rice Noodles 200g in stock as full cartons (6 units). This order asks for 4 cartons (48 units).',
    )
    expect(d.lineNote).toBe('No full cartons in stock (6 units)')
    expect(d.maxQty).toBe(0)
  })
})

describe('describeShortage: the line\'s own unit of measure', () => {
  const boxes = [
    { id: 5, code: 'box', factorToBase: 12, isBase: false },
    { id: 1, code: 'each', factorToBase: 1, isBase: true },
  ]

  it('uses the UOM\'s name, pluralised, instead of "carton"', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 4, packSize: 12, uomId: 5 }],
      uoms: boxes,
    })

    expect(d.headline).toBe(
      'Only 3 boxes of Rice Noodles 200g in stock (42 units). This order asks for 4 boxes (48 units).',
    )
    expect(d.lineNote).toBe('Only 3 boxes in stock (42 units)')
    expect(d.maxQty).toBe(3)
  })

  it('takes the factor from the UOM when the line carries no packSize, as the server does', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 4, packSize: null, uomId: 5 }],
      uoms: boxes,
    })

    expect(d.lineNote).toBe('Only 3 boxes in stock (42 units)')
    expect(d.maxQty).toBe(3)
  })

  it('lets the UOM win over a stale packSize', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 4, packSize: 6, uomId: 5 }],
      uoms: boxes,
    })

    // 4 x 12 matches the 48 the server counted; 4 x 6 would not.
    expect(d.maxQty).toBe(3)
  })

  it('reads the base UOM as plain units', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 48, packSize: null, uomId: 1 }],
      uoms: boxes,
    })

    expect(d.lineNote).toBe('Only 42 units in stock')
    expect(d.maxQty).toBe(42)
  })

  it('falls back to the line\'s packSize, and "carton", when the UOM is not in the list', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 4, packSize: 12, uomId: 99 }],
      uoms: boxes,
    })

    expect(d.lineNote).toBe('Only 3 cartons in stock (42 units)')
  })

  it('falls back to "carton" when the UOM has no usable name', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 48,
      lines: [{ quantity: 4, packSize: 12, uomId: 5 }],
      uoms: [{ id: 5, code: '   ', factorToBase: 12, isBase: false }],
    })

    expect(d.lineNote).toBe('Only 3 cartons in stock (42 units)')
  })

  it.each([
    ['case', 'cases'],
    ['pallet', 'pallets'],
    ['box', 'boxes'],
    ['tray', 'trays'],
    ['pack', 'packs'],
    ['bunch', 'bunches'],
    ['berry', 'berries'],
    ['PCS', 'PCS'],
    ['BOX', 'BOX'],
  ])('pluralises %s as %s', (code, plural) => {
    const d = describeShortage({
      productName: NAME,
      available: 30,
      requested: 48,
      lines: [{ quantity: 4, packSize: 12, uomId: 7 }],
      uoms: [{ id: 7, code, factorToBase: 12, isBase: false }],
    })

    expect(d.lineNote).toBe(`Only 2 ${plural} in stock (30 units)`)
  })
})

describe('describeShortage: a base-unit line', () => {
  it('speaks in units and offers every unit that is there', () => {
    const d = describeShortage({ productName: NAME, available: 42, requested: 48, lines: [loose(48)] })

    expect(d.headline).toBe('Only 42 units of Rice Noodles 200g in stock. This order asks for 48 units.')
    expect(d.lineNote).toBe('Only 42 units in stock')
    expect(d.maxQty).toBe(42)
  })

  it('uses the singular for one unit', () => {
    const d = describeShortage({ productName: NAME, available: 1, requested: 3, lines: [loose(3)] })

    expect(d.headline).toBe('Only 1 unit of Rice Noodles 200g in stock. This order asks for 3 units.')
    expect(d.lineNote).toBe('Only 1 unit in stock')
    expect(d.maxQty).toBe(1)
  })

  it('treats a packSize of 1 as a base unit', () => {
    const d = describeShortage({ productName: NAME, available: 4, requested: 6, lines: [carton(6, 1)] })

    expect(d.lineNote).toBe('Only 4 units in stock')
    expect(d.maxQty).toBe(4)
  })
})

describe('describeShortage: nothing in stock', () => {
  it('says the product is out of stock and offers removal', () => {
    const d = describeShortage({ productName: NAME, available: 0, requested: 48, lines: [carton(4)] })

    expect(d.headline).toBe('Rice Noodles 200g is out of stock.')
    expect(d.lineNote).toBe('Out of stock')
    expect(d.maxQty).toBe(0)
  })

  it('treats a negative balance as nothing', () => {
    const d = describeShortage({ productName: NAME, available: -3, requested: 5, lines: [loose(5)] })

    expect(d.headline).toBe('Rice Noodles 200g is out of stock.')
    expect(d.maxQty).toBe(0)
  })

  it('still says so, and offers removal on every line, when the product is split across lines', () => {
    const d = describeShortage({ productName: NAME, available: 0, requested: 29, lines: [carton(2), loose(5)] })

    expect(d.headline).toBe('Rice Noodles 200g is out of stock.')
    expect(d.maxQty).toBe(0)
  })
})

describe('describeShortage: when no single quantity would fix it', () => {
  it('falls back to units, with no one-tap fix, when the product is on lines of different sizes', () => {
    // 2 cartons of 12 + 5 loose = 29 units, against 20 in stock.
    const d = describeShortage({ productName: NAME, available: 20, requested: 29, lines: [carton(2), loose(5)] })

    expect(d.headline).toBe('Only 20 units of Rice Noodles 200g in stock. This order asks for 29 units.')
    expect(d.lineNote).toBe('Only 20 units in stock')
    expect(d.maxQty).toBeNull()
  })

  it('keeps the carton wording across lines of the same size but offers no single-line fix', () => {
    const d = describeShortage({
      productName: NAME,
      available: 42,
      requested: 60,
      lines: [carton(3), carton(2)],
    })

    expect(d.lineNote).toBe('Only 3 cartons in stock (42 units)')
    expect(d.headline).toBe(
      'Only 3 cartons of Rice Noodles 200g in stock (42 units). This order asks for 5 cartons (60 units).',
    )
    expect(d.maxQty).toBeNull()
  })

  it('offers removal on each of several same-size lines when not even one carton is there', () => {
    const d = describeShortage({ productName: NAME, available: 6, requested: 60, lines: [carton(3), carton(2)] })

    expect(d.maxQty).toBe(0)
  })

  it('refuses to guess when the lines do not add up to what the server counted', () => {
    // The lines say 4 x 1 = 4 units but the server counted 48: the pack factor is
    // unknown here, and "Set to 42" would be 42 CARTONS.
    const d = describeShortage({ productName: NAME, available: 42, requested: 48, lines: [loose(4)] })

    expect(d.headline).toBe('Only 42 units of Rice Noodles 200g in stock. This order asks for 48 units.')
    expect(d.maxQty).toBeNull()
  })

  it('falls back to units when there are no lines to read', () => {
    const d = describeShortage({ productName: NAME, available: 42, requested: 48, lines: [] })

    expect(d.headline).toBe('Only 42 units of Rice Noodles 200g in stock. This order asks for 48 units.')
    expect(d.maxQty).toBeNull()
  })
})

describe('describeShortage: awkward numbers', () => {
  it('does not print float noise', () => {
    const d = describeShortage({ productName: NAME, available: 0.1 + 0.2, requested: 5, lines: [loose(5)] })

    expect(d.lineNote).toBe('Only 0.3 units in stock')
    expect(d.maxQty).toBe(0)
  })
})
