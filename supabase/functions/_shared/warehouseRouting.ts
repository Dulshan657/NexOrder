/**
 * Closest-first warehouse routing — Deno/Edge-Function twin of
 * lib/warehouseRouting.ts. Pure TypeScript (no Deno-specific imports) so the
 * vitest parity test can import both. KEEP IN SYNC with the client copy.
 */

export interface Coords {
  lat: number;
  lng: number;
}

export interface RoutableWarehouse {
  id: number;
  lat?: number | null;
  lng?: number | null;
  isActive: boolean;
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

export function isRoutable(w: RoutableWarehouse): boolean {
  return w.isActive;
}

function hasCoords(w: RoutableWarehouse): boolean {
  return typeof w.lat === 'number' && typeof w.lng === 'number';
}

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
