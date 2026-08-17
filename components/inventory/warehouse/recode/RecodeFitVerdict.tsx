// Whether the codes a sweep would mint can physically be printed.
//
// A code's readability IS its width, and `generate-labels` refuses a run whose
// narrowest bars fall under 0.25 mm. Without this the operator chooses a beautiful
// long pattern here and discovers the refusal weeks later, on a different screen,
// with no memory of who chose it — on a ladder, after 400 stickers are down.
//
// Computed from the SAME pure module the renderer uses, over the codes the server
// just said it would produce. Extracted verbatim from RecodeSummaryModal so the
// stepped panel can show it inline at the Review step, where the decision is made.

import { useMemo } from 'react'
import { Barcode } from 'lucide-react'
import { MIN_X_DIMENSION_MM, fitRun, recommendPresets, type SheetPresetName } from '@/lib/labels/sizing'

export interface RecodeFitVerdictProps {
  codes: readonly string[]
  /** The stock this site prints slot labels on (mig 00106), or the built-in default. */
  preset: SheetPresetName
}

export function RecodeFitVerdict({ codes, preset }: RecodeFitVerdictProps) {
  const fit = useMemo(
    () => (codes.length > 0
      ? fitRun({ codes: codes as string[], preset, distance: 'across_a_pallet' })
      : null),
    [codes, preset],
  )
  // Only worth computing an alternative when the current stock is not already fine.
  const better = useMemo(
    () => (fit && fit.verdict !== 'good'
      ? recommendPresets({ codes: codes as string[], distance: 'across_a_pallet' })
          .find((r) => r.verdict === 'good') ?? null
      : null),
    [fit, codes],
  )

  if (!fit) return null

  return (
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
        <Barcode className="h-4 w-4 shrink-0" strokeWidth={2.5} />
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
      {/* A WARNING, never a gate. Refusing here would not shorten anybody's codes;
          it would only stop a site regularising them. The refusal that matters
          happens at print time, where a shorter run or different stock can fix it. */}
      {fit.verdict === 'fail' && (
        <p className="mt-1 text-xs text-rose-700">
          These codes can be applied, but a label run at this size will be refused.
          Shorten the block or change the sheet stock in Settings → Warehouse.
        </p>
      )}
    </section>
  )
}
