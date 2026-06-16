import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  disconnectEmailAccount,
  type EmailAccountProvider,
  type EmailAccountRow,
  listEmailAccounts,
  pauseEmailAccount,
  retryEmailAccount,
  startOAuthFlow,
} from '@/services/supabase/emailAccountsService'

const QUERY_KEY = ['email_accounts'] as const

export function useEmailAccounts() {
  return useQuery<EmailAccountRow[]>({
    queryKey: QUERY_KEY,
    queryFn: listEmailAccounts,
    staleTime: 30_000,
  })
}

export function useStartOAuthFlow() {
  return useMutation({
    mutationFn: (provider: EmailAccountProvider) => startOAuthFlow(provider),
  })
}

export function usePauseEmailAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, desiredStatus }: { id: string; desiredStatus: 'active' | 'paused' }) =>
      pauseEmailAccount(id, desiredStatus),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}

export function useDisconnectEmailAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (emailAccountId: string) => disconnectEmailAccount(emailAccountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}

export function useRetryEmailAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (emailAccountId: string) => retryEmailAccount(emailAccountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}
