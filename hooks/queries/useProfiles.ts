import { useQuery } from '@tanstack/react-query'
import { listProfiles } from '@/services/supabase/authService'

export const profileKeys = {
  all: ['profiles'] as const,
} as const

export function useProfiles() {
  return useQuery({
    queryKey: profileKeys.all,
    queryFn: () => listProfiles(),
    staleTime: 10 * 60 * 1000,
  })
}
