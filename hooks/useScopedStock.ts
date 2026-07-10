import { useMemo } from 'react'
import type { InventoryBalance } from '@/types'
import type { WarehouseScope } from '@/lib/warehouseScope'
import { useInventoryBalances, useProductStockByWarehouse } from '@/hooks/queries/useInventoryBalances'
import type { ProductStockRow } from '@/services/supabase/inventoryService'

/** Aggregated stock totals for one product, scope-agnostic. */
export interface ScopedAgg {
  onHand: number
  allocated: number
  available: number
}

/** Sum every balance row per productId. PURE — replicates StockView's
 * `aggByProduct` useMemo exactly:
 *
 * ```
 * const aggByProduct = useMemo(() => {
 *   const m = new Map<number, Agg>();
 *   for (const b of balances ?? []) {
 *     const cur = m.get(b.productId) ?? { onHand: 0, allocated: 0, available: 0 };
 *     cur.onHand += b.onHand;
 *     cur.allocated += b.allocated;
 *     cur.available += b.available;
 *     m.set(b.productId, cur);
 *   }
 *   return m;
 * }, [balances]);
 * ```
 *
 * Same field names, same accumulation, same result set — just built without
 * mutating the accumulator object in place (a new object per update, per the
 * project's immutability convention) so the returned map is byte-identical
 * to the original for the same input. */
export function buildAggFromBalances(
  balances: readonly InventoryBalance[] | undefined | null,
): Map<number, ScopedAgg> {
  const m = new Map<number, ScopedAgg>()
  for (const b of balances ?? []) {
    const cur = m.get(b.productId) ?? { onHand: 0, allocated: 0, available: 0 }
    m.set(b.productId, {
      onHand: cur.onHand + b.onHand,
      allocated: cur.allocated + b.allocated,
      available: cur.available + b.available,
    })
  }
  return m
}

/** Map `inv_product_stock_by_warehouse` rows 1:1 by productId. PURE.
 *
 * A row with `onHand: 0` still produces a map entry — that's what
 * distinguishes "zero stock at this site" from "never stocked at this site"
 * (a product entirely absent from `rows` is entirely absent from the map). */
export function buildAggFromStockRows(rows: readonly ProductStockRow[] | undefined | null): Map<number, ScopedAgg> {
  const m = new Map<number, ScopedAgg>()
  for (const r of rows ?? []) {
    m.set(r.productId, { onHand: r.onHand, allocated: r.allocated, available: r.available })
  }
  return m
}

export interface UseScopedStockResult {
  aggByProduct: Map<number, ScopedAgg>
  isLoading: boolean
}

/** The single code path for scope-aware stock totals. Always calls both
 * underlying queries unconditionally (Rules of Hooks) and selects between
 * them based on `scope`; only the query for the active scope is actually
 * enabled, so the other is a no-op. Under `'all'` this reproduces today's
 * StockView `aggByProduct` exactly — see `buildAggFromBalances`. */
export function useScopedStock(scope: WarehouseScope): UseScopedStockResult {
  const isAll = scope === 'all'
  const { data: balances, isLoading: balancesLoading } = useInventoryBalances({ enabled: isAll })
  const { data: stockRows, isLoading: stockRowsLoading } = useProductStockByWarehouse(isAll ? null : scope)

  const aggByProduct = useMemo(
    () => (isAll ? buildAggFromBalances(balances) : buildAggFromStockRows(stockRows)),
    [isAll, balances, stockRows],
  )

  return { aggByProduct, isLoading: isAll ? balancesLoading : stockRowsLoading }
}
