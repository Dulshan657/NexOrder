// Post-receipt putaway panel. For a layout-enabled warehouse, shows the engine's
// recommended bin per received line with an explainable "Why?" and lets the
// operator Accept, Choose another bin (override), or Skip (leave at the receiving
// dock for later). Accept/override moves the stock root→bin server-side.

import { useMemo, useState } from 'react'
import { Check, HelpCircle, ArrowRight } from 'lucide-react'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useDecidePutaway } from '@/hooks/queries/usePutawayRecommendation'
import type { PutawayLineRecommendation } from '@/types'
import { PutawayExplanationCard } from './PutawayExplanationCard'

interface PutawayPanelProps {
  warehouseId: number
  recommendations: PutawayLineRecommendation[]
  productNameById: Map<number, string>
}

type LineStatus = 'pending' | 'accepted' | 'overridden' | 'skipped'

export function PutawayPanel({ warehouseId, recommendations, productNameById }: PutawayPanelProps) {
  const locationsQuery = useWarehouseLocations(warehouseId)
  const decide = useDecidePutaway()
  const [statuses, setStatuses] = useState<Record<number, LineStatus>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [overrideChoice, setOverrideChoice] = useState<Record<number, number>>({})

  const codeById = useMemo(() => {
    const m = new Map<number, string>()
    for (const l of locationsQuery.data ?? []) m.set(l.id, l.code)
    return m
  }, [locationsQuery.data])

  const binOptions = useMemo(
    () => (locationsQuery.data ?? []).filter((l) => l.isActive && (l.kind === 'BIN' || l.kind === 'SHELF' || l.kind === 'RACK' || l.kind === 'BAY')),
    [locationsQuery.data],
  )

  const setStatus = (id: number, s: LineStatus) => setStatuses((prev) => ({ ...prev, [id]: s }))

  const accept = async (rec: PutawayLineRecommendation) => {
    await decide.mutateAsync({ recommendationId: rec.recommendationId, decision: 'accept' })
    setStatus(rec.recommendationId, 'accepted')
  }

  const override = async (rec: PutawayLineRecommendation) => {
    const chosen = overrideChoice[rec.recommendationId]
    if (!chosen) return
    await decide.mutateAsync({ recommendationId: rec.recommendationId, decision: 'override', chosenLocationId: chosen })
    setStatus(rec.recommendationId, 'overridden')
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100">
        <h2 className="text-sm font-semibold text-stone-700">Put away — recommended bins</h2>
        <p className="text-xs text-stone-400 mt-0.5">The engine picked the best bin for each line. Accept, choose another, or skip.</p>
      </div>
      <ul className="divide-y divide-stone-100">
        {recommendations.map((rec) => {
          const status = statuses[rec.recommendationId] ?? 'pending'
          const done = status !== 'pending'
          const recCode = rec.recommendedLocationId ? codeById.get(rec.recommendedLocationId) ?? `#${rec.recommendedLocationId}` : null
          return (
            <li key={rec.recommendationId} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-800 truncate">{productNameById.get(rec.productId) ?? `Product ${rec.productId}`}</p>
                  <p className="text-xs text-stone-400">
                    {rec.quantity} units →{' '}
                    {recCode ? <span className="font-mono text-emerald-600">{recCode}</span> : <span className="text-amber-600">no eligible bin</span>}
                  </p>
                </div>

                {done ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="w-3.5 h-3.5" />
                    {status === 'skipped' ? 'Skipped' : status === 'overridden' ? 'Put away (override)' : 'Put away'}
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setExpanded(expanded === rec.recommendationId ? null : rec.recommendationId)}
                      className="p-1.5 rounded-lg hover:bg-stone-100 btn-press" aria-label="Why this bin?"
                    >
                      <HelpCircle className="w-4 h-4 text-stone-400" />
                    </button>
                    <button
                      onClick={() => accept(rec)}
                      disabled={!rec.recommendedLocationId || decide.isPending}
                      className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => setStatus(rec.recommendationId, 'skipped')}
                      className="text-xs px-2.5 py-1 border border-stone-200 rounded-lg btn-press"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>

              {expanded === rec.recommendationId && !done && (
                <div className="mt-3 pl-1 space-y-3">
                  <PutawayExplanationCard explanation={rec.explanation} />
                  <div className="flex items-center gap-2">
                    <select
                      value={overrideChoice[rec.recommendationId] ?? ''}
                      onChange={(e) => setOverrideChoice((prev) => ({ ...prev, [rec.recommendationId]: Number(e.target.value) }))}
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1"
                      aria-label="Choose another bin"
                    >
                      <option value="">Choose another bin…</option>
                      {binOptions.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                    </select>
                    <button
                      onClick={() => override(rec)}
                      disabled={!overrideChoice[rec.recommendationId] || decide.isPending}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 border border-emerald-200 text-emerald-700 rounded-lg btn-press disabled:opacity-40"
                    >
                      Put here <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
