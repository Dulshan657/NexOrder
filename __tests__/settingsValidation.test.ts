import { describe, it, expect } from 'vitest'

import { validateSettings } from '../lib/settingsValidation'

describe('validateSettings', () => {
  it('returns {} for an empty draft', () => {
    expect(validateSettings({})).toEqual({})
  })

  it('returns {} for a fully valid draft', () => {
    expect(
      validateSettings({
        companyEmail: 'orders@company.com',
        orderIdPrefix: 'ORD',
        minimumOrderValue: 0,
        cartonDiscountPercent: 50,
        lowStockThreshold: 1,
        defaultCreditLimit: 0,
      }),
    ).toEqual({})
  })

  describe('companyEmail', () => {
    it('flags a malformed email', () => {
      expect(validateSettings({ companyEmail: 'not-an-email' })).toHaveProperty('companyEmail')
      expect(validateSettings({ companyEmail: 'a@b' })).toHaveProperty('companyEmail')
    })

    it('allows empty email (optional field)', () => {
      expect(validateSettings({ companyEmail: '' })).toEqual({})
      expect(validateSettings({ companyEmail: '   ' })).toEqual({})
    })
  })

  describe('orderIdPrefix', () => {
    it('flags an empty prefix', () => {
      expect(validateSettings({ orderIdPrefix: '' })).toHaveProperty('orderIdPrefix')
    })

    it('flags a 7-character prefix', () => {
      expect(validateSettings({ orderIdPrefix: 'ABCDEFG' })).toHaveProperty('orderIdPrefix')
    })

    it('flags lowercase characters', () => {
      expect(validateSettings({ orderIdPrefix: 'ord' })).toHaveProperty('orderIdPrefix')
    })

    it('allows 1-6 uppercase alphanumerics', () => {
      expect(validateSettings({ orderIdPrefix: 'A' })).toEqual({})
      expect(validateSettings({ orderIdPrefix: 'AB12CD' })).toEqual({})
    })
  })

  describe('numeric bounds', () => {
    it('flags negative minimum order value', () => {
      expect(validateSettings({ minimumOrderValue: -1 })).toHaveProperty('minimumOrderValue')
    })

    it('flags carton discount above 50', () => {
      expect(validateSettings({ cartonDiscountPercent: 51 })).toHaveProperty('cartonDiscountPercent')
    })

    it('flags negative carton discount', () => {
      expect(validateSettings({ cartonDiscountPercent: -0.5 })).toHaveProperty('cartonDiscountPercent')
    })

    it('flags low stock threshold of 0', () => {
      expect(validateSettings({ lowStockThreshold: 0 })).toHaveProperty('lowStockThreshold')
    })

    it('flags negative default credit limit', () => {
      expect(validateSettings({ defaultCreditLimit: -100 })).toHaveProperty('defaultCreditLimit')
    })

    it('flags non-finite numbers', () => {
      expect(validateSettings({ minimumOrderValue: NaN })).toHaveProperty('minimumOrderValue')
      expect(validateSettings({ lowStockThreshold: Infinity })).toHaveProperty('lowStockThreshold')
    })
  })

  it('collects multiple errors at once', () => {
    const errors = validateSettings({
      companyEmail: 'bad',
      orderIdPrefix: 'toolong7',
      cartonDiscountPercent: 99,
    })
    expect(Object.keys(errors).sort()).toEqual([
      'cartonDiscountPercent',
      'companyEmail',
      'orderIdPrefix',
    ])
  })
})
