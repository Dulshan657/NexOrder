// Step 4 — the server's answer, before anything is written.
//
// THE COUNTS HERE ARE THE SERVER'S `dry_run`, not an estimate. It returns before any
// write and before the audit, running the same pure planner the ghost numbers on the
// map already ran — so the number in the Apply button is provably the number that
// moves. Same rule as AreaPaintSummaryModal, and it fires ONCE on entering this step
// rather than per keystroke, because the `:recode:` bucket is 10/min.
//
// Every refusal carries a REMEDY. A refusal list with no way forward is where the
// old flow dead-ended: the operator saw red text and a disabled button, and the only
// escape was to cancel and guess.

import { AlertTriangle, Package, Layers } from 'lucide-react'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'
import { CODE_ORIGIN_LABELS } from '@/lib/codePattern'
import { RecodeFitVerdict } from '../RecodeFitVerdict'
import { refusalRemedy } from '../recodePlanView'
import type { SheetPresetName } from '@/lib/labels/sizing'

export interface ReviewStepProps {
  preview: RecodePreview | null
  loading: boolean
  preset: SheetPresetName
  /** Level codes the sweep would derive, listed rather than summarised. */
  levelCodes: readonly string[]
  ackPrinted: boolean
  onAckPrinted: (ack: boolean) => void
  onGotoStep: (step: 1 | 2 | 3) => void
  /** Re-frame to the origin the incumbents actually use. */
  onUseSuggestedOrigin: () => void
  /** Opt in to relaying the whole block. */
  onRenumberBlock: () => void
}

export function ReviewStep({
  preview, loading, preset, levelCodes, ackPrinted,
  onAckPrinted, onGotoStep, onUseSuggestedOrigin, onRenumberBlock,
}: ReviewStepProps) {
  if (loading || !preview) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Checking the new codes…</span>
        <div className="wh-shimmer h-4 w-2/3 rounded" />
        <div className="wh-shimmer h-16 w-full rounded" />
      </div>
    )
  }

  const refused = preview.refusedTotal > 0
  const drifted = preview.driftTotal > 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">
        <span className="font-semibold text-stone-900">{preview.willRecode}</span> to recode
        {preview.unchanged > 0 && <> · {preview.unchanged} already correct</>}
        {preview.incumbents > 0 && <> · {preview.incumbents} kept as they are</>}
      </p>

      {refused && (
        <section className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            Nothing will be written until these are resolved
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {preview.refusals.slice(0, 8).map((r, i) => {
              const remedy = refusalRemedy(r as any)
              // Drift has two genuinely different answers and the operator has to
              // pick — re-frame (nothing already labelled moves) or renumber the
              // whole block (everything does, deliberately).
              const isDrift = r.kind === 'drift'
              return (
                <li key={`${r.id}-${i}`} className="text-[11px] text-rose-900">
                  {remedy.detail}
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {isDrift && preview.suggestedFraming && (
                      <button type="button" onClick={onUseSuggestedOrigin}
                        className="rounded border border-rose-300 bg-white px-2 py-0.5 font-medium text-rose-700 btn-press hover:bg-rose-50">
                        Use {CODE_ORIGIN_LABELS[preview.suggestedFraming.origin].toLowerCase()} instead
                      </button>
                    )}
                    {isDrift && (
                      <button type="button" onClick={onRenumberBlock}
                        className="rounded border border-rose-300 bg-white px-2 py-0.5 font-medium text-rose-700 btn-press hover:bg-rose-50">
                        Renumber the whole block
                      </button>
                    )}
                    {!isDrift && remedy.action && remedy.step && (
                      <button type="button" onClick={() => onGotoStep(remedy.step as 1 | 2 | 3)}
                        className="rounded border border-rose-300 bg-white px-2 py-0.5 font-medium text-rose-700 btn-press hover:bg-rose-50">
                        {remedy.action}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          {preview.refusedTotal > 8 && (
            <p className="mt-2 text-[11px] text-rose-700">
              …and {preview.refusedTotal - 8} more.
            </p>
          )}
        </section>
      )}

      {!refused && preview.examples.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            First few
          </p>
          <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-stone-700">
            {preview.examples.map((e) => (
              <li key={e.from}>
                <span className="text-stone-400">{e.from}</span> → <span className="font-semibold">{e.to}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LISTED, not summarised. "N rack levels follow" told the operator a number
          and nothing they could check; the level codes are the half most likely to
          be surprising, since they are derived rather than chosen. */}
      {levelCodes.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            <Layers className="h-3 w-3" strokeWidth={2} />
            Rack levels ({levelCodes.length})
          </p>
          <p className="max-h-20 overflow-y-auto font-mono text-[11px] leading-relaxed text-stone-600">
            {levelCodes.slice(0, 40).join(' · ')}
            {levelCodes.length > 40 && ` · …${levelCodes.length - 40} more`}
          </p>
        </div>
      )}

      <RecodeFitVerdict codes={preview.codes} preset={preset} />

      {preview.holdingStock > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-stone-600">
          <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" strokeWidth={2} />
          {preview.holdingStock} of these hold stock. It stays exactly where it is —
          stock is keyed by location, not by code — but anyone working from a printed
          pick list will see the old codes.
        </p>
      )}

      {/* An acknowledgement, not a refusal: refusing would not peel any sticker off
          a beam, it would only stop the site regularising its codes. */}
      {preview.labelPrinted > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-900">
          <input type="checkbox" checked={ackPrinted}
            onChange={(e) => onAckPrinted(e.target.checked)} className="mt-0.5" />
          <span>
            <strong className="font-semibold">
              {preview.labelPrinted} of these already have a label on the racking.
            </strong>{' '}
            Recoding puts them back in the print backlog so they can be reprinted —
            until then those stickers name codes that no longer exist.
          </span>
        </label>
      )}

      {preview.willRecode === 0 && !refused && !drifted && (
        <p className="text-[11px] text-stone-500">
          Every selected bin already carries the code this sweep would give it.
        </p>
      )}
    </div>
  )
}
