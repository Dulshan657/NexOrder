// What explain-product-location said about one product (NX-0039): its home
// location, where its stock actually is, and where a new delivery would go and
// why. Shared by the desktop "Find a product" tab and the handheld screen.
//
// Places, not "bins": a rack level is "Rack 7 · Level 2", a floor bay is a bay
// in its area, stock not yet put away is on the dock. The code stays beneath in
// small mono type — it is what the label on the shelf says.

import type { ProductWhereabouts, StockBadge } from '@/services/supabase/productWhereaboutsService'

const BADGE: Record<StockBadge, { label: string; className: string }> = {
  home: { label: 'Home', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  off_home: { label: 'Off home', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  at_dock: { label: 'At dock', className: 'bg-sky-50 text-sky-800 ring-sky-200' },
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

function Place({ place, code }: { place: string; code: string }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-medium text-stone-900">{place}</span>
      {code !== place && <span className="block truncate font-mono text-[11px] text-stone-600">{code}</span>}
    </span>
  )
}

export function WhereaboutsSummary({ answer }: { answer: ProductWhereabouts }) {
  const { homeBin, stock, newDelivery } = answer
  const total = stock.reduce((t, s) => t + s.onHand, 0)
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-stone-900">{answer.product.name}</p>
        <p className="shrink-0 tabular-nums text-stone-600">{qty(total)} on site</p>
      </div>

      <div data-testid="home-place" className="rounded-lg bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-100">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Home location</p>
        {homeBin
          ? <Place place={homeBin.place} code={homeBin.code} />
          : <span className="text-stone-700">None set yet</span>}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-600">Where it is now</p>
        {stock.length === 0 ? (
          <p className="text-stone-600">None at this warehouse.</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg ring-1 ring-stone-200">
            {stock.map((s) => (
              <li key={s.locationId} data-testid={`stock-${s.locationId}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <Place place={s.place} code={s.code} />
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-stone-700">×{qty(s.onHand)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BADGE[s.badge].className}`}>
                    {BADGE[s.badge].label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg bg-stone-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">
          A new delivery
          {newDelivery && (
            <span className="font-normal normal-case tracking-normal"> · {qty(newDelivery.quantity)} units (one case), by the putaway rules</span>
          )}
        </p>
        <p className="mt-0.5 text-stone-800">
          {newDelivery
            ? newDelivery.reason
            : answer.newDeliveryNote ?? 'This warehouse has no published layout, so there is no putaway suggestion.'}
        </p>
      </div>
    </div>
  )
}
