import { describe, expect, it } from 'vitest'
import { requestStatusLabel } from '@/lib/qr/requestStatusLabel'
import type { QrOrderRequestStatus } from '@/types'

// The wording is a product decision (2026-10-13): an approver saying no is
// "Not approved"; staff withdrawing their own order is "Cancelled by you" to
// them and "Cancelled by staff" to whoever approves.

describe('requestStatusLabel', () => {
  it('calls a rejection "Not approved", in red, for either side of the counter', () => {
    expect(requestStatusLabel('rejected', 'requester')).toEqual({ label: 'Not approved', tone: 'red' })
    expect(requestStatusLabel('rejected', 'approver')).toEqual({ label: 'Not approved', tone: 'red' })
  })

  it('tells the staff member they cancelled it, and tells an approver staff did', () => {
    expect(requestStatusLabel('cancelled', 'requester')).toEqual({ label: 'Cancelled by you', tone: 'stone' })
    expect(requestStatusLabel('cancelled', 'approver')).toEqual({ label: 'Cancelled by staff', tone: 'stone' })
  })

  it('has a plain label for every other status, never an empty one', () => {
    const others: QrOrderRequestStatus[] = ['pending', 'approving', 'approved']
    for (const status of others) {
      for (const viewer of ['requester', 'approver'] as const) {
        expect(requestStatusLabel(status, viewer).label.length, `${status}/${viewer}`).toBeGreaterThan(0)
      }
    }
  })

  it('never says "Rejected" or "Declined": the product word is "Not approved"', () => {
    for (const viewer of ['requester', 'approver'] as const) {
      expect(requestStatusLabel('rejected', viewer).label).not.toMatch(/reject|declin/i)
    }
  })
})
