import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type OrderRow = Database['public']['Tables']['orders']['Row']
type OrderInsert = Database['public']['Tables']['orders']['Insert']
type OrderUpdate = Database['public']['Tables']['orders']['Update']
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert']
type OrderStatus = OrderRow['status']

export interface OrderFilters {
  horecaId?: number
  submittedBy?: string
  status?: OrderStatus
}

export async function getOrders(filters: OrderFilters = {}) {
  let query = supabase
    .from('orders')
    .select('*, horecas(name), order_items(*)')
    .order('order_date', { ascending: false })

  if (filters.horecaId !== undefined) {
    query = query.eq('horeca_id', filters.horecaId)
  }
  if (filters.submittedBy !== undefined) {
    query = query.eq('submitted_by', filters.submittedBy)
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getOrderById(id: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, horecas(name), order_items(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function getOrdersByHoReCa(horecaId: number) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, horecas(name), order_items(*)')
    .eq('horeca_id', horecaId)
    .order('order_date', { ascending: false })
  if (error) throw error
  return data
}

export async function getOrdersByUser(userId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, horecas(name), order_items(*)')
    .eq('submitted_by', userId)
    .order('order_date', { ascending: false })
  if (error) throw error
  return data
}

export async function createOrder(
  order: Omit<OrderInsert, 'id'>,
  items: Omit<OrderItemInsert, 'order_id'>[]
) {
  const orderId = `ORD-${Date.now()}`

  const { data: newOrder, error: orderError } = await supabase
    .from('orders')
    .insert({ ...order, id: orderId })
    .select()
    .single()
  if (orderError) throw orderError

  const itemsWithOrderId = items.map((item) => ({ ...item, order_id: orderId }))

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsWithOrderId)
  if (itemsError) throw itemsError

  return newOrder
}

export async function updateOrderStatus(
  id: string,
  status: string,
  note?: string
) {
  const { data: existing, error: fetchError } = await supabase
    .from('orders')
    .select('status_history')
    .eq('id', id)
    .single()
  if (fetchError) throw fetchError

  const previousHistory = Array.isArray(existing?.status_history)
    ? existing.status_history
    : []

  const newEntry = {
    status,
    timestamp: new Date().toISOString(),
    ...(note !== undefined ? { note } : {}),
  }

  const updatedHistory = [...previousHistory, newEntry]

  const { data, error } = await supabase
    .from('orders')
    .update({ status, status_history: updatedHistory } as OrderUpdate)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
