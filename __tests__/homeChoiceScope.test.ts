// NX-0033 M3: home-bin-choices gives the stop's own line its space back
// (p_exclude_rec_ids). Only a line that IS this stop's may do that: an open line
// of the same product at the same warehouse. Any other id would hand back
// space it never held, and a bin would show room it does not have.

import { describe, expect, it } from 'vitest'
import {
  REC_OUT_OF_SCOPE,
  recommendationScopeRefusal,
} from '../supabase/functions/_shared/homeChoiceScope'

const scope = { productId: 77, warehouseId: 2873 }
const rec = (o: Partial<{ product_id: number; warehouse_id: number; status: string }> = {}) => ({
  product_id: 77, warehouse_id: 2873, status: 'assigned', ...o,
})

describe('recommendationScopeRefusal', () => {
  it('accepts an open line of this product at this warehouse', () => {
    expect(recommendationScopeRefusal(rec(), scope)).toBeNull()
    expect(recommendationScopeRefusal(rec({ status: 'suggested' }), scope)).toBeNull()
  })

  it('refuses a line that does not exist, of another product, or at another warehouse', () => {
    expect(recommendationScopeRefusal(null, scope)).toBe(REC_OUT_OF_SCOPE)
    expect(recommendationScopeRefusal(rec({ product_id: 78 }), scope)).toBe(REC_OUT_OF_SCOPE)
    expect(recommendationScopeRefusal(rec({ warehouse_id: 2874 }), scope)).toBe(REC_OUT_OF_SCOPE)
  })

  it('refuses a line that is no longer open', () => {
    for (const status of ['accepted', 'overridden', 'short', 'expired', 'rejected']) {
      expect(recommendationScopeRefusal(rec({ status }), scope)).toBe(REC_OUT_OF_SCOPE)
    }
  })

  it('says so in words a person can act on', () => {
    expect(REC_OUT_OF_SCOPE).toBe('recommendationId must be an open putaway line of this product at this warehouse')
  })
})
