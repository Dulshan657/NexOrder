// Renders whichever screen the lookup state machine has settled on.
//
// A pure presenter: all the state lives in `useStockLookup`, which `StockView`
// owns so the scan dock can stay the last child of the page root. This has no
// `min-h-svh` and must never grow one — the page root already carries it, and a
// second would add a whole blank screen below the results that `check:viewport`
// would happily pass.

import React, { useMemo } from 'react'
import type { Product, User } from '../../../types'
import type { ScanMatch } from '@/lib/scan/resolveScan'
import { subtreeLocationIds } from '@/lib/warehouseSubtree'
import { useLocations } from '@/hooks/queries/useInventoryBalances'
import type { LookupScreen } from './useStockLookup'
import { LookupIdleCard } from './LookupIdleCard'
import { LookupMissCard } from './LookupMissCard'
import { BinLookupCard } from './BinLookupCard'
import { PlateLookupCard } from './PlateLookupCard'
import { ProductLookupCard } from './ProductLookupCard'

export interface StockLookupPanelProps {
  screen: LookupScreen
  products: readonly Product[]
  currentUser: User
  globalThreshold: number
  scopeId: number | null
  scopeLabel: string | null
  onCountBin?: (locationId: number) => void
  onSearchCatalogue: (query: string) => void
  onPick: (match: ScanMatch) => void
}

export function StockLookupPanel({
  screen,
  products,
  currentUser,
  globalThreshold,
  scopeId,
  scopeLabel,
  onCountBin,
  onSearchCatalogue,
  onPick,
}: StockLookupPanelProps) {
  const { data: locations } = useLocations()
  const scopedIds = useMemo(() => subtreeLocationIds(locations, scopeId), [locations, scopeId])

  if (screen.kind === 'idle') return <LookupIdleCard />

  if (screen.kind === 'resolving') {
    return (
      <div className="space-y-4">
        <div className="px-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">Looking up</p>
          <p className="mt-1.5 break-all font-mono text-3xl font-bold leading-none tracking-tight text-stone-900">
            {screen.code}
          </p>
        </div>
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      </div>
    )
  }

  if (screen.kind === 'location') {
    return (
      <BinLookupCard
        location={screen.location}
        // `null` from subtreeLocationIds means "not filtering", which is not the
        // same as "out of scope" — under a site-wide view everything is in it.
        inScope={!scopedIds || scopedIds.has(screen.location.id)}
        scopeLabel={scopeLabel}
        onCountBin={onCountBin}
      />
    )
  }

  if (screen.kind === 'plate') {
    return <PlateLookupCard plate={screen.plate} onCountBin={onCountBin} />
  }

  if (screen.kind === 'product') {
    // The index carries a narrow ScanProduct; the cards need the full record.
    const full = products.find((p) => p.id === screen.product.id)
    if (!full) {
      return (
        <LookupMissCard
          normalized={screen.product.sku}
          onPick={onPick}
          onSearchCatalogue={onSearchCatalogue}
        />
      )
    }
    return (
      <ProductLookupCard
        product={full}
        matchedOn={screen.matchedOn}
        currentUser={currentUser}
        globalThreshold={globalThreshold}
        scopeId={scopeId}
        scopeLabel={scopeLabel}
        onCountBin={onCountBin}
      />
    )
  }

  return (
    <LookupMissCard
      normalized={screen.normalized}
      candidates={screen.kind === 'ambiguous' ? screen.candidates : undefined}
      onPick={onPick}
      onSearchCatalogue={onSearchCatalogue}
    />
  )
}

export default StockLookupPanel
