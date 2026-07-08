// Re-slotting suggestions for a warehouse. Operators can trigger a batch
// re-optimization pass and then Accept / Reject each move the engine proposes
// (product · from-bin → to-bin · expected travel saved).

import { useMemo } from 'react'
import { Sparkles, ArrowRight, Check, X } from 'lucide-react'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useSlottingSuggestions, useDecideSlotting, useRunReoptimize } from '@/hooks/queries/useSlottingSuggestions'
import { useToasts } from '@/hooks/useToasts'
import type { SlottingSuggestion, Warehouse } from '@/types'

interface SlottingSuggestionsViewProps {
  warehouse: Warehouse
  /** Optional product-name lookup; falls back to `#id` when a name is missing. */
  productNameById?: Map<number, string>
}

export function SlottingSuggestionsView({ warehouse, productNameById }: SlottingSuggestionsViewProps) {
  const suggestionsQuery = useSlottingSuggestions(warehouse.id)
  const locationsQuery = useWarehouseLocations(warehouse.id)
  const decide = useDecideSlotting(warehouse.id)
  const reoptimize = useRunReoptimize(warehouse.id)
  const { addToast } = useToasts()

  const codeById = useMemo(() => {
    const m = new Map<number, string>()
    for (const l of locationsQuery.data ?? []) m.set(l.id, l.code)
    return m
  }, [locationsQuery.data])

  const runReoptimize = async () => {
    try {
      const { considered, suggested } = await reoptimize.mutateAsync()
      addToast(
        `Re-optimization complete — considered ${considered} item${considered === 1 ? '' : 's'}, ${suggested} new suggestion${suggested === 1 ? '' : 's'}.`,
        suggested > 0 ? 'success' : 'info',
      )
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Re-optimization failed.', 'error')
    }
  }

  const decideMove = async (s: SlottingSuggestion, decision: 'accept' | 'reject') => {
    try {
      await decide.mutateAsync({ suggestionId: s.id, decision })
      addToast(decision === 'accept' ? 'Move accepted.' : 'Suggestion dismissed.', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not apply decision.', 'error')
    }
  }

  const productName = (id: number) => productNameById?.get(id) ?? `#${id}`
  const binCode = (id: number) => codeById.get(id) ?? `#${id}`

  const suggestions = suggestionsQuery.data ?? []
  const reslotCount = suggestions.filter((s) => s.origin === 'reslot').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <h4 className="text-sm font-semibold text-stone-700">Re-slotting suggestions</h4>
        </div>
        <button
          onClick={runReoptimize}
          disabled={reoptimize.isPending}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-emerald-200 text-emerald-700 rounded-lg btn-press disabled:opacity-40"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {reoptimize.isPending ? 'Running…' : 'Run re-optimization'}
        </button>
      </div>

      {reslotCount > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <span className="font-semibold">Layout relocation in progress</span> — {reslotCount} move{reslotCount === 1 ? '' : 's'} pending
          from a recent layout publish. Accept each to physically relocate its stock into the new bins.
        </div>
      )}

      {suggestionsQuery.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-8 text-xs text-stone-500 border border-dashed border-stone-200 rounded-lg">
          No re-slotting suggestions. Run a re-optimization to look for better bin assignments.
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 border border-stone-100 rounded-lg overflow-hidden">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-stone-800 truncate">
                  {productName(s.productId)}
                  {s.origin === 'reslot' && (
                    <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700">Relocation</span>
                  )}
                </p>
                <p className="text-[11px] text-stone-500 flex items-center gap-1 mt-0.5">
                  <span className="font-mono">{binCode(s.fromLocationId)}</span>
                  <ArrowRight className="w-3 h-3 text-stone-400" />
                  <span className="font-mono text-emerald-600">{binCode(s.toLocationId)}</span>
                  <span className="text-stone-400">· saves {s.expectedGainM.toFixed(1)} m</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => decideMove(s, 'accept')}
                  disabled={decide.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" /> Accept
                </button>
                <button
                  onClick={() => decideMove(s, 'reject')}
                  disabled={decide.isPending}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 border border-stone-200 text-stone-600 rounded-lg btn-press disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
