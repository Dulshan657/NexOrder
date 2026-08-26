// One staged receipt line: a dense grid row on a desk, a two-tier card on a phone.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The receipt table was ~1100px of fixed columns (w-28 + 3x w-40 + w-44 + w-20 +
// w-10 = 888px, plus an unbounded Product column) inside one `overflow-x-auto`.
// On the RS35's 360px screen that is roughly three screens wide, with the batch
// barcode box and the Hold checkbox off to the right where nobody finds them.
//
// ── ONE RENDER, NOT TWO ─────────────────────────────────────────────────────
//
// Every control appears exactly once in this file. The layout changes with a
// CSS grid template, not with two parallel trees — the same approach as
// `ProductUomsSection`, `ProductSuppliersSection` and `SupplierProductsSheet`.
// Two trees would mean every future change to a cell has to be made twice, and
// the second one is the one that gets forgotten.
//
// `display: contents` is what makes the two-tier card possible without
// duplicating: below `xl` the secondary fields live inside a collapsible
// wrapper, and at `xl` that wrapper becomes `contents`, so its children flatten
// back out into cells of the row's own grid. Safe here — it has been sound in
// the accessibility tree since Chrome 89 / Firefox 84 / Safari 15.4, all well
// below the Chrome 111 floor `vite.config.ts` now pins.
//
// ── A CONTAINER QUERY, AND WHY IT IS NOT A BREAKPOINT ───────────────────────
//
// The three files above swap at `sm` because their columns are few and narrow.
// This row's fixed columns total 904px before gaps, so `sm` (640px) would trade
// a horizontal scroll for a broken layout. The figure that matters is MEASURED,
// at these exact widths, with the product column as `minmax(0,1fr)`:
//
//     1023px  card layout, no overflow
//     1024px  product column 0px, row overflows by 8px, name fully clipped
//     1100px  product column 52px — present, and useless
//     1180px  product column 132px — first width that reads
//     1280px  product column 232px
//
// Those numbers are right, and they are widths of THIS ROW'S CONTAINER: 904px
// of columns + 112px of gaps + 32px of padding = 1048px is spoken for before
// the product column gets anything, and 1180 - 1048 = 132 is the row above.
//
// They were then encoded as `@min-[1180px]:`, a VIEWPORT breakpoint, and that is a
// different quantity. The AppShell sidebar is 208px and the page pads by 32px,
// so at a 1280px viewport this container is 997px — 51px SHORT of 1048, which
// means the product column computed to literally 0px and the row overflowed.
// The one thing the operator is reading was unreadable on an ordinary laptop,
// while the comment above claimed 232px. Both halves were measured honestly;
// only the unit was wrong.
//
// So the query is on the container, which is what was measured all along. It
// also stops the sidebar being load-bearing: collapse it, mount this row
// somewhere narrower, nest it inside a mixed-pallet card — the row responds to
// the space it actually has.
//
// Do not turn this back into a viewport breakpoint, and do not lower 1180
// without re-measuring. The arithmetic is easy to get wrong in the optimistic
// direction: 904px of columns "fits" in 1024 right up until you subtract the
// padding and the gaps.
//
// `@container` itself is declared on the staged-lines card in
// `ReceiveStockView` — one context for the column headings AND the rows, so
// they cannot disagree about which layout is showing.
//
// ── NOTHING HIDES SILENTLY ──────────────────────────────────────────────────
//
// A collapsed line still states what is set — the plate, a lot code, an expiry,
// a barcode — and a held line is tinted amber and says Hold whether it is open
// or shut. A quarantine flag concealed inside a collapsed section would be a
// worse defect than the one this file fixes.

import React, { useId, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { ScanField } from '../../ui/ScanField'
import { Tooltip } from '../../ui/Tooltip'
import { normalizeScan } from '../../../lib/scan/resolveScan'
import { receivableUoms, deriveDefaultUoms, baseUom } from '../../../lib/uom'
import { provenanceHint, provenanceLabel, uomProvenance } from '../../../lib/palletUom'
import type { PalletSpec } from '../../../lib/palletFit'
import { supplierSkuFor } from '../../../lib/productSuppliers'
import type { Product } from '../../../types'
import { plateLabel, type DraftLine, type DraftPlate } from './receiveDraft'

/**
 * The row's column template once the CONTAINER is wide enough — column-for-column what the
 * table's `w-*` classes were, with the barcode column widened from 10rem to
 * 11rem to seat a full-height ScanField (see the touch-target note below).
 */
export const RECEIVE_ROW_COLUMNS =
  '@min-[1180px]:grid-cols-[minmax(0,1fr)_7rem_10rem_10rem_11rem_11rem_5rem_2.5rem]'

const CONTROL =
  'w-full min-h-[44px] px-2 py-1.5 text-sm bg-stone-50 border border-stone-200 rounded-md ' +
  'focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue'

/** Column name, repeated per-cell once the header row is hidden below `xl`. */
function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400 @min-[1180px]:hidden">
      {children}
    </span>
  )
}

export interface ReceiveLineCardProps {
  line: DraftLine
  product: Product | undefined
  supplierId: number | null
  plates: readonly DraftPlate[]
  /** Where a plate of this type would be routed — reads level roles (mig 00081). */
  plateDestinationLabel: (huType: 'pallet' | 'carton') => string
  /**
   * The global pallet (mig 00125). Only used to say where a product's Pallet
   * unit quantity came from — an ESTIMATED one is a guess, and the operator
   * counting a real pallet into stock is the person who most needs to know.
   */
  palletSpec?: PalletSpec | null
  onUpdate: (patch: Partial<DraftLine>) => void
  onRemove: () => void
  onSetPlateType: (huType: 'pallet' | 'carton') => void
  /**
   * This line sits inside a mixed-pallet card, which owns the container. The
   * "Arrived on" cell is withheld — a mixed pallet is a pallet, and offering
   * the choice per line would let one line claim to have arrived as a carton
   * while sharing a pallet with three others.
   */
  inGroup?: boolean
}

export function ReceiveLineCard({
  line,
  product,
  supplierId,
  plates,
  plateDestinationLabel,
  palletSpec = null,
  onUpdate,
  onRemove,
  onSetPlateType,
  inGroup = false,
}: ReceiveLineCardProps) {
  // Local, and keyed by the line's own identity through React's `key`. Nothing
  // above needs to know which lines are open, and lifting it would put a piece
  // of pure presentation into the receipt payload's neighbourhood.
  const [open, setOpen] = useState(false)
  const detailsId = useId()

  const supplierSku = product ? supplierSkuFor(product, supplierId) : undefined

  // Receivable UOMs (mig 00067): the product's own list, or a base+carton
  // default. Only offered when there is a choice beyond the base unit.
  const uoms = product
    ? (() => {
        const own = receivableUoms(product.uoms)
        return own.length > 0
          ? own
          : receivableUoms(deriveDefaultUoms(product.unit, product.price, product.cartonSize))
      })()
    : []
  const selectedUom = uoms.find((u) => u.id === line.uomId) ?? uoms.find((u) => u.isBase) ?? uoms[0]
  const baseCode = baseUom(uoms)?.code ?? product?.unit
  const baseQty = (Number(line.quantity) || 0) * (selectedUom?.isBase ? 1 : selectedUom?.factorToBase ?? 1)

  // Where this unit's quantity came from. Returns 'unknown' for anything that
  // is not a pallet, so an ordinary carton gets no claim attached to it.
  const provenance = uomProvenance(product, selectedUom, palletSpec)
  const provLabel = provenanceLabel(provenance)
  const provHint = provenanceHint(provenance)

  return (
    <div
      className={
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 px-4 py-3 ' +
        `@min-[1180px]:gap-x-4 @min-[1180px]:gap-y-0 ${RECEIVE_ROW_COLUMNS} ` +
        // The one place a line gets its own surface. A held line has to be
        // recognisable at a glance while collapsed, and while scrolling past.
        (line.quarantine ? 'bg-amber-50/60' : 'hover:bg-stone-50/50')
      }
    >
      {/* Product — always visible. Placed explicitly below `xl` so the remove
          control can sit beside it on the first row despite coming last in the
          DOM, which is the order the columns need at `xl`. */}
      <div className="col-start-1 row-start-1 min-w-0 @min-[1180px]:col-start-auto @min-[1180px]:row-start-auto">
        <p className="text-sm font-medium text-stone-900">{product?.name ?? '—'}</p>
        <p className="font-mono text-xs text-stone-400">
          {product?.sku}
          {/* The supplier's own part number, so the line can be ticked off
              against their docket. */}
          {supplierSku ? ` · their ${supplierSku}` : ''}
        </p>
      </div>

      {/* Quantity — always visible. The one field nobody should ever have to
          open a section to reach. */}
      <div className="col-span-2 @min-[1180px]:col-span-1">
        <MicroLabel>Qty</MicroLabel>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={line.quantity}
          onChange={(e) => onUpdate({ quantity: e.target.value })}
          className={`${CONTROL} text-right font-mono tabular-nums`}
          placeholder="0"
          aria-label={product ? `Quantity for ${product.name}` : 'Quantity'}
        />
        {product && uoms.length > 1 && selectedUom && (
          <div className="mt-1.5 space-y-0.5">
            <select
              aria-label={`Unit for ${product.name}`}
              value={selectedUom.id}
              onChange={(e) => {
                const next = uoms.find((u) => u.id === Number(e.target.value))
                onUpdate({ uomId: next && !next.isBase ? next.id : null })
              }}
              className={`${CONTROL} text-xs`}
            >
              {uoms.map((u) => (
                <option key={`${u.id}-${u.code}`} value={u.id}>
                  {u.code}
                  {u.isBase ? '' : ` (×${u.factorToBase})`}
                </option>
              ))}
            </select>
            {!selectedUom.isBase && (
              <p className="text-right text-[11px] tabular-nums text-stone-400">
                = {baseQty} {baseCode}
              </p>
            )}
            {/* An estimated pallet quantity is a guess, and this is where it
                turns into stock. Said here, not only on the product record. */}
            {provLabel && provHint && (
              <p className="flex items-center justify-end gap-1 text-[11px] text-stone-400">
                <span className={provenance === 'measured' ? '' : 'text-amber-600'}>{provLabel}</span>
                <Tooltip align="right" label="Where did this pallet quantity come from?" text={provHint} />
              </p>
            )}
          </div>
        )}
      </div>

      {/* The disclosure toggle. Below `xl` only — at `xl` every field it hides
          is already a visible column, so a control to reveal them would be a
          control that does nothing. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="btn-press col-span-2 -mx-1 flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-left text-xs text-stone-500 hover:bg-stone-100 @min-[1180px]:hidden"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{summarise(line, plates, inGroup)}</span>
      </button>

      {/*
        Below `xl`: a collapsible two-column block.
        At `xl`: `contents`, so the five children below become cells of the row
        grid in their own right and the column layout is exactly the old table.
      */}
      <div
        id={detailsId}
        className={`${open ? 'grid' : 'hidden'} col-span-2 grid-cols-2 gap-x-3 gap-y-2.5 @min-[1180px]:contents`}
      >
        <div>
          <MicroLabel>Lot code</MicroLabel>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={line.lotCode}
              onChange={(e) => onUpdate({ lotCode: e.target.value })}
              className={`${CONTROL} min-w-0 flex-1`}
              placeholder="optional"
              aria-label={`Lot code for line ${line.key}`}
            />
            <Tooltip
              label="What is a lot code?"
              text="The supplier's batch or lot number. Paired with an expiry date it drives FEFO picking, so the oldest stock leaves first."
            />
          </div>
        </div>

        <div>
          <MicroLabel>Expiry</MicroLabel>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={line.expiryDate}
              onChange={(e) => onUpdate({ expiryDate: e.target.value })}
              className={`${CONTROL} min-w-0 flex-1`}
              aria-label={`Expiry for line ${line.key}`}
            />
            <Tooltip
              label="What is the expiry for?"
              text="Optional. It sets the FEFO order for picking - the earliest expiry is picked first, ahead of stock received before it."
            />
          </div>
        </div>

        <div className="col-span-2 @min-[1180px]:col-span-1">
          <MicroLabel>Barcode</MicroLabel>
          {/*
            Deliberately NOT `compact`. That variant drops the 44px floor to
            py-1.5 AND suppresses the camera button outright — on a scan surface,
            on the one screen where someone is certainly holding a barcode. The
            column was widened to 11rem to seat the full control instead.

            Normalised on scan, not just stored raw: whatever lands here becomes
            `stock_batches.barcode`, which `resolveScan` indexes as
            `batchesByBarcode`, so a trailing control character saved now is a
            batch that can never be scanned again.
          */}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ScanField
                refocusAfterScan={false}
                ariaLabel={`Batch barcode for line ${line.key}`}
                value={line.barcode}
                onChange={(v: string) => onUpdate({ barcode: v })}
                onScan={(v: string) => onUpdate({ barcode: normalizeScan(v) })}
                placeholder="optional"
              />
            </div>
            <Tooltip
              align="right"
              label="What is this barcode for?"
              text="The barcode printed on this batch, when it differs from the product's own. Scanning it later resolves to this batch."
            />
          </div>
        </div>

        {/*
          -- ARRIVED ON ------------------------------------------------------
          One select, not two. This cell used to stack a plate PICKER ("Pallet
          1", "Carton 2", "+ New unit...") over a TYPE selector, which read
          specific -> general while the data ran general -> specific: the type
          select's value came off the PLATE, so on a shared plate changing one
          line silently retyped every sibling.

          A normal line now owns its plate one-for-one, so that hazard is gone
          by construction rather than by guarding. Sharing a plate is what the
          mixed-pallet card is for, and there the container owns the type.
        */}
        {inGroup ? (
          // Empty rather than absent: the row must keep its eight columns or it
          // stops lining up under the header at `xl`.
          <div className="hidden @min-[1180px]:block" />
        ) : (
          <div className="col-span-2 @min-[1180px]:col-span-1">
            <MicroLabel>Arrived on</MicroLabel>
            <div className="flex items-center gap-1.5">
              <select
                aria-label={`Arrived on, for line ${line.key}`}
                value={plates.find((p) => p.key === line.plateKey)?.huType ?? 'pallet'}
                onChange={(e) => onSetPlateType(e.target.value as 'pallet' | 'carton')}
                className={`${CONTROL} min-w-0 flex-1`}
              >
                {/* The destination shown here IS the routing: since mig 00081
                    each level role declares which plate types belong on it, so
                    an operator who moves pallets to a different role sees it
                    change. It is phrased as a prediction because that is all it
                    is -- putaway may place this anywhere. */}
                <option value="pallet">{plateDestinationLabel('pallet')}</option>
                <option value="carton">{plateDestinationLabel('carton')}</option>
              </select>
              <Tooltip
                align="right"
                label="What does Arrived on mean?"
                text="How the goods physically turned up. It is a hint for putaway, not a storage decision - you can still place them differently on the floor."
              />
            </div>
          </div>
        )}

        {/* The per-line override. Unticking one line of a held delivery releases
            just that line to ordinary stock. A full-height label below `xl`, so
            the checkbox is not a 16px target for a gloved thumb. */}
        <div className="col-span-2 @min-[1180px]:col-span-1 @min-[1180px]:text-center">
          <MicroLabel>Hold</MicroLabel>
          <div className="flex min-h-[44px] items-center gap-1.5 @min-[1180px]:justify-center">
            <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 @min-[1180px]:flex-none">
              <input
                type="checkbox"
                aria-label={`Quarantine line ${line.key}`}
                checked={line.quarantine}
                onChange={(e) => onUpdate({ quarantine: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm text-stone-600 @min-[1180px]:hidden">Hold this line back</span>
            </label>
            <Tooltip
              align="right"
              label="What does Hold do?"
              text="Held stock is received into the warehouse but stays unavailable to sell or pick until someone releases it."
            />
          </div>
        </div>
      </div>

      {/* Remove — top-right beside the product below `xl`, last column at `xl`. */}
      <div className="col-start-2 row-start-1 justify-self-end @min-[1180px]:col-start-auto @min-[1180px]:row-start-auto @min-[1180px]:text-right">
        <button
          type="button"
          onClick={onRemove}
          className="btn-press flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-600 @min-[1180px]:min-h-0 @min-[1180px]:min-w-0 @min-[1180px]:p-1.5"
          aria-label="Remove line"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * What the collapsed row says about the fields it is hiding.
 *
 * Every one of them is named, set or not, so the summary reads the same way
 * every time and the operator learns where to look. Hold comes first when it is
 * on: it is the only one of the five with a consequence for the stock.
 */
function summarise(line: DraftLine, plates: readonly DraftPlate[], inGroup: boolean): string {
  const parts: string[] = []
  if (line.quarantine) parts.push('Hold')
  // Inside a mixed pallet the card header already names the unit; repeating it
  // on every line would be the same two words down the whole card.
  if (!inGroup) parts.push(plateLabel(plates, line.plateKey))
  if (line.lotCode.trim()) parts.push(`Lot ${line.lotCode.trim()}`)
  if (line.expiryDate) parts.push(`Exp ${line.expiryDate}`)
  if (line.barcode.trim()) parts.push('Barcode set')
  const fields = inGroup ? 'lot, expiry, barcode' : 'lot, expiry, barcode, arrived on'
  return `${parts.join(' · ')} — ${fields}`
}

export default ReceiveLineCard
