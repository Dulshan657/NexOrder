// Settings → Warehouse → Print labels → "Before a labelling pass".
//
// Records what the calibration ladder above actually told the operator. This is
// register row O12: `BAR_WIDTH_REDUCTION_PT` shipped wired into the renderer,
// documented, and pinned at 0 pending evidence — but setting it meant editing a
// constant and deploying an Edge Function, so the only people who could record
// the measurement were the people who could deploy. Now it is site data
// (mig 00110) and the person holding the gun can enter it.
//
// TYPED IN MILLIMETRES, STORED IN POINTS. Every other threshold an operator
// meets in this subsystem is in mm — the ISO floor, the scan-distance table, the
// ladder's own row headings — and asking for points here would mean converting
// a caliper reading in their head. Points are the renderer's unit and stay
// inside it.
//
// NULL IS NOT ZERO, and the control keeps them apart on purpose. "Measured, and
// this press is true" is a result; "nobody has looked" is not. Clear deletes the
// row; saving 0 writes one.
import React, { useEffect, useState } from 'react'
import { Ruler, Check, AlertTriangle } from 'lucide-react'
import {
  useSetWarehousePrintCalibration,
  useWarehousePrintCalibration,
} from '@/hooks/queries/useLabelJobs'
import { MM } from '@/supabase/functions/_shared/labelSheet'
import { MAX_BAR_WIDTH_REDUCTION_PT } from '@/supabase/functions/_shared/labels/sizing'

const MAX_MM = MAX_BAR_WIDTH_REDUCTION_PT / MM

/** Blank is not zero here either — an empty box means "I have not typed one". */
function parseMm(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

interface PrintCalibrationControlProps {
  warehouseId: number | null
}

export default function PrintCalibrationControl({ warehouseId }: PrintCalibrationControlProps) {
  const current = useWarehousePrintCalibration(warehouseId)
  const save = useSetWarehousePrintCalibration(warehouseId)

  const [mmText, setMmText] = useState('')
  const [note, setNote] = useState('')
  const [issue, setIssue] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Seed the fields from whatever is stored, and re-seed when the site changes —
  // otherwise switching warehouses shows one site's figure over another's.
  useEffect(() => {
    const row = current.data
    setMmText(row ? (row.barWidthReductionPt / MM).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : '')
    setNote(row?.note ?? '')
    setIssue(null)
    setSaved(false)
  }, [current.data, warehouseId])

  if (warehouseId == null) return null

  const submit = async (clear: boolean) => {
    setIssue(null)
    setSaved(false)

    let pt: number | null = null
    if (!clear) {
      const mm = parseMm(mmText)
      if (mm === undefined) {
        setIssue('That is not a width. Enter millimetres, e.g. 0.03.')
        return
      }
      if (mm === null) {
        setIssue('Enter a width, or use Clear to mark this printer unmeasured.')
        return
      }
      if (mm > MAX_MM) {
        setIssue(`${mm}mm is past the ${MAX_MM.toFixed(2)}mm ceiling — a real press spreads 0.02–0.08mm.`)
        return
      }
      pt = mm * MM
    }

    try {
      await save.mutateAsync({ barWidthReductionPt: pt, note: clear ? null : note.trim() || null })
      setSaved(true)
    } catch (err) {
      setIssue(err instanceof Error ? err.message : 'Could not save the calibration.')
    }
  }

  const stored = current.data

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50/70 p-3">
      <h5 className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
        <Ruler className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
        Ink-spread compensation
      </h5>
      <p className="mt-1 max-w-prose text-xs text-stone-500">
        If the ladder above reads worse than its own row headings claim, this printer lays down
        more ink than it is told. Enter how much wider a bar comes out and every label after this
        is drawn that much narrower to compensate. Leave it blank until you have measured —
        guessing at this makes a good symbol worse.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-stone-600">
          <span className="mb-1 block font-medium">Bar width to remove (mm)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max={MAX_MM.toFixed(2)}
            value={mmText}
            onChange={(e) => { setMmText(e.target.value); setSaved(false) }}
            placeholder="0.00"
            className="w-32 rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          />
        </label>

        <label className="min-w-[12rem] flex-1 text-xs text-stone-600">
          <span className="mb-1 block font-medium">What you measured it with (optional)</span>
          <input
            type="text"
            value={note}
            maxLength={300}
            onChange={(e) => { setNote(e.target.value); setSaved(false) }}
            placeholder="e.g. HP M404 + RS35, ladder read clean to 0.30mm"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-nexgen-blue focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={save.isPending}
            className="min-h-[38px] rounded-lg bg-nexgen-blue px-3 py-2 text-sm font-medium text-white btn-press disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {stored && (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={save.isPending}
              className="min-h-[38px] rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 btn-press disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {issue && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600" role="alert">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {issue}
        </p>
      )}

      {saved && !issue && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700" role="status">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Saved. Sheets printed from now on
          use it; sheets already printed do not change.
        </p>
      )}

      {!current.isLoading && !stored && !saved && (
        <p className="mt-2 text-xs text-stone-400">
          This printer has never been measured, so labels print at their nominal width — which is
          what every site did before this setting existed, and is the right answer until the ladder
          says otherwise.
        </p>
      )}

      {stored && !saved && (
        <p className="mt-2 text-xs text-stone-500">
          Currently removing <span className="font-mono">{(stored.barWidthReductionPt / MM).toFixed(3)}mm</span>
          {stored.note ? <> — {stored.note}</> : null}
          {stored.updatedAt ? <> · set {new Date(stored.updatedAt).toLocaleDateString()}</> : null}
        </p>
      )}
    </div>
  )
}
