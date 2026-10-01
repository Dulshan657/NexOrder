import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import type { Database } from '@/lib/database.types'

type ScheduledVisitRow = Database['public']['Tables']['scheduled_visits']['Row']
type ScheduledVisitInsert = Database['public']['Tables']['scheduled_visits']['Insert']
type ScheduledVisitUpdate = Database['public']['Tables']['scheduled_visits']['Update']
type ScheduledVisitStatus = ScheduledVisitRow['status']

export interface ScheduledVisitFilters {
  assignedTo?: string
  createdBy?: string
  status?: ScheduledVisitStatus
}

export async function getScheduledVisits(filters: ScheduledVisitFilters = {}) {
  const build = () => {
    let query = supabase
      .from('scheduled_visits')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')

    if (filters.assignedTo !== undefined) {
      query = query.eq('assigned_to', filters.assignedTo)
    }
    if (filters.createdBy !== undefined) {
      query = query.eq('created_by', filters.createdBy)
    }
    if (filters.status !== undefined) {
      query = query.eq('status', filters.status)
    }

    return query
  }
  // Paged past the API row cap (lib/fetchAllRows); `id` makes the order unique.
  return fetchAllRows((from, to) => build().range(from, to))
}

export async function getScheduledVisitById(id: string) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createScheduledVisit(scheduledVisit: ScheduledVisitInsert) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .insert(scheduledVisit)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateScheduledVisit(id: string, updates: ScheduledVisitUpdate) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteScheduledVisit(id: string) {
  const { error } = await supabase
    .from('scheduled_visits')
    .delete()
    .eq('id', id)
  if (error) throw error
}
