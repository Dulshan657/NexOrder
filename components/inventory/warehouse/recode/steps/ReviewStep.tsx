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

import { AlertTriangle, ArrowRight, Package, Layers, PackageOpen, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Callout } from '@/components/ui'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'
import { CODE_ORIGIN_LABELS } from '@/lib/codePattern'
import { RecodeFitVerdict } from '../RecodeFitVerdict'
import { refusalRemedy } from '../recodePlanView'
import { MINI_BUTTON, SECTION_LABEL } from '../recodeChrome'
import type { SheetPresetName } from '@/lib/labels/sizing'

export interface ReviewStepProps {
  preview: RecodePreview | null
  loading: boolean
  preset: SheetPresetName
  /** Level codes the sweep would derive, listed rather than summarised. */
  levelCodes: readonly string[]
  ackPrinted: boolean
  onAckPrinted: (ack: boolean) => void
  /** Why the dry run failed, or null. Distinct from `!preview`, which also covers
   *  "nothing has been asked yet" — telling those two apart is the whole point. */
  previewError: string | null
  onRetryPreview: () => void
  /** How many bins are painted. Only used to say which thing is missing when there
   *  is nothing to review yet. */
  selectedCount: number
  onGotoStep: (step: 1 | 2 | 3) => void
  /** Re-frame to the origin the incumbents actually use. */
  onUseSuggestedOrigin: () => void
  /** Opt in to relaying the whole block. */
  onRenumberBlock: () => void
}

/**
 * Four states, not two.
 *
 * This guard used to be `if (loading || !preview)`, which meant a FAILED dry run —
 * whose catch clears the preview and stops the spinner — rendered a permanently
 * shimmering `aria-busy` region behind a toast that vanished in four seconds, while
 * the Apply button said "Review the sweep first" to someone standing on Review. The
 * empty case (nothing painted, or no block name) landed in the same hole, because
 * the effect early-returns without ever setting `loading`.
 *
 * Same shape as PutawayQueueView's ternary chain: loading → error → empty → content.
 */
export function ReviewStep({
  preview, loading, preset, levelCodes, ackPrinted, previewError, onRetryPreview,
  selectedCount,
  onAckPrinted, onGotoStep, onUseSuggestedOrigin, onRenumberBlock,
}: ReviewStepProps) {
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Checking the new codes…</span>
        <div className="wh-shimmer h-4 w-2/3 rounded" />
        <div className="wh-shimmer h-16 w-full rounded" />
      </div>
    )
  }

  if (previewError) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          Could not check the new codes
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-rose-900">
          {previewError} Nothing has been written.
        </p>
        <button
          type="button"
          onClick={onRetryPreview}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-rose-700 btn-press hover:bg-rose-50"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          Try again
        </button>
      </div>
    )
  }

  if (!preview) {
    // The effect never ran: no bins painted, or no block name. Say which.
    const missingSelection = selectedCount === 0
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-6 text-center">
        <PackageOpen className="mx-auto h-8 w-8 text-stone-300" strokeWidth={1.5} aria-hidden="true" />
        <p className="mt-2 text-sm text-stone-600">Nothing to check yet</p>
        <p className="mt-1 text-[11px] text-stone-500">
          {missingSelection ? 'Paint some bins on the map first.' : 'Give the block a name first.'}
        </p>
        <button
          type="button"
          onClick={() => onGotoStep(missingSelection ? 1 : 2)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-600 btn-press hover:bg-stone-50"
        >
          Back to {missingSelection ? 'Select' : 'Block'}
        </button>
      </div>
    )
  }

  const refused = preview.refusedTotal > 0
  const drifted = preview.driftTotal > 0

  const stats = [
    { n: preview.willRecode, label: 'to recode', accent: true },
    { n: preview.unchanged, label: 'already correct', accent: false },
    { n: preview.incumbents, label: 'kept as they are', accent: false },
  ].filter((s) => s.accent || s.n > 0)

  return (
    <div className="flex flex-col gap-4">
      {/* The single most important number in the flow, previously set as prose in a
          middot-joined run-on. Zero columns drop out, so a simple sweep shows one
          number instead of three-quarters of a sentence about nothing. */}
      <div className={`grid gap-2 ${stats.length === 1 ? 'grid-cols-1' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-lg border p-2.5 ${
              s.accent ? 'border-nexgen-blue/25 bg-nexgen-blue-light/50' : 'border-stone-200 bg-stone-50/70'
            }`}
          >
            <p className={`font-display text-2xl font-semibold leading-none tabular-nums ${
              s.accent ? 'text-nexgen-blue' : 'text-stone-700'
            }`}>
              {s.n}
            </p>
            <p className="mt-1 text-[11px] leading-tight text-stone-500">{s.label}</p>
          </div>
        ))}
      </div>

      {refused && (
        <section className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            Nothing will be written until these are resolved
          </p>
          {/* Each refusal is a card rather than a paragraph with buttons trailing off
              it — the detail and the way out used to run together. */}
          <ul className="mt-2 flex flex-col gap-1.5">
            {preview.refusals.slice(0, 8).map((r, i) => {
              const remedy = refusalRemedy(r as any)
              // Drift has two genuinely different answers and the operator has to
              // pick — re-frame (nothing already labelled moves) or renumber the
              // whole block (everything does, deliberately).
              const isDrift = r.kind === 'drift'
              const REMEDY_BTN =
                'rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 btn-press hover:bg-rose-50'
              return (
                <li key={`${r.id}-${i}`} className="rounded-md border border-rose-200/70 bg-white/60 p-2">
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-rose-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" strokeWidth={2} aria-hidden="true" />
                    <span>{remedy.detail}</span>
                  </p>
                  {(isDrift || (remedy.action && remedy.step)) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {isDrift && preview.suggestedFraming && (
                        <button type="button" onClick={onUseSuggestedOrigin} className={REMEDY_BTN}>
                          Use {CODE_ORIGIN_LABELS[preview.suggestedFraming.origin].toLowerCase()} instead
                        </button>
                      )}
                      {isDrift && (
                        <button type="button" onClick={onRenumberBlock} className={REMEDY_BTN}>
                          Renumber the whole block
                        </button>
                      )}
                      {!isDrift && remedy.action && remedy.step && (
                        <button type="button" onClick={() => onGotoStep(remedy.step as 1 | 2 | 3)} className={REMEDY_BTN}>
                          {remedy.action}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {preview.refusedTotal > 8 && (
            <p className="mt-2 text-xs text-rose-700">
              …and {preview.refusedTotal - 8} more.
            </p>
          )}
        </section>
      )}

      {!refused && preview.examples.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>First few</p>
          <ul className="mt-1.5 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {preview.examples.map((e) => (
              <li key={e.from} className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
                <span className="min-w-0 flex-1 truncate text-stone-500 line-through">{e.from}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-stone-300" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-semibold text-stone-800">{e.to}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* LISTED, not summarised. "N rack levels follow" told the operator a number
          and nothing they could check; the level codes are the half most likely to
          be surprising, since they are derived rather than chosen.

          Chips with an expander rather than a `max-h-20` scroller: a scroll region
          nested inside the panel's own scroller is bad enough with a mouse and
          genuinely unusable inside a mobile bottom sheet. */}
      {levelCodes.length > 0 && <LevelCodes codes={levelCodes} />}

      <RecodeFitVerdict codes={preview.codes} preset={preset} />

      {preview.holdingStock > 0 && (
        <Callout dense icon={<Package className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}>
          {preview.holdingStock} of these hold stock. It stays exactly where it is —
          stock is keyed by location, not by code — but anyone working from a printed
          pick list will see the old codes.
        </Callout>
      )}

      {/* An acknowledgement, not a refusal: refusing would not peel any sticker off
          a beam, it would only stop the site regularising its codes. */}
      {preview.labelPrinted > 0 && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-900">
          <input
            type="checkbox"
            checked={ackPrinted}
            onChange={(e) => onAckPrinted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 accent-amber-600"
          />
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
        <Callout dense>
          Every selected bin already carries the code this sweep would give it.
        </Callout>
      )}
    </div>
  )
}

/** The derived level codes, capped with an expander instead of a nested scroller. */
function LevelCodes({ codes }: { codes: readonly string[] }) {
  const [expanded, setExpanded] = useState(false)
  const CAP = 12
  const shown = expanded ? codes : codes.slice(0, CAP)
  return (
    <section>
      <p className={`flex items-center gap-1 ${SECTION_LABEL}`}>
        <Layers className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        Rack levels ({codes.length})
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {shown.map((c) => (
          <span key={c} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
            {c}
          </span>
        ))}
        {!expanded && codes.length > CAP && (
          <button type="button" onClick={() => setExpanded(true)} className={MINI_BUTTON}>
            +{codes.length - CAP} more
          </button>
        )}
      </div>
    </section>
  )
}
