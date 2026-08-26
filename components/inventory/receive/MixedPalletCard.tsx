// A mixed pallet: several SKUs riding on one physical pallet.
//
// ── WHY A CARD AND NOT A DROPDOWN ───────────────────────────────────────────
//
// Sharing a plate used to be expressed by pointing each line's plate picker at
// the same entry — general knowledge ("these three arrived together") encoded
// as three separate, identical, easily-forgotten selections. An operator does
// not think "line 2 belongs to pallet 1"; they think "this is a mixed pallet,
// and here is what is on it". The container comes first, so it is a container
// here too.
//
// ── IT IS ALWAYS A PALLET ───────────────────────────────────────────────────
//
// There is no type selector on this card and there must not be one. A carton
// holds one product, so a "mixed carton" names nothing on a real dock, and the
// member rows withhold their own "Arrived on" cell (`inGroup`) so a line cannot
// claim to have arrived as a carton while sharing a pallet with three others.
//
// ── THE ACTIVE CARD IS THE SCAN TARGET ──────────────────────────────────────
//
// While a card is active, everything added — searched, clicked or SCANNED at
// the dock — lands on it. That is the whole point on a gun: walk the pallet,
// scan, scan, scan, press Done. `ReceiveStockView` owns which card is active;
// this component only reports the intent.

import React from 'react'
import { Boxes, Check, Plus, Trash2 } from 'lucide-react'
import type { Product } from '../../../types'
import ReceiveLineCard from './ReceiveLineCard'
import type { PalletSpec } from '../../../lib/palletFit'
import type { DraftLine, DraftPlate } from './receiveDraft'

export type MixedPalletCardProps = {
  plate: DraftPlate
  /** "Mixed pallet 2" — numbered among mixed plates by `plateLabel`. */
  label: string
  /** The lines riding on this plate, in the receipt's own order. */
  lines: readonly DraftLine[]
  productById: ReadonlyMap<number, Product>
  supplierId: number | null
  plateDestinationLabel: (huType: 'pallet' | 'carton') => string
  /** Threaded through so a member line's Pallet unit can state its basis. */
  palletSpec?: PalletSpec | null
  /** This card is capturing everything added, including dock scans. */
  active: boolean
  /** Make this card the capture target and put the cursor in the search box. */
  onAddItem: () => void
  /** Stop capturing. The card and its lines stay exactly as they are. */
  onDone: () => void
  /** Remove the pallet and every line on it. */
  onRemove: () => void
  onUpdateLine: (lineKey: string, patch: Partial<DraftLine>) => void
  onRemoveLine: (lineKey: string) => void
}

export function MixedPalletCard({
  plate,
  label,
  lines,
  productById,
  supplierId,
  plateDestinationLabel,
  palletSpec = null,
  active,
  onAddItem,
  onDone,
  onRemove,
  onUpdateLine,
  onRemoveLine,
}: MixedPalletCardProps) {
  return (
    <section
      aria-label={label}
      // A left accent band rather than a padded box: the member rows carry the
      // eight-column grid template, and insetting them would slide every cell
      // out from under the header row at `xl`. 4px is the whole cost.
      className={`border-l-4 ${active ? 'border-nexgen-blue bg-nexgen-blue/[0.03]' : 'border-stone-200'}`}
    >
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <Boxes className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-stone-700">{label}</h3>
        {active && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-nexgen-blue/10 px-2 py-0.5 text-[11px] font-medium text-nexgen-blue">
            <span className="h-1.5 w-1.5 rounded-full bg-nexgen-blue" aria-hidden="true" />
            Scans land here
          </span>
        )}
        <span className="text-xs text-stone-400">
          {lines.length} item{lines.length === 1 ? '' : 's'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {active ? (
            <button
              type="button"
              onClick={onDone}
              className="btn-press inline-flex touch-target-y items-center gap-1.5 rounded-lg bg-stone-800 px-3 text-xs font-medium text-white"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Done
            </button>
          ) : (
            <button
              type="button"
              onClick={onAddItem}
              className="btn-press inline-flex touch-target-y items-center gap-1.5 rounded-lg px-3 text-xs text-stone-600 hover:bg-stone-100"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add item
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="btn-press flex touch-target-y min-w-[36px] items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {lines.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-stone-400">
          Nothing on this pallet yet — search or scan a product to add the first item.
        </p>
      ) : (
        <div className="divide-y divide-stone-100 border-t border-stone-100">
          {lines.map((line) => (
            // `key` on a typed local component is a type error in this repo:
            // with no @types/react there is no global JSX namespace, so `key`
            // is checked against the component's own props. See CLAUDE.md.
            <React.Fragment key={line.key}>
              <ReceiveLineCard
                inGroup
                line={line}
                product={line.productId != null ? productById.get(line.productId) : undefined}
                supplierId={supplierId}
                plates={[plate]}
                plateDestinationLabel={plateDestinationLabel}
                palletSpec={palletSpec}
                onUpdate={(patch) => onUpdateLine(line.key, patch)}
                onRemove={() => onRemoveLine(line.key)}
                // The container owns the type, so a member line can never set
                // it. Passing a no-op keeps the prop contract honest rather
                // than making it optional and letting a real caller forget it.
                onSetPlateType={() => {}}
              />
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

export default MixedPalletCard
