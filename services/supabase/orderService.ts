import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
import type { Database } from '@/lib/database.types'

type OrderRow = Database['public']['Tables']['orders']['Row']
type OrderStatus = OrderRow['status']

export interface OrderFilters {
  horecaId?: number
  submittedBy?: string
  status?: OrderStatus
}

// Reverse-embed the source pending_pos (linked via approved_order_id) so the UI
// can tag PO-Inbox orders and show who approved them. pending_pos has
// GRANT SELECT to authenticated with Admin/Manager-only RLS, so non-admins get
// an empty embed (no error) — their orders are never inbound anyway.
const ORDER_SELECT =
  '*, horecas(name), order_items(*), pending_pos!pending_pos_approved_order_id_fkey(inbound_message_id, status), order_fulfillments(*, locations(name))'

export async function getOrders(filters: OrderFilters = {}) {
  let query = supabase
    .from('orders')
    .select(ORDER_SELECT)
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
    .select(ORDER_SELECT)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function getOrdersByHoReCa(horecaId: number) {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('horeca_id', horecaId)
    .order('order_date', { ascending: false })
  if (error) throw error
  return data
}

export async function getOrdersByUser(userId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('submitted_by', userId)
    .order('order_date', { ascending: false })
  if (error) throw error
  return data
}

export interface PlaceOrderInput {
  hoReCaId: number
  items: Array<{ productId: number; quantity: number; packSize?: number | null; uomId?: number | null }>
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
    // FunctionsHttpError leaves the structured `{ error: { code, message } }`
    // body on the raw Response at `.context`; extract it so the user sees the
    // real reason (e.g. "19 of \"Coconut Milk 400ml\" available, 25 requested")
    // instead of the generic "Edge Function returned a non-2xx status code".
    throw new Error(await extractFunctionErrorMessage(error, 'Order placement failed'))
  }
  if (!data) throw new Error('Order placement returned no data')
  return data
}

export interface UpdateOrderStatusOpts {
  /** Per-warehouse advance: which fulfilment site this transition applies to. */
  locationId?: number
  /** processing->processed override: closest-first warehouse preference to re-route. */
  locationPref?: number[]
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  note?: string,
  opts?: UpdateOrderStatusOpts,
) {
  const { data, error } = await supabase.functions.invoke<{ order: OrderRow }>('update-order-status', {
    body: {
      orderId: id,
      status,
      note,
      ...(opts?.locationId != null ? { locationId: opts.locationId } : {}),
      ...(opts?.locationPref ? { locationPref: opts.locationPref } : {}),
    },
  })
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Status update failed'
    throw new Error(msg)
  }
  if (!data?.order) throw new Error('Status update returned no order')
  return data.order
}
