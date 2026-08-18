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
 */
export interface DraftPlate {
  key: string
  huType: 'pallet' | 'carton'
}

let draftSeq = 0
let plateSeq = 0

export const newPlate = (huType: 'pallet' | 'carton' = 'pallet'): DraftPlate => ({
  key: `p${plateSeq++}`,
  huType,
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
 * Display label for a plate: "Pallet 1", "Carton 3" — numbered by position so
 * the operator can match a row to the physical unit in front of them before any
 * real code exists.
 */
export function plateLabel(plates: readonly DraftPlate[], key: string): string {
  const index = plates.findIndex((p) => p.key === key)
  if (index < 0) return 'Plate'
  const plate = plates[index]
  return `${plate.huType === 'carton' ? 'Carton' : 'Pallet'} ${index + 1}`
}
