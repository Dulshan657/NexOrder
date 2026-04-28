import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type InvoiceInsert = Database['public']['Tables']['invoices']['Insert']
type InvoiceUpdate = Database['public']['Tables']['invoices']['Update']
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

export async function getInvoiceByOrderId(orderId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('order_id', orderId)
    .single()
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

export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  paidDate?: string
) {
  const updates: InvoiceUpdate = { status }
  if (paidDate !== undefined) {
    updates.paid_date = paidDate
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
