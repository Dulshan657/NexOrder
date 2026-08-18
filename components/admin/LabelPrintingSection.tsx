// Settings → Warehouse → Print labels.
//
// Turns locations and products into a printable A4 sticker sheet of barcode labels.
// Every label carries the bare code in the barcode plus the same code in large
// mono type, so a scuffed or badly-lit label can still be read and typed.
//
// The generated PDF lands in the private warehouse-labels bucket (mig 00074);
// this downloads it through a short-lived signed URL. Past runs are listed so a
// sheet can be re-downloaded instead of regenerated — the codes are recorded on
// the log row exactly as they were at print time.
//
// Downloaded, not window.open'd: the signed URL only exists after an await, and
// a tab opened after an await is outside the click gesture and gets blocked
// silently. See lib/openSignedDoc.ts.

import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, Barcode, Download, AlertTriangle, Ruler } from 'lucide-react'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import { useLayouts } from '@/hooks/queries/useLayouts'
import LayoutLabelJobModal from '@/components/admin/labels/LayoutLabelJobModal'
import { downloadSignedDoc } from '@/lib/openSignedDoc'
import { labelSheetFileName } from '@/lib/labelFileName'
import {
  generateCalibrationSheet,
  generateLabels,
  listLabelPrintLog,
  signLabelSheet,
  type LabelKind,
  type LabelPreset,
} from '@/services/supabase/labelService'
import { maxStartOffset, SHEET_PRESET_INFO } from '@/supabase/functions/_shared/labelSheet'

/** Location kinds offered for printing, grouped by what they are physically for. */
const KIND_GROUPS: Array<{ label: string; helper: string; kinds: string[] }> = [
  {
    label: 'Storable slots',
    helper: 'Bins and rack levels — the places putaway and picking direct people to.',
    kinds: ['BIN', 'SHELF', 'BAY', 'RACK'],
  },
  {
    label: 'Wayfinding',
    helper: 'Zone and aisle signs, so an operator can confirm the aisle before hunting for a bay.',
    kinds: ['ZONE', 'AISLE'],
  },
  {
    label: 'Staging',
    helper: 'Dock and staging areas.',
    kinds: ['STAGING'],
  },
]

/**
 * Built from the preset library rather than written out, so a stock added to
 * `SHEET_PRESETS` appears here and its size can never be described wrongly.
 * Largest sticker first — the list reads from "most room for a barcode" down.
 */
const PRESETS: Array<{ value: LabelPreset; label: string }> = (
  Object.keys(SHEET_PRESET_INFO) as LabelPreset[]
)
  .map((value) => ({ value, info: SHEET_PRESET_INFO[value] }))
  .sort((a, b) => a.info.perSheet - b.info.perSheet)
  .map(({ value, info }) => ({
    value,
    label: `${info.averyLabel} — ${info.bestFor} (${info.averyCode})`,
  }))

/** 'layout' is not a LabelKind — it opens the layout job modal instead of
 *  calling generate-labels directly, because one layout run is several sheets. */
type PrintMode = LabelKind | 'layout'

const LabelPrintingSection: React.FC = () => {
  const { data: warehouses } = useWarehouses()
  const qc = useQueryClient()

  const [mode, setMode] = useState<PrintMode>('layout')
  const [jobOpen, setJobOpen] = useState(false)
  const kind: LabelKind = mode === 'layout' ? 'location' : mode
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [groupIndex, setGroupIndex] = useState(0)
  const [preset, setPreset] = useState<LabelPreset>('a4-14')
  const [startOffset, setStartOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  // The last slot on the chosen stock. Derived, because the bound is a property
  // of the sheet and not of this component — see `maxStartOffset`.
  const offsetCeiling = maxStartOffset(preset)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ count: number } | null>(null)
  const [calibratedCode, setCalibratedCode] = useState<string | null>(null)

  // Switching from a dense stock to a sparse one must move the number the
  // operator can SEE. `layoutLabels` would clamp it either way, but silently —
  // leaving 60 on screen while the sheet prints from slot 13 is the whole bug.
  useEffect(() => {
    setStartOffset((n) => Math.min(n, offsetCeiling))
  }, [offsetCeiling])

  const logQuery = useQuery({ queryKey: ['label-print-log'], queryFn: () => listLabelPrintLog(10) })

  // Layout mode needs a specific warehouse — a layout job is scoped to one
  // published layout, and "all warehouses" names no layout at all.
  const { data: layouts } = useLayouts(warehouseId === '' ? null : Number(warehouseId))
  const publishedLayout = useMemo(
    () => (layouts ?? []).find((l) => l.status === 'published') ?? null,
    [layouts],
  )

  const run = async () => {
    setBusy(true)
    setError(null)
    setLastRun(null)
    try {
      const result = await generateLabels({
        kind,
        preset,
        startOffset,
        warehouseId: kind === 'location' && warehouseId !== '' ? Number(warehouseId) : undefined,
        locationKinds: kind === 'location' ? KIND_GROUPS[groupIndex].kinds : undefined,
      })
      setLastRun({ count: result.labelCount })
      void qc.invalidateQueries({ queryKey: ['label-print-log'] })
      await downloadSignedDoc(
        async () => {
          // Signed fresh from the path, not reused from the response — one
          // cheap call, and it cannot be the stale half of the pair.
          const url = await signLabelSheet(result.storagePath)
          if (!url) throw new Error('That sheet is no longer available in storage.')
          return url
        },
        labelSheetFileName({ kind }),
        { onError: (err) => setError(err instanceof Error ? err.message : 'Could not download the sheet.') },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the label sheet.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Print one code at a range of bar widths, to find where this printer and
   * this gun stop agreeing.
   *
   * Worth doing once per printer, BEFORE a labelling pass: every sizing verdict
   * assumes a printer that holds the bar width it is given, and a laser that
   * over-inks breaks that assumption invisibly.
   */
  const runCalibration = async () => {
    setBusy(true)
    setError(null)
    setLastRun(null)
    try {
      const result = await generateCalibrationSheet({
        warehouseId: warehouseId !== '' ? Number(warehouseId) : undefined,
      })
      setCalibratedCode(result.code)
      await downloadSignedDoc(
        async () => {
          const url = await signLabelSheet(result.storagePath)
          if (!url) throw new Error('That sheet is no longer available in storage.')
          return url
        },
        'barcode-calibration.pdf',
        { onError: (err) => setError(err instanceof Error ? err.message : 'Could not download the sheet.') },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the calibration sheet.')
    } finally {
      setBusy(false)
    }
  }

  const download = async (row: { labelKind: LabelKind; storagePath: string }) => {
    setError(null)
    await downloadSignedDoc(
      async () => {
        const url = await signLabelSheet(row.storagePath)
        if (!url) throw new Error('That sheet is no longer available in storage.')
        return url
      },
      labelSheetFileName({ kind: row.labelKind }),
      { onError: (err) => setError(err instanceof Error ? err.message : 'Could not download that sheet.') },
    )
  }

  return (
    <section className="glass-panel rounded-2xl p-5 sm:p-6">
      <header className="flex items-start gap-3 mb-5">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-nexgen-blue/10 flex items-center justify-center">
          <Barcode className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-stone-900">Print labels</h3>
          <p className="text-sm text-stone-500">
            Barcode stickers for locations and products. Scanning one anywhere in the app resolves it to
            that exact bin or SKU.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="label-kind" className="block text-xs font-semibold text-stone-600 mb-1.5">
            What to label
          </label>
          <select
            id="label-kind"
            value={mode}
            onChange={(e) => setMode(e.target.value as PrintMode)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm"
          >
            <option value="layout">Published layout — everything it needs</option>
            <option value="location">Locations (pick a kind)</option>
            <option value="product">Products</option>
            <option value="handling_unit">Pallets &amp; cartons (unlabelled)</option>
          </select>
          {mode === 'layout' && (
            <p className="text-xs text-stone-400 mt-1">
              Bins, rack levels, aisle signs and staging for one published layout — tracked, so a
              re-run only covers what has no sticker yet.
            </p>
          )}
          {mode === 'handling_unit' && (
            <p className="text-xs text-stone-400 mt-1">
              Prints every pallet/carton that has no sticker yet, then marks them labelled.
            </p>
          )}
        </div>

        {/* A layout run picks its own stock per sheet — bins on 24-up, aisle
            signs on 8-up — so there is nothing here to choose. */}
        {mode !== 'layout' && (
          <div>
            <label htmlFor="label-preset" className="block text-xs font-semibold text-stone-600 mb-1.5">
              Sheet layout
            </label>
            <select
              id="label-preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as LabelPreset)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm"
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {(mode === 'layout' || kind === 'location' || kind === 'handling_unit') && (
          <>
            <div>
              <label htmlFor="label-warehouse" className="block text-xs font-semibold text-stone-600 mb-1.5">
                Warehouse
              </label>
              <select
                id="label-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm"
              >
                {/* A layout job names ONE published layout, so "all" is not an
                    option here — it would name none. */}
                <option value="">{mode === 'layout' ? 'Choose a warehouse…' : 'All warehouses'}</option>
                {(warehouses ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              {mode === 'layout' && warehouseId !== '' && !publishedLayout && (
                <p className="text-xs text-amber-600 mt-1">
                  That warehouse has no published layout — publish one in the Layout Designer first.
                </p>
              )}
            </div>

            <div className={mode === 'location' ? '' : 'hidden'}>
              <label htmlFor="label-group" className="block text-xs font-semibold text-stone-600 mb-1.5">
                Which locations
              </label>
              <select
                id="label-group"
                value={groupIndex}
                onChange={(e) => setGroupIndex(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm"
              >
                {KIND_GROUPS.map((g, i) => (
                  <option key={g.label} value={i}>
                    {g.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-stone-400 mt-1">{KIND_GROUPS[groupIndex].helper}</p>
            </div>
          </>
        )}

        {/* The layout job asks for this itself, alongside the area picker. */}
        {mode !== 'layout' && (
          <div>
            <label htmlFor="label-offset" className="block text-xs font-semibold text-stone-600 mb-1.5">
              Skip first labels
            </label>
            {/* Clamped on BOTH sides. `max` alone is decorative on a number
                input outside a validating form — a typed 200 used to reach the
                server and come back as the generic "Invalid label request". */}
            <input
              id="label-offset"
              type="number"
              min={0}
              max={offsetCeiling}
              value={startOffset}
              onChange={(e) =>
                setStartOffset(Math.min(offsetCeiling, Math.max(0, Number(e.target.value) || 0)))
              }
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm tabular-nums"
            />
            <p className="text-xs text-stone-400 mt-1">
              For reusing a part-used sticker sheet — leaves that many cells blank on page 1. This
              stock holds {SHEET_PRESET_INFO[preset].perSheet}, so the most you can skip is{' '}
              {offsetCeiling}.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 mt-4 text-sm text-red-600" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {lastRun && (
        <p className="mt-4 text-sm text-emerald-700">
          Generated {lastRun.count} label{lastRun.count === 1 ? '' : 's'} — the PDF is in your
          downloads.
        </p>
      )}

      <div className="mt-5">
        {mode === 'layout' ? (
          <button
            type="button"
            onClick={() => setJobOpen(true)}
            disabled={!publishedLayout}
            className="inline-flex items-center gap-2 px-4 py-2 bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            {publishedLayout ? 'Set up label job' : 'Pick a warehouse first'}
          </button>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            {busy ? 'Generating…' : 'Generate sheet'}
          </button>
        )}
      </div>

      <div className="mt-6 pt-5 border-t border-stone-200/70">
        <h4 className="text-xs font-semibold text-stone-600">Before a labelling pass</h4>
        <p className="mt-1 text-xs text-stone-500 max-w-prose">
          Bar width is the one thing a printer can quietly ruin — a laser that over-inks turns a
          legal barcode into an unreadable one without changing anything you can see. This prints
          the longest code on the site at six bar widths. Scan down it with the gun you will
          actually use; the narrowest row that reads first-time every time is this printer&rsquo;s
          real limit.
        </p>
        <button
          type="button"
          onClick={runCalibration}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-stone-300 text-stone-700 text-sm font-medium rounded-lg btn-press disabled:opacity-50"
        >
          <Ruler className="w-4 h-4" aria-hidden="true" />
          {busy ? 'Generating…' : 'Print calibration sheet'}
        </button>
        {calibratedCode && (
          <p className="mt-2 text-xs text-emerald-700">
            Calibration sheet generated for <span className="font-mono">{calibratedCode}</span> —
            the longest code on this site, so it is the one most at risk.
          </p>
        )}
      </div>

      {jobOpen && publishedLayout && (
        <LayoutLabelJobModal
          open={jobOpen}
          onClose={() => setJobOpen(false)}
          layoutId={publishedLayout.id}
          layoutName={publishedLayout.name}
          warehouseId={warehouseId === '' ? undefined : Number(warehouseId)}
          onCalibrate={runCalibration}
        />
      )}

      {(logQuery.data ?? []).length > 0 && (
        <div className="mt-6 pt-5 border-t border-stone-200/70">
          <h4 className="text-xs font-semibold text-stone-600 mb-2">Recent runs</h4>
          <ul className="divide-y divide-stone-100">
            {(logQuery.data ?? []).map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                <span className="text-xs text-stone-700 flex-1 min-w-0 truncate">
                  {row.labelKind === 'location' ? 'Locations' : row.labelKind === 'product' ? 'Products' : 'Handling units'}
                  <span className="text-stone-400"> · {row.labelCount} labels</span>
                </span>
                <span className="text-[11px] text-stone-400 shrink-0 tabular-nums">
                  {row.createdAt.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => download(row)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-600 btn-press"
                >
                  <Download className="w-3 h-3" aria-hidden="true" /> Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default LabelPrintingSection
