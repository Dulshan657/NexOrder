import { supabase } from '@/lib/supabase'

/** One stop on a replenishment walk. Anchored at the SOURCE bin — the walker
 *  must pull before they can place, so the pair is one unit of work, not two
 *  independently schedulable stops. */
export interface ReplenRouteStop {
  sequence: number
  taskId: number
  locationId: number
  code: string
  /** Travel from the previous stop to the source bin. */
  legDistanceM: number
  /** Source → pick slot. Zero when both are levels of the same rack. */
  placeLegM: number
  reachable: boolean
  toLocationId: number
  toCode: string
  /** Both bins share a graph node: a same-rack move with no travel at all. */
  sameNode: boolean
  productId: number
  qtyBase: number
  huCode: string | null
  huType: string | null
  sku: string | null
  productName: string | null
}

export type ReplenRoute =
  | { mode: 'legacy'; note?: string }
  | {
      mode: 'engine'
      stops: ReplenRouteStop[]
      totalDistanceM: number
      unreachableCount: number
    }

export async function getReplenRoute(warehouseId: number): Promise<ReplenRoute> {
  const { data, error } = await supabase.functions.invoke<any>('recommend-replen-route', {
    body: { warehouse_id: warehouseId },
  })
  if (error) throw error
  if ((data as any)?.mode === 'legacy') {
    return { mode: 'legacy', note: (data as any).note }
  }
  const route = (data as any)?.route ?? {}
  return {
    mode: 'engine',
    stops: ((route.stops ?? []) as any[]).map((s) => ({
      sequence: s.sequence,
      taskId: s.taskId,
      locationId: s.locationId,
      code: s.code,
      legDistanceM: Number(s.legDistanceM) || 0,
      placeLegM: Number(s.placeLegM) || 0,
      reachable: s.reachable !== false,
      toLocationId: s.toLocationId,
      toCode: s.toCode,
      sameNode: Boolean(s.sameNode),
      productId: s.productId,
      qtyBase: Number(s.qtyBase) || 0,
      huCode: s.huCode ?? null,
      huType: s.huType ?? null,
      sku: s.sku ?? null,
      productName: s.productName ?? null,
    })),
    totalDistanceM: Number(route.totalDistanceM) || 0,
    unreachableCount: Number(route.unreachableCount) || 0,
  }
}
