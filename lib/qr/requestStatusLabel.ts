// What a held kitchen order is called, on the screen of whoever is looking at it.
//
// The wording is a product decision (2026-10-13), not a translation of the
// column: an approver saying no is "Not approved" -- never "Rejected" or
// "Declined", which read as a verdict on the cook -- and a withdrawal is
// "Cancelled by you" to the person who withdrew it but "Cancelled by staff" to
// the Customer or rep reading the venue's history, who is not that person.
//
// Pure: a label and a tone name, no React, no colours. The component owns which
// Tailwind classes a tone means, so a contrast fix touches one place.

import type { QrOrderRequestStatus } from '@/types'

/** Which side of the counter is reading. */
export type RequestViewer = 'requester' | 'approver'

export type RequestTone = 'red' | 'stone' | 'amber' | 'green'

export interface RequestStatusLabel {
  label: string
  tone: RequestTone
}

export function requestStatusLabel(status: QrOrderRequestStatus, viewer: RequestViewer): RequestStatusLabel {
  switch (status) {
    case 'rejected':
      return { label: 'Not approved', tone: 'red' }
    case 'cancelled':
      return { label: viewer === 'requester' ? 'Cancelled by you' : 'Cancelled by staff', tone: 'stone' }
    case 'approved':
      return { label: 'Approved', tone: 'green' }
    case 'approving':
      return { label: 'Being approved', tone: 'amber' }
    case 'pending':
      return { label: 'Waiting for approval', tone: 'amber' }
  }
}
