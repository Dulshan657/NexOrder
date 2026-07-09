import { describe, it, expect } from 'vitest'

import { pickSettings, diffSettings } from '../lib/settingsDraft'
import type { AppSettings } from '../types'

const base: AppSettings = {
  companyName: 'NexGen',
  companyAddress: '1 Test St',
  companyPhone: '+61 2 0000 0000',
  companyEmail: 'orders@nexgen.test',
  orderIdPrefix: 'ORD',
  minimumOrderValue: 50,
  defaultCreditLimit: 1000,
  cartonDiscountPercent: 5,
  lowStockThreshold: 10,
  currency: 'AUD',
  showStockToHoReCa: true,
  companyLogoUrl: 'https://cdn.test/logo.webp',
  poAutoApproveEnabled: true,
  poAutoApproveBlockOnShortStock: true,
  poAutoApproveBlockOnSenderMismatch: true,
}

describe('pickSettings', () => {
  it('returns only the requested keys', () => {
    const picked = pickSettings(base, ['companyName', 'currency'])
    expect(picked).toEqual({ companyName: 'NexGen', currency: 'AUD' })
  })

  it('does not mutate the source object', () => {
    const snapshot = { ...base }
    pickSettings(base, ['companyName'])
    expect(base).toEqual(snapshot)
  })
})

describe('diffSettings', () => {
  it('returns {} when the draft is clean', () => {
    const picked = pickSettings(base, ['companyName', 'minimumOrderValue'])
    expect(diffSettings(picked, { ...picked })).toEqual({})
  })

  it('returns only changed keys', () => {
    const picked = pickSettings(base, ['companyName', 'companyEmail', 'currency'])
    const draft = { ...picked, currency: 'USD' }
    expect(diffSettings(picked, draft)).toEqual({ currency: 'USD' })
  })

  it('treats companyLogoUrl null vs undefined as a change', () => {
    const withNull = pickSettings({ ...base, companyLogoUrl: null }, ['companyLogoUrl'])
    const withUndefined = pickSettings({ ...base, companyLogoUrl: undefined }, ['companyLogoUrl'])
    expect(diffSettings(withUndefined, withNull)).toEqual({ companyLogoUrl: null })
    // null → null is clean
    expect(diffSettings(withNull, { ...withNull })).toEqual({})
  })

  it('does not conflate numbers with string-numbers', () => {
    const picked = pickSettings(base, ['minimumOrderValue'])
    const draft = { minimumOrderValue: '50' as unknown as number }
    expect(diffSettings(picked, draft)).toEqual({ minimumOrderValue: '50' })
  })

  it('detects boolean flips', () => {
    const picked = pickSettings(base, ['showStockToHoReCa', 'lowStockThreshold'])
    const draft = { ...picked, showStockToHoReCa: false }
    expect(diffSettings(picked, draft)).toEqual({ showStockToHoReCa: false })
  })
})
