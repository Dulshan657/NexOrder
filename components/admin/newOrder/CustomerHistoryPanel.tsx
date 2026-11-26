// What this customer has ordered before: copy their last order, add one of
// their usual products, or copy any recent order. Lines come back in the units
// they were ordered in; a product that is no longer orderable is skipped and
// the screen says how many were.

import React from 'react'
import { Copy, History, Plus, Star } from 'lucide-react'

import { Button } from '../../ui'
import { customerOrders, linesOfOrder, usualProducts } from '../../../lib/newOrder/customerHistory'
import { money } from '../../../lib/newOrder/previewPricing'
import type { DraftLine } from '../../../lib/newOrder/orderLineModel'
import type { Order, Product } from '../../../types'

interface CustomerHistoryPanelProps {
  orders: Order[]
  hoReCaId: number | null
  /** Orderable products only; anything else in a past order is skipped. */
  products: Product[]
  onAddLines: (lines: DraftLine[], skipped: number) => void
}

const RECENT_SHOWN = 5

const orderDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function CustomerHistoryPanel({ orders, hoReCaId, products, onAddLines }: CustomerHistoryPanelProps) {
  if (hoReCaId === null) {
    return <p className="text-sm text-stone-600">Choose a customer to see what they usually order.</p>
  }

  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  const recent = customerOrders(orders, hoReCaId, RECENT_SHOWN)
  const usual = usualProducts(orders, hoReCaId).filter((u) => byId.has(u.productId))

  if (recent.length === 0) {
    return <p className="text-sm text-stone-600">No previous orders for this customer.</p>
  }

  const copy = (order: Order) => {
    const lines = linesOfOrder(order, products)
    const usable = lines.filter((l) => byId.has(l.productId))
    onAddLines(usable, lines.length - usable.length)
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="usual-heading">
        <h3 id="usual-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600">
          <Star className="w-3.5 h-3.5" aria-hidden="true" /> Usual products
        </h3>
        <ul className="space-y-1">
          {usual.map((u) => {
            const product = byId.get(u.productId)!
            return (
              <li key={u.productId}>
                <button
                  type="button"
                  onClick={() => onAddLines([{ productId: u.productId, uomId: null, quantity: u.medianQuantity }], 0)}
                  className="touch-target-y flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-100 btn-press"
                  aria-label={`Add ${u.medianQuantity} ${product.name}`}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0 text-stone-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-stone-800">{product.name}</span>
                  <span className="shrink-0 font-mono text-xs text-stone-600">×{u.medianQuantity}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="recent-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600">
            <History className="w-3.5 h-3.5" aria-hidden="true" /> Recent orders
          </h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => copy(recent[0])}>
            <Copy className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Copy last order
          </Button>
        </div>
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {recent.map((order) => (
            <li key={order.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-stone-800">{orderDate(order.orderDate)}</p>
                <p className="text-xs text-stone-600">
                  {order.items.length} line{order.items.length === 1 ? '' : 's'} · {money(order.total)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => copy(order)}
                aria-label={`Copy the order of ${orderDate(order.orderDate)}`}
                className="touch-target rounded-lg px-2 py-1 text-xs font-medium text-nexgen-blue-dark hover:bg-stone-100 btn-press"
              >
                Copy
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
