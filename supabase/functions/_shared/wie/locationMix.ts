// Warehouse Intelligence Engine — one product per location (NX-0049).
//
// The owner's floor rule: a product goes into a location only when the
// location
//   * holds nothing, or
//   * holds only this same product, or
//   * is this product's home AND every other product in it is homed there too
//     and carries the same (non-blank) brand -- the shared McCurrie homes.
// Anything else is refused, for every role. A hold (quarantine) location is
// never refused: held stock of many products waits there by design.
//
// "Holds" means stock on hand there OR an open putaway line of another product
// already assigned there, so two lines cannot both claim an empty location for
// different products. Stock or lines on THIS line's own plate do not count:
// that is the same mixed pallet going to the same place.
//
// The same rule lives in SQL (wie_location_mix_block, mig 00151), which every
// putaway transaction asks under its row lock; this copy lets the planner never
// offer a location the floor would be refused.
//
// Pure: no I/O.

export interface LocationOccupant {
  productId: number
  sku: string
  name: string
  brand: string | null
  /** The plate the stock (or open line) is on; null for loose stock. */
  handlingUnitId: number | null
}

export interface LocationMixInput {
  product: {
    productId: number
    brand: string | null
    /** This product's primary home in the warehouse, if it has one. */
    homeLocationId: number | null
    homeCode: string | null
  }
  location: { locationId: number; code: string; isHold: boolean }
  /** Stock on hand in the location, and other open putaway lines assigned to it. */
  occupants: readonly LocationOccupant[]
  /** Products whose primary home is this location. */
  homedAtLocation: ReadonlySet<number>
  /** The plate the line being placed is on, if any. */
  ownHandlingUnitId?: number | null
}

/** Same brand, ignoring case and spaces. A blank brand never matches. */
export function sameBrand(a: string | null, b: string | null): boolean {
  const x = (a ?? '').trim().toLowerCase()
  const y = (b ?? '').trim().toLowerCase()
  return x.length > 0 && x === y
}

/** The refusal text, or null when the placement is allowed. */
export function locationMixRefusal(input: LocationMixInput): string | null {
  const { product, location, occupants, homedAtLocation, ownHandlingUnitId } = input
  if (location.isHold) return null

  const others = occupants
    .filter((o) => o.productId !== product.productId)
    .filter((o) => !(ownHandlingUnitId != null && o.handlingUnitId === ownHandlingUnitId))
  if (others.length === 0) return null

  const isOwnHome = product.homeLocationId === location.locationId
  const blocking = others.filter((o) =>
    !(isOwnHome && homedAtLocation.has(o.productId) && sameBrand(o.brand, product.brand)))
  if (blocking.length === 0) return null

  const first = [...blocking].sort((a, b) => a.productId - b.productId)[0]
  const where = product.homeCode && !isOwnHome
    ? `an empty location or its home ${product.homeCode}`
    : 'an empty location'
  return `${location.code} already holds ${first.sku} (${first.name}). Put this in ${where}.`
}
