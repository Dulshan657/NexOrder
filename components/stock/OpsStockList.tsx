// The ops stock list: one `@container`, one heading strip, one row per product.
//
// The container is declared HERE — on the card that holds the headings AND the
// rows — so the two cannot disagree about which layout is showing. A container
// declared on the rows alone would let the strip say "five columns" while the
// rows rendered as cards. Same arrangement as `ReceiveStockView`'s staged-lines
// card.

import React from 'react'
import type { Product } from '../../types'
import type { WarehouseScope } from '../../lib/warehouseScope'
import { OpsStockRow, type Agg } from './OpsStockRow'
import { OPS_STOCK_ROW_COLUMNS } from './stockRowColumns'

export interface OpsStockListProps {
  products: readonly Product[]
  aggOf: (product: Product) => Agg
  maxQty: number
  canAdjust: boolean
  globalThreshold: number
  scope: WarehouseScope
}

export function OpsStockList({ products, aggOf, maxQty, canAdjust, globalThreshold, scope }: OpsStockListProps) {
  return (
    <div className="@container glass-card rounded-xl overflow-hidden">
      {/* Hidden until the container is wide enough to seat five columns; below
          that each cell carries its own `StockMicroLabel` instead. */}
      <div
        className={
          'hidden border-b border-stone-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-stone-600 ' +
          `@min-[780px]:grid @min-[780px]:gap-x-4 ${OPS_STOCK_ROW_COLUMNS}`
        }
        aria-hidden="true"
      >
        <span>Product</span>
        <span className="text-right">On hand</span>
        <span className="text-right">Allocated</span>
        <span>Available</span>
        <span className="text-right">Status</span>
      </div>

      <ul className="divide-y divide-stone-100">
        {products.map((product) => (
          // `key` cannot ride on a component with a typed props interface —
          // there is no global JSX namespace without `@types/react`. OpsStockRow
          // is still `React.FC` (props `any`) so it would be accepted, but the
          // Fragment keeps every list in this cluster spelled the same way.
          <React.Fragment key={product.id}>
            <OpsStockRow
              product={product}
              agg={aggOf(product)}
              maxQty={maxQty}
              canAdjust={canAdjust}
              globalThreshold={globalThreshold}
              scope={scope}
            />
          </React.Fragment>
        ))}
      </ul>
    </div>
  )
}

export default OpsStockList
