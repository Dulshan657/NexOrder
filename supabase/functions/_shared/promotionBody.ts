// The request mutate-promotion validates, and the rules PromotionForm checks before it sends
// anything, kept out of the function so they can be unit-tested and cannot drift apart.
//
// The function imports zod from esm.sh, which vitest cannot load. This module imports nothing
// at runtime: it only TYPES zod, and `buildPromotionInputSchema` takes the namespace as an
// argument. See horecaBody.ts, which set the pattern.
//
// `id` and `created_by` are NOT accepted from a client. The server sets both on a create. From
// 2026-04-29 to NX-0024 the create schema REQUIRED `created_by`, which the app never sent, and
// edit and delete required a UUID when every id is text such as PROMO-001, so no promotion
// could be saved from the app by anyone.

import type { z as Zod } from 'https://esm.sh/zod@3.23.8'

export interface PromotionDraft {
  type?: string | null
  percent_off?: number | null
  fixed_price?: number | null
  clearance_percent?: number | null
  bogo_config?: unknown
  bundle_config?: unknown
  scope?: unknown
  targeting?: unknown
  priority?: number | null
  min_order_value?: number | null
}

// A numeric column can read back as text ("15.00") depending on the client, and an update
// checks the stored row merged with the change.
const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
}

// Inside a stored config, which no schema types: pricing compares these with ===, so a string
// would save and then silently never apply.
const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value > 0

const positive = (value: unknown): boolean => {
  const number = toNumber(value)
  return Number.isFinite(number) && number > 0
}

/**
 * Why this promotion cannot be saved, in words for the person filling in the form, or null
 * when it can. A promotion with no real discount, or that can apply to nothing, would go live
 * and change nothing, or worse.
 */
export function promotionProblem(draft: PromotionDraft): string | null {
  return valueProblem(draft) ?? audienceProblem(draft)
}

// Reads only the kinds the app writes. Dev's PROMO-006 carries an older 'hoReCas' kind, which
// must not stop it being saved.
function audienceProblem(draft: PromotionDraft): string | null {
  if (draft.priority != null && (!Number.isInteger(draft.priority) || draft.priority < 1)) return 'Priority must be a whole number of 1 or more.'
  if (draft.min_order_value != null && toNumber(draft.min_order_value) < 0) return 'A minimum order cannot be negative.'

  const scope = (draft.scope ?? {}) as Record<string, unknown>
  const none = (list: unknown): boolean => !Array.isArray(list) || list.length === 0
  if (scope.kind === 'products' && none(scope.productIds)) return 'Choose at least one product, or apply it storewide.'
  if (scope.kind === 'categories' && none(scope.categories)) return 'Choose at least one category, or apply it storewide.'

  const targeting = (draft.targeting ?? {}) as Record<string, unknown>
  if (targeting.kind === 'horecas' && none(targeting.hoReCaIds)) return 'Choose at least one customer, or target everyone.'
  if (targeting.kind === 'tier' && none(targeting.tiers)) return 'Choose at least one tier, or target everyone.'
  if (targeting.kind === 'rep' && !isCount(targeting.repUserId)) return 'Choose a rep, or target everyone.'
  return null
}

function valueProblem(draft: PromotionDraft): string | null {
  const inRange = (value: unknown, max: number): boolean => {
    const number = toNumber(value)
    return number >= 1 && number <= max
  }

  switch (draft.type) {
    case 'percentage':
      return inRange(draft.percent_off, 100) ? null : 'Enter a discount between 1% and 100%.'
    case 'fixed_price':
      return positive(draft.fixed_price) ? null : 'Enter a fixed price above zero.'
    case 'clearance':
      return inRange(draft.clearance_percent, 90) ? null : 'Enter a clearance discount between 1% and 90%.'
    case 'bogo': {
      const config = (draft.bogo_config ?? {}) as Record<string, unknown>
      if (!isCount(config.buyProductId) || !isCount(config.getProductId)) return 'Choose the buy and free products.'
      if (!isCount(config.buyQuantity) || !isCount(config.getQuantity)) return 'Enter whole buy and free quantities.'
      return null
    }
    case 'bundle': {
      const config = (draft.bundle_config ?? {}) as Record<string, unknown>
      const ids = Array.isArray(config.productIds) ? config.productIds : []
      if (ids.length < 2 || ids.length > 5 || !ids.every(isCount) || new Set(ids).size !== ids.length) {
        return 'Choose between 2 and 5 different products for the bundle.'
      }
      return typeof config.bundlePrice === 'number' && positive(config.bundlePrice) ? null : 'Enter a bundle price above zero.'
    }
    default:
      return null
  }
}

/**
 * True when an update changes nothing but whether the promotion is on. That stays allowed on a
 * promotion an order records as used, which is otherwise frozen: turning it off rewrites nothing
 * on those orders, and without it a used promotion could never be stopped.
 *
 * Orders record bundle promotions only (`placeOrderCore`), so only bundles are ever frozen.
 */
export function isOnOffOnly(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data)
  return keys.length === 1 && keys[0] === 'is_active'
}

export function buildPromotionInputSchema(z: typeof Zod) {
  const promotionType = z.enum(['percentage', 'fixed_price', 'bogo', 'bundle', 'clearance'])

  // All fields optional for a partial update. Unknown keys, `id` and `created_by` among them,
  // are stripped by z.object.
  const body = z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    type: promotionType.optional(),
    percent_off: z.number().min(0).max(100).nullable().optional(),
    fixed_price: z.number().min(0).nullable().optional(),
    bogo_config: z.unknown().nullable().optional(),
    bundle_config: z.unknown().nullable().optional(),
    clearance_percent: z.number().min(0).max(100).nullable().optional(),
    scope: z.unknown().optional(),
    targeting: z.unknown().optional(),
    min_order_value: z.number().min(0).nullable().optional(),
    stack_with_horeca_pricing: z.boolean().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    priority: z.number().int().optional(),
    // Frontend-level field captured in spec; not a DB column — used for carton check
    applies_to: z.enum(['unit', 'carton']).optional(),
  })

  // Required fields when creating
  const createBody = body.extend({
    name: z.string().min(1),
    type: promotionType,
    scope: z.unknown(),
    targeting: z.unknown(),
    stack_with_horeca_pricing: z.boolean(),
    is_active: z.boolean(),
    priority: z.number().int(),
  })

  const id = z.string().min(1).max(100)

  return z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), data: createBody }),
    z.object({ action: z.literal('update'), id, data: body }),
    z.object({ action: z.literal('delete'), id }),
  ])
}
