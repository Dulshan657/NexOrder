import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { placeOrderCore, type PlaceOrderCoreInput } from '../supabase/functions/_shared/placeOrderCore'
import { EdgeFunctionError } from '../supabase/functions/_shared/errors'

// An in-memory stand-in for the service-role client covering exactly the calls
// placeOrderCore makes: a handful of from(table) reads, two RPCs, and the
// writes. Every write is recorded in order, which is what lets the dry-run
// tests assert "wrote nothing" and the live tests assert the sequence.

interface Fixture {
  horeca?: Record<string, unknown> | null
  products?: Array<Record<string, unknown>>
  promotions?: Array<Record<string, unknown>>
  settings?: Record<string, unknown> | null
  outstanding?: number[]
  warehouses?: Array<Record<string, unknown>>
  balances?: Array<{ product_id: number; location_id: number; available: number }>
  reserveError?: { message: string } | null
  orderInsertError?: { message: string } | null
  itemsInsertError?: { message: string } | null
  invoiceInsertError?: { message: string } | null
}

interface Recorded {
  kind: 'insert' | 'delete' | 'rpc'
  target: string
  payload?: unknown
}

function makeService(fx: Fixture) {
  const writes: Recorded[] = []

  const readResult = (table: string, productIds?: unknown[]): { data: unknown; error: unknown } => {
    switch (table) {
      case 'horecas':
        return fx.horeca === null
          ? { data: null, error: { message: 'no rows' } }
          : { data: fx.horeca, error: null }
      case 'products':
        return { data: (fx.products ?? []).filter((p) => !productIds || productIds.includes(p.id)), error: null }
      case 'promotions':
        return { data: fx.promotions ?? [], error: null }
      case 'app_settings':
        return { data: fx.settings ?? null, error: null }
      case 'invoices':
        return { data: (fx.outstanding ?? []).map((amount) => ({ amount })), error: null }
      case 'locations':
        return { data: fx.warehouses ?? [], error: null }
      case 'inventory_balances':
        return { data: fx.balances ?? [], error: null }
      default:
        throw new Error(`unexpected read of ${table}`)
    }
  }

  const insertError = (table: string): { message: string } | null => {
    if (table === 'orders') return fx.orderInsertError ?? null
    if (table === 'order_items') return fx.itemsInsertError ?? null
    if (table === 'invoices') return fx.invoiceInsertError ?? null
    return null
  }

  const service = {
    from(table: string) {
      let productIds: unknown[] | undefined
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: (col: string, values: unknown[]) => {
          if (table === 'products' && col === 'id') productIds = values
          return chain
        },
        single: () => Promise.resolve(readResult(table)),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(readResult(table, productIds)).then(resolve, reject),
        insert: (payload: unknown) => {
          writes.push({ kind: 'insert', target: table, payload })
          return Promise.resolve({ error: insertError(table) })
        },
        delete: () => ({
          eq: (_col: string, value: unknown) => {
            writes.push({ kind: 'delete', target: table, payload: value })
            return Promise.resolve({ error: null })
          },
        }),
      }
      return chain
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'inv_warehouse_draw_locations') {
        const id = args.p_warehouse_id as number
        return Promise.resolve({ data: [{ location_id: id }, { location_id: id * 100 }], error: null })
      }
      writes.push({ kind: 'rpc', target: name, payload: args })
      return Promise.resolve({ data: null, error: name === 'inv_reserve_order' ? (fx.reserveError ?? null) : null })
    },
  }
  return { service: service as never, writes }
}

// One product at $10 (id 1) and one at $20 (id 2); one active warehouse (id 1)
// whose draw locations are 1 and 100; plenty of stock unless a test says not.
function baseFixture(over: Fixture = {}): Fixture {
  return {
    horeca: {
      id: 7, name: 'Cafe Nero', discount_percent: null, credit_limit: 0, tier: null, lat: null, lng: null,
      horeca_pricing: [],
    },
    products: [
      { id: 1, sku: 'A-1', name: 'Coconut Milk', price: 10, category: 'Coconut', inventory: 500, carton_size: 12, product_uoms: [] },
      { id: 2, sku: 'B-2', name: 'Fish Sauce', price: 20, category: 'Fish', inventory: 500, carton_size: null, product_uoms: [] },
    ],
    settings: { order_id_prefix: 'ORD', minimum_order_value: 0, default_credit_limit: 0, carton_discount_percent: 5 },
    outstanding: [],
    warehouses: [{ id: 1, lat: null, lng: null, is_active: true, location_type: 'bulk', kind: 'WAREHOUSE' }],
    balances: [
      { product_id: 1, location_id: 1, available: 50 },
      { product_id: 1, location_id: 100, available: 50 },
      { product_id: 2, location_id: 1, available: 50 },
    ],
    ...over,
  }
}

const input = (over: Partial<PlaceOrderCoreInput> = {}): PlaceOrderCoreInput => ({
  submittedBy: 'user-1',
  actorRole: 'Restaurant/Hotel Customer',
  hoReCaId: 7,
  items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }],
  ...over,
})

async function thrownBy(run: () => Promise<unknown>): Promise<EdgeFunctionError> {
  try {
    await run()
  } catch (e) {
    expect(e).toBeInstanceOf(EdgeFunctionError)
    return e as EdgeFunctionError
  }
  throw new Error('expected the call to throw')
}

const promoRow = (o: Record<string, unknown>) => ({
  percent_off: null, fixed_price: null, clearance_percent: null, bogo_config: null, bundle_config: null,
  scope: { kind: 'storewide' }, targeting: { kind: 'all' }, stack_with_horeca_pricing: false,
  start_date: null, end_date: null, is_active: true, priority: 10, ...o,
})

describe('placeOrderCore', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('live mode', () => {
    it('writes every promotion the order used', async () => {
      const { service, writes } = makeService(baseFixture({
        promotions: [
          promoRow({ id: 'PCT', name: 'Half off', type: 'percentage', percent_off: 50, scope: { kind: 'products', productIds: [1] } }),
          promoRow({ id: 'BUN', name: 'Pair', type: 'bundle', bundle_config: { productIds: [1, 2], bundlePrice: 20 }, scope: { kind: 'products', productIds: [1, 2] } }),
          promoRow({ id: 'BOGO', name: 'Free sauce', type: 'bogo', bogo_config: { buyProductId: 1, buyQuantity: 2, getProductId: 2, getQuantity: 1 }, scope: { kind: 'products', productIds: [1, 2] } }),
        ],
      }))
      const result = await placeOrderCore(service, input())

      expect(result.total).toBe(25)
      expect((writes[0].payload as Record<string, unknown>).applied_promotions).toEqual([
        { promotionId: 'PCT', promotionName: 'Half off', type: 'percentage', discount: 10 },
        { promotionId: 'BUN', promotionName: 'Pair', type: 'bundle', discount: 5, productIds: [1, 2] },
        { promotionId: 'BOGO', promotionName: 'Free sauce', type: 'bogo', discount: 20, freeProductId: 2, freeQuantity: 1, unit: 'unit' },
      ])
    })

    it('values a free product that is not in the cart', async () => {
      const { service, writes } = makeService(baseFixture({
        products: [
          { id: 1, sku: 'A-1', name: 'Coconut Milk', price: 10, category: 'Coconut', inventory: 500, carton_size: 12, product_uoms: [] },
          { id: 2, sku: 'B-2', name: 'Fish Sauce', price: 20, category: 'Fish', inventory: 500, carton_size: null, product_uoms: [] },
          { id: 3, sku: 'C-3', name: 'Free Noodles', price: 7, category: 'Noodles', inventory: 500, carton_size: null, product_uoms: [] },
        ],
        promotions: [
          promoRow({ id: 'BOGO', name: 'Free noodles', type: 'bogo', bogo_config: { buyProductId: 1, buyQuantity: 2, getProductId: 3, getQuantity: 2 }, scope: { kind: 'products', productIds: [1, 3] } }),
        ],
      }))
      await placeOrderCore(service, input())

      expect((writes[0].payload as Record<string, unknown>).applied_promotions).toEqual([
        { promotionId: 'BOGO', promotionName: 'Free noodles', type: 'bogo', discount: 14, freeProductId: 3, freeQuantity: 2, unit: 'unit' },
      ])
    })

    it('a promotion below its minimum does not apply and is not recorded', async () => {
      const { service, writes } = makeService(baseFixture({
        promotions: [promoRow({ id: 'MIN', name: 'Half off', type: 'percentage', percent_off: 50, min_order_value: 41 })],
      }))
      const result = await placeOrderCore(service, input())

      expect(result.total).toBe(40)
      expect(result.appliedPromotionIds).toEqual([])
      expect((writes[0].payload as Record<string, unknown>).applied_promotions).toEqual([])
    })

    it("an order at exactly the minimum qualifies, measured at the customer's own prices", async () => {
      // List value 40. This customer pays half, so the order is worth 20.
      const horeca = {
        id: 7, name: 'Cafe Nero', discount_percent: 50, credit_limit: 0, tier: null, lat: null, lng: null, horeca_pricing: [],
      }
      const withMinimum = (min: number) => [
        promoRow({ id: 'MIN', name: 'Half again', type: 'percentage', percent_off: 50, stack_with_horeca_pricing: true, min_order_value: min }),
      ]

      const atMinimum = await placeOrderCore(makeService(baseFixture({ horeca, promotions: withMinimum(20) })).service, input())
      expect(atMinimum.total).toBe(10)

      const justOver = await placeOrderCore(makeService(baseFixture({ horeca, promotions: withMinimum(20.01) })).service, input())
      expect(justOver.total).toBe(20)
      expect(justOver.appliedPromotionIds).toEqual([])
    })

    it('a bundle and a buy-one-get-one below their minimum do not apply', async () => {
      const promotions = [
        promoRow({ id: 'BUN', name: 'Pair', type: 'bundle', bundle_config: { productIds: [1, 2], bundlePrice: 20 }, scope: { kind: 'products', productIds: [1, 2] }, min_order_value: 41 }),
        promoRow({ id: 'BOGO', name: 'Free', type: 'bogo', bogo_config: { buyProductId: 1, buyQuantity: 2, getProductId: 2, getQuantity: 1 }, scope: { kind: 'products', productIds: [1, 2] }, min_order_value: 41 }),
      ]
      const { service, writes } = makeService(baseFixture({ promotions }))
      const result = await placeOrderCore(service, input())

      expect(result.total).toBe(40)
      expect(result.bogoFreeItems).toEqual([])
      expect((writes[0].payload as Record<string, unknown>).applied_promotions).toEqual([])
    })

    it('a discount that takes the total under the minimum does not switch the promotion off', async () => {
      const withMinimum = (min: number) => [promoRow({ id: 'MIN', name: 'Half off', type: 'percentage', percent_off: 50, min_order_value: min })]

      // The order is worth 40 before the promotion and 20 after it.
      const kept = await placeOrderCore(makeService(baseFixture({ promotions: withMinimum(40) })).service, input())
      expect(kept.total).toBe(20)
      expect(kept.appliedPromotionIds).toEqual(['MIN'])

      const missed = await placeOrderCore(makeService(baseFixture({ promotions: withMinimum(40.01) })).service, input())
      expect(missed.total).toBe(40)
    })

    it('writes an empty list when the order used no promotion', async () => {
      const { service, writes } = makeService(baseFixture())
      await placeOrderCore(service, input())
      expect((writes[0].payload as Record<string, unknown>).applied_promotions).toEqual([])
    })

    it('a rep promotion applies to the rep placing the order and no one else', async () => {
      const promotions = [promoRow({ id: 'REP', name: 'Rep deal', type: 'percentage', percent_off: 50, targeting: { kind: 'rep', repUserId: 'rep-uuid' } })]

      const rep = await placeOrderCore(makeService(baseFixture({ promotions })).service, input({ submittedBy: 'rep-uuid', actorRole: 'Field Sales Rep' }))
      expect(rep.total).toBe(20)
      expect(rep.appliedPromotionIds).toEqual(['REP'])

      const other = await placeOrderCore(makeService(baseFixture({ promotions })).service, input({ submittedBy: 'other-rep', actorRole: 'Field Sales Rep' }))
      expect(other.total).toBe(40)

      const customer = await placeOrderCore(makeService(baseFixture({ promotions })).service, input({ submittedBy: 'customer-1' }))
      expect(customer.total).toBe(40)
    })

    it('writes order, items, reservation and invoice in that order and returns the place-order response shape', async () => {
      const { service, writes } = makeService(baseFixture())
      const result = await placeOrderCore(service, input())

      expect(Object.keys(result)).toEqual(['orderId', 'total', 'cartDiscount', 'appliedPromotionIds', 'bogoFreeItems'])
      expect(result.total).toBe(40) // 2×10 + 1×20
      expect(result.cartDiscount).toBe(0)
      expect(result.appliedPromotionIds).toEqual([])
      expect(result.bogoFreeItems).toEqual([])
      expect(result.orderId).toMatch(/^ORD-\d+$/)

      expect(writes.map((w) => `${w.kind}:${w.target}`)).toEqual([
        'insert:orders',
        'insert:order_items',
        'rpc:inv_reserve_order',
        'insert:invoices',
      ])

      const order = writes[0].payload as Record<string, unknown>
      expect(order).toMatchObject({
        id: result.orderId,
        horeca_id: 7,
        submitted_by: 'user-1',
        total: 40,
        status: 'processing',
        notes: null,
        delivery_date: null,
        delivery_time_slot: null,
        verification: null,
        applied_promotions: [],
      })

      const reserve = writes[2].payload as Record<string, unknown>
      expect(reserve).toMatchObject({
        p_order_id: result.orderId,
        p_items: [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }],
        p_location_pref: [1],
        p_actor: 'user-1',
      })

      expect(writes[3].payload).toMatchObject({ order_id: result.orderId, horeca_id: 7, horeca_name: 'Cafe Nero', amount: 40, status: 'pending' })
    })

    it('stores the notes, delivery fields and signature the caller passed', async () => {
      const { service, writes } = makeService(baseFixture())
      await placeOrderCore(service, input({
        notes: 'leave at back door',
        deliveryDate: '2026-10-20',
        deliveryTimeSlot: 'AM',
        verification: { signedBy: 'Sam' },
      }))
      expect(writes[0].payload).toMatchObject({
        notes: 'leave at back door',
        delivery_date: '2026-10-20',
        delivery_time_slot: 'AM',
        verification: { signedBy: 'Sam' },
      })
    })

    it('records the actor on the reservation separately from the order owner', async () => {
      const { service, writes } = makeService(baseFixture())
      await placeOrderCore(service, input({ submittedBy: 'staff-9', actorId: 'approver-2' }))
      expect(writes[0].payload).toMatchObject({ submitted_by: 'staff-9' })
      expect(writes[2].payload).toMatchObject({ p_actor: 'approver-2' })
    })

    it('fires the confirmation email without waiting for it', async () => {
      const { service } = makeService(baseFixture())
      const { orderId } = await placeOrderCore(service, input())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://example.supabase.co/functions/v1/send-email')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ template: 'order_confirmation', orderId })
    })

    it('does not fail the order when the invoice insert fails', async () => {
      const { service } = makeService(baseFixture({ invoiceInsertError: { message: 'dup' } }))
      await expect(placeOrderCore(service, input())).resolves.toMatchObject({ total: 40 })
    })

    it('answers INSUFFICIENT_STOCK (409) with the first shortage and writes nothing', async () => {
      const fx = baseFixture({ balances: [{ product_id: 1, location_id: 1, available: 1 }, { product_id: 2, location_id: 1, available: 0 }] })
      const { service, writes } = makeService(fx)
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409, message: '1 of "Coconut Milk" available, 2 requested' })
      expect(writes).toEqual([])
    })

    it('answers BELOW_MINIMUM (422)', async () => {
      const fx = baseFixture({ settings: { order_id_prefix: 'ORD', minimum_order_value: 100, carton_discount_percent: 5 } })
      const { service, writes } = makeService(fx)
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({ code: 'BELOW_MINIMUM', status: 422, message: 'Order total $40 is below minimum $100' })
      expect(writes).toEqual([])
    })

    it('answers CREDIT_EXCEEDED (422) using the tenant default when the HoReCa has no limit', async () => {
      const fx = baseFixture({
        settings: { order_id_prefix: 'ORD', minimum_order_value: 0, default_credit_limit: 100, carton_discount_percent: 5 },
        outstanding: [70],
      })
      const { service } = makeService(fx)
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({
        code: 'CREDIT_EXCEEDED',
        status: 422,
        message: 'Credit limit $100 would be exceeded ($70 outstanding + $40 new)',
      })
    })

    it('reports stock before minimum before credit when several rules are broken', async () => {
      const fx = baseFixture({
        balances: [],
        settings: { order_id_prefix: 'ORD', minimum_order_value: 100, default_credit_limit: 10, carton_discount_percent: 5 },
      })
      const { service } = makeService(fx)
      expect((await thrownBy(() => placeOrderCore(service, input()))).code).toBe('INSUFFICIENT_STOCK')
    })

    it('answers HORECA_NOT_FOUND (404)', async () => {
      const { service } = makeService(baseFixture({ horeca: null }))
      const err = await thrownBy(() => placeOrderCore(service, input({ hoReCaId: 99 })))
      expect(err).toMatchObject({ code: 'HORECA_NOT_FOUND', status: 404, message: 'HoReCa 99 not found' })
    })

    it('answers PRODUCT_NOT_FOUND (404) for the first unknown product', async () => {
      const { service } = makeService(baseFixture())
      const err = await thrownBy(() => placeOrderCore(service, input({ items: [{ productId: 1, quantity: 1 }, { productId: 77, quantity: 1 }, { productId: 88, quantity: 1 }] })))
      expect(err).toMatchObject({ code: 'PRODUCT_NOT_FOUND', status: 404, message: 'Product 77 not found' })
    })

    it('answers 500 and goes no further when the order insert fails', async () => {
      const { service, writes } = makeService(baseFixture({ orderInsertError: { message: 'boom' } }))
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({ code: 'DB_ORDER_INSERT_FAILED', status: 500, message: 'boom' })
      expect(writes.map((w) => `${w.kind}:${w.target}`)).toEqual(['insert:orders'])
    })

    it('removes the order when the items insert fails', async () => {
      const { service, writes } = makeService(baseFixture({ itemsInsertError: { message: 'bad fk' } }))
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({ code: 'DB_ITEMS_INSERT_FAILED', status: 500, message: 'bad fk' })
      expect(writes.map((w) => `${w.kind}:${w.target}`)).toEqual(['insert:orders', 'insert:order_items', 'delete:orders'])
    })

    it('undoes the order and answers INSUFFICIENT_STOCK when the reservation loses a race for stock', async () => {
      const { service, writes } = makeService(baseFixture({ reserveError: { message: 'INSUFFICIENT_STOCK: product 1' } }))
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        status: 409,
        message: 'Stock changed — one or more items are no longer available',
      })
      expect(writes.map((w) => `${w.kind}:${w.target}`)).toEqual([
        'insert:orders', 'insert:order_items', 'rpc:inv_reserve_order', 'delete:order_items', 'delete:orders',
      ])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers STOCK_RACE with the database message for any other reservation failure', async () => {
      const { service } = makeService(baseFixture({ reserveError: { message: 'deadlock detected' } }))
      const err = await thrownBy(() => placeOrderCore(service, input()))
      expect(err).toMatchObject({ code: 'STOCK_RACE', status: 409, message: 'deadlock detected' })
    })

    it('refuses an empty cart', async () => {
      const { service } = makeService(baseFixture())
      const err = await thrownBy(() => placeOrderCore(service, input({ items: [] })))
      expect(err).toMatchObject({ code: 'INVALID_INPUT', status: 400 })
    })
  })

  describe('dry run', () => {
    it('the approver counts for a rep promotion, not the requester', async () => {
      const promotions = [promoRow({ id: 'REP', name: 'Rep deal', type: 'percentage', percent_off: 50, targeting: { kind: 'rep', repUserId: 'rep-uuid' } })]

      const byRep = await placeOrderCore(makeService(baseFixture({ promotions })).service, input({ submittedBy: 'kitchen', actorId: 'rep-uuid' }), { dryRun: true })
      expect(byRep.total).toBe(20)

      const byOther = await placeOrderCore(makeService(baseFixture({ promotions })).service, input({ submittedBy: 'rep-uuid', actorId: 'manager' }), { dryRun: true })
      expect(byOther.total).toBe(40)
    })

    it('prices the cart and writes nothing', async () => {
      const { service, writes } = makeService(baseFixture())
      const preview = await placeOrderCore(service, input(), { dryRun: true })

      expect(writes).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
      expect(preview.ok).toBe(true)
      expect(preview.problems).toEqual([])
      expect(preview.total).toBe(40)
      expect(preview.subtotal).toBe(40)
      expect(preview.hoReCa).toEqual({ id: 7, name: 'Cafe Nero' })
      expect(preview.lines).toMatchObject([
        { productId: 1, quantity: 2, unitPrice: 10, lineTotal: 20, baseUnits: 2 },
        { productId: 2, quantity: 1, unitPrice: 20, lineTotal: 20, baseUnits: 1 },
      ])
      expect(preview.stock).toEqual([
        { productId: 1, productName: 'Coconut Milk', requested: 2, available: 100, short: false },
        { productId: 2, productName: 'Fish Sauce', requested: 1, available: 50, short: false },
      ])
    })

    it('prices exactly as a live placement does', async () => {
      const fx = baseFixture({
        horeca: {
          id: 7, name: 'Cafe Nero', discount_percent: 10, credit_limit: 0, tier: null, lat: null, lng: null,
          horeca_pricing: [{ product_id: 2, custom_price: 15 }],
        },
      })
      const dry = await placeOrderCore(makeService(fx).service, input({ items: [{ productId: 1, quantity: 2, packSize: 12 }, { productId: 2, quantity: 2 }] }), { dryRun: true })
      const live = await placeOrderCore(makeService(fx).service, input({ items: [{ productId: 1, quantity: 2, packSize: 12 }, { productId: 2, quantity: 2 }] }))
      expect(dry.total).toBe(live.total)
      expect(dry.cartDiscount).toBe(live.cartDiscount)
      expect(dry.appliedPromotionIds).toEqual(live.appliedPromotionIds)
    })

    it('collects every problem instead of stopping at the first', async () => {
      const fx = baseFixture({
        balances: [{ product_id: 1, location_id: 1, available: 1 }], // 1 short, 2 has none
        settings: { order_id_prefix: 'ORD', minimum_order_value: 100, default_credit_limit: 50, carton_discount_percent: 5 },
        outstanding: [30],
      })
      const { service, writes } = makeService(fx)
      const preview = await placeOrderCore(service, input(), { dryRun: true })

      expect(writes).toEqual([])
      expect(preview.ok).toBe(false)
      expect(preview.problems.map((p) => p.code)).toEqual([
        'INSUFFICIENT_STOCK',
        'INSUFFICIENT_STOCK',
        'BELOW_MINIMUM',
        'CREDIT_EXCEEDED',
      ])
      expect(preview.problems[0]).toMatchObject({ productId: 1, requested: 2, available: 1 })
      expect(preview.problems[1]).toMatchObject({ productId: 2, requested: 1, available: 0 })
      expect(preview.problems[2]).toMatchObject({ total: 40, minimum: 100 })
      expect(preview.problems[3]).toMatchObject({ total: 40, limit: 50, outstanding: 30 })
      // The numbers are still computed, so the approver sees what the order WOULD be.
      expect(preview.total).toBe(40)
      expect(preview.creditLimit).toBe(50)
      expect(preview.outstanding).toBe(30)
      expect(preview.minimumOrderValue).toBe(100)
    })

    it('reports an unknown product and prices the rest', async () => {
      const { service, writes } = makeService(baseFixture())
      const preview = await placeOrderCore(service, input({ items: [{ productId: 1, quantity: 1 }, { productId: 77, quantity: 1 }] }), { dryRun: true })
      expect(writes).toEqual([])
      expect(preview.ok).toBe(false)
      expect(preview.problems).toEqual([{ code: 'PRODUCT_NOT_FOUND', message: 'Product 77 not found', productId: 77 }])
      expect(preview.lines.map((l) => l.productId)).toEqual([1])
      expect(preview.total).toBe(10)
    })

    it('does not invent a minimum-order problem when every product was unknown', async () => {
      const fx = baseFixture({ settings: { order_id_prefix: 'ORD', minimum_order_value: 100, carton_discount_percent: 5 } })
      const preview = await placeOrderCore(makeService(fx).service, input({ items: [{ productId: 77, quantity: 1 }] }), { dryRun: true })
      expect(preview.problems.map((p) => p.code)).toEqual(['PRODUCT_NOT_FOUND'])
      expect(preview.lines).toEqual([])
    })

    it('returns a missing HoReCa as a problem rather than throwing', async () => {
      const { service, writes } = makeService(baseFixture({ horeca: null }))
      const preview = await placeOrderCore(service, input({ hoReCaId: 99 }), { dryRun: true })
      expect(writes).toEqual([])
      expect(preview).toMatchObject({
        ok: false,
        hoReCa: null,
        lines: [],
        total: 0,
        problems: [{ code: 'HORECA_NOT_FOUND', message: 'HoReCa 99 not found' }],
      })
    })

    it('still throws when the database itself fails', async () => {
      const { service } = makeService(baseFixture())
      const broken = {
        ...(service as object),
        from: (table: string) => {
          if (table === 'products') return { select: () => ({ in: () => Promise.resolve({ data: null, error: new Error('db down') }) }) }
          return (service as { from: (t: string) => unknown }).from(table)
        },
      } as never
      await expect(placeOrderCore(broken, input(), { dryRun: true })).rejects.toThrow('db down')
    })
  })
})
