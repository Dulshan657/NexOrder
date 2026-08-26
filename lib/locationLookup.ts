// locationId → { code, name }, for the surfaces that only receive ids.
//
// Six RPCs hand the client a bare `code` and no name — wie_order_alloc_bins,
// wie_order_pick_stops, wie_putaway_stops, wie_putaway_candidates and the
// replen/route pair. Widening them is NOT the fix: each needs a DROP FUNCTION
// plus a recreate with a changed RETURNS TABLE, which is exactly the
// "CREATE OR REPLACE with a changed signature creates a second overload" hazard
// that has already silently duplicated inv_transfer_stock and inv_receive_stock
// in this repo — for a benefit one cached client query already delivers.
//
// `getWarehouseLocations` does `select('*')`, so every warehouse-scoped screen
// already holds the names. This turns the `codeById` map those screens built
// into one that carries both, and it costs nothing.
//
// Order-scoped screens (the Pick Queue, whose stops carry no warehouseId) can't
// use this — see hooks/queries/useLocationNames.ts.

import type { DisplayLocation } from '@/lib/locationDisplay'

interface LocationLike {
  id: number
  code: string
  name?: string | null
  isActive?: boolean
}

/** Both halves of a location's identity, keyed by id. */
export function buildDisplayLookup(
  locations: readonly LocationLike[] | undefined | null,
): Map<number, DisplayLocation> {
  const map = new Map<number, DisplayLocation>()
  for (const l of locations ?? []) {
    // `isActive` is carried through because the source query returns retired
    // bins too (see the header). A caller that must not send someone walking to
    // a bin that publishing took off the layout has no other way to know.
    map.set(l.id, { code: l.code, name: l.name ?? null, isActive: l.isActive })
  }
  return map
}

/**
 * The location for an id, or a placeholder carrying the id.
 *
 * `#123` is what these screens have always shown for an id they cannot resolve,
 * and it stays: it is honest about being an id rather than inventing a name.
 */
export function displayFor(
  lookup: ReadonlyMap<number, DisplayLocation>,
  id: number | null | undefined,
): DisplayLocation | null {
  if (id == null) return null
  return lookup.get(id) ?? { code: `#${id}`, name: null }
}

/** Lowercased searchable text for a location — code AND name.
 *
 *  Operators will now say "chiller rack seven", and a haystack that only holds
 *  codes would make the names decorative. */
export function searchTextFor(loc: DisplayLocation | null | undefined): string {
  if (!loc) return ''
  return `${loc.code} ${loc.name ?? ''}`.toLowerCase()
}
