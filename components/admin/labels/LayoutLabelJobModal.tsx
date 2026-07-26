// "Print all labels for this layout" — one job, several sheets.
//
// A published layout needs three different kinds of sticker and they cannot come
// off the same stock: bin and rack-level labels are read at arm's length on a
// 24-up sheet, zone and aisle signs are read from across the floor on an 8-up
// sheet, staging sits between. So this renders one PDF per stock and presents
// them as one set — the whole point being that an operator can see they have
// everything, which is exactly what the old kind-at-a-time picker could not tell
// them.
//
// Generating does NOT mark anything labelled. The confirm at the end does, after
// the stickers are actually on the racks. See confirm-label-print for why.

import React, { useMemo, useState } from 'react'
import { Printer, Download, AlertTriangle, CheckCircle2, Undo2 } from 'lucide-react'
import { Modal, Button, Field, Select, NumberInput, Toggle } from '@/components/ui'
import {
  useConfirmLabelPrint,
  useLayoutLabelTargets,
  usePrintLayoutLabels,
} from '@/hooks/queries/useLabelJobs'
import { signLabelSheet, type LayoutLabelJob } from '@/services/supabase/labelService'
import type { SheetGroup } from '@/supabase/functions/_shared/labels/layoutLabelPlan'

const GROUP_LABEL: Record<SheetGroup, string> = {
  wayfinding: 'Zone & aisle signs',
  slots: 'Bin & level stickers',
  staging: 'Staging & dock',
}

const PRESET_LABEL: Record<string, string> = {
  'a4-24': '24 per sheet · 63×34mm',
  'a4-14': '14 per sheet · 99×38mm',
  'a4-8': '8 per sheet · 99×67mm',
}

export interface LayoutLabelJobModalProps {
  open: boolean
  onClose: () => void
  layoutId: number
  layoutName?: string
}

export function LayoutLabelJobModal({
  open,
  onClose,
  layoutId,
  layoutName,
}: LayoutLabelJobModalProps) {
  const [onlyUnprinted, setOnlyUnprinted] = useState(true)
  const [rootLocationId, setRootLocationId] = useState<number | ''>('')
  const [startOffset, setStartOffset] = useState(0)
  const [job, setJob] = useState<LayoutLabelJob | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rootId = rootLocationId === '' ? null : Number(rootLocationId)

  // What this run would print, right now.
  const plan = useLayoutLabelTargets(layoutId, {
    rootLocationId: rootId,
    onlyUnprinted,
    enabled: open,
  })

  // Everything on the layout, regardless of printed state — the source of the
  // area picker's options. The wayfinding group IS the list of zones, aisles and
  // racks, so the picker needs no second query and no separate location tree.
  const everything = useLayoutLabelTargets(layoutId, { onlyUnprinted: false, enabled: open })

  const areas = useMemo(() => {
    const wayfinding = (everything.data ?? []).find((s) => s.group === 'wayfinding')
    return wayfinding?.items ?? []
  }, [everything.data])

  const printJob = usePrintLayoutLabels()
  const confirmJob = useConfirmLabelPrint(layoutId)

  const plannedTotal = (plan.data ?? []).reduce((n, s) => n + s.items.length, 0)
  const jobTotal = (job?.sheets ?? []).reduce((n, s) => n + s.labelCount, 0)

  const reset = () => {
    setJob(null)
    setConfirmed(false)
    setError(null)
  }

  const run = async () => {
    setError(null)
    try {
      const result = await printJob.mutateAsync({
        layoutId,
        rootLocationId: rootId,
        onlyUnprinted,
        startOffset,
      })
      setJob(result)
      setConfirmed(false)
      // Sheets open in the order they should be printed: signs go up before the
      // bin stickers underneath them mean anything.
      for (const sheet of result.sheets) {
        if (sheet.signedUrl) window.open(sheet.signedUrl, '_blank', 'noopener')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the label sheets.')
    }
  }

  const confirm = async (undo = false) => {
    if (!job) return
    setError(null)
    try {
      await confirmJob.mutateAsync({ jobId: job.jobId, undo })
      setConfirmed(!undo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that job.')
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

  const busy = printJob.isPending || confirmJob.isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Printer className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />}
      title="Print labels for this layout"
      description={
        layoutName
          ? `Every QR ${layoutName} needs — bins, rack levels, aisle signs and staging.`
          : 'Every QR this layout needs — bins, rack levels, aisle signs and staging.'
      }
      // An unconfirmed job is not unsaved work: the PDFs are stored and listed in
      // Recent runs, and the backlog is deliberately unchanged until confirm. So
      // no discard guard — it would cry wolf on every close.
      footer={({ requestClose }) => (
        <div className="flex items-center justify-between gap-3 w-full">
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            Close
          </Button>
          {job ? (
            confirmed ? (
              <Button variant="secondary" onClick={() => confirm(true)} disabled={busy}>
                <Undo2 className="w-4 h-4" aria-hidden="true" />
                Undo — these were never printed
              </Button>
            ) : (
              <Button onClick={() => confirm(false)} disabled={busy}>
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Mark these {jobTotal} as labelled
              </Button>
            )
          ) : (
            <Button onClick={run} disabled={busy || plannedTotal === 0}>
              <Printer className="w-4 h-4" aria-hidden="true" />
              {printJob.isPending ? 'Generating…' : `Generate ${plannedTotal} label${plannedTotal === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      )}
    >
      <div className="space-y-5">
        {!job && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Area"
                htmlFor="label-area"
                helper="Everything beneath the area you pick, plus its own sign."
              >
                <Select
                  id="label-area"
                  value={rootLocationId}
                  onChange={(e: { target: { value: string } }) => {
                    setRootLocationId(e.target.value === '' ? '' : Number(e.target.value))
                    reset()
                  }}
                >
                  <option value="">Whole layout</option>
                  {areas.map((a) => (
                    <option key={a.locationId} value={a.locationId}>
                      {a.code}
                      {a.context ? ` — ${a.context}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Skip first labels"
                htmlFor="label-offset"
                helper="Reusing a part-used sticker sheet — applies to the first sheet only."
              >
                <NumberInput
                  id="label-offset"
                  min={0}
                  max={47}
                  value={startOffset}
                  onChange={(e: { target: { value: string } }) =>
                    setStartOffset(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </Field>
            </div>

            <Toggle
              checked={!onlyUnprinted}
              onChange={(next) => {
                setOnlyUnprinted(!next)
                reset()
              }}
              label="Reprint everything"
              description="Off: only locations that have no sticker yet. On: every location in the selection, printed or not."
            />

            <div className="rounded-xl border border-stone-200 divide-y divide-stone-100">
              {plan.isLoading && <p className="p-3 text-sm text-stone-500">Working out what's needed…</p>}
              {!plan.isLoading && plannedTotal === 0 && (
                <p className="p-3 text-sm text-stone-500">
                  {onlyUnprinted
                    ? 'Nothing outstanding — every location in this selection already has a label.'
                    : 'This selection contains no locations to label.'}
                </p>
              )}
              {(plan.data ?? []).map((sheet) => (
                <div key={sheet.group} className="flex items-center gap-3 p-3">
                  <span className="text-sm text-stone-700 flex-1 min-w-0">
                    {GROUP_LABEL[sheet.group]}
                    <span className="block text-xs text-stone-400">
                      {PRESET_LABEL[sheet.preset] ?? sheet.preset}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-stone-900 tabular-nums shrink-0">
                    {sheet.items.length}
                  </span>
                </div>
              ))}
            </div>

            {plannedTotal > 0 && (
              <p className="text-xs text-stone-400">
                {(plan.data ?? []).length === 1
                  ? 'One PDF will open.'
                  : `${(plan.data ?? []).length} PDFs will open — one per sheet size, because they print on different stock.`}
              </p>
            )}
          </>
        )}

        {job && (
          <>
            <div className="rounded-xl border border-stone-200 divide-y divide-stone-100">
              {job.sheets.map((sheet) => (
                <div key={sheet.group} className="flex items-center gap-3 p-3">
                  <span className="text-sm text-stone-700 flex-1 min-w-0">
                    {GROUP_LABEL[sheet.group]}
                    <span className="block text-xs text-stone-400">
                      {sheet.labelCount} label{sheet.labelCount === 1 ? '' : 's'} ·{' '}
                      {PRESET_LABEL[sheet.preset] ?? sheet.preset}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => reopen(sheet.storagePath)}
                    className="shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Open
                  </Button>
                </div>
              ))}
            </div>

            {confirmed ? (
              <p className="flex items-start gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Recorded — those {jobTotal} locations no longer show as needing a label.
                </span>
              </p>
            ) : (
              <p className="text-sm text-stone-500">
                These locations still show as needing a label. Confirm once the stickers are on the
                racks — a jammed printer or a closed tab should not retire them from the list.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="flex items-start gap-2 text-sm text-red-600" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Modal>
  )
}

export default LayoutLabelJobModal
