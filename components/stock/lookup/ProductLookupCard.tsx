// Where is this item, how many do we have, and what is it.
//
// Three of the four jobs this screen exists for, answered in that order —
// because an operator who has just scanned something is holding it, and what
// they do not know is where the rest of it lives.
//
// ── MONEY IS ABSENT, NOT BLANKED, FOR THE WAREHOUSE ROLE ────────────────────
//
// `canSeeProductPricing` gates the whole pricing block: no label, no dash, no
// empty row. A blanked field still says "there is a number here you are not
// being shown", which is both noisier and less true than simply not being a
// screen that talks about money. It is a DISPLAY rule — see that module.

import React, { useMemo } from 'react'
import { Barcode, ClipboardList, Home, MapPin, Package } from 'lucide-react'
import { Callout } from '@/components/ui'
import type { Product, User } from '../../../types'
import { useBalancesByProduct, useLocations } from '@/hooks/queries/useInventoryBalances'
import { useProductHomeBins } from '@/hooks/queries/useProductHomeBins'
import { classifyStock, lowStockThresholdFor } from '@/lib/stockStatus'
import { decomposeToUoms, formatBreakdown } from '@/lib/uomDecompose'
import { deriveDefaultUoms } from '@/lib/uom'
import { subtreeLocationIds } from '@/lib/warehouseSubtree'
import { canSeeProductPricing } from '@/lib/canSeeProductPricing'
import { locationTitle } from '@/lib/locationDisplay'
import type { ProductMatchSource } from '@/lib/scan/resolveScan'
import { StatusPill } from '../OpsStockRow'

const MATCHED_ON: Record<ProductMatchSource, string> = {
  sku: 'matched on SKU',
  barcode: 'matched on barcode',
  batchBarcode: 'matched on a batch barcode',
}

export interface ProductLookupCardProps {
  product: Product
  /** How `resolveScan` got here. Rendered so a mis-scan is legible — a code
   *  that matched a batch barcode rather than the product's own is worth
   *  knowing when the answer looks wrong. */
  matchedOn?: ProductMatchSource
  currentUser: User
  globalThreshold: number
  /** Numeric site id, or null for a site-wide view. */
  scopeId: number | null
  scopeLabel: string | null
  onCountBin?: (locationId: number) => void
}

export function ProductLookupCard({
  product,
  matchedOn,
  currentUser,
  globalThreshold,
  scopeId,
  scopeLabel,
  onCountBin,
}: ProductLookupCardProps) {
  const { data: balances, isLoading, isError } = useBalancesByProduct(product.id)
  const { data: locations } = useLocations()
  const { data: homeBins } = useProductHomeBins(product.id)
  const showMoney = canSeeProductPricing(currentUser.role)

  const scopedIds = useMemo(
    () => subtreeLocationIds(locations, scopeId),
    [locations, scopeId],
  )

  // `null` from subtreeLocationIds means "do not filter" — site-wide, or the
  // tree has not loaded. An empty Set would mean the opposite, so the two are
  // never conflated here.
  const inScope = useMemo(
    () => (balances ?? []).filter((b) => !scopedIds || scopedIds.has(b.locationId)),
    [balances, scopedIds],
  )
  const elsewhere = useMemo(
    () => (balances ?? []).filter((b) => scopedIds && !scopedIds.has(b.locationId)),
    [balances, scopedIds],
  )

  const totals = useMemo(() => {
    let onHand = 0, allocated = 0, available = 0
    for (const b of inScope) { onHand += b.onHand; allocated += b.allocated; available += b.available }
    return { onHand, allocated, available }
  }, [inScope])

  const elsewhereOnHand = useMemo(
    () => elsewhere.reduce((sum, b) => sum + b.onHand, 0),
    [elsewhere],
  )

  const breakdownLabel = useMemo(() => {
    const uoms = (product.uoms && product.uoms.length > 0)
      ? product.uoms
      : deriveDefaultUoms(product.unit, product.price, product.cartonSize)
    if (uoms.length <= 1 || totals.onHand <= 0) return null
    const parts = decomposeToUoms(totals.onHand, uoms)
    if (parts.length <= 1) return null
    return formatBreakdown(parts)
  }, [product.uoms, product.unit, product.price, product.cartonSize, totals.onHand])

  const status = classifyStock(totals.available, lowStockThresholdFor(product, globalThreshold))
  const withStock = inScope.filter((b) => b.onHand !== 0)

  const locationById = useMemo(
    () => new Map((locations ?? []).map((l) => [l.id, l])),
    [locations],
  )

  // Home bins are per (product, warehouse); under a site-wide view show them
  // all, otherwise only the site being worked in.
  const scopedHomeBins = useMemo(
    () => (homeBins ?? []).filter((hb) => scopeId == null || hb.warehouseId === scopeId),
    [homeBins, scopeId],
  )

  return (
    <div className="space-y-4">
      {/* The NAME leads, not the code. Unlike a bin or a plate, the operator is
          holding this object — identifying it is not the question. */}
      <div className="px-1 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-stone-100 text-stone-600">
          <Package className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold leading-tight text-stone-900">{product.name}</h2>
        <p className="mt-1.5 break-all font-mono text-sm text-stone-700">{product.sku}</p>
        {matchedOn && <p className="mt-1 text-xs text-stone-600">{MATCHED_ON[matchedOn]}</p>}
        <div className="mt-3 flex justify-center"><StatusPill status={status} /></div>
      </div>

      {/* Divided strip, not three nested boxes — one surface, two rules. */}
      <dl className="grid grid-cols-3 divide-x divide-stone-200 rounded-xl border border-stone-200 bg-white text-center">
        <div className="min-w-0 px-2 py-3">
          <dt className="text-xs text-stone-600">On hand</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-stone-900">{totals.onHand}</dd>
        </div>
        <div className="min-w-0 px-2 py-3">
          <dt className="text-xs text-stone-600">Allocated</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-stone-600">{totals.allocated}</dd>
        </div>
        <div className="min-w-0 px-2 py-3">
          <dt className="text-xs text-stone-600">Available</dt>
          <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-emerald-700">{totals.available}</dd>
        </div>
      </dl>

      {breakdownLabel && (
        <p className="text-center text-xs text-stone-600">{breakdownLabel}</p>
      )}

      {elsewhereOnHand > 0 && (
        <Callout tone="info" dense title="More at other sites">
          {elsewhereOnHand} units sit outside {scopeLabel ?? 'this site'}. The figures above count
          only where you are working.
        </Callout>
      )}

      {/* Where it is */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Where it is</h3>
        {isLoading ? (
          <div className="glass-card rounded-xl divide-y divide-stone-100">
            {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse bg-stone-100/60" />)}
          </div>
        ) : isError ? (
          <div className="glass-card rounded-xl p-6 text-center">
            <p className="text-sm text-red-600">Couldn't load the locations.</p>
            <p className="mt-1 text-xs text-stone-600">Check your connection and try again.</p>
          </div>
        ) : withStock.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <MapPin className="mx-auto mb-2 h-8 w-8 text-stone-300" aria-hidden="true" />
            <p className="text-sm text-stone-700">Not in any bin here</p>
            <p className="mt-1 text-xs text-stone-600">
              {inScope.length > 0
                ? `${inScope.length} empty ${inScope.length === 1 ? 'slot is' : 'slots are'} still reserved for it.`
                : 'No balance rows at this site.'}
            </p>
          </div>
        ) : (
          <ul className="glass-card divide-y divide-stone-100 overflow-hidden rounded-xl">
            {withStock.map((b) => (
              <li key={b.balanceId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold text-stone-900">
                    {b.locationCode ?? 'MAIN'}
                  </p>
                  <p className="truncate text-xs text-stone-600">
                    {locationTitle({ code: b.locationCode ?? 'MAIN', name: b.locationName })}
                    {' · '}
                    {b.lotCode ? `lot ${b.lotCode}` : 'untracked'}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-semibold tabular-nums text-stone-900">{b.onHand}</span>
                  {b.allocated > 0 && (
                    <span className="block text-xs tabular-nums text-stone-600">{b.allocated} alloc</span>
                  )}
                </p>
                {onCountBin && <button
                  type="button"
                  onClick={() => onCountBin(b.locationId)}
                  aria-label={`Count ${b.locationCode ?? 'this location'}`}
                  className="touch-target inline-flex shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 btn-press"
                >
                  <ClipboardList className="h-4 w-4" aria-hidden="true" />
                </button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The pick face, shown even when it is empty — that is precisely when a
          picker needs to know it exists, and `product_home_bins` carries only
          `binId`, so the code comes from the locations tree. */}
      {scopedHomeBins.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
            <Home className="h-4 w-4 text-stone-600" aria-hidden="true" /> Home bin
          </h3>
          <ul className="glass-card divide-y divide-stone-100 overflow-hidden rounded-xl">
            {scopedHomeBins.map((hb) => {
              const bin = locationById.get(hb.binId)
              return (
                <li key={`${hb.binId}-${hb.purpose}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-stone-900">{bin?.code ?? `#${hb.binId}`}</p>
                    {hb.purpose !== 'primary' && (
                      <p className="truncate text-xs text-stone-600">{hb.purpose}</p>
                    )}
                  </div>
                  {(hb.minQty != null || hb.maxQty != null) && (
                    <p className="shrink-0 text-xs tabular-nums text-stone-600">
                      min {hb.minQty ?? '—'} · max {hb.maxQty ?? '—'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* What it is */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Details</h3>
        <dl className="glass-card divide-y divide-stone-100 overflow-hidden rounded-xl text-sm">
          <Detail label="Barcode" value={product.barcode ?? null} mono icon={<Barcode className="h-3.5 w-3.5" aria-hidden="true" />} />
          <Detail label="Unit" value={product.unit} />
          <Detail label="Per carton" value={String(product.cartonSize)} />
          <Detail label="Category" value={product.category} />
          <Detail label="Brand" value={product.brand ?? null} />
          {showMoney && <Detail label="Sell price" value={`$${product.price.toFixed(2)}`} />}
        </dl>
      </section>
    </div>
  )
}

function Detail({ label, value, mono, icon }: {
  label: string
  value: string | null
  mono?: boolean
  icon?: React.ReactNode
}) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-stone-600">{icon}{label}</dt>
      <dd className={`min-w-0 truncate text-right text-stone-900 ${mono ? 'font-mono text-sm' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  )
}

export default ProductLookupCard
