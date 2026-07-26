// Settings → Warehouse → Print labels.
//
// Turns locations and products into a printable A4 sticker sheet of QR labels.
// Every label carries the bare code in the QR plus the same code in large mono
// type, so a scuffed or badly-lit label can still be read and typed.
//
// The generated PDF lands in the private warehouse-labels bucket (mig 00074);
// this opens it through a short-lived signed URL. Past runs are listed so a
// sheet can be re-downloaded instead of regenerated — the codes are recorded on
// the log row exactly as they were at print time.

import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, QrCode, Download, AlertTriangle } from 'lucide-react'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import { useLayouts } from '@/hooks/queries/useLayouts'
import LayoutLabelJobModal from '@/components/admin/labels/LayoutLabelJobModal'
import {
  generateLabels,
  listLabelPrintLog,
  signLabelSheet,
  type LabelKind,
  type LabelPreset,
} from '@/services/supabase/labelService'

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

const PRESETS: Array<{ value: LabelPreset; label: string }> = [
  { value: 'a4-24', label: '24 per sheet — 63×34mm (bins)' },
  { value: 'a4-14', label: '14 per sheet — 99×38mm' },
  { value: 'a4-8', label: '8 per sheet — 99×67mm (aisle signs)' },
]

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
  const [preset, setPreset] = useState<LabelPreset>('a4-24')
  const [startOffset, setStartOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ count: number; url: string | null } | null>(null)

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
      setLastRun({ count: result.labelCount, url: result.signedUrl })
      if (result.signedUrl) window.open(result.signedUrl, '_blank', 'noopener')
      void qc.invalidateQueries({ queryKey: ['label-print-log'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the label sheet.')
    } finally {
      setBusy(false)
    }
  }

  const reopen = async (storagePath: string) => {
    setError(null)
    try {
      const url = await signLabelSheet(storagePath)
      if (url) window.open(url, '_blank', 'noopener')
      else setError('That sheet is no longer available in storage.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that sheet.')
    }
  }

  return (
    <section className="glass-panel rounded-2xl p-5 sm:p-6">
      <header className="flex items-start gap-3 mb-5">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-nexgen-blue/10 flex items-center justify-center">
          <QrCode className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-stone-900">Print labels</h3>
          <p className="text-sm text-stone-500">
            QR stickers for locations and products. Scanning one anywhere in the app resolves it to
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
            <input
              id="label-offset"
              type="number"
              min={0}
              max={47}
              value={startOffset}
              onChange={(e) => setStartOffset(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm tabular-nums"
            />
            <p className="text-xs text-stone-400 mt-1">
              For reusing a part-used sticker sheet — leaves that many cells blank on page 1.
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
          Generated {lastRun.count} label{lastRun.count === 1 ? '' : 's'}.
          {lastRun.url ? ' The PDF opened in a new tab.' : ''}
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

      {jobOpen && publishedLayout && (
        <LayoutLabelJobModal
          open={jobOpen}
          onClose={() => setJobOpen(false)}
          layoutId={publishedLayout.id}
          layoutName={publishedLayout.name}
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
                  onClick={() => reopen(row.storagePath)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-stone-200 text-stone-600 btn-press"
                >
                  <Download className="w-3 h-3" aria-hidden="true" /> Open
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
