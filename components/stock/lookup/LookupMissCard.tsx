// The two ways a scan fails to become one answer.
//
// One file because they are the same screen in two moods — "I have no answer"
// and "I have more than one" — and both are resolved the same way: show the
// operator the code that was actually read, and hand the decision back.
//
// AN AMBIGUOUS SCAN IS NEVER AUTO-RESOLVED. `PutawayScanFinder` may prefer the
// candidate with queued work, because it has a queue to disambiguate against; a
// read-only lookup has no such tiebreak, and guessing is how a code collision
// becomes a silent mis-read. `resolveScan`'s own header says it never guesses —
// this is the screen that keeps that promise.

import React from 'react'
import { HelpCircle, Search, SearchX } from 'lucide-react'
import { describeScanMatch, type ScanMatch } from '@/lib/scan/resolveScan'
import { Callout } from '@/components/ui'

export interface LookupMissCardProps {
  /** Already normalized — the fold the resolver actually matched on, not the
   *  raw keystrokes, so what is quoted here is what was looked for. */
  normalized: string
  /** Present for an ambiguous result; empty for an unknown one. */
  candidates?: readonly ScanMatch[]
  onPick: (match: ScanMatch) => void
  /** Hands the code to the Browse list's search box. */
  onSearchCatalogue: (query: string) => void
}

export function LookupMissCard({ normalized, candidates, onPick, onSearchCatalogue }: LookupMissCardProps) {
  const ambiguous = !!candidates && candidates.length > 0

  return (
    <div className="glass-card rounded-xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600">
          {ambiguous
            ? <HelpCircle className="h-5 w-5" aria-hidden="true" />
            : <SearchX className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-stone-900">
            {ambiguous ? 'That code means more than one thing' : 'No match for that code'}
          </h2>
          {/* `break-all`, not `truncate`: a code the operator cannot finish
              reading is worse than a code on two lines. */}
          <p className="mt-1 break-all font-mono text-lg font-bold leading-tight text-stone-900">
            {normalized}
          </p>
        </div>
      </div>

      {ambiguous ? (
        <>
          <p className="mt-4 text-sm text-stone-600">Pick the one you meant.</p>
          <ul className="mt-2 space-y-2">
            {candidates!.map((candidate, i) => (
              <li key={`${candidate.kind}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(candidate)}
                  className="touch-target-y flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-medium text-stone-900 hover:bg-stone-50 btn-press"
                >
                  <span className="min-w-0 truncate">{describeScanMatch(candidate)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <Callout tone="neutral" dense className="mt-4">
            Nothing in the catalogue, the location tree or the plate register carries this code.
            It may belong to a supplier's own labelling, or the label may be damaged.
          </Callout>
          <button
            type="button"
            onClick={() => onSearchCatalogue(normalized)}
            className="touch-target-y mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 btn-press"
          >
            <Search className="h-4 w-4" aria-hidden="true" /> Search the catalogue for this text
          </button>
        </>
      )}
    </div>
  )
}

export default LookupMissCard
