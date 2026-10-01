import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import type { Database } from '@/lib/database.types'

type VisitInsert = Database['public']['Tables']['visits']['Insert']
type VisitUpdate = Database['public']['Tables']['visits']['Update']

export interface VisitFilters {
  userId?: string
  horecaId?: number
  scheduledVisitId?: string
}

export async function getVisits(filters: VisitFilters = {}) {
  const build = () => {
    let query = supabase
      .from('visits')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')

    if (filters.userId !== undefined) {
      query = query.eq('user_id', filters.userId)
    }
    if (filters.horecaId !== undefined) {
      query = query.eq('horeca_id', filters.horecaId)
    }
    if (filters.scheduledVisitId !== undefined) {
      query = query.eq('scheduled_visit_id', filters.scheduledVisitId)
    }

    return query
  }
  // Paged past the API row cap (lib/fetchAllRows); `id` makes the order unique.
  return fetchAllRows((from, to) => build().range(from, to))
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

export async function updateVisit(id: string, updates: VisitUpdate) {
  const { data, error } = await supabase
    .from('visits')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
