import { supabase } from '@/lib/supabase'

export interface ProductHomeBin {
  productId: number
  warehouseId: number
  binId: number
  /** Distinguishes several slots for one SKU in one warehouse (mig 00082).
   *  Everything written before that migration is 'primary'. */
  purpose: string
  /** Replenishment thresholds, in BASE units. null until configured. */
  minQty: number | null
  maxQty: number | null
  replenEnabled: boolean
}

export async function getProductHomeBins(productId: number): Promise<ProductHomeBin[]> {
  const { data, error } = await supabase
    .from('product_home_bins')
    // Cast: lib/database.types.ts predates mig 00072 and has not been
    // regenerated, so PostgREST's typed client rejects the columns 00082 added.
    // Regenerating is its own piece of work — the current generator emits bare
    // `string` where lib/adapters.ts narrows ~15 unions (LocationKind,
    // MovementType, SlotUnit…), so it lands ~20 unrelated errors. Same defensive
    // pattern as lib/adapters.ts:939 and ProductWmsAttributesSection.
    .select('product_id, warehouse_id, bin_id, purpose, min_qty, max_qty, replen_enabled' as '*')
    .eq('product_id', productId)
  if (error) throw error
  return ((data ?? []) as any[]).map((r) => ({
    productId: r.product_id,
    warehouseId: r.warehouse_id,
    binId: r.bin_id,
    purpose: (r as any).purpose ?? 'primary',
    minQty: (r as any).min_qty != null ? Number((r as any).min_qty) : null,
    maxQty: (r as any).max_qty != null ? Number((r as any).max_qty) : null,
    replenEnabled: Boolean((r as any).replen_enabled),
  }))
}

export interface HomeBinReplenInput {
  /** Base units. null clears the figure; omitted leaves it untouched. */
  minQty?: number | null
  maxQty?: number | null
  replenEnabled?: boolean
}

export async function setProductHomeBin(
  productId: number,
  warehouseId: number,
  binId: number,
  replen?: HomeBinReplenInput,
): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-product-home-bin', {
    body: { action: 'set', productId, warehouseId, binId, ...(replen ?? {}) },
  })
  if (error) throw error
}

export async function clearProductHomeBin(productId: number, warehouseId: number): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-product-home-bin', {
    body: { action: 'clear', productId, warehouseId },
  })
  if (error) throw error
}
