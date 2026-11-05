import { describe, expect, it } from 'vitest'
import { z } from 'zod/v3'

// NX-0024: the rules mutate-promotion and PromotionForm share. The function imports zod
// from esm.sh, which vitest cannot load, so the schema takes the namespace as an argument;
// this file passes the client's `zod/v3`, the same API as the 3.23.8 the function pins.
//
// The module is loaded inside each test: on the base commit it does not exist, and a
// top-level import would stop this file loading.
const load = () => import('../supabase/functions/_shared/promotionBody')

const base = { name: 'Test', scope: { kind: 'storewide' }, targeting: { kind: 'all' }, stack_with_horeca_pricing: true, is_active: true, priority: 10 }

describe('promotion rules', () => {
  it('the form and the server agree on what is a valid promotion', async () => {
    const { promotionProblem } = await load()

    expect(promotionProblem({ type: 'percentage', percent_off: 10 })).toBeNull()
    expect(promotionProblem({ type: 'percentage', percent_off: 0 })).toMatch(/discount/i)
    expect(promotionProblem({ type: 'percentage', percent_off: 101 })).toMatch(/discount/i)
    expect(promotionProblem({ type: 'percentage' })).toMatch(/discount/i)

    expect(promotionProblem({ type: 'fixed_price', fixed_price: 4.5 })).toBeNull()
    expect(promotionProblem({ type: 'fixed_price', fixed_price: 0 })).toMatch(/price/i)

    expect(promotionProblem({ type: 'clearance', clearance_percent: 40 })).toBeNull()
    expect(promotionProblem({ type: 'clearance', clearance_percent: 0 })).toMatch(/clearance/i)

    const bogo = { buyProductId: 1, buyQuantity: 2, getProductId: 1, getQuantity: 1 }
    expect(promotionProblem({ type: 'bogo', bogo_config: bogo })).toBeNull()
    expect(promotionProblem({ type: 'bogo', bogo_config: { ...bogo, buyProductId: 0 } })).toMatch(/product/i)
    expect(promotionProblem({ type: 'bogo', bogo_config: { ...bogo, getProductId: 0 } })).toMatch(/product/i)

    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: [1, 2], bundlePrice: 9 } })).toBeNull()
    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: [1], bundlePrice: 9 } })).toMatch(/products/i)
    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: [1, 2], bundlePrice: 0 } })).toMatch(/price/i)
  })

  it('a scope or audience with nothing chosen is refused', async () => {
    const { promotionProblem } = await load()
    const ok = { type: 'percentage', percent_off: 10 }

    expect(promotionProblem({ ...ok, scope: { kind: 'storewide' }, targeting: { kind: 'all' } })).toBeNull()
    expect(promotionProblem({ ...ok, scope: { kind: 'products', productIds: [1] } })).toBeNull()
    expect(promotionProblem({ ...ok, scope: { kind: 'products', productIds: [] } })).toMatch(/product/i)
    expect(promotionProblem({ ...ok, scope: { kind: 'categories', categories: [] } })).toMatch(/categor/i)
    expect(promotionProblem({ ...ok, targeting: { kind: 'horecas', hoReCaIds: [] } })).toMatch(/customer/i)
    expect(promotionProblem({ ...ok, targeting: { kind: 'tier', tiers: [] } })).toMatch(/tier/i)
    expect(promotionProblem({ ...ok, targeting: { kind: 'rep', repUserId: 0 } })).toMatch(/rep/i)
  })

  it('a stored offer must hold real ids and whole quantities', async () => {
    const { promotionProblem } = await load()
    const bogo = { buyProductId: 1, buyQuantity: 2, getProductId: 1, getQuantity: 1 }

    expect(promotionProblem({ type: 'bogo', bogo_config: { ...bogo, getQuantity: 0.5 } })).toMatch(/quantities/i)
    expect(promotionProblem({ type: 'bogo', bogo_config: { ...bogo, buyProductId: '12' } })).toMatch(/product/i)
    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: ['a', 'b'], bundlePrice: 9 } })).toMatch(/products/i)
    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: [1, 1], bundlePrice: 9 } })).toMatch(/products/i)
    expect(promotionProblem({ type: 'bundle', bundle_config: { productIds: [1, 2], bundlePrice: '9' } })).toMatch(/price/i)
    expect(promotionProblem({ type: 'percentage', percent_off: 10, targeting: { kind: 'rep', repUserId: '12' } })).toMatch(/rep/i)
    expect(promotionProblem({ type: 'percentage', percent_off: 10, min_order_value: -5 })).toMatch(/minimum/i)
    expect(promotionProblem({ type: 'percentage', percent_off: 10, priority: 0 })).toMatch(/priority/i)
  })

  it('reads a stored value that comes back as text', async () => {
    const { promotionProblem } = await load()

    expect(promotionProblem({ type: 'percentage', percent_off: '15.00' as never })).toBeNull()
    expect(promotionProblem({ type: 'fixed_price', fixed_price: '3.00' as never })).toBeNull()
    expect(promotionProblem({ type: 'clearance', clearance_percent: '40.00' as never })).toBeNull()
    expect(promotionProblem({ type: 'percentage', percent_off: '' as never })).toMatch(/discount/i)
  })

  it('the limits match the form, and the wording', async () => {
    const { promotionProblem } = await load()

    expect(promotionProblem({ type: 'percentage', percent_off: 0.5 })).toMatch(/discount/i)
    expect(promotionProblem({ type: 'clearance', clearance_percent: 90 })).toBeNull()
    expect(promotionProblem({ type: 'clearance', clearance_percent: 95 })).toMatch(/90%/)
    expect(promotionProblem({ type: 'percentage', percent_off: 10, priority: 1.5 })).toMatch(/whole number/i)
  })

  it('only an on or off change is allowed on a promotion used on orders', async () => {
    const { isOnOffOnly } = await load()

    expect(isOnOffOnly({ is_active: false })).toBe(true)
    expect(isOnOffOnly({ is_active: false, name: 'New name' })).toBe(false)
    expect(isOnOffOnly({ percent_off: 50 })).toBe(false)
    expect(isOnOffOnly({})).toBe(false)
  })

  it('accepts the text ids promotions actually have', async () => {
    const { buildPromotionInputSchema } = await load()
    const schema = buildPromotionInputSchema(z)

    expect(schema.safeParse({ action: 'delete', id: 'PROMO-001' }).success).toBe(true)
    expect(schema.safeParse({ action: 'update', id: 'PROMO-001', data: { is_active: false } }).success).toBe(true)
    expect(schema.safeParse({ action: 'delete', id: '' }).success).toBe(false)
  })

  it('a create needs no id or created_by, and drops any a client sends', async () => {
    const { buildPromotionInputSchema } = await load()
    const parsed = buildPromotionInputSchema(z).parse({
      action: 'create',
      data: { ...base, type: 'percentage', percent_off: 10, id: 'mine', created_by: 'someone-else' },
    })

    expect(parsed.action).toBe('create')
    if (parsed.action !== 'create') return
    expect(parsed.data).not.toHaveProperty('id')
    expect(parsed.data).not.toHaveProperty('created_by')
    expect(parsed.data.name).toBe('Test')
  })

  it('an edit cannot change who created the promotion', async () => {
    const { buildPromotionInputSchema } = await load()
    const parsed = buildPromotionInputSchema(z).parse({
      action: 'update',
      id: 'PROMO-001',
      data: { name: 'New', created_by: 'someone-else' },
    })

    if (parsed.action !== 'update') throw new Error('expected an update')
    expect(parsed.data).not.toHaveProperty('created_by')
  })
})
