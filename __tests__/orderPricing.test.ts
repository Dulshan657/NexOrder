import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  aggregateOrderItems,
  baseUnitsByProduct,
  checkCreditLimit,
  checkMinimumOrder,
  collectAppliedPromotionIds,
  computeOrderTotals,
  findInvalidOrderItem,
  findMissingProducts,
  findStockShortages,
  normalizeOrderItems,
  priceOrderLines,
  resolveCreditLimit,
  stockPositions,
  sumAvailableByProduct,
  toBogoFreeItems,
  toPricedLines,
  type OrderLineInput,
  type OrderProblem,
  type PricedProduct,
} from '../supabase/functions/_shared/orderPricing'
import type { HoReCa, Promotion, UserContext } from '../supabase/functions/_shared/pricing'

// ── fixtures ────────────────────────────────────────────────────────────────

const user: UserContext = { id: 0, role: 'Restaurant/Hotel Customer' }

const mkProduct = (o: Partial<PricedProduct> = {}): PricedProduct => ({
  id: 1,
  name: 'Coconut Milk 400ml',
  sku: 'COC-400',
  price: 10,
  category: 'Coconut',
  inventory: 1000,
  cartonSize: 12,
  uoms: [],
  ...o,
})

const mkHoReCa = (o: Partial<HoReCa> = {}): HoReCa => ({ id: 7, ...o })

const mkPromo = (o: Partial<Promotion> = {}): Promotion => ({
  id: 'P-1',
  name: '25% off',
  type: 'percentage',
  percentOff: 25,
  scope: { kind: 'storewide' },
  targeting: { kind: 'all' },
  stackWithHoReCaPricing: false,
  isActive: true,
  priority: 10,
  ...o,
})

const mapOf = (...products: PricedProduct[]) => new Map(products.map((p) => [p.id, p]))

// ── input validation ────────────────────────────────────────────────────────

describe('findInvalidOrderItem', () => {
  it('accepts well-formed lines, with or without a UOM', () => {
    expect(findInvalidOrderItem([{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1, uomId: 3 }])).toBeNull()
  })

  it.each([
    ['a non-numeric productId', { productId: '1', quantity: 1 }],
    ['a missing quantity', { productId: 1 }],
    ['a zero quantity', { productId: 1, quantity: 0 }],
    ['a negative quantity', { productId: 1, quantity: -2 }],
    ['a fractional quantity', { productId: 1, quantity: 1.5 }],
  ])('rejects %s with the INVALID_ITEM wording', (_label, item) => {
    expect(findInvalidOrderItem([item as never])).toBe(
      'Each item needs integer productId and positive integer quantity',
    )
  })

  it.each([0, -1, 1.5])('rejects uomId %s', (uomId) => {
    expect(findInvalidOrderItem([{ productId: 1, quantity: 1, uomId }])).toBe(
      'uomId must be a positive integer when provided',
    )
  })

  it('reports the first bad line', () => {
    expect(
      findInvalidOrderItem([{ productId: 1, quantity: 1 }, { productId: 2, quantity: 0 }, { productId: 3, uomId: -1 }]),
    ).toBe('Each item needs integer productId and positive integer quantity')
  })
})

describe('findMissingProducts', () => {
  it('returns one PRODUCT_NOT_FOUND per unknown id, in order', () => {
    const problems = findMissingProducts([5, 1, 9], mapOf(mkProduct({ id: 1 })))
    expect(problems).toEqual([
      { code: 'PRODUCT_NOT_FOUND', message: 'Product 5 not found', productId: 5 },
      { code: 'PRODUCT_NOT_FOUND', message: 'Product 9 not found', productId: 9 },
    ])
  })

  it('returns nothing when every product exists', () => {
    expect(findMissingProducts([1], mapOf(mkProduct({ id: 1 })))).toEqual([])
  })
})

// ── normalisation + aggregation ─────────────────────────────────────────────

describe('normalizeOrderItems', () => {
  const uoms = [
    { id: 10, factorToBase: 1, price: 10, isBase: true },
    { id: 11, factorToBase: 12, price: 108, isBase: false },
  ]
  const products = mapOf(mkProduct({ id: 1, uoms }))

  it('turns the base UOM into a per-unit line and ignores a client packSize', () => {
    const [line] = normalizeOrderItems([{ productId: 1, quantity: 3, uomId: 10, packSize: 99 }], products)
    expect(line).toEqual({ productId: 1, quantity: 3, packSize: null, uomId: 10 })
  })

  it('takes a non-base UOM factor from the product, never from the client', () => {
    const [line] = normalizeOrderItems([{ productId: 1, quantity: 2, uomId: 11, packSize: 99 }], products)
    expect(line).toEqual({ productId: 1, quantity: 2, packSize: 12, uomId: 11 })
  })

  it('falls back to the legacy packSize when the UOM is unknown or absent', () => {
    const lines = normalizeOrderItems(
      [{ productId: 1, quantity: 1, uomId: 404, packSize: 6 }, { productId: 1, quantity: 1 }],
      products,
    )
    expect(lines).toEqual([
      { productId: 1, quantity: 1, packSize: 6, uomId: null },
      { productId: 1, quantity: 1, packSize: null, uomId: null },
    ])
  })

  it('drops lines whose product is unknown (the caller reports those separately)', () => {
    expect(normalizeOrderItems([{ productId: 404, quantity: 1 }], products)).toEqual([])
  })
})

describe('aggregateOrderItems', () => {
  it('merges duplicate lines so both count toward the stock check', () => {
    const merged = aggregateOrderItems([
      { productId: 1, quantity: 2, packSize: null, uomId: null },
      { productId: 1, quantity: 3, packSize: null, uomId: null },
    ])
    expect(merged).toEqual([{ productId: 1, quantity: 5, packSize: null, uomId: null }])
  })

  it('keeps two UOMs that share a factor apart', () => {
    const merged = aggregateOrderItems([
      { productId: 1, quantity: 1, packSize: 12, uomId: 11 },
      { productId: 1, quantity: 1, packSize: 12, uomId: 12 },
    ])
    expect(merged).toHaveLength(2)
  })

  it('does not mutate its input', () => {
    const input: OrderLineInput[] = [
      { productId: 1, quantity: 2, packSize: null, uomId: null },
      { productId: 1, quantity: 3, packSize: null, uomId: null },
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    aggregateOrderItems(input)
    expect(input).toEqual(snapshot)
  })

  it('preserves first-appearance order', () => {
    const merged = aggregateOrderItems([
      { productId: 3, quantity: 1 },
      { productId: 1, quantity: 1 },
      { productId: 3, quantity: 1, packSize: 6 },
    ])
    expect(merged.map((l) => `${l.productId}:${l.packSize ?? ''}`)).toEqual(['3:', '1:', '3:6'])
  })
})

describe('baseUnitsByProduct', () => {
  it('converts carton lines to base units and sums per product', () => {
    const totals = baseUnitsByProduct([
      { productId: 1, quantity: 2, packSize: 12 }, // 24
      { productId: 1, quantity: 5, packSize: null }, // 5
      { productId: 2, quantity: 3, packSize: 1 }, // 3
    ])
    expect([...totals]).toEqual([
      [1, 29],
      [2, 3],
    ])
  })
})

// ── stock ───────────────────────────────────────────────────────────────────

describe('stock checks', () => {
  const products = mapOf(
    mkProduct({ id: 1, name: 'Coconut Milk 400ml' }),
    mkProduct({ id: 2, name: 'Fish Sauce 700ml' }),
    mkProduct({ id: 3, name: 'Soy Sauce 1L' }),
  )

  it('sums availability per product across the rows read', () => {
    const avail = sumAvailableByProduct([
      { product_id: 1, available: 4 },
      { product_id: 1, available: '6' },
      { product_id: 2, available: 1 },
    ])
    expect(avail.get(1)).toBe(10)
    expect(avail.get(2)).toBe(1)
  })

  it('collects EVERY shortage, in cart order, with the live wording and the numbers', () => {
    const totals = new Map([[1, 25], [2, 8], [3, 4]])
    const avail = new Map([[1, 19], [2, 8]]) // 3 has no rows at all
    const problems = findStockShortages(totals, avail, products)
    expect(problems).toEqual([
      {
        code: 'INSUFFICIENT_STOCK',
        message: '19 of "Coconut Milk 400ml" available, 25 requested',
        productId: 1,
        requested: 25,
        available: 19,
      },
      {
        code: 'INSUFFICIENT_STOCK',
        message: '0 of "Soy Sauce 1L" available, 4 requested',
        productId: 3,
        requested: 4,
        available: 0,
      },
    ])
  })

  it('treats exactly enough stock as enough', () => {
    expect(findStockShortages(new Map([[1, 10]]), new Map([[1, 10]]), products)).toEqual([])
  })

  it('reports a position for every product, short or not', () => {
    const positions = stockPositions(new Map([[1, 25], [2, 8]]), new Map([[1, 19], [2, 20]]), products)
    expect(positions).toEqual([
      { productId: 1, productName: 'Coconut Milk 400ml', requested: 25, available: 19, short: true },
      { productId: 2, productName: 'Fish Sauce 700ml', requested: 8, available: 20, short: false },
    ])
  })
})

// ── pricing ─────────────────────────────────────────────────────────────────

describe('priceOrderLines', () => {
  const uoms = [
    { id: 10, factorToBase: 1, price: 10, isBase: true },
    { id: 11, factorToBase: 12, price: 100, isBase: false },
  ]
  const p1 = mkProduct({ id: 1, price: 10, uoms })
  const products = mapOf(p1)

  it('prices a per-unit line at the list price', () => {
    const [line] = priceOrderLines([{ productId: 1, quantity: 3, packSize: null, uomId: null }], products, mkHoReCa(), user, [], 5)
    expect(line).toMatchObject({ productId: 1, quantity: 3, unitPrice: 10, productName: 'Coconut Milk 400ml', productSku: 'COC-400' })
  })

  it('applies the HoReCa per-product price and blanket discount (the cheaper wins)', () => {
    const [custom] = priceOrderLines(
      [{ productId: 1, quantity: 1, packSize: null, uomId: null }],
      products,
      mkHoReCa({ pricing: { 1: 7 }, discountPercent: 20 }),
      user,
      [],
      5,
    )
    expect(custom.unitPrice).toBe(7)
  })

  it('applies the carton discount to a carton line', () => {
    // 10 × 12 units × (1 − 5%) = 114
    const [line] = priceOrderLines([{ productId: 1, quantity: 1, packSize: 12, uomId: null }], products, mkHoReCa(), user, [], 5)
    expect(line.unitPrice).toBe(114)
    expect(line.packSize).toBe(12)
  })

  it('uses the explicit UOM list price for a non-base UOM', () => {
    const [line] = priceOrderLines([{ productId: 1, quantity: 2, packSize: 12, uomId: 11 }], products, mkHoReCa(), user, [], 5)
    expect(line.unitPrice).toBe(100)
    expect(line.uomId).toBe(11)
  })

  it('records the promotion that set the price', () => {
    const [line] = priceOrderLines([{ productId: 1, quantity: 1, packSize: null, uomId: null }], products, mkHoReCa(), user, [mkPromo()], 5)
    expect(line.unitPrice).toBe(7.5)
    expect(line.appliedPromotionId).toBe('P-1')
  })

  it('skips a line whose product is unknown rather than throwing', () => {
    expect(priceOrderLines([{ productId: 99, quantity: 1 }], products, mkHoReCa(), user, [], 5)).toEqual([])
  })

  it('does not mutate the promotions it is given', () => {
    const promos = Object.freeze([Object.freeze(mkPromo())])
    expect(() =>
      priceOrderLines([{ productId: 1, quantity: 1, packSize: null, uomId: null }], products, mkHoReCa(), user, promos, 5),
    ).not.toThrow()
  })
})

describe('computeOrderTotals', () => {
  const a = mkProduct({ id: 1, name: 'A', price: 10 })
  const b = mkProduct({ id: 2, name: 'B', price: 20, sku: 'B' })
  const products = mapOf(a, b)
  const resolved = [
    { productId: 1, quantity: 3, packSize: null, uomId: null, productName: 'A', productSku: 'COC-400', unitPrice: 10, appliedPromotionId: null },
    { productId: 2, quantity: 1, packSize: null, uomId: null, productName: 'B', productSku: 'B', unitPrice: 20, appliedPromotionId: null },
  ]

  it('sums the lines with no cart promotions', () => {
    const t = computeOrderTotals(resolved, [], mkHoReCa(), user, products)
    expect(t).toMatchObject({ subtotal: 50, cartDiscount: 0, total: 50 })
  })

  it('subtracts a bundle discount and rounds to the cent', () => {
    const bundle = mkPromo({ id: 'B-1', type: 'bundle', percentOff: undefined, bundleConfig: { productIds: [1, 2], bundlePrice: 25.555 } })
    const t = computeOrderTotals(resolved, [bundle], mkHoReCa(), user, products)
    // individual 10 + 20 = 30 → discount 4.445 → rounded 4.45 (×1 complete bundle... min(3,1)=1)
    expect(t.cartDiscount).toBeCloseTo(4.45, 2)
    expect(t.total).toBe(Math.round((50 - t.cartDiscount) * 100) / 100)
    expect(t.bundleDiscounts.map((d) => d.promoId)).toEqual(['B-1'])
  })

  it('reports free BOGO items without touching the total', () => {
    const bogo = mkPromo({ id: 'G-1', type: 'bogo', percentOff: undefined, bogoConfig: { buyProductId: 1, buyQuantity: 2, getProductId: 2, getQuantity: 1 } })
    const t = computeOrderTotals(resolved, [bogo], mkHoReCa(), user, products)
    expect(t.total).toBe(50)
    expect(toBogoFreeItems(t.bogoFreeItems)).toEqual([{ productId: 2, freeQuantity: 1, promoId: 'G-1' }])
  })
})

describe('toPricedLines / collectAppliedPromotionIds', () => {
  it('adds line total and base units', () => {
    const [line] = toPricedLines([
      { productId: 1, quantity: 3, packSize: 12, uomId: null, productName: 'A', productSku: 'A', unitPrice: 33.333, appliedPromotionId: null },
    ])
    expect(line.lineTotal).toBe(100)
    expect(line.baseUnits).toBe(36)
  })

  it('lists each promotion once, from lines, bundles and free items', () => {
    const ids = collectAppliedPromotionIds(
      [
        { productId: 1, quantity: 1, packSize: null, uomId: null, productName: 'A', productSku: 'A', unitPrice: 1, appliedPromotionId: 'P-1' },
        { productId: 2, quantity: 1, packSize: null, uomId: null, productName: 'B', productSku: 'B', unitPrice: 1, appliedPromotionId: 'P-1' },
        { productId: 3, quantity: 1, packSize: null, uomId: null, productName: 'C', productSku: 'C', unitPrice: 1, appliedPromotionId: null },
      ],
      [{ promoId: 'B-1', promoName: 'Bundle', discount: 1, productIds: [1, 2] }],
      [],
    )
    expect(ids).toEqual(['P-1', 'B-1'])
  })
})

// ── order-level rules ───────────────────────────────────────────────────────

describe('checkMinimumOrder', () => {
  it('flags a total under the minimum, in the live wording', () => {
    expect(checkMinimumOrder(45.5, 100)).toEqual({
      code: 'BELOW_MINIMUM',
      message: 'Order total $45.5 is below minimum $100',
      total: 45.5,
      minimum: 100,
    })
  })

  it('accepts a total equal to the minimum', () => {
    expect(checkMinimumOrder(100, 100)).toBeNull()
  })

  it('is off when no minimum is configured', () => {
    expect(checkMinimumOrder(0.01, 0)).toBeNull()
  })
})

describe('credit limit', () => {
  it('prefers the HoReCa limit and falls back to the tenant default', () => {
    expect(resolveCreditLimit(500, 1000)).toBe(500)
    expect(resolveCreditLimit(0, 1000)).toBe(1000)
    expect(resolveCreditLimit(0, 0)).toBe(0)
  })

  it('flags outstanding + new over the limit, in the live wording', () => {
    expect(checkCreditLimit(1000, 800, 250)).toEqual({
      code: 'CREDIT_EXCEEDED',
      message: 'Credit limit $1000 would be exceeded ($800 outstanding + $250 new)',
      total: 250,
      limit: 1000,
      outstanding: 800,
    })
  })

  it('allows reaching the limit exactly', () => {
    expect(checkCreditLimit(1000, 800, 200)).toBeNull()
  })

  it('is off when there is no limit', () => {
    expect(checkCreditLimit(0, 99999, 99999)).toBeNull()
  })
})

// ── collection ──────────────────────────────────────────────────────────────

describe('collecting every problem at once', () => {
  it('a cart that is short on two lines, under the minimum and over credit yields all four, in precedence order', () => {
    const products = mapOf(mkProduct({ id: 1, name: 'A' }), mkProduct({ id: 2, name: 'B' }))
    const totals = new Map([[1, 10], [2, 10]])
    const avail = new Map([[1, 3], [2, 0]])

    const problems: OrderProblem[] = [
      ...findStockShortages(totals, avail, products),
      ...[checkMinimumOrder(20, 50)].filter((p): p is OrderProblem => !!p),
      ...[checkCreditLimit(100, 90, 20)].filter((p): p is OrderProblem => !!p),
    ]

    expect(problems.map((p) => p.code)).toEqual([
      'INSUFFICIENT_STOCK',
      'INSUFFICIENT_STOCK',
      'BELOW_MINIMUM',
      'CREDIT_EXCEEDED',
    ])
    // A live placement reports only the first, which is the stock shortage.
    expect(problems[0].message).toBe('3 of "A" available, 10 requested')
  })
})

// ── purity ──────────────────────────────────────────────────────────────────

// orderPricing.ts and the pricing.ts it imports are also bundled into the
// frontend (lib/qr/mayBeShort.ts, lib/kitchen/reorderPlan.ts), so both must stay
// free of Deno, URL imports and I/O.
for (const file of ['orderPricing.ts', 'pricing.ts']) {
  describe(`${file} stays pure`, () => {
    const src = readFileSync(join(__dirname, '..', 'supabase', 'functions', '_shared', file), 'utf8')

    it('uses no Deno globals', () => {
      expect(src).not.toMatch(/\bDeno\./)
    })

    it('uses no URL or npm imports', () => {
      expect(src).not.toMatch(/from\s+['"]https?:\/\//)
      expect(src).not.toMatch(/from\s+['"]npm:/)
      expect(src).not.toMatch(/from\s+['"]esm\.sh/)
    })

    it('gives every relative import a .ts extension', () => {
      for (const match of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        expect(match[1]).toMatch(/\.ts$/)
      }
    })

    it('does no I/O', () => {
      expect(src).not.toMatch(/\bfetch\(/)
      expect(src).not.toMatch(/\.from\(['"]/)
      expect(src).not.toMatch(/\.rpc\(/)
    })
  })
}
