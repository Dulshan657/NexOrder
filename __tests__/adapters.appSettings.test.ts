import { describe, it, expect } from 'vitest'

import { toAppSettings, fromAppSettings } from '../lib/adapters'
import type { AppSettings } from '../types'

// Full app_settings row (mig 00044 + 00088 + 00125 columns included).
const baseRow = {
  id: 1,
  company_name: 'NexGen',
  company_address: '1 Test St',
  company_phone: '+61 2 0000 0000',
  company_email: 'orders@nexgen.test',
  order_id_prefix: 'ORD',
  minimum_order_value: 50,
  default_credit_limit: 1000,
  carton_discount_percent: 5,
  low_stock_threshold: 10,
  currency: 'AUD',
  show_stock_to_horeca: true,
  company_logo_url: 'https://cdn.test/logo.webp',
  po_auto_approve_enabled: true,
  po_auto_approve_block_on_short_stock: false,
  po_auto_approve_block_on_sender_mismatch: true,
  po_auto_approve_block_on_customer_mismatch: true,
  pallet_footprint_length_mm: 1165,
  pallet_footprint_width_mm: 1165,
  pallet_base_height_mm: 150,
  pallet_max_load_height_mm: 1650,
} as Parameters<typeof toAppSettings>[0]

describe('toAppSettings / fromAppSettings', () => {
  it('round-trips a full settings object', () => {
    const app = toAppSettings(baseRow)
    const row = fromAppSettings(app)
    expect(row).toEqual({
      company_name: 'NexGen',
      company_address: '1 Test St',
      company_phone: '+61 2 0000 0000',
      company_email: 'orders@nexgen.test',
      order_id_prefix: 'ORD',
      minimum_order_value: 50,
      default_credit_limit: 1000,
      carton_discount_percent: 5,
      low_stock_threshold: 10,
      currency: 'AUD',
      show_stock_to_horeca: true,
      company_logo_url: 'https://cdn.test/logo.webp',
      po_auto_approve_enabled: true,
      po_auto_approve_block_on_short_stock: false,
      po_auto_approve_block_on_sender_mismatch: true,
      po_auto_approve_block_on_customer_mismatch: true,
      pallet_footprint_length_mm: 1165,
      pallet_footprint_width_mm: 1165,
      pallet_base_height_mm: 150,
      pallet_max_load_height_mm: 1650,
    })
  })

  it('falls back to the AU standard pallet on a pre-mig-00125 row', () => {
    // The migration seeds these as NOT NULL defaults, so a row without them is
    // one read between deploying the frontend and applying the migration. It
    // must not leave the product form computing against an undefined pallet.
    const legacy = { ...baseRow } as Record<string, unknown>
    delete legacy.pallet_footprint_length_mm
    delete legacy.pallet_footprint_width_mm
    delete legacy.pallet_base_height_mm
    delete legacy.pallet_max_load_height_mm
    const app = toAppSettings(legacy as Parameters<typeof toAppSettings>[0])
    expect(app.palletFootprintLengthMm).toBe(1165)
    expect(app.palletFootprintWidthMm).toBe(1165)
    expect(app.palletBaseHeightMm).toBe(150)
    expect(app.palletMaxLoadHeightMm).toBe(1650)
  })

  it('coerces numeric-string columns to numbers', () => {
    const row = {
      ...baseRow,
      minimum_order_value: '50.5',
      default_credit_limit: '1000',
      carton_discount_percent: '5',
    } as unknown as Parameters<typeof toAppSettings>[0]
    const app = toAppSettings(row)
    expect(app.minimumOrderValue).toBe(50.5)
    expect(app.defaultCreditLimit).toBe(1000)
    expect(app.cartonDiscountPercent).toBe(5)
  })

  it('defaults po_auto_approve_* to true when columns are absent (pre-mig-00044/00088 row)', () => {
    const legacy = { ...baseRow } as Record<string, unknown>
    delete legacy.po_auto_approve_enabled
    delete legacy.po_auto_approve_block_on_short_stock
    delete legacy.po_auto_approve_block_on_sender_mismatch
    delete legacy.po_auto_approve_block_on_customer_mismatch
    const app = toAppSettings(legacy as Parameters<typeof toAppSettings>[0])
    expect(app.poAutoApproveEnabled).toBe(true)
    expect(app.poAutoApproveBlockOnShortStock).toBe(true)
    expect(app.poAutoApproveBlockOnSenderMismatch).toBe(true)
    expect(app.poAutoApproveBlockOnCustomerMismatch).toBe(true)
  })

  it('preserves explicit false for po_auto_approve_* columns', () => {
    const app = toAppSettings(baseRow)
    expect(app.poAutoApproveBlockOnShortStock).toBe(false)
  })

  it('fromAppSettings({}) returns {} (partial patch support)', () => {
    expect(fromAppSettings({})).toEqual({})
  })

  it('fromAppSettings emits only the provided keys', () => {
    expect(fromAppSettings({ currency: 'USD' })).toEqual({ currency: 'USD' })
    expect(fromAppSettings({ companyLogoUrl: null })).toEqual({ company_logo_url: null })
  })

  it('fromAppSettings keeps explicit false values', () => {
    const patch: Partial<AppSettings> = { showStockToHoReCa: false, poAutoApproveEnabled: false }
    expect(fromAppSettings(patch)).toEqual({
      show_stock_to_horeca: false,
      po_auto_approve_enabled: false,
    })
  })
})
