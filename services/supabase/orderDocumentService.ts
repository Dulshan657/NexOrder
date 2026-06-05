import { supabase } from '@/lib/supabase'
import { toOrderDocument } from '@/lib/adapters'
import type { OrderDocument } from '@/types'

// Read access to the order_documents archive (pick slips + dispatch advices).
// RLS restricts SELECT to Admin/Manager/Warehouse; the PDFs themselves live in
// the private `order-documents` bucket and are reachable only via a short-lived
// signed URL from the create-order-document-url Edge Function.

export interface OrderDocumentView {
  doc: OrderDocument
  orderStatus: string | null
  horecaName: string
}

export async function getOrderDocuments(orderId?: string): Promise<OrderDocumentView[]> {
  let query = supabase
    .from('order_documents')
    .select('*, orders(status, horecas(name))')
    .order('generated_at', { ascending: false })
  if (orderId) query = query.eq('order_id', orderId)

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as any[]).map((row) => ({
    doc: toOrderDocument(row),
    orderStatus: row.orders?.status ?? null,
    horecaName: row.orders?.horecas?.name ?? '—',
  }))
}

export async function getOrderDocumentUrl(orderDocumentId: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ signedUrl: string; expiresInSeconds: number }>(
    'create-order-document-url',
    { body: { orderDocumentId } },
  )
  if (error) throw error
  if (!data?.signedUrl) throw new Error('No signed URL returned')
  return data.signedUrl
}
