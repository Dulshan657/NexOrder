import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
} from '@/services/supabase/notificationService'
import type { Database } from '@/lib/database.types'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']

// Notifications are polled more frequently than the global default (5 min)
// because users expect near-real-time awareness of order and route events.
const NOTIFICATION_STALE_TIME = 30 * 1000 // 30 seconds

export const notificationKeys = {
  all: ['notifications'] as const,
  forUser: (userId: string, userRole: string) =>
    ['notifications', userId, userRole] as const,
} as const

export function useNotifications(
  userId: string | null | undefined,
  userRole: string | null | undefined
) {
  return useQuery({
    queryKey: notificationKeys.forUser(userId ?? '', userRole ?? ''),
    queryFn: () => getNotifications(userId!, userRole!),
    enabled: !!userId && !!userRole,
    staleTime: NOTIFICATION_STALE_TIME,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => markAsRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => markAllAsRead(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

export function useCreateNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notification: NotificationInsert) =>
      createNotification(notification),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}
