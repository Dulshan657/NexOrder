/**
 * Closest-first warehouse routing for multi-warehouse order allocation.
 *
 * Given a customer's coordinates and the set of warehouses, returns the
 * warehouse ids ordered nearest-first — the `p_location_pref` array the
 * `inv_reserve_order` RPC walks to split a line across sites.
 *
 * KEEP IN SYNC with supabase/functions/_shared/warehouseRouting.ts (the Deno
 * twin used by the Edge Functions). The parity is asserted in
 * __tests__/warehouseRouting.test.ts.
 */

export interface Coords {
  lat: number;
  lng: number;
}

/** The minimal warehouse shape routing needs (a WAREHOUSE-kind location). */
export interface RoutableWarehouse {
  id: number;
  lat?: number | null;
  lng?: number | null;
  isActive: boolean;
  /** 'racked' warehouses are excluded from routing until directed ops exist. */
  locationType?: 'bulk' | 'racked' | null;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: Coords, b: Coords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A warehouse can receive order allocations if it is active. Racked warehouses
 * participate too (mig 00040): reservation draws across their bins, and a site
 * with no stock simply contributes nothing and the split moves to the next.
 */
export function isRoutable(w: RoutableWarehouse): boolean {
  return w.isActive;
}

function hasCoords(w: RoutableWarehouse): boolean {
  return typeof w.lat === 'number' && typeof w.lng === 'number';
}

/**
 * Order routable warehouse ids nearest-first from `origin`.
 *
 * - Warehouses with coordinates sort by haversine distance, ties broken by id.
 * - Warehouses without coordinates sink to the end (id-ascending among them).
 * - When `origin` is null (customer has no coordinates), fall back to
 *   id-ascending order, matching the DB `inv_default_location()` lowest-id rule.
 */
export function orderedWarehousesFor(
  origin: Coords | null,
  warehouses: ReadonlyArray<RoutableWarehouse>,
): number[] {
  const eligible = warehouses.filter(isRoutable);

  if (!origin) {
    return [...eligible].sort((a, b) => a.id - b.id).map((w) => w.id);
  }

  const sorted = eligible
    .filter(hasCoords)
    .map((w) => ({
      id: w.id,
      dist: haversineKm(origin, { lat: w.lat as number, lng: w.lng as number }),
    }))
    .sort((a, b) => a.dist - b.dist || a.id - b.id)
    .map((w) => w.id);

  const tail = eligible
    .filter((w) => !hasCoords(w))
    .sort((a, b) => a.id - b.id)
    .map((w) => w.id);

  return [...sorted, ...tail];
}
