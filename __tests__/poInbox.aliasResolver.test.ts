import { describe, it, expect } from 'vitest'

import {
  CUSTOMER_AUTO_ALIAS_THRESHOLD,
  PRODUCT_AUTO_ALIAS_THRESHOLD,
} from '../supabase/functions/_shared/poInbox/aliasResolver'

// The aliasResolver module imports from openai.ts which uses fetch + env;
// vitest cannot exercise the network paths. These tests cover the exported
// constants + sanity-check that the file imports cleanly under Node.

describe('aliasResolver constants', () => {
  it('exports a customer-match threshold in the (0, 1] range', () => {
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBeGreaterThan(0)
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBeLessThanOrEqual(1)
  })

  it('exports a product-match threshold in the (0, 1] range', () => {
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBeGreaterThan(0)
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBeLessThanOrEqual(1)
  })

  it('uses the same threshold value the spec calls out (0.9)', () => {
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBe(0.9)
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBe(0.9)
  })
})
