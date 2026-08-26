// Pure per-field validators for app settings. Returns a map of field → message;
// an empty object means the draft is valid. Only validates keys that are present
// in the partial draft, so per-tab drafts only surface their own errors.

import type { AppSettings } from '../types'

export type SettingsErrors = Partial<Record<keyof AppSettings, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORDER_PREFIX_RE = /^[A-Z0-9]{1,6}$/

export function validateSettings(draft: Partial<AppSettings>): SettingsErrors {
  const errors: SettingsErrors = {}

  // Pallet spec (mig 00125). Bounds mirror the CHECK, so a bad figure is
  // refused here with a sentence instead of arriving as a 500 from Postgres.
  // A zero footprint or load height would make `computePalletFit` refuse for
  // every product at once, which reads as the whole feature being broken.
  const mm = (
    key: 'palletFootprintLengthMm' | 'palletFootprintWidthMm'
      | 'palletBaseHeightMm' | 'palletMaxLoadHeightMm',
    min: number,
    max: number,
  ) => {
    const v = draft[key]
    if (v === undefined) return
    if (!Number.isInteger(v) || v < min || v > max) {
      errors[key] = `Must be a whole number of millimetres between ${min} and ${max}.`
    }
  }
  mm('palletFootprintLengthMm', 1, 10000)
  mm('palletFootprintWidthMm', 1, 10000)
  mm('palletBaseHeightMm', 0, 2000)
  mm('palletMaxLoadHeightMm', 1, 10000)

  // Email is optional; validate format only when a non-empty value is present.
  if (
    draft.companyEmail !== undefined &&
    draft.companyEmail.trim() !== '' &&
    !EMAIL_RE.test(draft.companyEmail.trim())
  ) {
    errors.companyEmail = 'Enter a valid email address.'
  }

  if (draft.orderIdPrefix !== undefined && !ORDER_PREFIX_RE.test(draft.orderIdPrefix)) {
    errors.orderIdPrefix = 'Use 1–6 characters: A–Z or 0–9.'
  }

  if (
    draft.minimumOrderValue !== undefined &&
    (!Number.isFinite(draft.minimumOrderValue) || draft.minimumOrderValue < 0)
  ) {
    errors.minimumOrderValue = 'Must be 0 or more.'
  }

  if (
    draft.cartonDiscountPercent !== undefined &&
    (!Number.isFinite(draft.cartonDiscountPercent) ||
      draft.cartonDiscountPercent < 0 ||
      draft.cartonDiscountPercent > 50)
  ) {
    errors.cartonDiscountPercent = 'Must be between 0 and 50.'
  }

  if (
    draft.lowStockThreshold !== undefined &&
    (!Number.isFinite(draft.lowStockThreshold) || draft.lowStockThreshold < 1)
  ) {
    errors.lowStockThreshold = 'Must be 1 or more.'
  }

  if (
    draft.defaultCreditLimit !== undefined &&
    (!Number.isFinite(draft.defaultCreditLimit) || draft.defaultCreditLimit < 0)
  ) {
    errors.defaultCreditLimit = 'Must be 0 or more.'
  }

  return errors
}
