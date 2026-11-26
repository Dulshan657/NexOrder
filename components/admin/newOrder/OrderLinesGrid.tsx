// The order's lines: product, unit, quantity, stock, price.
//
// Prices are read-only because they are the server's: `place-order` reprices
// every line and persists its own total. They are nonetheless the SAME
// resolution (`lib/newOrder/previewPricing.ts`), so the preview agrees with the
// order.
//
// One markup for every width, a CSS grid that is a table row from `sm` up and a
// two-line card below it. Never two renderings toggled by breakpoint: that
// would put two quantity boxes for one line in the DOM, and focus, labels and
// tests would each find the wrong one.

import React from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'

import { NumberInput, Select } from '../../ui'
import { orderableUoms, type DraftLine, type StockShortfall } from '../../../lib/newOrder/orderLineModel'
import { money, priceLines } from '../../../lib/newOrder/previewPricing'
import type { HoReCa, Product, Promotion, User } from '../../../types'

interface OrderLinesGridProps {
  lines: DraftLine[]
  products: Product[]
  customer: HoReCa | null
  currentUser: User
  promotions: Promotion[]
  overStock?: Map<number, StockShortfall>
  onChangeQuantity: (index: number, quantity: number) => void
  onChangeUnit?: (index: number, uomId: number | null) => void
  onRemove: (index: number) => void
  /** Called with each quantity box, so the screen can move focus into a line. */
  registerQuantityInput?: (key: string, el: HTMLInputElement | null) => void
  /** Enter in a quantity box: the screen sends focus back to quick-add. */
  onQuantityEnter?: () => void
}

export const lineKey = (l: Pick<DraftLine, 'productId' | 'uomId'>) => `${l.productId}:${l.uomId ?? 'base'}`

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_6rem_6.5rem_6.5rem_2.75rem] sm:items-center'

export default function OrderLinesGrid({
  lines,
  products,
  customer,
  currentUser,
  promotions,
  overStock = new Map(),
  onChangeQuantity,
  onChangeUnit,
  onRemove,
  registerQuantityInput,
  onQuantityEnter,
}: OrderLinesGridProps) {
  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  const { unitPrices, total } = priceLines(lines, products, customer, currentUser, promotions)

  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      <div className={`${ROW} hidden sm:grid border-b border-stone-200 bg-stone-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-600 rounded-t-xl`}>
        <span>Product</span>
        <span>Unit</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Each</span>
        <span className="text-right">Line</span>
        <span className="sr-only">Remove</span>
      </div>

      {lines.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-stone-600">
          No lines yet. Type a SKU above and press Enter, or add from the customer&apos;s history.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {lines.map((line, index) => {
            const product = byId.get(line.productId)
            const name = product?.name ?? `Product ${line.productId}`
            const units = product ? orderableUoms(product) : []
            const shortfall = overStock.get(line.productId)
            const badQty = !Number.isInteger(line.quantity) || line.quantity < 1
            return (
              <li key={lineKey(line)} className={`${ROW} px-4 py-3 ${shortfall ? 'bg-red-50/60' : ''}`}>
                <div className="min-w-0 col-span-2 sm:col-span-1">
                  <p className="font-medium text-stone-900 truncate">{name}</p>
                  <p className="font-mono text-xs text-stone-600">
                    {product?.sku}
                    {product && <span className="ml-2">· {Math.max(0, product.available)} avail.</span>}
                  </p>
                  {shortfall && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700" role="alert">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      Only {shortfall.available} available — {shortfall.requested} asked for
                    </p>
                  )}
                </div>

                <div>
                  {units.length > 1 && onChangeUnit ? (
                    <Select
                      dense
                      aria-label={`Unit for ${name}`}
                      value={line.uomId == null ? String(units.find((u) => u.isBase)?.id ?? '') : String(line.uomId)}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        const chosen = units.find((u) => String(u.id) === e.target.value)
                        onChangeUnit(index, chosen && !chosen.isBase ? chosen.id : null)
                      }}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}{u.isBase ? '' : ` ×${u.factorToBase}`}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm text-stone-600">{units[0]?.code ?? product?.unit ?? 'each'}</span>
                  )}
                </div>

                <div className="sm:text-right">
                  <NumberInput
                    ref={(el: HTMLInputElement | null) => registerQuantityInput?.(lineKey(line), el)}
                    value={Number.isFinite(line.quantity) ? line.quantity : ''}
                    min={1}
                    step={1}
                    dense
                    invalid={badQty || !!shortfall}
                    aria-label={`Quantity for ${name}`}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onChangeQuantity(index, e.target.value === '' ? Number.NaN : Number(e.target.value))
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        onQuantityEnter?.()
                      }
                    }}
                    className="text-right"
                  />
                </div>

                <span className="hidden sm:block text-right font-mono text-sm text-stone-600">{money(unitPrices[index])}</span>

                <span className="text-right font-mono text-sm font-medium text-stone-900 self-center">
                  {money(unitPrices[index] * (Number.isFinite(line.quantity) ? line.quantity : 0))}
                </span>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    aria-label={`Remove ${name}`}
                    className="touch-target p-1.5 rounded-lg text-stone-500 hover:text-red-700 hover:bg-red-50 btn-press"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <div data-total-row className="flex items-center justify-end gap-4 border-t border-stone-200 bg-stone-50 px-4 py-2.5 rounded-b-xl">
          <span className="text-sm font-semibold text-stone-600">Estimated total</span>
          <span className="font-mono font-bold text-stone-900">{money(total)}</span>
        </div>
      )}
    </div>
  )
}
