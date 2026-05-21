import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ApproveOverrides,
  type ApprovePoResponse,
  approvePo,
  countPendingPosNeedsReview,
  getPendingPoDetail,
  listCustomerAliases,
  listPendingPos,
  listProductAliases,
  type PendingPoDetailRow,
  type PendingPoStatus,
  type PendingPoSummaryRow,
  rejectPo,
} from '@/services/supabase/poInboxService'

const LIST_KEY = (status?: PendingPoStatus) => ['pending_pos', 'list', status ?? 'all'] as const
const DETAIL_KEY = (id: string) => ['pending_pos', 'detail', id] as const
const COUNT_KEY = ['pending_pos', 'count_needs_review'] as const
const ALIAS_LIST_KEY_CUSTOMER = ['po_aliases', 'customer'] as const
const ALIAS_LIST_KEY_PRODUCT = ['po_aliases', 'product'] as const

export function usePendingPos(status?: PendingPoStatus, options?: { enabled?: boolean }) {
  return useQuery<PendingPoSummaryRow[]>({
    queryKey: LIST_KEY(status),
    queryFn: () => listPendingPos(status),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  })
}

export function usePendingPoDetail(id: string | null) {
  return useQuery<PendingPoDetailRow>({
    queryKey: id ? DETAIL_KEY(id) : ['pending_pos', 'detail', '__none__'],
    queryFn: () => getPendingPoDetail(id as string),
    enabled: !!id,
    staleTime: 5_000,
  })
}

export function usePendingPoCount() {
  return useQuery<number>({
    queryKey: COUNT_KEY,
    queryFn: countPendingPosNeedsReview,
    staleTime: 30_000,
  })
}

export function useApprovePo() {
  const qc = useQueryClient()
  return useMutation<ApprovePoResponse, Error, { pendingPoId: string; overrides?: ApproveOverrides }>({
    mutationFn: ({ pendingPoId, overrides }) => approvePo(pendingPoId, overrides),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_pos'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useRejectPo() {
  const qc = useQueryClient()
  return useMutation<void, Error, { pendingPoId: string; rejectionReason: string }>({
    mutationFn: ({ pendingPoId, rejectionReason }) => rejectPo(pendingPoId, rejectionReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_pos'] })
    },
  })
}

export function useCustomerAliases() {
  return useQuery({
    queryKey: ALIAS_LIST_KEY_CUSTOMER,
    queryFn: listCustomerAliases,
    staleTime: 60_000,
  })
}

export function useProductAliases() {
  return useQuery({
    queryKey: ALIAS_LIST_KEY_PRODUCT,
    queryFn: listProductAliases,
    staleTime: 60_000,
  })
}
