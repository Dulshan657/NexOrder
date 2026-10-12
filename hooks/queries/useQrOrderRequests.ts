// TanStack Query bindings for held QR orders (services/supabase/qrService.ts ->
// qr-order-request + the qr_order_requests table).
//
//   kitchen (QR Staff)   useSubmitQrRequest, useCancelQrRequest, useQrOrderRequests
//   approvers            useQrOrderRequests, useQrRequestPreview,
//                        useApproveQrRequest, useRejectQrRequest
//
// Lists are keyed `['qr-order-requests', horecaId | 'all', status]` and kept
// fresh two ways: every mutation here invalidates the prefix, and the realtime
// channel (hooks/useRealtimeSubscriptions.ts) invalidates it when ANY client
// changes a request, so an approver's queue and a kitchen's "waiting for
// approval" banner move without a refresh.
//
// All errors are `QrApiError` (lib/qr/qrApiError.ts).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveQrRequest,
  cancelQrRequest,
  listQrRequests,
  previewQrRequest,
  rejectQrRequest,
  submitQrRequest,
  type QrApproveInput,
  type QrApproveResult,
  type QrLineInput,
  type QrPreviewResult,
  type QrRequestFilter,
  type QrSubmitInput,
  type QrSubmitResult,
} from '@/services/supabase/qrService'
import type { QrApiError } from '@/lib/qr/qrApiError'
import type { QrOrderRequest, QrOrderRequestStatus } from '@/types'
import { orderKeys } from './useOrders'
import { productKeys } from './useProducts'
import { invoiceKeys } from './useInvoices'
import { notificationKeys } from './useNotifications'

export const qrRequestKeys = {
  /** Every list, every preview. The realtime channel invalidates this. */
  all: ['qr-order-requests'] as const,
  list: (horecaId: number | 'all', status: string) => ['qr-order-requests', horecaId, status] as const,
  /** Server pricing of one request. A separate root so a list refresh does not re-price a review in progress. */
  preview: (requestId: string, itemsKey: string) => ['qr-order-preview', requestId, itemsKey] as const,
  previews: ['qr-order-preview'] as const,
} as const

/** `undefined` -> 'any'; several statuses -> sorted and comma-joined, so order does not matter. */
export function qrStatusKey(status: QrOrderRequestStatus | QrOrderRequestStatus[] | undefined): string {
  if (status === undefined) return 'any'
  return Array.isArray(status) ? [...status].sort().join(',') : status
}

const LIST_STALE_MS = 15_000

export interface UseQrOrderRequestsOptions extends QrRequestFilter {
  enabled?: boolean
}

/**
 * Held orders, newest first. `horecaId` omitted = every venue the caller may see
 * (RLS narrows it). For a QR Staff session whose unlock has lapsed the server
 * returns nothing, so the list simply goes empty.
 */
export function useQrOrderRequests({ enabled = true, ...filter }: UseQrOrderRequestsOptions = {}) {
  return useQuery<QrOrderRequest[]>({
    queryKey: qrRequestKeys.list(filter.horecaId ?? 'all', qrStatusKey(filter.status)),
    queryFn: () => listQrRequests(filter),
    enabled,
    staleTime: LIST_STALE_MS,
  })
}

/** The requests waiting on an approver (or on the kitchen, from their side), newest first. */
export function usePendingQrRequests(horecaId?: number, opts: { enabled?: boolean } = {}) {
  return useQrOrderRequests({ horecaId, status: 'pending', ...opts })
}

function itemsKey(items: QrLineInput[] | undefined): string {
  if (!items) return 'as-requested'
  return items.map((i) => `${i.productId}:${i.uomId ?? ''}:${i.packSize ?? ''}:${i.quantity}`).join('|')
}

/**
 * The server's pricing + every problem for a request, as it stands or with the
 * approver's edited `items`. Re-runs when `items` change and keeps the previous
 * figures on screen meanwhile, so editing a quantity does not blank the modal.
 * Never cached: a stock level or credit balance from a minute ago is a lie.
 */
export function useQrRequestPreview(
  requestId: string | null | undefined,
  items?: QrLineInput[],
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery<QrPreviewResult, QrApiError>({
    queryKey: qrRequestKeys.preview(requestId ?? '', itemsKey(items)),
    queryFn: () => previewQrRequest(requestId as string, items),
    enabled: enabled && !!requestId,
    staleTime: 0,
    gcTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

/** `mutate(input)` -> `{ requestId, quotedTotal, ... }`. QR Staff only. */
export function useSubmitQrRequest() {
  const qc = useQueryClient()
  return useMutation<QrSubmitResult, QrApiError, QrSubmitInput>({
    mutationFn: (input) => submitQrRequest(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qrRequestKeys.all })
    },
  })
}

/** `mutate(requestId)`. QR Staff withdrawing their own pending request. */
export function useCancelQrRequest() {
  const qc = useQueryClient()
  return useMutation<void, QrApiError, string>({
    mutationFn: (requestId) => cancelQrRequest(requestId),
    // Settled, not success: a QR_REQUEST_CONFLICT ("already approved") means the
    // list on screen is stale, and refreshing it is the right response.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qrRequestKeys.all })
    },
  })
}

/**
 * `mutate({ requestId, items?, notes? })`. Places the REAL order, so besides the
 * requests it refreshes everything an order touches: orders, product stock,
 * invoices and notifications. Invalidates on failure too -- a business-rule
 * refusal reverts the claim and sets `lastError`, which the list should show.
 */
export function useApproveQrRequest() {
  const qc = useQueryClient()
  return useMutation<QrApproveResult, QrApiError, QrApproveInput>({
    mutationFn: (input) => approveQrRequest(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qrRequestKeys.all })
      qc.invalidateQueries({ queryKey: qrRequestKeys.previews })
      qc.invalidateQueries({ queryKey: orderKeys.all })
      qc.invalidateQueries({ queryKey: productKeys.all })
      qc.invalidateQueries({ queryKey: invoiceKeys.all })
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

export interface RejectQrRequestVars {
  requestId: string
  /** 3-500 characters; the requester is told it. */
  reason: string
}

export function useRejectQrRequest() {
  const qc = useQueryClient()
  return useMutation<void, QrApiError, RejectQrRequestVars>({
    mutationFn: (v) => rejectQrRequest(v.requestId, v.reason),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qrRequestKeys.all })
      qc.invalidateQueries({ queryKey: qrRequestKeys.previews })
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}
