// Ending a hold (mig 00101).
//
// The hold is on the PLACE, not the stock, so this dialog is a move and nothing
// else — there is no flag to clear and no state to unwind. Every line leaves at
// once by default, because a hold is normally lifted on a whole delivery; a
// quantity can be trimmed per line for the case where only part of a pallet
// passed inspection.

import { useEffect, useMemo, useState } from 'react'
import { Modal, Button } from '@/components/ui'
import { useToasts } from '@/hooks/useToasts'
import { useReleaseQuarantine } from '@/hooks/queries/useReleaseQuarantine'
import { locationOneLine } from '@/lib/locationDisplay'
import type { InventoryLocation } from '@/types'
import type { BinContentRow } from './useWarehouseViewerModel'

/** What can actually leave: inv_transfer_stock moves AVAILABLE stock only, and
 *  a reserved unit cannot leave its balance row. Held stock should never be
 *  allocated in the first place (that is the whole point), so this is normally
 *  just on_hand — but subtracting is the honest sum and costs nothing. */
const releasable = (c: BinContentRow): number => Math.max(0, c.onHand - c.allocated)

interface ReleaseQuarantineModalProps {
  open: boolean
  onClose: () => void
  from: InventoryLocation
  contents: BinContentRow[]
  destinations: InventoryLocation[]
}

export function ReleaseQuarantineModal({ open, onClose, from, contents, destinations }: ReleaseQuarantineModalProps) {
  const { addToast } = useToasts()
  const release = useReleaseQuarantine()
  const [destinationCode, setDestinationCode] = useState('')
  const [qtyByProduct, setQtyByProduct] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  // Re-arm on every open: a dialog that reopens holding the last release's
  // quantities would release the wrong amount on a second, hurried use.
  useEffect(() => {
    if (!open) return
    setDestinationCode('')
    setError(null)
    // Base units, which is what inv_transfer_stock moves — NOT `slots`, which
    // is slot CONSUMPTION and is a different number entirely for anything whose
    // size_factor is not 1.
    setQtyByProduct(Object.fromEntries(contents.map((c) => [c.productId, String(releasable(c))])))
  }, [open, contents])

  // Matched on CODE, which is what is printed on the rack and what a scanner
  // reads — the same identity contract everywhere else in the warehouse uses.
  const destination = useMemo(
    () => destinations.find((d) => d.code.toUpperCase() === destinationCode.trim().toUpperCase()) ?? null,
    [destinations, destinationCode],
  )

  const lines = useMemo(
    () => contents
      .map((c) => ({
        productId: c.productId,
        name: c.productName ?? `#${c.productId}`,
        quantity: Number(qtyByProduct[c.productId] ?? '0'),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0),
    [contents, qtyByProduct],
  )

  const submit = async () => {
    setError(null)
    if (!destination) {
      setError('Choose a destination location by its code.')
      return
    }
    if (lines.length === 0) {
      setError('Nothing to release — every quantity is blank or zero.')
      return
    }
    try {
      const result = await release.mutateAsync({
        fromLocationId: from.id,
        toLocationId: destination.id,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      })
      // A partial release is a true statement about the floor: some pallets
      // moved. Saying so beats reporting a flat success or a flat failure.
      if (result.failed.length > 0) {
        addToast(
          `Released ${result.moved.length} line${result.moved.length === 1 ? '' : 's'}; ${result.failed.length} refused.`,
          'error',
        )
      } else {
        addToast(`Released to ${destination.code} — now available to sell.`, 'success')
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Release failed')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Release from ${from.code}`}
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" size="sm" onClick={requestClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={release.isPending}>
            {release.isPending ? 'Releasing…' : 'Release'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-xs text-stone-500">
          Moving this stock out of {locationOneLine(from)} ends its hold. It becomes available to sell
          the moment it lands.
        </p>

        <label className="block text-xs text-stone-500">
          Move to
          {/* ONE datalist for every destination, never a per-row select: a site
              with hundreds of bins renders hundreds of option lists otherwise,
              which is what froze the replenishment grid. */}
          <input
            list="release-destinations"
            value={destinationCode}
            onChange={(e) => setDestinationCode(e.target.value)}
            placeholder="Scan or type a location code"
            className="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 font-mono text-xs"
          />
          <datalist id="release-destinations">
            {destinations.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
          </datalist>
          {destinationCode.trim() !== '' && !destination && (
            <span className="mt-1 block text-[11px] text-red-600">
              No location here with that code.
            </span>
          )}
        </label>

        <div className="rounded-lg border border-stone-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th scope="col" className="px-2 py-1.5 font-semibold">Product</th>
                <th scope="col" className="w-28 px-2 py-1.5 text-right font-semibold">Release</th>
              </tr>
            </thead>
            <tbody>
              {contents.map((c) => (
                <tr key={c.productId} className="border-b border-stone-100 last:border-0">
                  <td className="px-2 py-1.5">{c.productName ?? `#${c.productId}`}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number" min={0} max={releasable(c)}
                      aria-label={`Quantity to release for ${c.productName ?? c.productId}`}
                      value={qtyByProduct[c.productId] ?? ''}
                      onChange={(e) => setQtyByProduct((prev) => ({ ...prev, [c.productId]: e.target.value }))}
                      className="w-24 rounded border border-stone-200 px-2 py-1 text-right"
                    />
                    <span className="ml-1 text-stone-400">of {releasable(c)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
