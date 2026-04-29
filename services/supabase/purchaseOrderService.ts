import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type PurchaseOrderInsert = Database['public']['Tables']['purchase_orders']['Insert']
type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update']
type PurchaseOrderRow = Database['public']['Tables']['purchase_orders']['Row']
type PurchaseOrderItemInsert = Database['public']['Tables']['purchase_order_items']['Insert']

/** Item shape accepted by the mutate-purchase-order Edge Function */
type PurchaseOrderItemBody = {
  product_id: number
  product_name: string
  quantity: number
  cost: number
}

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
): Promise<PurchaseOrderRow> {
  // Map items to the shape the Edge Function expects (strips purchase_order_id if present)
  const itemBodies: PurchaseOrderItemBody[] = items.map(({ product_id, product_name, quantity, cost }) => ({
    product_id,
    product_name,
    quantity,
    cost,
  }))

  const { data, error } = await supabase.functions.invoke<PurchaseOrderRow>(
    'mutate-purchase-order',
    { body: { action: 'create', data: { po, items: itemBodies } } }
  )
  if (error) throw error
  return data as PurchaseOrderRow
}

export async function updatePurchaseOrder(
  id: string,
  updates: PurchaseOrderUpdate
): Promise<PurchaseOrderRow> {
  const { data, error } = await supabase.functions.invoke<PurchaseOrderRow>(
    'mutate-purchase-order',
    { body: { action: 'update', id, data: { po: updates } } }
  )
  if (error) throw error
  return data as PurchaseOrderRow
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: 'Pending' | 'Submitted' | 'Completed' | 'Cancelled',
  note?: string
): Promise<PurchaseOrderRow> {
  const { data, error } = await supabase.functions.invoke<PurchaseOrderRow>(
    'mutate-purchase-order',
    { body: { action: 'update-status', id, status, ...(note !== undefined && { note }) } }
  )
  if (error) throw error
  return data as PurchaseOrderRow
}
