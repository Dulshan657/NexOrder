// The request body mutate-horeca validates for a customer (`horecas`) create or
// update, kept out of the function so it can be unit-tested -- and the rules the
// customer form checks before it sends anything, so the two cannot drift apart.
//
// The function imports zod from esm.sh, which vitest cannot load. This module
// imports nothing at runtime: it only TYPES zod, and `buildHorecaBodySchema`
// takes the namespace as an argument. The function passes in the zod it runs
// with; __tests__/horecaContactFields.test.ts passes in the client's `zod/v3`.
// The `import type` is erased by every compiler that runs this file except
// `deno check`, which is the one that resolves it.
//
// ONE SET OF RULES, TWO READERS. The limits, the messages and the ABN and email
// predicates below are used by BOTH the schema (the server's check) and
// `validateHoReCaContact` (the form's check). Change a rule here and both move.
// A save the form lets through and the server refuses is a closed dialog and a
// lost edit (NX-0018, found on dev as scenario S6), so the form must be at least
// as strict as the schema: __tests__/horecaContactFields.test.ts holds them to
// the same answer on the same values.

import type { z as Zod } from 'https://esm.sh/zod@3.23.8'

/** An ABN is exactly this many digits. */
export const ABN_DIGITS = 11

export const CONTACT_NAME_MAX = 100
export const PHONE_MAX = 40
export const EMAIL_MAX = 254 // RFC 5321 path limit
const BRAND_MAX = 100
const BRANDS_MAX = 50

/** What a person is told. Shared so the form and the server say the same thing. */
export const HORECA_FIELD_MESSAGES = {
  contactName: `Contact name is at most ${CONTACT_NAME_MAX} characters.`,
  phone: `Phone is at most ${PHONE_MAX} characters.`,
  abn: `An ABN is ${ABN_DIGITS} digits. Spaces are fine.`,
  billingEmail: 'Enter a full email address, like accounts@example.com.',
  billingEmailTooLong: `Billing email is at most ${EMAIL_MAX} characters.`,
} as const

/** An ABN as people write it ("51 824 753 556") with every whitespace character removed. */
export function normaliseAbn(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/** True when `raw`, once its spaces are removed, is exactly 11 digits. */
export function isValidAbn(raw: string): boolean {
  return new RegExp(`^\\d{${ABN_DIGITS}}$`).test(normaliseAbn(raw))
}

// The pattern zod's `.email()` applies (zod 3.23), held here so the form and the
// schema test the same thing. It needs a dot and a two-letter ending after the @,
// which is why `a@b` is refused here although a browser's <input type="email">
// accepts it.
const EMAIL_PATTERN = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i

/** True when `raw` is an email address a customer record may hold. Does not trim. */
export function isValidEmail(raw: string): boolean {
  return EMAIL_PATTERN.test(raw)
}

/** The four free-text contact fields as the form holds them, by their form names. */
export interface HoReCaContactInput {
  contactName?: string
  phone?: string
  abn?: string
  billingEmail?: string
}

export type HoReCaContactErrors = Partial<Record<keyof HoReCaContactInput, string>>

/**
 * The form's check of the contact fields: a message per field the server would
 * refuse, and nothing for a field it would accept. A blank (or all-spaces) field
 * is fine here: it means "clear this", and the form sends it as null.
 */
export function validateHoReCaContact(input: HoReCaContactInput): HoReCaContactErrors {
  const errors: HoReCaContactErrors = {}

  const contactName = (input.contactName ?? '').trim()
  if (contactName.length > CONTACT_NAME_MAX) errors.contactName = HORECA_FIELD_MESSAGES.contactName

  const phone = (input.phone ?? '').trim()
  if (phone.length > PHONE_MAX) errors.phone = HORECA_FIELD_MESSAGES.phone

  const abn = (input.abn ?? '').trim()
  if (abn !== '' && !isValidAbn(abn)) errors.abn = HORECA_FIELD_MESSAGES.abn

  const email = (input.billingEmail ?? '').trim()
  if (email.length > EMAIL_MAX) errors.billingEmail = HORECA_FIELD_MESSAGES.billingEmailTooLong
  else if (email !== '' && !isValidEmail(email)) errors.billingEmail = HORECA_FIELD_MESSAGES.billingEmail

  return errors
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
    contact_name: z.string().trim().min(1).max(CONTACT_NAME_MAX, HORECA_FIELD_MESSAGES.contactName).nullable().optional(),
    phone: z.string().trim().min(1).max(PHONE_MAX, HORECA_FIELD_MESSAGES.phone).nullable().optional(),
    // Spaces are dropped BEFORE the check and the stored value has none.
    abn: z
      .string()
      .transform(normaliseAbn)
      .refine(isValidAbn, HORECA_FIELD_MESSAGES.abn)
      .nullable()
      .optional(),
    billing_email: z
      .string()
      .trim()
      .max(EMAIL_MAX, HORECA_FIELD_MESSAGES.billingEmailTooLong)
      .refine(isValidEmail, HORECA_FIELD_MESSAGES.billingEmail)
      .nullable()
      .optional(),
    buys_brands: z.array(z.string().trim().min(1).max(BRAND_MAX)).max(BRANDS_MAX).optional(),
  })
}
