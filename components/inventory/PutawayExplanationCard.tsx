// "Why this bin?" — renders a PutawayExplanation as factor bars plus any hard
// rules that filtered candidates out. Purely presentational; the engine already
// computed the numbers, this just makes them legible to the operator.

import { AlertTriangle, PackageSearch } from 'lucide-react'
import type { CandidateBreakdown, PutawayExplanation } from '@/types'
import { locationOneLine, type DisplayLocation } from '@/lib/locationDisplay'

const FACTOR_LABEL: Record<string, string> = {
  travel_distance: 'Travel distance',
  capacity_fit: 'Capacity fit',
  grouping: 'Grouping',
  zone_preference: 'Zone preference',
  congestion: 'Congestion',
  velocity_match: 'Velocity match',
}

function CandidateFactors({ candidate }: { candidate: CandidateBreakdown }) {
  return (
    <div className="space-y-1.5">
      {candidate.factors.filter((f) => f.weight > 0).map((f) => (
        <div key={f.factor} className="flex items-center gap-2">
          <span className="w-24 text-[11px] text-stone-500 shrink-0">{FACTOR_LABEL[f.factor] ?? f.factor}</span>
          <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, f.normalized)) * 100)}%` }} />
          </div>
          <span className="w-28 text-[10px] text-stone-500 text-right shrink-0">{f.detail}</span>
        </div>
      ))}
      {candidate.ruleTriggers.map((t) => (
        <div key={t.ruleId} className="text-[11px] text-violet-600">
          {t.effect === 'boost' ? '▲' : '▼'} {t.name} ({t.delta > 0 ? '+' : ''}{t.delta.toFixed(2)})
        </div>
      ))}
    </div>
  )
}

export function PutawayExplanationCard({ explanation, binById }: {
  explanation: PutawayExplanation
  /** Friendly names by location id (mig 00094). Optional: this card is also
   *  rendered where no lookup is at hand, and locationOneLine falls back to the
   *  code on its own. */
  binById?: ReadonlyMap<number, DisplayLocation>
}) {
  const { winner, alternatives, hardFilters, candidatesConsidered, note } = explanation
  // The hard never-mix rule (mig 00072): a SKU may only land on a level whose
  // role it allows. When this is the reason NOTHING came back, that's the
  // queue-wedging case the manual override exists for — surface it up front,
  // in the engine's own words, rather than leaving it buried in the details.
  const roleMismatch = hardFilters.find((h) => h.code === 'level_role_mismatch')

  return (
    <div className="space-y-3 text-xs">
      {roleMismatch && !winner && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium">{roleMismatch.label}</p>
            {roleMismatch.sample.length > 0 && (
              <p className="text-[11px] text-amber-700/80 mt-0.5">
                e.g. {roleMismatch.sample.map((s) => s.code).join(', ')}
              </p>
            )}
            <p className="text-[11px] text-amber-700/80 mt-1">
              This is a hard rule, not a scoring preference — use "Choose bin" to place it on a mismatched level
              anyway. The override is recorded.
            </p>
          </div>
        </div>
      )}

      {/* A destination decided WITHOUT scoring — today, a line riding on a plate
          an earlier line of the same receipt already placed (mig 00078). Saying
          so beats showing a bare "considered 0 bins, no eligible bin". */}
      {note ? (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800">
          <PackageSearch className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>{note}</p>
        </div>
      ) : (
        <p className="text-stone-500">
          Considered {candidatesConsidered} bin{candidatesConsidered === 1 ? '' : 's'}.
          {winner ? ` Best score ${winner.totalScore.toFixed(2)}.` : ' No eligible bin.'}
        </p>
      )}

      {winner && (
        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <p className="font-medium text-emerald-800 mb-1.5">
            {locationOneLine(binById?.get(winner.locationId) ?? { code: winner.locationCode })}
          </p>
          <CandidateFactors candidate={winner} />
        </div>
      )}

      {alternatives.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-stone-500 hover:text-stone-700">
            {alternatives.length} alternative{alternatives.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 space-y-2">
            {alternatives.map((a) => (
              <div key={a.locationId} className="p-2 rounded-lg bg-stone-50 border border-stone-100">
                <p className="font-medium text-stone-600 mb-1.5">
                  {locationOneLine(binById?.get(a.locationId) ?? { code: a.locationCode })} · {a.totalScore.toFixed(2)}
                </p>
                <CandidateFactors candidate={a} />
              </div>
            ))}
          </div>
        </details>
      )}

      {hardFilters.length > 0 && (
        <details>
          <summary className="cursor-pointer text-stone-500 hover:text-stone-600">
            Why some bins were excluded
          </summary>
          <ul className="mt-1.5 space-y-1">
            {hardFilters.map((h) => (
              <li key={`${h.code}-${h.ruleId ?? 'builtin'}`} className="text-stone-500">
                <span className="font-medium">{h.label}</span> — {h.rejectedCount} bin{h.rejectedCount === 1 ? '' : 's'}
                {h.sample.length > 0 && <span className="text-stone-500"> (e.g. {h.sample.map((s) => s.code).join(', ')})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
