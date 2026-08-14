// "Which sticker should I buy?" — asked and answered with numbers.
//
// Label size stopped being a constant when locations moved from QR to Code 128.
// A QR is square and degrades gracefully; a linear barcode's readability IS its
// width, so the right sheet depends on how long this site's codes encode and how
// far away the operator scans. Neither is a property of the paper, and neither
// is something an operator can be expected to work out from a dropdown listing
// millimetres.
//
// THE VERDICTS HERE ARE NOT ADVICE, THEY ARE THE SERVER'S DECISION. Every figure
// on screen comes from _shared/labels/sizing.ts, the same pure module
// generate-labels refuses a run with. A second implementation would eventually
// promise a sheet the server then rejected — or, worse, stay quiet about one it
// accepted. See lib/labels/sizing.ts for the re-export and the same split used
// by the stocktake count sheet.
//
// The preview draws real bars from the real encoder at the real module width, so
// what is on screen is the artwork, scaled — not an illustration of it.

import React, { useMemo, useState } from 'react'
import { Ruler, Check, AlertTriangle, XCircle } from 'lucide-react'
import { Modal, Button } from '@/components/ui'
import {
  MIN_X_FOR_DISTANCE,
  SCAN_DISTANCE_LABELS,
  SHEET_PRESET_INFO,
  darkRuns,
  encodeCode128,
  recommendPresets,
  type RunFit,
  type ScanDistance,
  type SheetPresetName,
} from '@/lib/labels/sizing'
import type { SheetGroup } from '@/supabase/functions/_shared/labels/layoutLabelPlan'

/** What the operator is labelling, and therefore which sheet group they mean. */
const SUBJECTS: Array<{ group: SheetGroup; label: string; helper: string }> = [
  {
    group: 'slots',
    label: 'Bins and rack levels',
    helper: 'The places putaway and picking send people to. Much the largest number of labels.',
  },
  {
    group: 'wayfinding',
    label: 'Aisle and zone signs',
    helper: 'Read to navigate, and scanned at arm’s length to confirm where you are.',
  },
  {
    group: 'staging',
    label: 'Dock and staging areas',
    helper: 'A handful of labels on the floor or a wall.',
  },
]

const DISTANCES: ScanDistance[] = ['arms_length', 'across_a_pallet', 'down_an_aisle']

const VERDICT_STYLE = {
  good: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Check, word: 'Good' },
  marginal: { badge: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle, word: 'Marginal' },
  fail: { badge: 'bg-rose-50 text-rose-700 border-rose-200', Icon: XCircle, word: 'Too small' },
} as const

/**
 * One sticker, drawn to scale, with real bars.
 *
 * Uses the same encoder the PDF does, so a code that will be dense on paper
 * looks dense here. `mmToPx` is the only fudge — a screen millimetre is not a
 * paper millimetre, and pretending otherwise would make the preview a lie about
 * physical size rather than about proportion.
 */
function StickerPreview({
  preset,
  code,
  context,
}: {
  preset: SheetPresetName
  code: string
  context?: string
}) {
  const info = SHEET_PRESET_INFO[preset]
  const mmToPx = 2.6
  const w = info.widthMm * mmToPx
  const h = info.heightMm * mmToPx

  const bars = useMemo(() => {
    try {
      const symbol = encodeCode128(code)
      return { runs: darkRuns(symbol), modules: symbol.modules }
    } catch {
      return null
    }
  }, [code])

  if (!bars) return null

  // Same shape as fitBarcode: ten modules of quiet zone either side.
  const quietModules = 10
  const moduleW = w / (bars.modules + 2 * quietModules)
  const barsH = Math.min(h * 0.45, 40)

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="rounded border border-stone-300 bg-white shrink-0"
      role="img"
      aria-label={`Preview of ${code} on ${info.averyLabel}`}
    >
      <g>
        {bars.runs.map((run, i) => (
          <rect
            key={i}
            x={(quietModules + run.start) * moduleW}
            y={h * 0.12}
            width={run.width * moduleW}
            height={barsH}
            fill="#0c0a09"
          />
        ))}
      </g>
      <text
        x={w / 2}
        y={h * 0.12 + barsH + 11}
        textAnchor="middle"
        fontFamily="monospace"
        fontWeight="700"
        fontSize={Math.min(11, h * 0.13)}
        fill="#0c0a09"
      >
        {code}
      </text>
      {context && (
        <text
          x={w / 2}
          y={h * 0.12 + barsH + 22}
          textAnchor="middle"
          fontFamily="sans-serif"
          fontSize={Math.min(8, h * 0.1)}
          fill="#6b6560"
        >
          {context}
        </text>
      )}
    </svg>
  )
}

export interface LabelSizeWizardProps {
  open: boolean
  onClose: () => void
  /** Every code this run would print. The verdicts are computed against these. */
  codes: readonly string[]
  /** Seeds the subject question; the operator can still change it. */
  group?: SheetGroup
  currentPreset?: SheetPresetName
  /** Called with the chosen stock, and whether to save it as the site default. */
  onChoose: (preset: SheetPresetName, saveAsDefault: boolean) => void
  /** Omitted when there is no single warehouse to save against. */
  canSaveDefault?: boolean
  onCalibrate?: () => void
}

export function LabelSizeWizard({
  open,
  onClose,
  codes,
  group = 'slots',
  currentPreset,
  onChoose,
  canSaveDefault = true,
  onCalibrate,
}: LabelSizeWizardProps) {
  const [subject, setSubject] = useState<SheetGroup>(group)
  const [distance, setDistance] = useState<ScanDistance>('arms_length')
  const [saveAsDefault, setSaveAsDefault] = useState(true)

  const ranked: RunFit[] = useMemo(
    () => (codes.length === 0 ? [] : recommendPresets({ codes, distance })),
    [codes, distance],
  )

  // The label most at risk — narrowest bars — is what every row is judged on.
  const sample = ranked[0]?.worstCode ?? codes[0] ?? ''
  const nothingWorks = ranked.length > 0 && ranked.every((r) => r.verdict !== 'good')

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      icon={<Ruler className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />}
      title="Choose a label size"
      description="Bar width decides whether a label scans. These figures are measured against the codes this run would actually print."
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <fieldset>
          <legend className="text-xs font-semibold text-stone-600 mb-2">
            What are you labelling?
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SUBJECTS.map((s) => (
              <button
                key={s.group}
                type="button"
                onClick={() => setSubject(s.group)}
                aria-pressed={subject === s.group}
                className={`text-left rounded-lg border p-3 btn-press ${
                  subject === s.group
                    ? 'border-nexgen-blue bg-nexgen-blue/5'
                    : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="block text-sm font-medium text-stone-900">{s.label}</span>
                <span className="block mt-0.5 text-xs text-stone-500">{s.helper}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-semibold text-stone-600 mb-2">
            How far away will it be scanned?
          </legend>
          <p className="text-xs text-stone-500 mb-2 max-w-prose">
            This is the question that actually decides the answer — a laser&rsquo;s working range
            scales with bar width.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DISTANCES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDistance(d)}
                aria-pressed={distance === d}
                className={`text-left rounded-lg border p-3 btn-press ${
                  distance === d
                    ? 'border-nexgen-blue bg-nexgen-blue/5'
                    : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <span className="block text-sm font-medium text-stone-900">
                  {SCAN_DISTANCE_LABELS[d]}
                </span>
                <span className="block mt-0.5 text-xs text-stone-500 font-mono">
                  needs {MIN_X_FOR_DISTANCE[d]}mm bars
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/*
          The honest answer, stated rather than buried. Recommending a full-page
          sheet for "down an aisle" without saying this would be a worse answer
          than the prose: signs are read by EYE at distance and scanned close up.
        */}
        {distance === 'down_an_aisle' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 max-w-prose">
            Worth knowing: a barcode readable from several metres needs roughly 1mm bars and a very
            large sign. Aisle signs are normally read by eye at that distance and only scanned at
            arm&rsquo;s length — if that matches how your team works, answer &ldquo;arm&rsquo;s
            length&rdquo; instead.
          </p>
        )}

        {codes.length === 0 ? (
          <p className="text-sm text-stone-500">
            Nothing to measure — this run would print no labels.
          </p>
        ) : (
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h4 className="text-xs font-semibold text-stone-600">
                {codes.length} label{codes.length === 1 ? '' : 's'}, judged on the worst of them
              </h4>
              <span className="text-xs text-stone-500 font-mono">{sample}</span>
            </div>

            {nothingWorks && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                No stock reaches {MIN_X_FOR_DISTANCE[distance]}mm bars for these codes. Pick the
                best available and check one with the gun before running the sheet, or scan from
                closer.
              </p>
            )}

            <ul className="space-y-2">
              {ranked.map((fit) => {
                const info = SHEET_PRESET_INFO[fit.preset]
                const style = VERDICT_STYLE[fit.verdict]
                const isCurrent = fit.preset === currentPreset
                return (
                  <li
                    key={fit.preset}
                    className={`rounded-lg border p-3 ${
                      isCurrent ? 'border-nexgen-blue/50 bg-nexgen-blue/5' : 'border-stone-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <StickerPreview
                        preset={fit.preset}
                        code={sample}
                        context={subject === 'slots' ? 'Chiller · Rack 7' : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-stone-900">
                            {info.averyLabel}
                          </span>
                          <span className="text-xs text-stone-400 font-mono">{info.averyCode}</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${style.badge}`}
                          >
                            <style.Icon className="w-3 h-3" aria-hidden="true" />
                            {style.word}
                          </span>
                          {isCurrent && (
                            <span className="text-[11px] text-nexgen-blue font-medium">
                              current
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-stone-600 font-mono">
                          {fit.xDimensionMm.toFixed(2)}mm bars · {fit.barHeightMm.toFixed(0)}mm tall
                          · {fit.sheets} sheet{fit.sheets === 1 ? '' : 's'}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {fit.verdict === 'fail'
                            ? (fit.failures[0]?.reason ?? 'Will not scan at this size.')
                            : fit.verdict === 'marginal'
                              ? (fit.marginal[0]?.reason ?? 'Below what this distance wants.')
                              : info.bestFor}
                        </p>
                      </div>
                      <Button
                        variant={fit.verdict === 'good' ? 'primary' : 'secondary'}
                        disabled={fit.verdict === 'fail'}
                        onClick={() => onChoose(fit.preset, canSaveDefault && saveAsDefault)}
                      >
                        Use this
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {canSaveDefault && (
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Remember this as the site&rsquo;s stock for {SUBJECTS.find((s) => s.group === subject)?.label.toLowerCase()}
              <span className="block text-xs text-stone-500">
                A site buys one kind of sticker and keeps buying it. Leave this off to use the size
                for this run only.
              </span>
            </span>
          </label>
        )}

        {onCalibrate && (
          <div className="rounded-lg border border-stone-200 p-3">
            <p className="text-xs text-stone-600 max-w-prose">
              Every figure above assumes a printer that holds the bar width it is given, and that is
              the one thing a printer can quietly ruin. Print a calibration sheet once and scan down
              it to find this printer&rsquo;s real limit.
            </p>
            <Button variant="secondary" className="mt-2" onClick={onCalibrate}>
              Print calibration sheet
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default LabelSizeWizard
