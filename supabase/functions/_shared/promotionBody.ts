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
}

const positive = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * Why this promotion cannot be saved, in words for the person filling in the form, or null
 * when it can. A promotion with no real discount would go live and change nothing, or worse.
 */
export function promotionProblem(draft: PromotionDraft): string | null {
  switch (draft.type) {
    case 'percentage': {
      const value = draft.percent_off
      return positive(value) && (value as number) <= 100 ? null : 'Enter a discount between 1% and 100%.'
    }
    case 'fixed_price':
      return positive(draft.fixed_price) ? null : 'Enter a fixed price above zero.'
    case 'clearance': {
      const value = draft.clearance_percent
      return positive(value) && (value as number) <= 100 ? null : 'Enter a clearance discount between 1% and 100%.'
    }
    case 'bogo': {
      const config = (draft.bogo_config ?? {}) as Record<string, unknown>
      if (!positive(config.buyProductId) || !positive(config.getProductId)) return 'Choose the buy and free products.'
      if (!positive(config.buyQuantity) || !positive(config.getQuantity)) return 'Enter the buy and free quantities.'
      return null
    }
    case 'bundle': {
      const config = (draft.bundle_config ?? {}) as Record<string, unknown>
      const count = Array.isArray(config.productIds) ? config.productIds.length : 0
      if (count < 2 || count > 5) return 'Choose between 2 and 5 products for the bundle.'
      return positive(config.bundlePrice) ? null : 'Enter a bundle price above zero.'
    }
    default:
      return null
  }
}

/**
 * True when an update changes nothing but whether the promotion is on. That stays allowed on a
 * promotion already used on orders, which is otherwise frozen: turning it off rewrites nothing
 * on those orders, and without it a used promotion could never be stopped.
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
