// Dry-run WIE test bench. Everything here is read-only: it calls the engine's
// non-committing endpoints (recommend-putaway, recommend-pick-route, wie-simulate)
// so an operator can SEE what the engine would do without moving any stock.
// It never touches decide-putaway / decide-slotting.

import { useMemo, useState, type ReactNode } from 'react'
import { FlaskConical, ChevronDown, ChevronRight } from 'lucide-react'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import type { SimulationResult } from '@/types'
import { useProducts } from '@/hooks/queries/useProducts'
import { usePickQueue } from '@/hooks/queries/usePickQueue'
import { useRecommendPutaway } from '@/hooks/queries/usePutawayRecommendation'
import { useRunSimulation } from '@/hooks/queries/useSimulation'
import { PutawayExplanationCard } from '@/components/inventory/PutawayExplanationCard'
import { PickRoutePanel } from '@/components/inventory/PickRoutePanel'
import { SimulationResultCard } from '@/components/admin/layout/SimulationResultCard'

interface WarehouseTestBenchProps {
  warehouseId: number
  layoutId: number
  onPutawayResult: (r: PutawayResponse | null) => void
  routeOrderIds: string[]
  onRouteOrderIdsChange: (ids: string[]) => void
}

const MAX_ROUTE_ORDERS = 3

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-stone-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-stone-700 btn-press"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-stone-400" /> : <ChevronRight className="h-3.5 w-3.5 text-stone-400" />}
        {title}
      </button>
      {open && <div className="border-t border-stone-100 p-3">{children}</div>}
    </div>
  )
}

function PutawayTest({ warehouseId, onResult }: { warehouseId: number; onResult: (r: PutawayResponse | null) => void }) {
  const { data: products } = useProducts()
  const [productId, setProductId] = useState<number | null>(null)
  const [qty, setQty] = useState(5)
  const recommend = useRecommendPutaway()

  const run = async () => {
    if (productId == null) return
    try {
      const result = await recommend.mutateAsync({ warehouseId, lines: [{ product_id: productId, quantity: qty }], dryRun: true })
      onResult(result)
    } catch {
      onResult(null) // error surfaced via recommend.isError below
    }
  }

  const rec = recommend.data?.mode === 'engine' ? recommend.data.recommendations[0] : null

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={productId ?? ''}
          onChange={(e) => { setProductId(e.target.value ? Number(e.target.value) : null); onResult(null) }}
          className="min-w-[10rem] flex-1 rounded-lg border border-stone-200 px-2 py-1.5"
        >
          <option value="">Select a product…</option>
          {(products ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          type="number" min={1} value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 rounded-lg border border-stone-200 px-2 py-1.5"
        />
        <button
          onClick={run}
          disabled={productId == null || recommend.isPending}
          className="rounded-lg bg-nexgen-blue px-3 py-1.5 font-semibold text-white btn-press disabled:opacity-40"
        >
          {recommend.isPending ? '…' : 'Recommend'}
        </button>
      </div>
      {recommend.isError && <p className="rounded bg-red-50 px-2 py-1.5 text-red-600">Recommendation failed. Try again.</p>}
      {recommend.data?.mode === 'legacy' && (
        <p className="rounded bg-amber-50 px-2 py-1.5 text-amber-700">
          Legacy heuristic — this warehouse has no published layout, so the engine returns no spatial recommendation.
        </p>
      )}
      {rec && (rec.recommendedLocationId != null
        ? <PutawayExplanationCard explanation={rec.explanation} />
        : <p className="rounded bg-stone-50 px-2 py-1.5 text-stone-500">No eligible bin for this product.</p>)}
    </div>
  )
}

function PickRouteTest({
  warehouseId, routeOrderIds, onChange,
}: { warehouseId: number; routeOrderIds: string[]; onChange: (ids: string[]) => void }) {
  const { data: queue } = usePickQueue()
  const orders = useMemo(
    () => (queue ?? []).filter((o) => o.fulfilmentWarehouseIds.includes(warehouseId)),
    [queue, warehouseId],
  )

  const toggle = (orderId: string) => {
    if (routeOrderIds.includes(orderId)) onChange(routeOrderIds.filter((id) => id !== orderId))
    else if (routeOrderIds.length < MAX_ROUTE_ORDERS) onChange([...routeOrderIds, orderId])
  }

  return (
    <div className="space-y-2 text-xs">
      {orders.length === 0 ? (
        <p className="text-stone-400">No pickable orders at this warehouse.</p>
      ) : (
        <>
          <p className="text-stone-400">Pick up to {MAX_ROUTE_ORDERS} orders to route:</p>
          <div className="max-h-32 space-y-1 overflow-auto">
            {orders.map((o) => {
              const on = routeOrderIds.includes(o.orderId)
              return (
                <button
                  key={o.orderId}
                  onClick={() => toggle(o.orderId)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left btn-press ${
                    on ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 text-stone-600'
                  }`}
                >
                  <span className="font-mono">{o.orderId.slice(0, 10)}</span>
                  <span className="truncate pl-2 text-stone-400">{o.horecaName}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {routeOrderIds.length > 0 && <PickRoutePanel warehouseId={warehouseId} orderIds={routeOrderIds} />}
    </div>
  )
}

function SimulateTest({ layoutId }: { layoutId: number }) {
  const [days, setDays] = useState(30)
  const sim = useRunSimulation()
  const result: SimulationResult | undefined = sim.data

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-stone-500">History window</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-stone-200 px-2 py-1.5">
          {[7, 30, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <button
          onClick={() => sim.mutate({ layoutId, days })}
          disabled={sim.isPending}
          className="rounded-lg bg-nexgen-blue px-3 py-1.5 font-semibold text-white btn-press disabled:opacity-40"
        >
          {sim.isPending ? 'Simulating…' : 'Simulate'}
        </button>
      </div>
      {sim.isError && <p className="text-red-600">Simulation failed. Try again.</p>}
      {result && <SimulationResultCard result={result} variant="flat" />}
    </div>
  )
}

export function WarehouseTestBench({
  warehouseId, layoutId, onPutawayResult, routeOrderIds, onRouteOrderIdsChange,
}: WarehouseTestBenchProps) {
  return (
    <div className="glass-card rounded-xl p-3">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-nexgen-blue" />
        <p className="text-sm font-semibold text-stone-900">Test bench</p>
        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
          read-only · dry-run
        </span>
      </div>
      <p className="mb-3 text-[11px] text-stone-400">Preview engine decisions on the grid. Nothing is committed — no stock moves.</p>
      <div className="space-y-2">
        <Section title="Putaway — where would a product go?" defaultOpen>
          <PutawayTest warehouseId={warehouseId} onResult={onPutawayResult} />
        </Section>
        <Section title="Pick route — how would an order be walked?">
          <PickRouteTest warehouseId={warehouseId} routeOrderIds={routeOrderIds} onChange={onRouteOrderIdsChange} />
        </Section>
        <Section title="Simulate — replay historical picks">
          <SimulateTest layoutId={layoutId} />
        </Section>
      </div>
    </div>
  )
}
