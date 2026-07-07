// Scoring-weights editor for a warehouse's WIE optimizer. Six relative-weight
// sliders (0..1) that feed the putaway/slotting scorer. Loads the saved profile
// or falls back to the engine defaults, and saves via mutate-scoring-profile.

import { useEffect, useState } from 'react'
import { Sliders, Check } from 'lucide-react'
import { useScoringProfile, useSaveScoringProfile } from '@/hooks/queries/useScoringProfile'
import { DEFAULT_WEIGHTS_UI } from '@/services/supabase/scoringProfileService'
import type { Warehouse, WieScoringWeights } from '@/types'

interface ScoringWeightsSectionProps {
  warehouse: Warehouse
}

const FACTORS: Array<{ key: keyof WieScoringWeights; label: string; hint: string }> = [
  { key: 'travelDistance', label: 'Travel distance', hint: 'Prefer bins closer to dispatch' },
  { key: 'capacityFit', label: 'Capacity fit', hint: 'Prefer bins that fit the quantity well' },
  { key: 'grouping', label: 'Grouping', hint: 'Keep like products together' },
  { key: 'zonePreference', label: 'Zone preference', hint: 'Honour product zone affinity' },
  { key: 'congestion', label: 'Congestion', hint: 'Avoid busy aisles' },
  { key: 'velocityMatch', label: 'Velocity match', hint: 'Fast movers near the front' },
]

export function ScoringWeightsSection({ warehouse }: ScoringWeightsSectionProps) {
  const profileQuery = useScoringProfile(warehouse.id)
  const save = useSaveScoringProfile(warehouse.id)
  const [weights, setWeights] = useState<WieScoringWeights>(DEFAULT_WEIGHTS_UI)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (profileQuery.data) setWeights(profileQuery.data.weights)
  }, [profileQuery.data])

  const setWeight = (key: keyof WieScoringWeights, value: number) => {
    setSaved(false)
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    await save.mutateAsync(weights)
    setSaved(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sliders className="w-4 h-4 text-emerald-600" />
        <h4 className="text-sm font-semibold text-stone-700">Scoring weights</h4>
      </div>
      <p className="text-xs text-stone-400 -mt-2">
        Relative importance of each factor when the engine scores bins. Values are weighed against each
        other — only the ratios matter, not the absolute numbers.
      </p>

      {profileQuery.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-8 rounded-lg bg-stone-100 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {FACTORS.map((f) => (
            <div key={f.key} className="flex items-center gap-3">
              <div className="w-40 shrink-0">
                <p className="text-xs font-medium text-stone-700">{f.label}</p>
                <p className="text-[10px] text-stone-400">{f.hint}</p>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[f.key]}
                onChange={(e) => setWeight(f.key, Number(e.target.value))}
                className="flex-1 accent-emerald-600"
                aria-label={f.label}
              />
              <span className="w-10 text-right font-mono text-xs text-stone-600 shrink-0">{weights[f.key].toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {save.isError && <p className="text-xs text-red-600">Couldn't save weights. Try again.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg btn-press disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save weights'}
        </button>
        {saved && !save.isPending && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="w-3.5 h-3.5" /> Saved</span>
        )}
      </div>
    </div>
  )
}
