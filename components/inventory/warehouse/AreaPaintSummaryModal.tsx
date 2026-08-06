// What this paint is about to do, before it does it (mig 00095).
//
// THE SUMMARY IS THE SERVER'S ANSWER, not an estimate. It comes from the same
// `paint_areas` action with `dry_run: true`, so the counts here are the counts
// that move. It fires ONCE on open and again only when `includeCustom` changes,
// which is the one input the counts actually depend on — re-firing per keystroke
// would burn the 10/min paint bucket for nothing.
//
// The preview always computes the cascade even when the checkbox is off. That is
// deliberate: "24 racks would be renamed" is the information the opt-in exists to
// present, and computing it only after the operator has already opted in would
// make the choice blind.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { usePaintAreas } from '@/hooks/queries/useWarehouseLocations'
import { previewPaintAreas, type AreaPaintPreview } from '@/services/supabase/warehouseLocationService'
import type { AreaPaintSpec } from '@/lib/areaPaint'

interface AreaPaintSummaryModalProps {
  warehouseId: number
  layoutId: number
  baseFingerprint: string
  specs: AreaPaintSpec[]
  floorCount: number
  onClose: () => void
  onSaved: () => void
}

export function AreaPaintSummaryModal({
  warehouseId,
  layoutId,
  baseFingerprint,
  specs,
  floorCount,
  onClose,
  onSaved,
}: AreaPaintSummaryModalProps) {
  const [cascade, setCascade] = useState(false)
  const [includeCustom, setIncludeCustom] = useState(false)
  const [preview, setPreview] = useState<AreaPaintPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const paint = usePaintAreas(warehouseId)
  const { addToast } = useToasts()

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

  const submit = async () => {
    try {
      const result = await paint.mutateAsync({
        layoutId, baseFingerprint, areas: specs,
        cascadeNames: cascade, includeCustom: cascade && includeCustom,
      })
      addToast(
        result.renamed > 0
          ? `Areas saved — ${result.renamed} location${result.renamed === 1 ? '' : 's'} renamed`
          : 'Areas saved',
        'success',
      )
      onSaved()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not save the areas', 'error')
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
      title="Save areas"
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
            disabled={paint.isPending || !!previewError}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
          >
            {paint.isPending ? 'Saving…' : 'Save areas'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {previewError && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{previewError}</p>
        )}
        {!preview && !previewError && <p className="text-sm text-stone-400">Checking…</p>}

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

            {preview.willRename > 0 ? (
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

            {preview.skippedForeign > 0 && (
              <p className="text-[11px] leading-snug text-stone-400">
                {preview.skippedForeign} location{preview.skippedForeign === 1 ? '' : 's'} already
                carried a different area&rsquo;s name before this paint, so {preview.skippedForeign === 1 ? 'it is' : 'they are'} left
                alone. Rename {preview.skippedForeign === 1 ? 'it' : 'them'} from the map if that is wrong.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
