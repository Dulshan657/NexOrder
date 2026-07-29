// The PO's printed "Deliver To" block, and how it becomes the
// `orders.delivery_address` snapshot when nobody overrides it.
//
// Deliberately dependency-free, like ./documentNotes.ts, so the same file serves
// both runtimes: Deno inside approve-po, and Vite/vitest on the frontend where
// the detail modal prefills its address form. Forking it would let the address
// an operator sees diverge from the one the order is created with.

/** The extracted block. Loose on purpose, matching DocumentNotesSource: rows
 *  written before `ship_to` shipped simply lack the key, which arrives as
 *  `undefined`, and the model is free to return any member as null. */
export interface ShipToSource {
  ship_to?: {
    name?: string | null
    street?: string | null
    city?: string | null
  } | null
}

/** The `orders.delivery_address` shape, guarded by
 *  `orders_delivery_address_is_object` and documented on the column itself
 *  (migration 00021). `approve-po` re-exports this as ResolvedDeliveryAddress. */
export interface DeliveryAddressSnapshot {
  street: string
  city: string | null
  postcode: string | null
  country: string | null
  recipient_name: string | null
  source_address_id: string | null
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Build the delivery-address snapshot from what the PO printed.
 *
 * Returns null — rather than a half-empty object — whenever the document gave us
 * no usable street. NULL in that column has a defined meaning ("fall back to
 * horecas.address", migration 00021), and an object with a blank street would
 * override that fallback with nothing, which is strictly worse than not writing.
 *
 * `postcode` and `country` are always null: the extraction schema folds state
 * and postcode into `city` ("Hallam VIC 3803") by design, and re-splitting a
 * free-text locality is a guess this layer has no business making.
 *
 * `source_address_id` is always null. This address came off a document, not out
 * of the customer's address book, and callers must not add it to that book —
 * every auto-approved PO would otherwise silently grow it.
 */
export function shipToDeliveryAddress(
  extracted: ShipToSource | null | undefined,
): DeliveryAddressSnapshot | null {
  const shipTo = extracted?.ship_to
  if (!shipTo) return null

  const street = text(shipTo.street)
  if (!street) return null

  return {
    street,
    city: text(shipTo.city),
    postcode: null,
    country: null,
    recipient_name: text(shipTo.name),
    source_address_id: null,
  }
}
