// "Ask the engine" — one card beside the map (NX-0039). A question per tab:
// where is this product and how do I walk it, where would a delivery go, how
// would these orders be walked, how did past picks walk. Every answer is a
// preview: the engine is asked in dry run and nothing moves.
//
// It used to be this card wrapping a second "Test bench" card of collapsible
// sections; the owner asked for one card.

import { useId, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import type { PutawayResponse } from '@/services/supabase/putawayService'
import type { PickRouteStop } from '@/types'
import { FindProductSection, type ProductHighlight } from './FindProductSection'
import { PutawayTab } from './askEngine/PutawayTab'
import { PickRouteTab } from './askEngine/PickRouteTab'
import { SimulateTab } from './askEngine/SimulateTab'

export interface AskEnginePanelProps {
  className?: string
  warehouseId: number
  layoutId: number
  onPutawayResult: (r: PutawayResponse | null) => void
  routeOrderIds: string[]
  onRouteOrderIdsChange: (ids: string[]) => void
  /** A product's walk to draw (NX-0039); null clears it. */
  onProductWalk: (stops: PickRouteStop[] | null) => void
  /** The places holding a found product, to highlight; null clears. */
  onHighlight: (h: ProductHighlight | null) => void
  /** Admin/Manager: `wie-simulate`'s role gate. The tab is left out otherwise.
   *  The function refuses anyway, and a tab that always errors is worse than no
   *  tab (NX-0046). */
  canSimulate?: boolean
}

type TabKey = 'find' | 'putaway' | 'route' | 'simulate'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'find', label: 'Find a product' },
  { key: 'putaway', label: 'Put away' },
  { key: 'route', label: 'Pick route' },
  { key: 'simulate', label: 'Simulate' },
]

export function AskEnginePanel({
  className = '',
  warehouseId,
  layoutId,
  onPutawayResult,
  routeOrderIds,
  onRouteOrderIdsChange,
  onProductWalk,
  onHighlight,
  canSimulate = false,
}: AskEnginePanelProps) {
  const [tab, setTab] = useState<TabKey>('find')
  const tabs = canSimulate ? TABS : TABS.filter((t) => t.key !== 'simulate')
  const base = useId()
  const tabId = (k: TabKey) => `${base}-tab-${k}`
  const panelId = (k: TabKey) => `${base}-panel-${k}`

  // Arrow keys move between tabs, as a tablist should.
  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    const i = tabs.findIndex((t) => t.key === tab)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = tabs[(i + step + tabs.length) % tabs.length].key
    setTab(next)
    document.getElementById(tabId(next))?.focus()
  }

  let body: ReactNode
  if (tab === 'find') body = <FindProductSection warehouseId={warehouseId} onWalk={onProductWalk} onHighlight={onHighlight} />
  else if (tab === 'putaway') body = <PutawayTab warehouseId={warehouseId} onResult={onPutawayResult} />
  else if (tab === 'route') body = <PickRouteTab warehouseId={warehouseId} routeOrderIds={routeOrderIds} onChange={onRouteOrderIdsChange} />
  else body = <SimulateTab layoutId={layoutId} />

  return (
    <section aria-labelledby={`${base}-title`} className={`glass-card flex flex-col overflow-hidden rounded-xl ${className}`}>
      <header className="shrink-0 space-y-2 px-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-nexgen-blue/10">
            <Sparkles className="h-4 w-4 text-nexgen-blue" aria-hidden="true" />
          </span>
          <h2 id={`${base}-title`} className="text-sm font-semibold text-stone-900">Ask the engine</h2>
          <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">
            Preview only — nothing moves
          </span>
        </div>
        <div role="tablist" aria-label="Questions" className="flex gap-1 overflow-x-auto border-b border-stone-200/80">
          {tabs.map((t) => {
            const on = t.key === tab
            return (
              <button
                key={t.key}
                id={tabId(t.key)}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId(t.key)}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={onKeyDown}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  on ? 'border-nexgen-blue text-nexgen-blue' : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </header>
      <div
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {body}
      </div>
    </section>
  )
}
