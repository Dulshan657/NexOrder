// Step 2 — what to call this block.
//
// `{block}` is a string the operator types, deliberately NOT the painted area's
// name. The engine's header argues that at length; the short version is that one
// painted "Cold Storage" routinely wants two blocks (COLD-A, COLD-B), an area name
// is 60 characters of free text where a code is a barcode whose WIDTH IS ITS
// READABILITY, and an area is expected to be renamed while a code cannot be.
//
// The area name is offered as a PREFILL, which is a suggestion the operator can
// overtype — that keeps the convenience without making the code derive from it.

import { AlertTriangle } from 'lucide-react'
import { Callout } from '@/components/ui'
import { MAX_BLOCK_LENGTH, blockIssue, sanitizeBlock } from '@/lib/codePattern'
import type { BlockCensusRow } from '../recodeGeometry'
import { CHIP, HINT, SECTION_LABEL } from '../recodeChrome'

export interface BlockStepProps {
  block: string
  /** Code-safe suggestion from the area the selection sits in, if any. */
  suggestion: string | null
  /** Blocks already swept on this site. Growing one is the normal second visit, so
   *  they are offered here rather than only on step 1 — the same data, on the step
   *  that actually asks the question. */
  blocks: readonly BlockCensusRow[]
  /** The first few codes this block would produce, rendered by the same pure
   *  module the server plans with. */
  samples: readonly string[]
  /** How many bins are already in this block and not selected. */
  incumbentCount: number
  onBlock: (block: string) => void
}

export function BlockStep({
  block, suggestion, blocks, samples, incumbentCount, onBlock,
}: BlockStepProps) {
  const issue = block ? blockIssue(block) : null
  const clean = sanitizeBlock(block)

  /** The suggestion, plus recent blocks that are not already what is typed. Capped
   *  because this is a shortcut row, not a browser. */
  const recent = blocks
    .map((b) => b.block)
    .filter((b) => b !== clean && b !== suggestion)
    .slice(0, 4)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-stone-700">Block name</span>
          <input
            value={block}
            onChange={(e) => onBlock(e.target.value)}
            maxLength={MAX_BLOCK_LENGTH}
            placeholder="BULK"
            autoFocus
            aria-invalid={issue ? true : undefined}
            className={`w-full rounded-lg border bg-white px-3 py-2.5 font-mono text-lg uppercase tracking-wide text-stone-900 outline-none focus:border-nexgen-blue focus:ring-2 focus:ring-nexgen-blue/20 ${
              issue ? 'border-amber-300' : 'border-stone-200'
            }`}
          />
        </label>
        <p className={`mt-1.5 ${HINT}`}>Every bin you selected gets a code starting with this.</p>
        {/* Amber and iconed, not neutral grey. `blockIssue` is advice about a name
            that will be sanitized, not a refusal — but rendered in the same colour
            as helper text it was indistinguishable from one. */}
        {issue && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" />
            <span>{issue}</span>
          </p>
        )}
      </div>

      {(suggestion || recent.length > 0) && (
        <section className="flex flex-col gap-2">
          <p className={SECTION_LABEL}>Suggested</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {suggestion && clean !== suggestion && (
              <button type="button" onClick={() => onBlock(suggestion)} className={CHIP}>
                <span className="font-mono">{suggestion}</span>
                <span className="text-stone-500">from the area</span>
              </button>
            )}
            {recent.map((b) => (
              <button key={b} type="button" onClick={() => onBlock(b)} className={CHIP}>
                <span className="font-mono">{b}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* The payoff of the step, so it gets to look like one rather than a
          middot-joined line. These come from the same pure planner the server runs. */}
      {samples.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>Codes this will mint</p>
          <ul className="mt-1.5 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {samples.slice(0, 4).map((s) => (
              <li key={s} className="px-3 py-1.5 font-mono text-sm text-stone-800">{s}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Growing an existing block is the normal second visit, and the reassurance
          that matters is that nothing already labelled moves. */}
      {incumbentCount > 0 && (
        <Callout dense>
          <span className="font-mono font-semibold text-stone-700">{clean}</span> already has{' '}
          {incumbentCount} bin{incumbentCount === 1 ? '' : 's'}. Painting more continues the
          numbering — those {incumbentCount} keep the codes they have.
        </Callout>
      )}
    </div>
  )
}
