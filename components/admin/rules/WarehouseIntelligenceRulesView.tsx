// Container for the WIE optimizer config: putaway rules + the category
// compatibility matrix, as two tabs. Opened from the Warehouses settings header.

import { useState } from 'react'
import { RuleBuilderView } from './RuleBuilderView'
import { CompatibilityMatrixView } from './CompatibilityMatrixView'

type Tab = 'rules' | 'compatibility'

export function WarehouseIntelligenceRulesView() {
  const [tab, setTab] = useState<Tab>('rules')
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['rules', 'compatibility'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-lg border btn-press ${tab === t ? 'border-emerald-500 bg-emerald-50' : 'border-stone-200 bg-white'}`}
          >
            {t === 'rules' ? 'Putaway rules' : 'Compatibility matrix'}
          </button>
        ))}
      </div>
      {tab === 'rules' ? <RuleBuilderView /> : <CompatibilityMatrixView />}
    </div>
  )
}
