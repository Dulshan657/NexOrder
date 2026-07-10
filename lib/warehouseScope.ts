import { UserRole } from '../types';

/**
 * The app-wide warehouse filter: a specific warehouse (location id) or the
 * literal `'all'` meaning "every warehouse". Persisted to `?wh=` and
 * `localStorage['nexorder.wh_scope']` by the (not-yet-built) React provider;
 * this module stays pure so the resolution rules unit-test without React,
 * `window`, or `localStorage`.
 */
export type WarehouseScope = number | 'all';

/**
 * Parse a raw `?wh=`/localStorage token into a `WarehouseScope`, or `null` if
 * it isn't a valid token.
 *
 * `'all'` parses to `'all'`. A string of digits parses to its numeric value,
 * but only when that value is a positive integer — `locations` ids are
 * `SERIAL` (start at 1), so `'0'` and any negative/fractional/non-numeric
 * token (including `''`) are invalid and return `null`.
 */
export function parseScopeToken(raw: string | null | undefined): WarehouseScope | null {
  if (raw == null) return null;
  if (raw === 'all') return 'all';
  if (!/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Admin, Manager, and Warehouse all see a scope-aware Stock/Products view. */
export function isStaffScopeRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.WAREHOUSE;
}

/** Only Admin/Manager may pick `'all'` — Warehouse is hard-pinned to a site. */
export function canSelectAll(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

export interface ResolveScopeArgs {
  role: UserRole;
  homeWarehouseId: number | undefined;
  urlToken: string | null;
  storedToken: string | null;
  /** Active warehouse location ids. Empty on first render, before the
   *  warehouses query resolves. */
  activeWarehouseIds: readonly number[];
}

/**
 * Resolve the scope a tab should render with on first mount, given the
 * current user's role, their pinned home site (Warehouse role only), and
 * whatever tokens are already in the URL / localStorage.
 *
 * - **Warehouse role**: hard-pinned, `urlToken`/`storedToken` are ignored
 *   entirely. Prefers `homeWarehouseId` if it's an active warehouse, else the
 *   first active warehouse. Only when there are NO active warehouses at all
 *   does this fall back to `homeWarehouseId ?? 'all'` — a degenerate case
 *   (no sites exist yet) that should never occur in a seeded environment,
 *   documented here rather than silently coded around.
 * - **Admin/Manager**: precedence `urlToken -> storedToken -> 'all'`. Each
 *   token is honoured only if it parses AND (it's `'all'`, or it's numeric
 *   and present in `activeWarehouseIds`, or `activeWarehouseIds` is still
 *   empty — accepted provisionally because warehouses load async and the
 *   provider re-validates once they arrive). An invalid/rejected token falls
 *   through to the next source rather than aborting straight to `'all'`.
 * - **Everyone else** (Sales Rep variants, Customer): always `'all'` — they
 *   never see a picker and keep reading the global cache.
 */
export function resolveInitialScope(args: ResolveScopeArgs): WarehouseScope {
  const { role, homeWarehouseId, urlToken, storedToken, activeWarehouseIds } = args;

  if (role === UserRole.WAREHOUSE) {
    if (homeWarehouseId !== undefined && activeWarehouseIds.includes(homeWarehouseId)) {
      return homeWarehouseId;
    }
    if (activeWarehouseIds.length > 0) {
      return activeWarehouseIds[0];
    }
    return homeWarehouseId ?? 'all';
  }

  if (!canSelectAll(role)) {
    return 'all';
  }

  for (const rawToken of [urlToken, storedToken]) {
    const parsed = parseScopeToken(rawToken);
    if (parsed === null) continue;
    if (parsed === 'all') return 'all';
    if (activeWarehouseIds.length === 0 || activeWarehouseIds.includes(parsed)) {
      return parsed;
    }
    // Parsed but not an active warehouse: fall through to the next source.
  }

  return 'all';
}
