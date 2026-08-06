// Bind every drawn bin to the ZONE its painted area names (mig 00096).
//
// Painting and saving already bind as a side effect, so this exists for the site
// painted BEFORE 00096 — MAIN carries 189 racks and 945 shelves under areas that
// have never been bound to anything, and the alternative to this button is asking
// an operator to re-paint an area they already painted correctly.
//
// THE PREVIEW IS THE SERVER'S ANSWER, not an estimate. It comes from the same
// `bind_zones` action with `dry_run: true`, so the count in the button is the
// count that moves. It fires ONCE on open: nothing in this dialog is typed, so
// there is nothing that could change the answer.
//
// The warning worth reading is the category one. Binding turns zone semantics on
// for the first time, and `zone_profiles.allowed_categories` is a HARD allow-list
// in the putaway engine — a bin that gains a zone can stop being a legal putaway
// target while still holding the very stock the zone excludes. It warns and binds
// anyway, because refusing would not move the pallets off the rack.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { useBindZones } from '@/hooks/queries/useWarehouseLocations'
import { previewZoneBinding, type ZoneBindingPreview } from '@/services/supabase/warehouseLocationService'

interface BindZonesModalProps {
  warehouseId: number
  onClose: () => void
}

export function BindZonesModal({ warehouseId, onClose }: BindZonesModalProps) {
  const [preview, setPreview] = useState<ZoneBindingPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const bind = useBindZones(warehouseId)
  const { addToast } = useToasts()

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setPreviewError(null)
    previewZoneBinding(warehouseId)
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'Could not check the zone binding')
      })
    return () => { cancelled = true }
  }, [warehouseId])

  const total = (preview?.willBind ?? 0) + (preview?.unbind ?? 0)
  const canBind = total > 0 && !bind.isPending

  const submit = async () => {
    if (!canBind) return
    try {
      const result = await bind.mutateAsync()
      addToast(
        result.bound > 0
          ? `Bound ${result.boundUnits} location${result.boundUnits === 1 ? '' : 's'} to their zones`
          : 'Everything was already in the right place',
        'success',
      )
      onClose()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not bind the areas', 'error')
    }
  }

  // Areas that name a zone are the ones this acts on; the rest are listed only so
  // the operator can see nothing was missed.
  const zoned = (preview?.byArea ?? []).filter((a) => a.profileId != null)
  const unzoned = (preview?.byArea ?? []).filter((a) => a.profileId == null && a.areaName)

  return (
    <Modal
      open
      onClose={onClose}
      title="Bind areas to zones"
      size="md"
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
            disabled={!canBind}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white btn-press disabled:opacity-40"
          >
            {bind.isPending
              ? 'Binding…'
              : total > 0 ? `Bind ${total} location${total === 1 ? '' : 's'}` : 'Nothing to bind'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-stone-600">
          A painted area can name a zone profile. Binding makes that real: its racks are re-parented
          under the zone, which is how the putaway engine, the map and the location tree all read a
          bin&rsquo;s zone.
        </p>

        {previewError && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{previewError}</p>
        )}

        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              {preview.willBind > 0
                ? `${preview.willBind} location${preview.willBind === 1 ? '' : 's'} will move into a zone`
                : 'No location needs to move into a zone'}
              {preview.levels > 0 && `, carrying ${preview.levels} rack level${preview.levels === 1 ? '' : 's'}`}
              {preview.unbind > 0 && `; ${preview.unbind} will return to the site root`}
              {preview.unchanged > 0 && `. ${preview.unchanged} already sit correctly`}
              .
            </p>

            {zoned.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-stone-50 p-2 text-[11px]">
                {zoned.map((a) => (
                  <li key={a.areaName} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-stone-700">{a.areaName || 'Unnamed area'}</span>
                    <span className="text-stone-500">
                      {a.moved} of {a.units} location{a.units === 1 ? '' : 's'} moving
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {unzoned.length > 0 && (
              <p className="text-[11px] leading-snug text-stone-400">
                {unzoned.map((a) => a.areaName).join(', ')} name{unzoned.length === 1 ? 's' : ''} no zone
                profile, so {unzoned.length === 1 ? 'its' : 'their'} bins stay at the site root. Tag the
                area with a zone profile to bind {unzoned.length === 1 ? 'it' : 'them'}.
              </p>
            )}

            {preview.categoryWarnings.length > 0 && (
              <div className="space-y-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <p className="font-medium">Check these before binding.</p>
                {preview.categoryWarnings.map((w) => (
                  <p key={w.areaName} className="text-amber-800/90">
                    <span className="font-medium">{w.areaName}</span> allows only some categories, but{' '}
                    {w.bins} bin{w.bins === 1 ? '' : 's'} in it hold {w.categories.join(', ')}. Putaway
                    will stop offering {w.bins === 1 ? 'that bin' : 'those bins'} for{' '}
                    {w.categories.length === 1 ? 'that category' : 'those categories'} — the stock
                    already there is not moved.
                  </p>
                ))}
              </div>
            )}

            {preview.examples.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-stone-50 p-2 font-mono text-[11px]">
                {preview.examples.map((ex) => (
                  <li key={ex.code} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-stone-400">{ex.code}</span>
                    <span className="text-stone-300">→</span>
                    <span className="text-stone-600">{ex.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-[11px] leading-snug text-stone-400">
          Names, codes and rack numbers are untouched — the labels already on the racking stay
          correct, and no stock moves. Painting or saving areas binds automatically from now on.
        </p>
      </div>
    </Modal>
  )
}
