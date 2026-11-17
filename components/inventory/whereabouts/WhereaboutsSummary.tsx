// What explain-product-location said about one product (NX-0039): its home
// bin, where its stock actually is, and where a new delivery would go and why.
// Shared by the desktop "Find a product" card and the handheld screen.

import type { ProductWhereabouts, StockBadge } from '@/services/supabase/productWhereaboutsService'

const BADGE: Record<StockBadge, { label: string; className: string }> = {
  home: { label: 'Home', className: 'bg-emerald-50 text-emerald-800' },
  off_home: { label: 'Off home', className: 'bg-amber-50 text-amber-800' },
  at_dock: { label: 'At dock — awaiting putaway', className: 'bg-sky-50 text-sky-800' },
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

export function WhereaboutsSummary({ answer }: { answer: ProductWhereabouts }) {
  const { homeBin, stock, newDelivery } = answer
  return (
    <div className="space-y-2 text-xs">
      <p className="text-sm font-semibold text-stone-900">{answer.product.name}</p>

      <p data-testid="home-bin" className="text-stone-700">
        <span className="font-semibold">Home bin: </span>
        {homeBin ? <span className="font-mono">{homeBin.code}</span> : 'none set'}
      </p>

      <div>
        <p className="mb-1 font-semibold text-stone-700">Stock now</p>
        {stock.length === 0 ? (
          <p className="text-stone-600">None at this warehouse.</p>
        ) : (
          <ul className="space-y-1">
            {stock.map((s) => (
              <li
                key={s.locationId}
                data-testid={`stock-${s.locationId}`}
                className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-2 py-1"
              >
                <span className="font-mono text-stone-800">{s.badge === 'at_dock' ? 'Dock' : s.code}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-stone-700">×{qty(s.onHand)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${BADGE[s.badge].className}`}>
                    {BADGE[s.badge].label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-stone-200 px-2 py-1.5">
        <p className="font-semibold text-stone-700">
          A new delivery
          {newDelivery && (
            <span className="font-normal text-stone-600"> · {qty(newDelivery.quantity)} units (one case), by the putaway rules</span>
          )}
        </p>
        {newDelivery ? (
          <p className="text-stone-700">{newDelivery.reason}</p>
        ) : (
          <p className="text-stone-600">
            {answer.newDeliveryNote ?? 'This warehouse has no published layout, so there is no putaway suggestion.'}
          </p>
        )}
      </div>
    </div>
  )
}
