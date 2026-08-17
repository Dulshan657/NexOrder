// "Print all labels for this layout" — one job, several sheets.
//
// A published layout needs three different kinds of sticker and they cannot come
// off the same stock: bin and rack-level labels are read at arm's length on a
// 14-up sheet, zone and aisle signs are read from across the floor on an 8-up
// sheet. So this renders one PDF per stock and presents
// them as one set — the whole point being that an operator can see they have
// everything, which is exactly what the old kind-at-a-time picker could not tell
// them.
//
// Generating does NOT mark anything labelled. The confirm at the end does, after
// the stickers are actually on the racks. See confirm-label-print for why.
//
// The sheets are DOWNLOADED, never window.open'd. A signed URL only exists after
// an await, and a tab opened after an await is outside the click gesture, so the
// browser blocks it — silently, and hardest on the 2nd and 3rd of a burst, which
// is precisely a three-sheet job. Fetching to a Blob and clicking an <a download>
// has no such dependency. Same reasoning as lib/openSignedDoc.ts, which this uses.
//
// But a browser also caps UNATTENDED downloads, and that cap is what a multi-sheet
// job runs into. Measured: one <a download> fired without a click always lands;
// fire two in a loop and the second is dropped AND the origin is left in a state
// where even later button clicks are dropped. Two downloads each driven by their
// own click both land, gesture already spent by an await or not.
//
// Hence the rule below: a job of ONE sheet downloads itself, a job of several
// downloads nothing and asks for a click per sheet. That is not a lesser fallback
// — it is the only shape that reliably puts every sheet on the operator's disk,
// and it matches the floor anyway, where each sheet goes on different stock.

import React, { useMemo, useState } from 'react'
import { Printer, Download, AlertTriangle, CheckCircle2, Undo2, Ruler } from 'lucide-react'
import { Modal, Button, Field, Select, NumberInput, Toggle } from '@/components/ui'
import { downloadSignedDoc } from '@/lib/openSignedDoc'
import { GROUP_LABEL, labelSheetFileName } from '@/lib/labelFileName'
import LabelSizeWizard from '@/components/admin/labels/LabelSizeWizard'
import {
  resolvePreset,
  type LabelPresetPrefs,
  type SheetGroup,
} from '@/supabase/functions/_shared/labels/layoutLabelPlan'
import {
  useConfirmLabelPrint,
  useLayoutLabelTargets,
  usePrintLayoutLabels,
  useSetWarehouseLabelPrefs,
  useWarehouseLabelPrefs,
} from '@/hooks/queries/useLabelJobs'
import {
  signLabelSheet,
  type LayoutLabelJob,
  type LayoutLabelSheet,
} from '@/services/supabase/labelService'
import { SHEET_PRESET_INFO } from '@/supabase/functions/_shared/labelSheet'

/**
 * Read from the preset library rather than restated. The previous hand-written
 * map listed only three stocks and described one of them at the wrong size.
 */
const PRESET_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SHEET_PRESET_INFO).map(([preset, info]) => [
    preset,
    info.averyLabel.replace(', ', ' · '),
  ]),
)

export interface LayoutLabelJobModalProps {
  open: boolean
  onClose: () => void
  layoutId: number
  layoutName?: string
  /** Needed to read and save this site's sticker stock. Omit and sizing is per-run. */
  warehouseId?: number
  onCalibrate?: () => void
  /** Restrict the run to these locations. Set by the recode hand-off so "print the
   *  new labels" prints exactly the bins that were just swept, and nothing else. */
  locationIds?: readonly number[] | null
  /** One line saying where a restricted run came from — a narrowed job that does
   *  not explain itself looks like a broken area filter. */
  contextNote?: string
}

export function LayoutLabelJobModal({
  open,
  onClose,
  layoutId,
  layoutName,
  warehouseId,
  onCalibrate,
  locationIds = null,
  contextNote,
}: LayoutLabelJobModalProps) {
  const [onlyUnprinted, setOnlyUnprinted] = useState(true)
  const [rootLocationId, setRootLocationId] = useState<number | ''>('')
  const [startOffset, setStartOffset] = useState(0)
  const [job, setJob] = useState<LayoutLabelJob | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Which sheets have actually reached the operator's disk. A sheet that
  // rendered but failed to download must not look like one that arrived.
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({})
  const [downloading, setDownloading] = useState(false)

  const rootId = rootLocationId === '' ? null : Number(rootLocationId)

  // What this run would print, right now.
  const narrowed = !!locationIds && locationIds.length > 0
  const plan = useLayoutLabelTargets(layoutId, {
    rootLocationId: rootId,
    onlyUnprinted,
    locationIds,
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

  // The stock this site has chosen (mig 00106). The preview must apply it, or
  // it would show the built-in default while the server rendered something
  // else — `resolvePreset` is the one definition both sides use.
  const prefs = useWarehouseLabelPrefs(warehouseId ?? null)
  const savePrefs = useSetWarehouseLabelPrefs(warehouseId ?? null)
  const [sizingFor, setSizingFor] = useState<SheetGroup | null>(null)
  // Chosen for this run only. Cleared when a choice is saved as the site's
  // stock instead, so there is never both an override and a matching default.
  const [overrides, setOverrides] = useState<LabelPresetPrefs>({})

  const prefMap = useMemo(() => {
    const map: LabelPresetPrefs = {}
    for (const p of prefs.data ?? []) map[p.sheetGroup] = p.preset
    return map
  }, [prefs.data])

  const plannedSheets = useMemo(
    () =>
      (plan.data ?? []).map((s) => ({
        ...s,
        preset: overrides[s.group] ?? resolvePreset(s.group, prefMap),
        overridden: overrides[s.group] != null,
      })),
    [plan.data, prefMap, overrides],
  )

  const plannedTotal = (plan.data ?? []).reduce((n, s) => n + s.items.length, 0)
  const jobTotal = (job?.sheets ?? []).reduce((n, s) => n + s.labelCount, 0)

  const reset = () => {
    setJob(null)
    setConfirmed(false)
    setError(null)
    setDownloaded({})
  }

  /**
   * Put one sheet on the operator's disk.
   *
   * Signs afresh from the storage path every time rather than reusing the URL
   * the job came back with: that one expires after 10 minutes, and a modal left
   * open while someone loads the printer outlives it. Nothing is regenerated —
   * the same stored PDF, so the codes stay exactly as first printed.
   */
  const downloadSheet = async (sheet: LayoutLabelSheet): Promise<void> => {
    let failed = false
    await downloadSignedDoc(
      async () => {
        const url = await signLabelSheet(sheet.storagePath)
        if (!url) throw new Error('That sheet is no longer available in storage.')
        return url
      },
      labelSheetFileName({ group: sheet.group, layoutName, date: new Date() }),
      {
        onError: (err) => {
          failed = true
          setError(
            err instanceof Error
              ? `${GROUP_LABEL[sheet.group]}: ${err.message}`
              : `Could not download the ${GROUP_LABEL[sheet.group].toLowerCase()} sheet.`,
          )
        },
      },
    )
    setDownloaded((prev) => ({ ...prev, [sheet.group]: !failed }))
  }

  const run = async () => {
    setError(null)
    setDownloaded({})
    try {
      const result = await printJob.mutateAsync({
        layoutId,
        rootLocationId: rootId,
        onlyUnprinted,
        startOffset,
        locationIds,
        presetOverrides: overrides as Record<SheetGroup, never>,
      })
      setJob(result)
      setConfirmed(false)
      // A single sheet can be handed over without being asked for; several
      // cannot (see the note at the top of this file), so they wait for a click.
      if (result.sheets.length === 1) {
        setDownloading(true)
        try {
          await downloadSheet(result.sheets[0])
        } finally {
          setDownloading(false)
        }
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

  const busy = printJob.isPending || confirmJob.isPending || downloading

  /**
   * Adopt a stock for one sheet group.
   *
   * Saving is the only way this sticks — a per-run choice would have to ride on
   * the print request, and the server deliberately re-derives the stock rather
   * than trusting the client with it (same reasoning as re-deriving WHICH
   * locations are in a group). So an unsaved choice is offered as a preview
   * only, and the button says so.
   */
  const chooseSize = async (preset: string, saveAsDefault: boolean) => {
    if (!sizingFor) return
    setError(null)
    try {
      if (saveAsDefault && warehouseId != null) {
        await savePrefs.mutateAsync([{ sheetGroup: sizingFor, preset: preset as never }])
        // Saved as the site's stock, so the run resolves to it normally and
        // carrying an override too would just be a second way to say the same
        // thing — and a way for the two to disagree.
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[sizingFor]
          return next
        })
      } else {
        setOverrides((prev) => ({ ...prev, [sizingFor]: preset as never }))
      }
      setSizingFor(null)
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that label size.')
    }
  }

  const sizingSheet = plannedSheets.find((s) => s.group === sizingFor) ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Printer className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />}
      title="Print labels for this layout"
      description={
        // A narrowed run must SAY it is narrowed. Otherwise the operator reads
        // "every label this layout needs", counts far fewer sheets than they
        // expect, and concludes the area filter is broken.
        contextNote
          ?? (layoutName
            ? `Every label ${layoutName} needs — bins, rack levels, aisle signs and staging.`
            : 'Every label this layout needs — bins, rack levels, aisle signs and staging.')
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
                  // A narrowed run already names its locations; letting the area
                  // filter also apply would silently intersect two selections and
                  // print neither of them.
                  disabled={narrowed}
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
              {plannedSheets.map((sheet) => (
                <div key={sheet.group} className="flex items-center gap-3 p-3">
                  <span className="text-sm text-stone-700 flex-1 min-w-0">
                    {GROUP_LABEL[sheet.group]}
                    <span className="block text-xs text-stone-400">
                      {PRESET_LABEL[sheet.preset] ?? sheet.preset}
                      {sheet.overridden
                        ? ' · this run only'
                        : prefs.data?.some((p) => p.sheetGroup === sheet.group)
                          ? ' · site default'
                          : ''}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-stone-900 tabular-nums shrink-0">
                    {sheet.items.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSizingFor(sheet.group)}
                    disabled={busy}
                  >
                    <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
                    Size
                  </Button>
                </div>
              ))}
            </div>

            {plannedTotal > 0 && (
              <p className="text-xs text-stone-400">
                {(plan.data ?? []).length === 1
                  ? 'One PDF will download.'
                  : `${(plan.data ?? []).length} PDFs — one per sheet size, because they print on different stock. You download each one from the list.`}
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
                      {downloaded[sheet.group] === true && ' · downloaded'}
                      {downloaded[sheet.group] === false && ' · not downloaded'}
                    </span>
                  </span>
                  <Button
                    // Outstanding sheets read as the action; a sheet already on
                    // disk steps back so the eye lands on what is still missing.
                    variant={downloaded[sheet.group] === true ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => downloadSheet(sheet)}
                    disabled={busy}
                    className="shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    {downloaded[sheet.group] === true ? 'Download again' : 'Download'}
                  </Button>
                </div>
              ))}
              {job.failures.map((failure) => (
                <div key={failure.group} className="flex items-start gap-2 p-3 text-sm text-red-600">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {GROUP_LABEL[failure.group]} could not be rendered — {failure.message} The other
                    sheets above are unaffected; re-run to retry this one.
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-stone-400">
              {job.sheets.length === 1
                ? 'Saved to your downloads. Download it again any time — nothing is regenerated, so the codes stay exactly as printed.'
                : 'Download each sheet above. They do not arrive on their own: browsers drop a burst of downloads, and a sheet that never reached you is worse than one more click. Nothing is regenerated, so the codes stay exactly as printed.'}
            </p>

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

      {sizingSheet && (
        <LabelSizeWizard
          open
          onClose={() => setSizingFor(null)}
          codes={sizingSheet.items.map((i) => i.code)}
          group={sizingSheet.group}
          currentPreset={sizingSheet.preset}
          canSaveDefault={warehouseId != null}
          onChoose={chooseSize}
          onCalibrate={onCalibrate}
        />
      )}
    </Modal>
  )
}

export default LayoutLabelJobModal
