import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSettings,
  updateSettings,
} from '@/services/supabase/settingsService'
import type { Database } from '@/lib/database.types'

// settingsService references 'settings' but the Database type uses 'app_settings'.
// The Update type is derived from the database type that matches the actual table.
type SettingsUpdate = Database['public']['Tables']['app_settings']['Update']

export const settingsKeys = {
  all: ['settings'] as const,
} as const

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: getSettings,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: SettingsUpdate) => updateSettings(updates),
    onSuccess: (row) => {
      // The edge function returns the authoritative updated row — seed the
      // cache with it directly so consumers never see a stale window between
      // the mutation settling and a refetch landing.
      qc.setQueryData(settingsKeys.all, row)
    },
  })
}
