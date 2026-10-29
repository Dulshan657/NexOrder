// The order status stored as 'processed' means an office user has checked and
// accepted the order. "Processed" read as "done" to the people using it (and to
// Nex), so it is SHOWN as "Confirmed". Only the label changes: the stored value,
// the database and the Edge Functions all still say 'processed'.

import { describe, expect, it } from 'vitest'
import { ORDER_STATUS_LABELS, ORDER_STATUS_SEQUENCE } from '../constants'

describe('ORDER_STATUS_LABELS', () => {
  it('shows the processed status as Confirmed', () => {
    expect(ORDER_STATUS_LABELS.processed).toBe('Confirmed')
    expect(ORDER_STATUS_SEQUENCE).toContain('processed')
  })

  it('uses no label twice, so no two stages read the same', () => {
    const labels = Object.values(ORDER_STATUS_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
