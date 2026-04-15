import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type ScheduledVisitInsert = Database['public']['Tables']['scheduled_visits']['Insert']
type ScheduledVisitUpdate = Database['public']['Tables']['scheduled_visits']['Update']

export interface ScheduledVisitFilters {
  assignedTo?: string
  createdBy?: string
  status?: string
}

export async function getScheduledVisits(filters: ScheduledVisitFilters = {}) {
  let query = supabase
    .from('scheduled_visits')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.assignedTo !== undefined) {
    query = query.eq('assigned_to', filters.assignedTo)
  }
  if (filters.createdBy !== undefined) {
    query = query.eq('created_by', filters.createdBy)
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
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
