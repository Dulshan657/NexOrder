// Which decided kitchen orders a screen shows.
//
// Two screens, two different questions:
//
//   Order home      "what did I just get told no to?" -- MY rejected requests, not put
//                   away, from the last week. A prompt, so it expires and can be dismissed.
//   Order history   "what happened to everything that did not become an order?" -- every
//                   decided request (rejected or cancelled), mine as kitchen staff and the
//                   whole venue's as a Customer, however old. A record, so nothing hides it.
//
// "Mine" is `requestedBy === the signed-in login`, exactly as PendingQrRequests decides
// who gets a Cancel button: there is one hidden login per staff member, so a colleague's
// request is never mine even though the venue's RLS lets the phone read it.
//
// Pure: lists in, lists out, never mutating.

import type { QrOrderRequest } from '@/types'

/** How long after the decision the Order home card stays. */
export const NOT_APPROVED_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** True when this login sent the request. False for no login, or a sender whose profile is gone. */
export function isOwnRequest(request: Pick<QrOrderRequest, 'requestedBy'>, userId: string | null | undefined): boolean {
  return !!userId && request.requestedBy === userId
}

function decisionTime(request: Pick<QrOrderRequest, 'decidedAt' | 'createdAt'>): number {
  const t = Date.parse(request.decidedAt ?? request.createdAt)
  return Number.isNaN(t) ? 0 : t
}

export interface NotApprovedForHomeOptions {
  userId: string | null | undefined
  dismissed: readonly string[]
  /** Epoch ms; injected so age is testable. */
  now: number
}

/** My rejected requests that are recent and not put away, in the order given. */
export function notApprovedForHome(
  requests: readonly QrOrderRequest[],
  { userId, dismissed, now }: NotApprovedForHomeOptions,
): QrOrderRequest[] {
  return requests.filter(
    (r) =>
      r.status === 'rejected' &&
      isOwnRequest(r, userId) &&
      !dismissed.includes(r.id) &&
      now - decisionTime(r) <= NOT_APPROVED_CARD_MAX_AGE_MS,
  )
}

export interface DecidedForHistoryOptions {
  /** 'requester' = kitchen staff (own requests only); 'approver' = a Customer login (the venue's). */
  mode: 'requester' | 'approver'
  userId: string | null | undefined
}

/** Rejected and cancelled requests for the history page, in the order given. Never hidden by age. */
export function decidedForHistory(
  requests: readonly QrOrderRequest[],
  { mode, userId }: DecidedForHistoryOptions,
): QrOrderRequest[] {
  return requests.filter(
    (r) =>
      (r.status === 'rejected' || r.status === 'cancelled') && (mode === 'approver' || isOwnRequest(r, userId)),
  )
}
