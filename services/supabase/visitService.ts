import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type VisitInsert = Database['public']['Tables']['visits']['Insert']
type VisitUpdate = Database['public']['Tables']['visits']['Update']

export interface VisitFilters {
  userId?: string
  horecaId?: number
  scheduledVisitId?: string
}

export async function getVisits(filters: VisitFilters = {}) {
  let query = supabase
    .from('visits')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.userId !== undefined) {
    query = query.eq('user_id', filters.userId)
  }
  if (filters.horecaId !== undefined) {
    query = query.eq('horeca_id', filters.horecaId)
  }
  if (filters.scheduledVisitId !== undefined) {
    query = query.eq('scheduled_visit_id', filters.scheduledVisitId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createVisit(visit: VisitInsert) {
  const { data, error } = await supabase
    .from('visits')
    .insert(visit)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateVisit(id: number, updates: VisitUpdate) {
  const { data, error } = await supabase
    .from('visits')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
