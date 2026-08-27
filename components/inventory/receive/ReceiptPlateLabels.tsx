// Print the plate stickers for a receipt, at the dock, before the goods move.
//
// This panel exists because of what happens when it does not. `receive-stock`
// mints a handling unit for EVERY line — that is what makes "every receipt line
// is on a plate" true — but it renders no sticker, and until now nothing offered
// to. So a site accumulates plates the database can name and nobody can scan,
// and the putaway walk hours later demands a code that was printed on nothing.
//
// Which plates are pre-ticked is not a UI preference: it is `plateNeedsLabel`,
// the same rule the walk applies at the rack, stated once in
// _shared/putawayIdentity.ts. A pallet always wants one; anything else wants one
// only when the goods cannot identify themselves. The rest are still listed and
// still printable — a barcode that arrived scuffed is a real reason to label a
// carton that ordinarily would not need it — they are just not ticked, because
// pre-ticking the whole receipt is how a print run becomes a thing people skip.

import React, { useEffect, useMemo, useState } from 'react'
import { Printer, Tag } from 'lucide-react'
import { useReceiptPlates } from '@/hooks/queries/useReceiveStock'
import { usePrintPlateLabels } from '@/hooks/queries/usePalletBreakdown'
import { useToasts } from '@/hooks/useToasts'
import { plateNeedsLabel } from '@/lib/putawayIdentity'

interface ReceiptPlateLabelsProps {
  /** The receipt just recorded. Null before one exists. */
  goodsReceiptId: number | null
}

export const ReceiptPlateLabels: React.FC<ReceiptPlateLabelsProps> = ({ goodsReceiptId }) => {
  const { addToast } = useToasts()
  const platesQuery = useReceiptPlates(goodsReceiptId)
  const print = usePrintPlateLabels()
  const [selected, setSelected] = useState<number[]>([])
  const [labelUrl, setLabelUrl] = useState<string | null>(null)

  const plates = platesQuery.data ?? []

  const needing = useMemo(
    () =>
      plates
        .filter((p) =>
          plateNeedsLabel({
            huType: p.huType,
            labelPrinted: p.labelPrinted,
            productBarcodes: p.products.map((prod) => prod.barcode),
          }),
        )
        .map((p) => p.id),
    [plates],
  )

  // Seed the ticks from the rule once the list arrives, and re-seed when a new
  // receipt replaces it. Not a render-time derivation: the operator must be able
  // to untick a suggestion, and a derived value would fight them.
  useEffect(() => {
    setSelected(needing)
    setLabelUrl(null)
  }, [goodsReceiptId, needing.join(',')])

  if (goodsReceiptId == null || plates.length === 0) return null

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setLabelUrl(null)
  }

  const renderLabels = async () => {
    try {
      const result = await print.mutateAsync(selected)
      // Rendered as a link the operator TAPS: window.open after an await is
      // popup-blocked, every time.
      setLabelUrl(result.signedUrl)
      if (!result.signedUrl) addToast('The sheet rendered but returned no link — try again', 'error')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not render the labels', 'error')
    }
  }

  return (
    <div className="glass-card rounded-xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-nexgen-blue shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-stone-900">Plate labels</h2>
          <p className="text-xs text-stone-500">
            {needing.length > 0
              ? `${needing.length} of ${plates.length} plate${plates.length === 1 ? '' : 's'} on this receipt ` +
                'needs a sticker. Print and stick them on before the goods leave the dock.'
              : 'Every plate on this receipt can be identified without a sticker. Print one anyway if a ' +
                'barcode arrived damaged.'}
          </p>
        </div>
      </div>

      <ul className="space-y-1">
        {plates.map((plate) => {
          const wants = needing.includes(plate.id)
          return (
            <li key={plate.id}>
              <label className="flex items-center gap-2.5 px-2 py-2 min-h-[44px] rounded-lg hover:bg-stone-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(plate.id)}
                  onChange={() => toggle(plate.id)}
                  className="w-4 h-4 shrink-0 rounded border-stone-300 text-nexgen-blue focus:ring-nexgen-blue/30"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-mono text-stone-800">{plate.code}</span>
                  <span className="block text-xs text-stone-400 truncate">
                    {plate.huType === 'pallet' ? 'Pallet' : 'Carton'}
                    {plate.products.length > 0 && ` · ${plate.products.map((p) => p.name).join(', ')}`}
                  </span>
                </span>
                {plate.labelPrinted ? (
                  <span className="shrink-0 text-[11px] text-stone-400">already printed</span>
                ) : wants ? (
                  <span className="shrink-0 text-[11px] text-amber-700">needs one</span>
                ) : null}
              </label>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center gap-3 flex-wrap">
        {labelUrl ? (
          <a
            href={labelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            Open the label sheet
          </a>
        ) : (
          <button
            type="button"
            onClick={renderLabels}
            disabled={print.isPending || selected.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] border border-stone-300 bg-white text-stone-700 text-sm font-medium rounded-lg btn-press disabled:opacity-50"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            {print.isPending
              ? 'Rendering…'
              : `Print ${selected.length} label${selected.length === 1 ? '' : 's'}`}
          </button>
        )}
        {labelUrl && (
          <p className="text-xs text-stone-500">
            Stick them on before the pallets move — putaway asks for these codes.
          </p>
        )}
      </div>
    </div>
  )
}

export default ReceiptPlateLabels
