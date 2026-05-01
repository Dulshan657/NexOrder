import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type InvoiceInsert = Database['public']['Tables']['invoices']['Insert']
type InvoiceStatus = InvoiceRow['status']

export interface InvoiceFilters {
  horecaId?: number
  status?: InvoiceStatus
}

export async function getInvoices(filters: InvoiceFilters = {}) {
  let query = supabase
    .from('invoices')
    .select('*')
    .order('created_date', { ascending: false })

  if (filters.horecaId !== undefined) {
    query = query.eq('horeca_id', filters.horecaId)
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
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

export async function createInvoice(invoice: InvoiceInsert) {
  const { data, error } = await supabase
    .from('invoices')
    .insert(invoice)
    .select()
    .single()
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
