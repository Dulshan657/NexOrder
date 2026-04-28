import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PurchaseOrderInsert = Database['public']['Tables']['purchase_orders']['Insert']
type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update']
type PurchaseOrderItemInsert = Database['public']['Tables']['purchase_order_items']['Insert']

export async function getPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*), suppliers(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createPurchaseOrder(
  po: PurchaseOrderInsert,
  items: Omit<PurchaseOrderItemInsert, 'purchase_order_id'>[]
) {
  const { data: newPO, error: poError } = await supabase
    .from('purchase_orders')
    .insert(po)
    .select()
    .single()
  if (poError) throw poError

  const itemsWithPoId = items.map((item) => ({
    ...item,
    purchase_order_id: newPO.id,
  }))

  const { error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(itemsWithPoId)
  if (itemsError) throw itemsError

  return newPO
}

export async function updatePurchaseOrder(
  id: string,
  updates: PurchaseOrderUpdate
) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePurchaseOrder(id: string) {
  const { error } = await supabase
    .from('purchase_orders')
    .delete()
    .eq('id', id)
  if (error) throw error
}
