// The request body mutate-horeca validates for a customer (`horecas`) create or
// update, kept out of the function so it can be unit-tested.
//
// The function imports zod from esm.sh, which vitest cannot load. This module
// imports nothing at runtime: it only TYPES zod, and `buildHorecaBodySchema`
// takes the namespace as an argument. The function passes in the zod it runs
// with; __tests__/horecaContactFields.test.ts passes in the client's `zod/v3`.
// The `import type` is erased by every compiler that runs this file except
// `deno check`, which is the one that resolves it.

import type { z as Zod } from 'https://esm.sh/zod@3.23.8'

/** An ABN is exactly this many digits. */
export const ABN_DIGITS = 11

const CONTACT_NAME_MAX = 100
const PHONE_MAX = 40
const EMAIL_MAX = 254 // RFC 5321 path limit
const BRAND_MAX = 100
const BRANDS_MAX = 50

/** An ABN as people write it ("51 824 753 556") with every whitespace character removed. */
export function normaliseAbn(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/** True when `raw`, once its spaces are removed, is exactly 11 digits. */
export function isValidAbn(raw: string): boolean {
  return new RegExp(`^\\d{${ABN_DIGITS}}$`).test(normaliseAbn(raw))
}

/**
 * The body of `create` (all fields, `name` and `address` required by the caller)
 * and `update` (any subset). Keys are the column names.
 *
 * `contact_name`, `phone`, `abn` and `billing_email` take null to clear them.
 * `buys_brands` is NOT NULL in the database, so it takes a list, empty to clear.
 * `billing_email` is a plain address with no uniqueness rule: customers in one
 * group share an inbox, which is why the column exists.
 */
export function buildHorecaBodySchema(z: typeof Zod) {
  return z.object({
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    discount_percent: z.number().min(0).max(50).nullable().optional(),
    credit_limit: z.number().min(0).nullable().optional(),
    show_stock_tab: z.boolean().nullable().optional(),
    tier: z.enum(['Gold', 'Silver', 'Bronze']).nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    is_temporary: z.boolean().optional(),
    created_by_user_id: z.string().uuid().nullable().optional(),
    reviewed_at: z.string().nullable().optional(),
    reviewed_by: z.string().nullable().optional(),
    contact_name: z.string().trim().min(1).max(CONTACT_NAME_MAX).nullable().optional(),
    phone: z.string().trim().min(1).max(PHONE_MAX).nullable().optional(),
    // Spaces are dropped BEFORE the check and the stored value has none.
    abn: z
      .string()
      .transform(normaliseAbn)
      .refine(isValidAbn, `ABN must be ${ABN_DIGITS} digits`)
      .nullable()
      .optional(),
    billing_email: z.string().trim().email().max(EMAIL_MAX).nullable().optional(),
    buys_brands: z.array(z.string().trim().min(1).max(BRAND_MAX)).max(BRANDS_MAX).optional(),
  })
}
