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

/**
 * How many units have been picked against this order, across every warehouse.
 *
 * Needed because an order's status is the ROLLUP of its per-warehouse
 * fulfilments and takes the LOWEST rung, so an order reading `processed` may
 * already have a site that has picked its share. Cancelling one of those would
 * release only the unpicked remainder and strand what is off the shelf, so the
 * Cancel action has to ask the physical record rather than the summary.
 *
 * `pick_progress` is SELECT-able by Admin/Manager/Warehouse (mig 00027), which
 * covers everyone who can see this control.
 */
export async function getPickedUnits(orderId: string): Promise<number> {
  const { data, error } = await supabase
    .from('pick_progress')
    .select('picked_qty')
    .eq('order_id', orderId)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((sum, row) => sum + Number((row as { picked_qty: number }).picked_qty ?? 0), 0)
}

export interface CancelOrderResult {
  ok: true
  orderId: string
  status: 'cancelled'
  previousStatus: OrderStatus
  cancelledAt: string
  invoiceId: string | null
  invoiceCancelled: boolean
}

/**
 * Cancel a placed order. Admin only; the reason is mandatory and is stored on
 * the order as well as in the audit log.
 *
 * There is no deleteOrder to sit beside this, and there never was one that
 * worked through the app: until mig 00112 an Admin could DELETE an order
 * straight over PostgREST, with no audit trail and no ledger correction. This
 * is the replacement — the order survives, its reservation goes back, and the
 * record says who and why.
 */
export async function cancelOrder(id: string, reason: string): Promise<CancelOrderResult> {
  const { data, error } = await supabase.functions.invoke<CancelOrderResult>('cancel-order', {
    body: { orderId: id, reason },
  })
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Cancelling the order failed'
    throw new Error(msg)
  }
  if (!data?.ok) throw new Error('Cancelling the order returned no result')
  return data
}
