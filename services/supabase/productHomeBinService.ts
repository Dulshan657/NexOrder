import { supabase } from '@/lib/supabase'

export interface ProductHomeBin {
  productId: number
  warehouseId: number
  binId: number
}

export async function getProductHomeBins(productId: number): Promise<ProductHomeBin[]> {
  const { data, error } = await supabase
    .from('product_home_bins')
    .select('product_id, warehouse_id, bin_id')
    .eq('product_id', productId)
  if (error) throw error
  return (data ?? []).map((r) => ({
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    binId: r.bin_id,
  }))
}

export async function setProductHomeBin(productId: number, warehouseId: number, binId: number): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-product-home-bin', {
    body: { action: 'set', productId, warehouseId, binId },
  })
  if (error) throw error
}

export async function clearProductHomeBin(productId: number, warehouseId: number): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-product-home-bin', {
    body: { action: 'clear', productId, warehouseId },
  })
  if (error) throw error
}
