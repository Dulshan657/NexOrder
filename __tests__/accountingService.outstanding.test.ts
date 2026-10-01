import { describe, it, expect } from 'vitest'

import { getHoReCaOutstanding } from '../services/accountingService'
import type { Invoice, InvoiceStatus } from '../types'

const inv = (id: string, status: InvoiceStatus, amount: number): Invoice => ({
  id,
  orderId: `ORD-${id}`,
  hoReCaId: 1,
  hoReCaName: 'Cafe',
  amount,
  dueDate: '2026-01-01',
  status,
  createdDate: '2025-12-01',
})

describe('getHoReCaOutstanding', () => {
  it('counts pending and overdue invoices as owed', () => {
    const out = getHoReCaOutstanding(1, 'Cafe', [inv('a', 'pending', 100), inv('b', 'overdue', 50)])
    expect(out.totalOutstanding).toBe(150)
  })

  it('does not count paid or cancelled invoices as owed', () => {
    const out = getHoReCaOutstanding(1, 'Cafe', [
      inv('a', 'pending', 100),
      inv('b', 'paid', 70),
      inv('c', 'cancelled', 900),
    ])
    expect(out.totalOutstanding).toBe(100)
    expect(out.isBlocked).toBe(true) // the pending one is 90+ days past due
  })

  it('does not block a customer whose only old invoice was cancelled', () => {
    const out = getHoReCaOutstanding(1, 'Cafe', [inv('c', 'cancelled', 900)])
    expect(out.totalOutstanding).toBe(0)
    expect(out.isBlocked).toBe(false)
  })
})
