// The fields mutate-app-settings may update, kept out of the function so the
// schema can be unit-tested (__tests__/mutateAppSettings.test.ts).
//
// The function imports zod from esm.sh, which vitest cannot load. This module
// imports nothing at runtime: it only TYPES zod, and `buildSettingsDataSchema`
// takes the namespace as an argument (the pattern of _shared/horecaBody.ts).
// A key missing from this schema is stripped silently, so a toggle for it
// would appear to save and then revert on reload.

import type { z as Zod } from 'https://esm.sh/zod@3.23.8'

// Only the updatable fields are accepted; id and non-numeric fields are
// accepted as-is without range constraints (company name, address, etc.).
export function buildSettingsDataSchema(z: typeof Zod) {
  return z.object({
    company_name: z.string().min(1).optional(),
    company_address: z.string().optional(),
    company_phone: z.string().optional(),
    company_email: z.string().email().optional(),
    order_id_prefix: z.string().min(1).optional(),
    currency: z.string().min(1).optional(),
    show_stock_to_horeca: z.boolean().optional(),
    company_logo_url: z.string().url().nullable().optional(),
    // PO-Inbox auto-approval policy toggles (migs 00044, 00088). A key missing
    // from this schema is stripped silently, so the toggle would appear to save
    // and then revert on reload.
    po_auto_approve_enabled: z.boolean().optional(),
    po_auto_approve_block_on_short_stock: z.boolean().optional(),
    po_auto_approve_block_on_sender_mismatch: z.boolean().optional(),
    po_auto_approve_block_on_customer_mismatch: z.boolean().optional(),
    // Business-rule validated numerics
    minimum_order_value: z.number().min(0).optional(),
    default_credit_limit: z.number().min(0).optional(),
    carton_discount_percent: z.number().min(0).max(50).optional(),
    low_stock_threshold: z.number().min(0).optional(),
    // Global pallet spec (mig 00125), in whole millimetres. NOT NULL columns
    // with defaults, and the settings draft only ever emits changed keys with
    // real values — so `.optional()` is right here and `.nullable()` would be
    // wrong: it would admit a null the column rejects. The bounds mirror the
    // CHECK so a refusal reads as a message rather than a 500.
    pallet_footprint_length_mm: z.number().int().min(1).max(10000).optional(),
    pallet_footprint_width_mm: z.number().int().min(1).max(10000).optional(),
    pallet_base_height_mm: z.number().int().min(0).max(2000).optional(),
    pallet_max_load_height_mm: z.number().int().min(1).max(10000).optional(),
    // NX-0049: the owner's "space is unlimited for now" for putaway. Read by
    // the planner, home-bin health and wie_home_block (mig 00151).
    putaway_ignore_capacity: z.boolean().optional(),
  })
}
