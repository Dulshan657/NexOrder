// Rename a painted area, and every auto-named bin inside it, on a LIVE site.
//
// The designer cannot do this — save_geometry requires a draft — and a
// mis-measured or mis-spelled area is exactly the thing discovered after
// go-live, so this has to work against a published layout.
//
// THE PREVIEW IS THE SERVER'S ANSWER, not an estimate. It comes from the same
// `rename_area` action with `dry_run: true`, so the count in the button is the
// count that will move. It fires ONCE on open, and again only if the operator
// ticks "also rename these": the number depends on `from`, not on what is being
// typed, so re-firing per keystroke would burn the 10/min bulk bucket for
// nothing.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { useRenameArea } from '@/hooks/queries/useWarehouseLocations'
import { previewAreaRename, type AreaRenamePreview } from '@/services/supabase/warehouseLocationService'
import { MAX_AREA_NAME, areaNameIssue, sanitizeAreaName } from '@/lib/locationNaming'

interface RenameAreaModalProps {
  warehouseId: number
  /** The area's current name — its identity, and the pool key its racks are
   *  numbered from. */
  areaName: string
  onClose: () => void
}

export function RenameAreaModal({ warehouseId, areaName, onClose }: RenameAreaModalProps) {
  const [name, setName] = useState(areaName)
  const [includeCustom, setIncludeCustom] = useState(false)
  const [preview, setPreview] = useState<AreaRenamePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const rename = useRenameArea(warehouseId)
  const { addToast } = useToasts()

  // One call per (area, includeCustom) — never per keystroke. `to` is sent only
  // so the examples read correctly; the counts do not depend on it.
  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setPreviewError(null)
    previewAreaRename({ warehouseId, from: areaName, to: areaName, includeCustom })
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'Could not check the rename')
      })
    return () => { cancelled = true }
  }, [warehouseId, areaName, includeCustom])

  const trimmed = sanitizeAreaName(name)
  const issue = name.trim() ? areaNameIssue(name) : null
  const dirty = trimmed !== areaName.trim()
  const canSave = dirty && !issue && !rename.isPending

  const submit = async () => {
    if (!canSave) return
    try {
      const result = await rename.mutateAsync({ from: areaName, to: trimmed, includeCustom })
      addToast(
        result.renamed > 0
          ? `Renamed ${result.renamed} location${result.renamed === 1 ? '' : 's'}`
          : `Renamed the area — no bin names needed changing`,
        'success',
      )
      onClose()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not rename the area', 'error')
    }
  }

  const total = preview?.willRename ?? 0

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rename “${areaName}”`}
      size="md"
      dirty={dirty}
      footer={({ requestClose }) => (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
          >
            {rename.isPending
              ? 'Renaming…'
              : total > 0 ? `Rename ${total} location${total === 1 ? '' : 's'}` : 'Rename'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="rename-area-name" className="mb-1 block text-xs font-medium text-stone-500">
            New name
          </label>
          <input
            id="rename-area-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            maxLength={MAX_AREA_NAME}
            autoFocus
            placeholder="Cold Room"
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800"
          />
          {issue && <p className="mt-1 text-[11px] text-rose-600">{issue}</p>}
        </div>

        {previewError && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{previewError}</p>
        )}

        {preview && (
          <div className="space-y-2">
            <p className="text-sm text-stone-600">
              {preview.racks} rack{preview.racks === 1 ? '' : 's'}
              {preview.levels > 0 && ` and ${preview.levels} level${preview.levels === 1 ? '' : 's'}`}
              {' '}will be renamed.
            </p>

            {preview.examples.length > 0 && trimmed && (
              <ul className="space-y-1 rounded-lg bg-stone-50 p-2 text-[11px]">
                {preview.examples.map((ex) => (
                  <li key={ex.code} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-stone-500">{ex.code}</span>
                    <span className="text-stone-500">{ex.from}</span>
                    <span className="text-stone-300">→</span>
                    {/* The example's `to` came back computed against the OLD name
                        (the preview does not re-fire per keystroke), so swap in
                        what is actually being typed. */}
                    <span className="font-medium text-stone-700">
                      {ex.to.replace(areaName, trimmed)}
                    </span>
                  </li>
                ))}
                {total > preview.examples.length && (
                  <li className="text-stone-500">…and {total - preview.examples.length} more</li>
                )}
              </ul>
            )}

            {preview.skippedCustom > 0 && (
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
          </div>
        )}

        <p className="text-[11px] leading-snug text-stone-500">
          Rack numbers are never changed, and codes are never changed — the labels already on the
          racking stay correct.
        </p>
      </div>
    </Modal>
  )
}
