// What this annotation edit is about to do, before it does it (migs 00095/00097).
//
// THE SUMMARY IS THE SERVER'S ANSWER, not an estimate. It comes from the same
// `paint_areas` / `paint_labels` actions with `dry_run: true`, so the counts here
// are the counts that move. It fires ONCE on open and again only when
// `includeCustom` changes, which is the one input the counts actually depend on —
// re-firing per keystroke would burn the 10/min buckets for nothing.
//
// The preview always computes the cascade even when the checkbox is off. That is
// deliberate: "24 racks would be renamed" is the information the opt-in exists to
// present, and computing it only after the operator has already opted in would
// make the choice blind.
//
// AREAS AND SIGNS ARE PREVIEWED AND SAVED SEPARATELY, through two actions with
// two fingerprints and two rate buckets — see signPaint.ts for why they are not
// one thing. This modal is the single place an operator confirms both, so the
// two panels below are deliberately worded to make the difference legible: areas
// rename bins and move them between zones, signs do neither. (The component name
// predates signs; it is the annotation-save confirm.)

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { usePaintAreas, usePaintSigns } from '@/hooks/queries/useWarehouseLocations'
import {
  previewPaintAreas,
  previewPaintSigns,
  type AreaPaintPreview,
  type SignPaintPreview,
} from '@/services/supabase/warehouseLocationService'
import type { AreaPaintSpec } from '@/lib/areaPaint'
import type { SignSpec } from '@/lib/signPaint'

interface AreaPaintSummaryModalProps {
  warehouseId: number
  layoutId: number
  baseFingerprint: string
  specs: AreaPaintSpec[]
  /** Floor signs (mig 00097). Omitted on a surface that does not edit them, in
   *  which case no sign preview is fetched and no sign write is issued. */
  signSpecs?: SignSpec[]
  /** signCellsFingerprint over the rows the sign working set was built from.
   *  Its own baseline — never the area one. */
  signBaseFingerprint?: string
  floorCount: number
  onClose: () => void
  onSaved: () => void
}

export function AreaPaintSummaryModal({
  warehouseId,
  layoutId,
  baseFingerprint,
  specs,
  signSpecs,
  signBaseFingerprint,
  floorCount,
  onClose,
  onSaved,
}: AreaPaintSummaryModalProps) {
  const [cascade, setCascade] = useState(false)
  const [includeCustom, setIncludeCustom] = useState(false)
  const [preview, setPreview] = useState<AreaPaintPreview | null>(null)
  const [signPreview, setSignPreview] = useState<SignPaintPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const paint = usePaintAreas(warehouseId)
  const paintSignsMutation = usePaintSigns(warehouseId)
  const { addToast } = useToasts()
  const editsSigns = signSpecs !== undefined && signBaseFingerprint !== undefined

  /**
   * Whether `paint_areas` will actually be called — the same condition `submit`
   * uses, deliberately, so the panel cannot describe a write that will not happen.
   *
   * This matters because `paint_areas` ALWAYS runs the zone-binding pass, and on
   * a site with no painted areas that pass resolves every bin to the warehouse
   * root. Verified on MAIN: saving one sign showed "189 locations will move into
   * their area's zone; 189 will return to the site root", on a save that touched
   * no location at all. Alarming, and a straightforward lie about the pending
   * action.
   */
  const willWriteAreas = !preview || !preview.unchanged || cascade

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setPreviewError(null)
    previewPaintAreas({
      warehouseId, layoutId, baseFingerprint, areas: specs,
      cascadeNames: true, includeCustom,
    })
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'Could not check the areas')
      })
    return () => { cancelled = true }
    // `specs` is captured at open and does not change while this is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, layoutId, baseFingerprint, includeCustom])

  // Separate effect, and deliberately NOT keyed on includeCustom: signs have no
  // cascade, so re-fetching this when that checkbox moves would spend the sign
  // bucket on an answer that cannot have changed.
  useEffect(() => {
    if (!editsSigns) return
    let cancelled = false
    setSignPreview(null)
    previewPaintSigns({ warehouseId, layoutId, baseFingerprint: signBaseFingerprint!, signs: signSpecs! })
      .then((p) => { if (!cancelled) setSignPreview(p) })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'Could not check the signs')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, layoutId, signBaseFingerprint, editsSigns])

  const submit = async () => {
    try {
      // SIGNS FIRST, and only when they actually changed. They are inert — no
      // cascade, no binding — so they cannot fail on anything the operator has
      // to decide. If the area write then fails, the signs are already safe and
      // the retry is only the risky half. Skipping an unchanged picture also
      // keeps a pure sign edit from spending the area bucket, and vice versa.
      let signsSaved = 0
      if (editsSigns && signPreview && !signPreview.unchanged) {
        const signResult = await paintSignsMutation.mutateAsync({
          layoutId, baseFingerprint: signBaseFingerprint!, signs: signSpecs!,
        })
        signsSaved = signResult.signs
      }

      let renamed = 0
      let areasTouched = false
      if (!preview || !preview.unchanged || cascade) {
        const result = await paint.mutateAsync({
          layoutId, baseFingerprint, areas: specs,
          cascadeNames: cascade, includeCustom: cascade && includeCustom,
        })
        renamed = result.renamed
        areasTouched = true
      }

      const what = areasTouched && signsSaved > 0 ? 'Areas and signs saved'
        : signsSaved > 0 ? 'Signs saved'
          : 'Areas saved'
      addToast(
        renamed > 0
          ? `${what} — ${renamed} location${renamed === 1 ? '' : 's'} renamed`
          : what,
        'success',
      )
      onSaved()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not save', 'error')
    }
  }

  const cellsByFloor = new Map<number, number>()
  for (const spec of specs) {
    for (const cell of spec.cells) cellsByFloor.set(cell.floor, (cellsByFloor.get(cell.floor) ?? 0) + 1)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editsSigns ? 'Save annotations' : 'Save areas'}
      size="md"
      footer={({ requestClose }) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 btn-press"
          >
            Back to painting
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={paint.isPending || paintSignsMutation.isPending || !!previewError}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
          >
            {paint.isPending || paintSignsMutation.isPending
              ? 'Saving…'
              : editsSigns ? 'Save annotations' : 'Save areas'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {previewError && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{previewError}</p>
        )}
        {!preview && !previewError && <p className="text-sm text-stone-400">Checking…</p>}

        {/* Signs first, matching the save order, and visually separated from the
            areas below because the consequences are not comparable: everything
            in this block is text on a picture. */}
        {editsSigns && signPreview && !signPreview.unchanged && (
          <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-2.5 text-sm text-stone-600">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Signs</p>
            {signPreview.created.map((name) => (
              <p key={`sc-${name}`}>
                <span className="font-medium text-stone-800">New sign “{name}”</span>
                {' — '}{signSpecs!.find((s) => s.name === name)?.cells.length ?? 0} cells.
              </p>
            ))}
            {signPreview.resized.map((r) => (
              <p key={`sr-${r.name}`}>
                <span className="font-medium text-stone-800">“{r.name}”</span>
                {' '}{r.after > r.before ? 'grows' : r.after < r.before ? 'shrinks' : 'moves'}
                {' '}{r.before} → {r.after} cells.
              </p>
            ))}
            {signPreview.erased.map((name) => (
              <p key={`se-${name}`}>
                <span className="font-medium text-rose-700">“{name}” is removed.</span>
              </p>
            ))}
            <p className="text-[11px] text-stone-400">
              Signs are wayfinding text — no bin is renamed, no zone changes, and the layout does
              not need republishing.
            </p>
          </div>
        )}

        {preview && (
          <>
            <div className="space-y-1.5 text-sm text-stone-600">
              {preview.unchanged && <p className="text-stone-400">Nothing about the areas changed.</p>}
              {preview.created.map((name) => (
                <p key={`c-${name}`}>
                  <span className="font-medium text-stone-800">New area “{name}”</span>
                  {' — '}{specs.find((s) => s.name === name)?.cells.length ?? 0} cells.
                </p>
              ))}
              {preview.resized.map((r) => (
                <p key={`r-${r.name}`}>
                  <span className="font-medium text-stone-800">“{r.name}”</span>
                  {' '}{r.after > r.before ? 'grows' : r.after < r.before ? 'shrinks' : 'moves'}
                  {' '}{r.before} → {r.after} cells.
                </p>
              ))}
              {preview.reprofiled.map((r) => (
                <p key={`p-${r.name}`}>
                  <span className="font-medium text-stone-800">“{r.name}”</span> changes zone profile.
                </p>
              ))}
              {preview.erased.map((name) => (
                <p key={`e-${name}`}>
                  <span className="font-medium text-rose-700">“{name}” is erased.</span>
                </p>
              ))}
              {floorCount > 1 && cellsByFloor.size > 0 && (
                <p className="text-[11px] text-stone-400">
                  {[...cellsByFloor.entries()].sort((a, b) => a[0] - b[0])
                    .map(([f, n]) => `Floor ${f + 1}: ${n} cells`).join(' · ')}
                </p>
              )}
            </div>

            {!willWriteAreas ? (
              <p className="text-xs text-stone-400">
                The areas are untouched, so nothing about them will be written — no bin is renamed
                and no bin changes zone.
              </p>
            ) : preview.willRename > 0 ? (
              <label className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5 text-xs text-stone-700">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-stone-800">
                    Also rename the bins inside these areas
                  </span>
                  <span className="block text-stone-500">
                    {preview.racks} rack{preview.racks === 1 ? '' : 's'}
                    {preview.levels > 0 && ` and ${preview.levels} level${preview.levels === 1 ? '' : 's'}`}
                    {' '}would change name. Rack numbers and codes are never changed — the labels
                    already on the racking stay correct.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-stone-400">No bin names need changing.</p>
            )}

            {cascade && preview.examples.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-stone-50 p-2 text-[11px]">
                {preview.examples.map((ex) => (
                  <li key={ex.code} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-stone-400">{ex.code}</span>
                    <span className="text-stone-500">{ex.from}</span>
                    <span className="text-stone-300">→</span>
                    <span className="font-medium text-stone-700">{ex.to}</span>
                  </li>
                ))}
                {preview.willRename > preview.examples.length && (
                  <li className="text-stone-400">
                    …and {preview.willRename - preview.examples.length} more
                  </li>
                )}
              </ul>
            )}

            {cascade && preview.skippedCustom > 0 && (
              <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={includeCustom}
                  onChange={(e) => setIncludeCustom(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">
                    {preview.skippedCustom} location{preview.skippedCustom === 1 ? '' : 's'} keep a custom name.
                  </span>
                  <span className="block text-amber-800/80">
                    Someone named {preview.skippedCustom === 1 ? 'it' : 'them'} by hand. Tick to rename
                    {preview.skippedCustom === 1 ? ' it' : ' them'} too.
                  </span>
                </span>
              </label>
            )}

            {willWriteAreas && preview.skippedForeign > 0 && (
              <p className="text-[11px] leading-snug text-stone-400">
                {preview.skippedForeign} location{preview.skippedForeign === 1 ? '' : 's'} already
                carried a different area&rsquo;s name before this paint, so {preview.skippedForeign === 1 ? 'it is' : 'they are'} left
                alone. Rename {preview.skippedForeign === 1 ? 'it' : 'them'} from the map if that is wrong.
              </p>
            )}

            {/* Zone binding (mig 00096). Not opt-in like the name cascade — an
                area naming a zone parents its bins under it either way — but it
                is a real re-parent and the operator should not discover it from
                the audit log. */}
            {willWriteAreas && (preview.willBind > 0 || preview.unbind > 0) && (
              <p className="text-xs text-stone-500">
                {preview.willBind > 0 && (
                  <>
                    {preview.willBind} location{preview.willBind === 1 ? '' : 's'} will move into
                    their area&rsquo;s zone
                    {preview.bindLevels > 0 && `, carrying ${preview.bindLevels} rack level${preview.bindLevels === 1 ? '' : 's'}`}
                  </>
                )}
                {preview.willBind > 0 && preview.unbind > 0 && '; '}
                {preview.unbind > 0 && (
                  <>
                    {preview.unbind} will return to the site root
                  </>
                )}
                .
              </p>
            )}

            {willWriteAreas && preview.categoryWarnings.length > 0 && (
              <div className="space-y-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                {preview.categoryWarnings.map((w) => (
                  <p key={w.areaName}>
                    <span className="font-medium">{w.areaName}</span> allows only some categories, but{' '}
                    {w.bins} bin{w.bins === 1 ? '' : 's'} in it hold {w.categories.join(', ')}. Putaway
                    will stop offering {w.bins === 1 ? 'that bin' : 'those bins'} for{' '}
                    {w.categories.length === 1 ? 'that category' : 'those categories'} — the stock
                    already there is not moved.
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
