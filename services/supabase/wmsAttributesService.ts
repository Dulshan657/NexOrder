import { supabase } from '@/lib/supabase'
import { toProductWmsAttributes } from '@/lib/adapters'
import type { LevelRole, ProductWmsAttributes, ShelfLifePolicy } from '@/types'

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
  /** Level roles this SKU may be put away into (mig 00072). null/omitted = ANY
   *  role — which is what every existing product has, so an empty selection
   *  must never be sent as an empty array. */
  allowed_level_roles?: LevelRole[] | null
  /** Receiving requirements (mig 00134). Never null — the columns are NOT NULL. */
  requires_lot?: boolean
  requires_expiry?: boolean
}

/** What Receive Stock must capture for one product (NX-0005). */
export interface ReceivingRequirement {
  lot: boolean
  expiry: boolean
}

/**
 * Every product that must arrive with a lot code or an expiry, keyed by id.
 * Only the flagged rows are fetched: the map is sparse, and a product absent
 * from it requires nothing.
 */
export async function listReceivingRequirements(): Promise<Map<number, ReceivingRequirement>> {
  const { data, error } = await supabase
    .from('product_wms_attributes')
    .select('product_id, requires_lot, requires_expiry')
    .or('requires_lot.eq.true,requires_expiry.eq.true')
  if (error) throw error
  return new Map(
    (data ?? []).map((r) => [r.product_id, { lot: !!r.requires_lot, expiry: !!r.requires_expiry }]),
  )
}

export async function saveWmsAttributes(input: WmsAttributesInput): Promise<ProductWmsAttributes> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; attributes: unknown }>('mutate-wms-attributes', {
    body: input,
  })
  if (error) throw error
  return toProductWmsAttributes((data as any).attributes)
}
