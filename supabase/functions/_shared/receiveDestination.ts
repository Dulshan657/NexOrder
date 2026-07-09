// Pure destination-resolution + guard for receive-stock, split out so it's
// testable under vitest — receive-stock/index.ts itself imports Deno-only
// modules (`serve` from deno.land, `Deno.env`), which don't resolve under
// Node/tsc. See productBulk.ts's header comment for the same convention.
//
// Resolves and validates the warehouse a goods receipt lands in:
//   - Warehouse-role staff with a home site (`home_warehouse_id` set) may
//     only receive there — an explicit location_id for any other warehouse
//     is FORBIDDEN.
//   - Warehouse-role staff with NO home site (home_warehouse_id NULL, true
//     for every profile today) are unrestricted, same as Admin/Manager,
//     until an operator assigns one in Users admin.
//   - When no destination resolves — no explicit location_id AND no home
//     site — and more than one warehouse is active, the receipt is rejected
//     (INVALID_INPUT) rather than silently falling through to the
//     `inv_receive_stock` RPC's `inv_default_location()` fallback, which
//     always picks the lowest-id active warehouse (in practice, always
//     MAIN). A single-warehouse install keeps relying on that RPC default.

import { EdgeFunctionError } from './errors.ts'

export interface ReceiveDestinationActor {
  role: string
  homeWarehouseId: number | null
}

/**
 * Resolve the destination `location_id` for a goods receipt, throwing an
 * `EdgeFunctionError` if the request is disallowed or under-specified.
 *
 * @param requestedLocationId the `location_id` supplied on the receipt header, if any
 * @param actor the authenticated caller's role + home warehouse
 * @param activeWarehouseCount count of active `kind='WAREHOUSE'` locations
 */
export function resolveReceiveDestination(
  requestedLocationId: number | null | undefined,
  actor: ReceiveDestinationActor,
  activeWarehouseCount: number,
): number | null {
  if (
    actor.role === 'Warehouse' &&
    actor.homeWarehouseId != null &&
    requestedLocationId != null &&
    requestedLocationId !== actor.homeWarehouseId
  ) {
    throw new EdgeFunctionError('FORBIDDEN', 'You can only receive stock at your own warehouse')
  }

  const locationId = requestedLocationId ?? actor.homeWarehouseId ?? null

  if (locationId == null && activeWarehouseCount > 1) {
    throw new EdgeFunctionError('INVALID_INPUT', 'Destination warehouse is required')
  }

  return locationId
}
