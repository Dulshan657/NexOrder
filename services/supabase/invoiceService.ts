import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'
import type { Database } from '@/lib/database.types'

type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type InvoiceStatus = InvoiceRow['status']

export interface InvoiceFilters {
  horecaId?: number
  status?: InvoiceStatus
}

export async function getInvoices(filters: InvoiceFilters = {}) {
  const build = () => {
    let query = supabase
      .from('invoices')
      .select('*')
      .order('created_date', { ascending: false })
      .order('id')

    if (filters.horecaId !== undefined) {
      query = query.eq('horeca_id', filters.horecaId)
    }
    if (filters.status !== undefined) {
      query = query.eq('status', filters.status)
    }

    return query
  }
  // Paged past the API row cap (lib/fetchAllRows); `id` makes the order unique.
  return fetchAllRows((from, to) => build().range(from, to))
}

export async function getInvoiceByOrderId(orderId: string): Promise<InvoiceRow | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) throw error
  return data
}

export interface MutateInvoiceStatusInput {
  orderId: string
  status: InvoiceStatus
  reason?: string
}

export interface MutateInvoiceStatusResult {
  ok: true
  invoice: InvoiceRow | null
  created: boolean
  noop?: boolean
}

export async function mutateInvoiceStatus(
  input: MutateInvoiceStatusInput,
): Promise<MutateInvoiceStatusResult> {
  const { data, error } = await supabase.functions.invoke<MutateInvoiceStatusResult>(
    'mutate-invoice-status',
    { body: input },
  )
  if (error) {
    const ctx = (error as { context?: { error?: { code?: string; message?: string } } }).context
    const msg = ctx?.error?.message ?? error.message ?? 'Failed to update payment status'
    throw new Error(msg)
  }
  if (!data) throw new Error('Payment status update returned no data')
  return data
}
