import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type EmailAccountProvider,
  type EmailAccountRow,
  listEmailAccounts,
  pauseEmailAccount,
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
