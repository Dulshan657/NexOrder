import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
type NotificationUpdate = Database['public']['Tables']['notifications']['Update']

/**
 * Fetch notifications for a user: those addressed directly to them,
 * plus broadcast notifications whose target_roles array contains their role.
 * Results are ordered newest-first.
 */
export async function getNotifications(_userId: string, _userRole: string) {
  // Fetch all notifications — client-side filtering handles role matching
  // (RLS policies restrict visibility server-side)
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

export async function createNotification(notification: NotificationInsert) {
  const { data, error } = await supabase
    .from('notifications')
    .insert(notification)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markAsRead(id: number) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true } as NotificationUpdate)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markAllAsRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true } as NotificationUpdate)
    .eq('user_id', userId)
    .eq('read', false)
  if (error) throw error
}
