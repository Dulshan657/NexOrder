// The shape of a goods receipt while it is still being staged at the dock.
//
// Lifted out of `ReceiveStockView` so `ReceiveLineCard` can name these types
// without importing the view that renders it — the cycle that would otherwise
// force the card to restate them structurally and let the two drift.

/** A staged receipt line. One row on the screen, one line on the docket. */
export interface DraftLine {
  key: string
  productId: number | null
  quantity: string
  /** Received UOM (mig 00067); null = base unit. */
  uomId: number | null
  lotCode: string
  expiryDate: string
  barcode: string
  /** The plate (mig 00075) this line lands on. Every line has one. */
  plateKey: string
  /**
   * Hold this line (mig 00101). The header checkbox writes it onto every line
   * rather than being sent separately, so what the operator sees ticked in the
   * grid IS what is submitted — there is no second, invisible source of truth
   * for the server to rank against it.
   */
  quarantine: boolean
}

/**
 * A pallet or carton being built at the dock. The CODE is minted server-side on
 * receipt — this key only groups lines onto the same physical unit.
 *
 * `mixed` marks a plate the operator declared as a MIXED PALLET: several SKUs
 * riding on one pallet, entered through its own card rather than by pointing
 * each line at a shared plate. It is a UI fact and is never submitted — the
 * payload carries `hu_type` only, and a mixed pallet is simply a declared plate
 * that several lines name. A mixed plate is always a pallet: a carton holds one
 * product, so there is nothing for a mixed carton to mean.
 */
export interface DraftPlate {
  key: string
  huType: 'pallet' | 'carton'
  mixed?: boolean
}

let draftSeq = 0
let plateSeq = 0

export const newPlate = (huType: 'pallet' | 'carton' = 'pallet'): DraftPlate => ({
  key: `p${plateSeq++}`,
  huType,
})

/** A mixed pallet. Type is fixed — see `DraftPlate.mixed`. */
export const newMixedPlate = (): DraftPlate => ({
  key: `p${plateSeq++}`,
  huType: 'pallet',
  mixed: true,
})

export const newDraft = (plateKey: string, quarantine = false): DraftLine => ({
  key: `d${draftSeq++}`,
  productId: null,
  quantity: '',
  uomId: null,
  lotCode: '',
  expiryDate: '',
  barcode: '',
  plateKey,
  // A line added while the delivery is flagged inherits the flag — otherwise
  // "hold this delivery" quietly stops applying to anything typed after it.
  quarantine,
})

/**
 * Display label for a plate: "Pallet 1", "Carton 3", "Mixed pallet 2" —
 * numbered by position so the operator can match a row to the physical unit in
 * front of them before any real code exists.
 *
 * Mixed pallets are numbered among THEMSELVES, not among all plates: the first
 * one an operator declares must read "Mixed pallet 1" whether or not six
 * ordinary lines were keyed in ahead of it, because that is the label they will
 * say out loud while standing next to it.
 */
export function plateLabel(plates: readonly DraftPlate[], key: string): string {
  const index = plates.findIndex((p) => p.key === key)
  if (index < 0) return 'Plate'
  const plate = plates[index]
  if (plate.mixed) {
    const nth = plates.slice(0, index + 1).filter((p) => p.mixed).length
    return `Mixed pallet ${nth}`
  }
  return `${plate.huType === 'carton' ? 'Carton' : 'Pallet'} ${index + 1}`
}
