// A QrOrderRequest with sensible defaults, for the tests of the "Not approved"
// surfaces (home card, order history, resend). Override only what the test is about.

import type { QrOrderRequest } from '@/types'

export function mkQrRequest(over: Partial<QrOrderRequest> = {}): QrOrderRequest {
  return {
    id: 'req-1',
    horecaId: 7,
    requestedBy: 'staff-sam',
    qrStaffId: 's1',
    staffName: 'Sam',
    status: 'rejected',
    items: [
      { productId: 1, quantity: 3, packSize: null, uomId: null, productName: 'Tomato Paste' },
      { productId: 2, quantity: 1, packSize: null, uomId: null, productName: 'Chilli Oil' },
    ],
    notes: null,
    deliveryDate: null,
    deliveryTimeSlot: null,
    deliveryAddress: null,
    quotedTotal: 22,
    createdAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    decidedBy: 'approver-1',
    decisionReason: 'Out of season',
    lastError: null,
    editedByApprover: false,
    approvedOrderId: null,
    ...over,
  }
}

/** An ISO time `ms` before now. */
export const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
