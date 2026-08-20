// The order's lines: one row per product, quantity editable, price read-only.
//
// Read-only because prices are the server's: `place-order` recomputes every
// line and persists its own total, so a figure typed here would be a number the
// operator believes and the order does not carry. What is shown is the same
// resolution the cart uses (`resolveHoReCaPrice`), evaluated early.

import React from 'react'
import { Trash2, Plus } from 'lucide-react'

import { Button, NumberInput } from '../../ui'
import ProductSearchDropdown from '../ProductSearchDropdown'
import { resolveHoReCaPrice } from '../../../pricing'
import type { ParsedOrderLine } from '../../../lib/newOrder/resolveOrderLines'
import type { HoReCa, Product } from '../../../types'

interface OrderLinesGridProps {
  lines: ParsedOrderLine[]
  products: Product[]
  customer: HoReCa | null
  onChangeQuantity: (productId: number, quantity: number) => void
  onRemove: (productId: number) => void
  onAddProduct: (productId: number) => void
}

const money = (n: number) => `$${n.toFixed(2)}`

const OrderLinesGrid: React.FC<OrderLinesGridProps> = ({
  lines,
  products,
  customer,
  onChangeQuantity,
  onRemove,
  onAddProduct,
}) => {
  const byId = new Map<number, Product>(products.map((p): [number, Product] => [p.id, p]))
  const priceOf = (productId: number) => {
    const product = byId.get(productId)
    return product ? resolveHoReCaPrice(product, customer) : 0
  }
  const total = lines.reduce((sum, l) => sum + priceOf(l.productId) * l.quantity, 0)

  // Already-chosen products drop out of the picker: a repeated pick is a
  // quantity change on the row that exists, not a second row of the same thing.
  const chosen = new Set(lines.map((l) => l.productId))
  const selectable = products.filter((p) => !chosen.has(p.id) && p.isActive !== false)

  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-stone-600">Product</th>
              <th className="px-4 py-2.5 text-right font-semibold text-stone-600 w-28">Qty</th>
              <th className="px-4 py-2.5 text-right font-semibold text-stone-600 w-28">Unit</th>
              <th className="px-4 py-2.5 text-right font-semibold text-stone-600 w-28">Line</th>
              <th className="px-2 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-stone-400">
                  No lines yet. Add a product below, or paste a block of them.
                </td>
              </tr>
            )}
            {lines.map((line) => (
              <tr key={line.productId} className="hover:bg-stone-50/60">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-stone-900">{line.name}</p>
                  <p className="font-mono text-xs text-stone-500">{line.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <NumberInput
                    value={line.quantity}
                    min={1}
                    step={1}
                    dense
                    aria-label={`Quantity for ${line.name}`}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onChangeQuantity(line.productId, Number(e.target.value))
                    }
                    className="text-right"
                  />
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-stone-600">
                  {money(priceOf(line.productId))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-medium text-stone-900">
                  {money(priceOf(line.productId) * line.quantity)}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(line.productId)}
                    aria-label={`Remove ${line.name}`}
                    className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 btn-press"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="bg-stone-50 border-t border-stone-200">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-right font-semibold text-stone-600">
                  Estimated total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-stone-900">
                  {money(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-stone-200 bg-white px-4 py-3">
        <Plus className="w-4 h-4 text-stone-400 shrink-0" />
        <div className="flex-1 max-w-md">
          <ProductSearchDropdown
            products={selectable}
            selectedProductId={null}
            onSelect={onAddProduct}
            placeholder="Add a product…"
          />
        </div>
      </div>
    </div>
  )
}

export default OrderLinesGrid
