// The confirm step for a code sweep (mig 00107).
//
// Modelled on AreaPaintSummaryModal — server `dry_run` in, counts and a from→to
// sample out — with two additions that are specific to codes and both load-bearing.
//
//  1. THE BAR-WIDTH VERDICT. A code's readability IS its width, and `generate-labels`
//     refuses a run whose narrowest bars fall under 0.25 mm. Without this the
//     operator chooses a beautiful long pattern here and discovers the refusal
//     weeks later, on a different screen, with no memory of who chose it. Computed
//     from the SAME pure module the renderer uses, over the codes the server just
//     said it would produce.
//  2. THE PRINTED-LABEL ACKNOWLEDGEMENT. A recode resets `label_printed`, which is
//     right — the sticker on the racking is now wrong and belongs back in the
//     backlog — but it must not be a surprise. Refusing instead would not peel any
//     sticker off a beam; it would only stop the site regularising its codes.

import { useMemo, useState } from 'react'
import { AlertTriangle, Barcode, Package } from 'lucide-react'
import { Modal } from '@/components/ui'
import { MIN_X_DIMENSION_MM, fitRun, recommendPresets, type SheetPresetName } from '@/lib/labels/sizing'
import type { RecodePreview } from '@/services/supabase/warehouseLocationService'

interface RecodeSummaryModalProps {
  preview: RecodePreview
  /** The stock this site prints slot labels on (mig 00106), or the built-in default. */
  preset: SheetPresetName
  saving: boolean
  onClose: () => void
  onConfirm: () => void
}

export function RecodeSummaryModal({
  preview,
  preset,
  saving,
  onClose,
  onConfirm,
}: RecodeSummaryModalProps) {
  const [ackPrinted, setAckPrinted] = useState(false)

  const fit = useMemo(
    () => (preview.codes.length > 0
      ? fitRun({ codes: preview.codes, preset, distance: 'across_a_pallet' })
      : null),
    [preview.codes, preset],
  )
  const better = useMemo(
    () => (fit && fit.verdict !== 'good'
      ? recommendPresets({ codes: preview.codes, distance: 'across_a_pallet' })
          .find((r) => r.verdict === 'good') ?? null
      : null),
    [fit, preview.codes],
  )

  const refused = preview.refusedTotal > 0
  const needsAck = preview.labelPrinted > 0 && !ackPrinted
  const nothingToDo = preview.willRecode === 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply these codes?"
      size="lg"
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || refused || needsAck || nothingToDo}
            className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white btn-press disabled:opacity-40"
          >
            {saving ? 'Applying…' : `Recode ${preview.willRecode}`}
          </button>
        </div>
      )}
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-stone-600">
          <span><strong className="font-semibold text-stone-900">{preview.willRecode}</strong> to recode</span>
          {preview.levels > 0 && (
            <span><strong className="font-semibold text-stone-900">{preview.levels}</strong> rack levels follow</span>
          )}
          {preview.unchanged > 0 && (
            <span><strong className="font-semibold text-stone-900">{preview.unchanged}</strong> already correct</span>
          )}
          <span className="font-mono text-xs text-stone-500">
            {preview.block} · from {preview.startedAt}
          </span>
        </div>

        {refused && (
          <section className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
              <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
              {preview.refusedTotal} refused — nothing will be written
            </p>
            {/* The whole batch is refused, not the offending rows: half a naming
                scheme is worse than none, and fixing the block and re-running
                costs nothing. */}
            <ul className="mt-1.5 space-y-0.5 text-xs text-rose-700/90">
              {preview.refusals.slice(0, 8).map((r) => (
                <li key={`${r.id}-${r.to}`}>
                  <span className="font-mono">{r.from || '—'}</span> — {r.detail}
                </li>
              ))}
            </ul>
            {preview.refusedTotal > 8 && (
              <p className="mt-1 text-xs text-rose-600/80">…and {preview.refusedTotal - 8} more</p>
            )}
          </section>
        )}

        {!refused && preview.examples.length > 0 && (
          <section>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              First few
            </p>
            <ul className="space-y-0.5 font-mono text-xs text-stone-700">
              {preview.examples.map((e) => (
                <li key={e.from}>
                  <span className="text-stone-400">{e.from}</span>
                  <span className="mx-1.5 text-stone-300">→</span>
                  <span className="font-semibold text-stone-900">{e.to}</span>
                </li>
              ))}
            </ul>
            {preview.willRecode > preview.examples.length && (
              <p className="mt-1 text-xs text-stone-500">
                …and {preview.willRecode - preview.examples.length} more
              </p>
            )}
          </section>
        )}

        {fit && (
          <section
            className={`rounded-lg border p-3 ${
              fit.verdict === 'good'
                ? 'border-stone-200 bg-stone-50'
                : fit.verdict === 'marginal'
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-rose-200 bg-rose-50/70'
            }`}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
              <Barcode className="h-4 w-4" strokeWidth={2.5} />
              {fit.xDimensionMm.toFixed(2)} mm bars on your {preset} stock
              {fit.verdict === 'good' && ' — fine'}
              {fit.verdict === 'marginal' && ' — readable up close only'}
              {fit.verdict === 'fail' && ` — below the ${MIN_X_DIMENSION_MM} mm floor`}
            </p>
            <p className="mt-1 text-xs text-stone-600">
              Longest code <span className="font-mono">{fit.worstCode}</span> · {fit.sheets} sheet
              {fit.sheets === 1 ? '' : 's'}
              {better && better.preset !== preset && (
                <> · the {better.preset} stock would give {better.xDimensionMm.toFixed(2)} mm
                  over {better.sheets} sheet{better.sheets === 1 ? '' : 's'}</>
              )}
            </p>
            {fit.verdict === 'fail' && (
              <p className="mt-1 text-xs text-rose-700">
                These codes can be applied, but a label run at this size will be refused.
                Shorten the block or change the sheet stock in Settings → Warehouse.
              </p>
            )}
          </section>
        )}

        {preview.holdingStock > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-stone-600">
            <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" strokeWidth={2} />
            {preview.holdingStock} of these hold stock. It stays exactly where it is —
            stock is keyed by location, not by code — but anyone working from a
            printed pick list will see the old codes.
          </p>
        )}

        {preview.labelPrinted > 0 && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={ackPrinted}
              onChange={(e) => setAckPrinted(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="font-semibold">
                {preview.labelPrinted} of these already have a label on the racking.
              </strong>{' '}
              Recoding puts them back in the print backlog so they can be reprinted —
              until then the stickers on those bays name codes that no longer exist.
            </span>
          </label>
        )}

        {nothingToDo && !refused && (
          <p className="text-xs text-stone-500">
            Every selected bin already carries the code this sweep would give it.
          </p>
        )}
      </div>
    </Modal>
  )
}
