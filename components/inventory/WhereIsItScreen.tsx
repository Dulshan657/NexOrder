// "Where is it?" (NX-0039) — the handheld half of Ask the engine's "Find a
// product". Scan a product on the RS35 and read where it lives, where a new
// delivery would go, and both walks from the dock as numbered steps. The map is
// a desk surface; on a 360 px screen the walk is text.
//
// Read-only: explain-product-location answers from the normal putaway rules in
// dry run and the pick-route engine, and moves nothing.

import React, { useMemo, useState } from 'react'
import { useWarehouses } from '@/hooks/queries/useWarehouses'
import { useWarehouseScope } from '@/context/WarehouseScopeContext'
import { useProductWhereabouts } from '@/hooks/queries/useProductWhereabouts'
import { UserRole, type User } from '@/types'
import { ADMIN_TAB_LABELS } from '@/lib/adminTabUrl'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import StickyScanBar from './StickyScanBar'
import { ProductScanBox } from './whereabouts/ProductScanBox'
import { WhereaboutsSummary } from './whereabouts/WhereaboutsSummary'
import { WalkSteps } from './whereabouts/WalkSteps'

interface WhereIsItScreenProps {
  currentUser: User
}

const WhereIsItScreen: React.FC<WhereIsItScreenProps> = ({ currentUser }) => {
  const { data: warehouses } = useWarehouses()
  const activeWarehouses = useMemo(() => (warehouses ?? []).filter((w) => w.isActive), [warehouses])

  // A Warehouse user looks up stock at their own site — the server refuses
  // any other. Everyone else: the shared scope when one is picked, otherwise
  // their own site, otherwise the first active warehouse.
  const { scope } = useWarehouseScope()
  const ownSite = currentUser.role === UserRole.WAREHOUSE ? currentUser.homeWarehouseId ?? null : null
  const fallback = useMemo(() => {
    const home = currentUser.homeWarehouseId
    if (home != null && activeWarehouses.some((w) => w.id === home)) return home
    return activeWarehouses[0]?.id ?? null
  }, [activeWarehouses, currentUser.homeWarehouseId])
  const warehouseId = ownSite ?? (scope !== 'all' ? scope : fallback)

  const [productId, setProductId] = useState<number | null>(null)
  const { data: answer, isLoading, isError } = useProductWhereabouts(warehouseId, productId)

  return (
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS['Where is it']}
        description="Scan a product to see where it lives and how to walk to it."
      />
      <StickyScanBar>
        <ProductScanBox onProduct={setProductId} wedge />
      </StickyScanBar>

      {warehouseId == null && <p className="text-sm text-stone-600">No active warehouse.</p>}
      {productId != null && isLoading && <p className="text-sm text-stone-600">Asking the engine…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">Could not look that product up. Try again.</p>
      )}

      {answer && (
        <div className="space-y-4">
          <WhereaboutsSummary answer={answer} />
          {answer.mode === 'engine' ? (
            <>
              <WalkSteps title="Put away walk" walk={answer.putawayWalk} empty="No bin can take a new delivery." />
              <WalkSteps title="Pick walk" walk={answer.pickWalk} empty="No stock free to pick." />
            </>
          ) : (
            <p className="text-xs text-stone-600">This warehouse has no published layout, so there are no walks.</p>
          )}
        </div>
      )}
    </PageFrame>
  )
}

export default WhereIsItScreen
