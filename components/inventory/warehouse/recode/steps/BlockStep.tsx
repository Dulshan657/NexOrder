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

import { MAX_BLOCK_LENGTH, blockIssue, sanitizeBlock } from '@/lib/codePattern'

export interface BlockStepProps {
  block: string
  /** Code-safe suggestion from the area the selection sits in, if any. */
  suggestion: string | null
  /** The first few codes this block would produce, rendered by the same pure
   *  module the server plans with. */
  samples: readonly string[]
  /** How many bins are already in this block and not selected. */
  incumbentCount: number
  onBlock: (block: string) => void
}

export function BlockStep({ block, suggestion, samples, incumbentCount, onBlock }: BlockStepProps) {
  const issue = block ? blockIssue(block) : null
  const clean = sanitizeBlock(block)

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-stone-600">Block name</span>
        <input
          value={block}
          onChange={(e) => onBlock(e.target.value)}
          maxLength={MAX_BLOCK_LENGTH}
          placeholder="BULK"
          autoFocus
          className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-sm uppercase text-stone-800 outline-none focus:border-nexgen-blue focus:ring-2 focus:ring-nexgen-blue/20"
        />
      </label>

      {suggestion && clean !== suggestion && (
        <button
          type="button"
          onClick={() => onBlock(suggestion)}
          className="self-start rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50"
        >
          Use <span className="font-mono">{suggestion}</span>, from the area it sits in
        </button>
      )}

      {issue && <p className="text-[11px] text-stone-500">{issue}</p>}

      {samples.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            The first few codes
          </p>
          <p className="font-mono text-xs text-stone-700">{samples.join(' · ')}</p>
        </div>
      )}

      {/* Growing an existing block is the normal second visit, and the reassurance
          that matters is that nothing already labelled moves. */}
      {incumbentCount > 0 && (
        <p className="rounded-lg border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-600">
          <span className="font-mono font-semibold">{clean}</span> already has {incumbentCount} bin
          {incumbentCount === 1 ? '' : 's'}. Painting more continues the numbering —
          those {incumbentCount} keep the codes they have.
        </p>
      )}
    </div>
  )
}
