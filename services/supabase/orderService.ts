import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type OrderRow = Database['public']['Tables']['orders']['Row']
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

export interface PlaceOrderInput {
  hoReCaId: number
  items: Array<{ productId: number; quantity: number; packSize?: number | null }>
  notes?: string | null
  deliveryDate?: string | null
  deliveryTimeSlot?: 'AM' | 'PM' | null
  verification?: Record<string, unknown> | null
}

export interface PlaceOrderResult {
  orderId: string
  total: number
  cartDiscount: number
  appliedPromotionIds: string[]
  bogoFreeItems: Array<{ productId: number; freeQuantity: number; promoId: string }>
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.functions.invoke<PlaceOrderResult>('place-order', {
    body: input,
  })
  if (error) {
    // Edge Function errors come back with status + parsed body in error.context
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Order placement failed'
    throw new Error(msg)
  }
  if (!data) throw new Error('Order placement returned no data')
  return data
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  note?: string
) {
  const { data, error } = await supabase.functions.invoke<{ order: OrderRow }>('update-order-status', {
    body: { orderId: id, status, note },
  })
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Status update failed'
    throw new Error(msg)
  }
  if (!data?.order) throw new Error('Status update returned no order')
  return data.order
}
