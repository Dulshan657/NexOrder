import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type RouteInsert = Database['public']['Tables']['routes']['Insert']
type RouteUpdate = Database['public']['Tables']['routes']['Update']

export interface RouteFilters {
  assignedTo?: string
  createdBy?: string
  status?: string
}

export async function getRoutes(filters: RouteFilters = {}) {
  let query = supabase
    .from('routes')
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

export async function getRouteById(id: string) {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createRoute(route: RouteInsert) {
  const { data, error } = await supabase
    .from('routes')
    .insert(route)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRoute(id: string, updates: RouteUpdate) {
  const { data, error } = await supabase
    .from('routes')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRoute(id: string) {
  const { error } = await supabase
    .from('routes')
    .delete()
    .eq('id', id)
  if (error) throw error
}
