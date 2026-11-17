// Scan a product → where it lives and how to walk it (NX-0039). Read-only:
// explain-product-location answers from the normal putaway rules (dry run) and
// the pick-route engine; it moves nothing and queues nothing.
import { supabase } from '@/lib/supabase'
import type { PickRoute } from '@/types'
import type { StockBadge } from '@/supabase/functions/_shared/wie/productWhereabouts'

export type { StockBadge }

export interface WhereaboutsStock {
  locationId: number
  code: string
  onHand: number
  available: number
  badge: StockBadge
}

export interface ProductWalk extends PickRoute {
  /** "1. A-03-02 — 14 m", one per stop. */
  steps: string[]
}

export interface NewDelivery {
  source: 'home' | 'overflow' | 'engine'
  locationId: number | null
  code: string | null
  homeQty: number
  overflowQty: number
  reason: string
  /** Base units the answer was worked out for (one receivable case). */
  quantity: number
}

export interface ProductWhereabouts {
  mode: 'engine' | 'legacy'
  product: { id: number; name: string }
  homeBin: { locationId: number; code: string } | null
  stock: WhereaboutsStock[]
  homeQty: number
  offHomeQty: number
  atDockQty: number
  /** Null on a site with no published layout (legacy putaway). */
  newDelivery: NewDelivery | null
  putawayWalk: ProductWalk | null
  pickWalk: ProductWalk | null
}

export async function explainProductLocation(
  warehouseId: number,
  productId: number,
): Promise<ProductWhereabouts> {
  const { data, error } = await supabase.functions.invoke<ProductWhereabouts & { ok: true }>(
    'explain-product-location',
    { body: { warehouse_id: warehouseId, product_id: productId } },
  )
  if (error) throw error
  if (!data) throw new Error('No response from explain-product-location')
  return data
}
