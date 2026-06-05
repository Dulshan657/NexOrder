import { supabase } from '@/lib/supabase'

export interface PickQueueLine {
  orderItemId: number
  productId: number
  productName: string
  productSku: string
  quantity: number
  picked: number
}

export interface PickQueueOrder {
  orderId: string
  status: string
  orderDate: string | null
  deliveryDate: string | null
  horecaName: string
  horecaAddress: string
  lines: PickQueueLine[]
}

export interface GenerateDocResult {
  storagePath: string
  signedUrl: string | null
}

// Orders that the warehouse acts on: processed (ready to pick), picked, packed.
export async function getPickQueue(): Promise<PickQueueOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, order_date, delivery_date, horecas(name, address), ' +
      'order_items(id, product_id, product_name, product_sku, quantity, pick_progress(picked_qty))',
    )
    .in('status', ['processed', 'picked', 'packed'])
    .order('order_date', { ascending: true })
  if (error) throw error

  return ((data ?? []) as any[]).map((o) => ({
    orderId: o.id,
    status: o.status,
    orderDate: o.order_date ?? null,
    deliveryDate: o.delivery_date ?? null,
    horecaName: o.horecas?.name ?? '—',
    horecaAddress: o.horecas?.address ?? '',
    lines: (o.order_items ?? []).map((it: any) => ({
      orderItemId: it.id,
      productId: it.product_id,
      productName: it.product_name,
      productSku: it.product_sku,
      quantity: Number(it.quantity),
      picked: (it.pick_progress ?? []).reduce((s: number, p: any) => s + Number(p.picked_qty), 0),
    })),
  }))
}

export async function recordPick(orderItemId: number, pickedQty: number): Promise<{ line_fully_picked: boolean; order_fully_picked: boolean }> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; line_fully_picked: boolean; order_fully_picked: boolean }>(
    'record-pick',
    { body: { orderItemId, pickedQty } },
  )
  if (error) throw error
  return data!
}

export async function generatePickSlip(orderId: string): Promise<GenerateDocResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & GenerateDocResult>(
    'generate-pick-slip',
    { body: { orderId } },
  )
  if (error) throw error
  return { storagePath: data!.storagePath, signedUrl: data!.signedUrl }
}

export async function generateDispatchAdvice(orderId: string): Promise<GenerateDocResult> {
  const { data, error } = await supabase.functions.invoke<{ ok: true } & GenerateDocResult>(
    'generate-dispatch-advice',
    { body: { orderId } },
  )
  if (error) throw error
  return { storagePath: data!.storagePath, signedUrl: data!.signedUrl }
}
