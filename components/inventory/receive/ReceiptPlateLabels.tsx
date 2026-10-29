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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Printer, Tag } from 'lucide-react'
import { useReceiptPlates } from '@/hooks/queries/useReceiveStock'
import { usePrintPlateLabels } from '@/hooks/queries/usePalletBreakdown'
import { useToastActions } from '@/hooks/useToasts'
import { plateNeedsLabel } from '@/lib/putawayIdentity'

interface ReceiptPlateLabelsProps {
  /** The receipt just recorded. Null before one exists. */
  goodsReceiptId: number | null
  /**
   * Render the sheet for the plates that need a label as soon as they are
   * known, with no click (NX-0005). The operator's one action is then the tap
   * that opens it — which has to stay a tap: opening it programmatically after
   * the await is popup-blocked. The tick-list moves behind "Choose labels".
   *
   * Rendering is what flips `label_printed`, exactly as the Print button
   * always has; a sheet nobody opens is therefore recorded as printed. Accepted
   * in the NX-0005 brief.
   */
  autoRender?: boolean
}

export const ReceiptPlateLabels: React.FC<ReceiptPlateLabelsProps> = ({ goodsReceiptId, autoRender = false }) => {
  const { addToast } = useToastActions()
  const platesQuery = useReceiptPlates(goodsReceiptId)
  const print = usePrintPlateLabels()
  const [selected, setSelected] = useState<number[]>([])
  const [labelUrl, setLabelUrl] = useState<string | null>(null)
  const [renderedCount, setRenderedCount] = useState(0)
  const [chooserOpen, setChooserOpen] = useState(false)
  // Per receipt, not per `needing`: rendering flips `label_printed`, so the
  // very next refetch (window focus, coming back from the PDF tab) shrinks
  // `needing`. Re-seeding on that would untick everything and drop the link
  // the operator was about to tap.
  const seededFor = useRef<number | null>(null)
  const autoRanFor = useRef<number | null>(null)

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
    setLabelUrl(null)
    setRenderedCount(0)
    setChooserOpen(false)
  }, [goodsReceiptId])

  useEffect(() => {
    if (goodsReceiptId == null || platesQuery.data == null) return
    if (seededFor.current === goodsReceiptId) return
    seededFor.current = goodsReceiptId
    setSelected(needing)
  }, [goodsReceiptId, platesQuery.data, needing])

  const renderIds = async (ids: number[]) => {
    try {
      const result = await print.mutateAsync(ids)
      // Rendered as a link the operator TAPS: window.open after an await is
      // popup-blocked, every time.
      setLabelUrl(result.signedUrl)
      setRenderedCount(ids.length)
      if (!result.signedUrl) addToast('The sheet rendered but returned no link — try again', 'error')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not render the labels', 'error')
    }
  }

  useEffect(() => {
    if (!autoRender || goodsReceiptId == null || platesQuery.data == null) return
    if (autoRanFor.current === goodsReceiptId || needing.length === 0) return
    autoRanFor.current = goodsReceiptId
    void renderIds(needing)
    // `renderIds` is recreated every render and reads nothing stale that
    // matters; the ref above is what makes this fire once per receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRender, goodsReceiptId, platesQuery.data, needing])

  if (goodsReceiptId == null || plates.length === 0) return null

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setLabelUrl(null)
  }

  const renderLabels = () => renderIds(selected)

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

      {autoRender && (
        <button
          type="button"
          onClick={() => setChooserOpen((v) => !v)}
          aria-expanded={chooserOpen}
          className="btn-press touch-target-y inline-flex items-center gap-1.5 rounded-lg px-1 text-xs text-stone-600 hover:bg-stone-100"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${chooserOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          Choose labels
        </button>
      )}

      <ul className={`space-y-1 ${autoRender && !chooserOpen ? 'hidden' : ''}`}>
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
                  <span className="block text-xs text-stone-500 truncate">
                    {plate.huType === 'pallet' ? 'Pallet' : 'Carton'}
                    {plate.products.length > 0 && ` · ${plate.products.map((p) => p.name).join(', ')}`}
                  </span>
                </span>
                {plate.labelPrinted ? (
                  <span className="shrink-0 text-[11px] text-stone-500">already printed</span>
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
            className={`inline-flex items-center gap-1.5 bg-nexgen-blue text-white font-medium rounded-lg btn-press min-h-[44px] ${
              autoRender ? 'px-5 py-2.5 text-base' : 'px-3.5 py-2 text-sm'
            }`}
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            {autoRender
              ? `Print ${renderedCount} label${renderedCount === 1 ? '' : 's'}`
              : 'Open the label sheet'}
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
