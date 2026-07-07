import { supabase } from '@/lib/supabase'
import { toProductWmsAttributes } from '@/lib/adapters'
import type { ProductWmsAttributes, ShelfLifePolicy } from '@/types'

export async function getWmsAttributes(productId: number): Promise<ProductWmsAttributes | null> {
  const { data, error } = await supabase
    .from('product_wms_attributes')
    .select('*')
    .eq('product_id', productId)
    .maybeSingle()
  if (error) throw error
  return data ? toProductWmsAttributes(data) : null
}

export interface WmsAttributesInput {
  product_id: number
  hazard_class?: string | null
  temp_min?: number | null
  temp_max?: number | null
  shelf_life_policy?: ShelfLifePolicy | null
  stackable?: boolean | null
  handling_type?: string | null
  weight_kg?: number | null
  volume_l?: number | null
}

export async function saveWmsAttributes(input: WmsAttributesInput): Promise<ProductWmsAttributes> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; attributes: unknown }>('mutate-wms-attributes', {
    body: input,
  })
  if (error) throw error
  return toProductWmsAttributes((data as any).attributes)
}
