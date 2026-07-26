// Rack level roles — the one definition, for both runtimes.
//
// Until mig 00081 the role vocabulary ('pick','reserve','bulk') was hardcoded in
// ~11 places: a SQL CHECK, a plpgsql RAISE, two duplicate TS unions, three zod
// enums, four LEVEL_ROLES arrays and two colour/label maps. The same value
// rendered as "Pick face", "Pick" and bare lowercase "pick" on four different
// screens. Roles now live in the level_roles table; this module is how every
// consumer reads them.
//
// PURITY CONTRACT (enforced by __tests__/wie/purity.test.ts): this file lives in
// _shared/wie/, so it must be pure TypeScript — no Deno globals, no remote
// imports, no I/O. That is why EVERY helper takes the role array as its first
// argument and there is no module-level cache and no fetch. Loading happens
// strictly outside:
//   * server: _shared/putawayTasks.ts (already impure) reads the table
//   * client: services/supabase/levelRoleService.ts + hooks/queries/useLevelRoles.ts
// Engine entry points receive roles as DATA through their existing args object.
// Never import a loader from here.
//
// `key` is the STORED value and never changes; `displayName` is what an operator
// sees. Renaming "Pick Zone" touches one row, not six screens.

/** One row of public.level_roles (mig 00081), camelCased. */
export interface LevelRoleRecord {
  key: string
  displayName: string
  description: string | null
  colorFill: string
  colorStroke: string
  colorText: string | null
  sortOrder: number
  /** Handling-unit types that prefer this role. Replaces ROLES_BY_HU_TYPE. */
  huTypes: string[]
  /** Replenishment destination + the inv_reserve_order bin preference. */
  isPickZone: boolean
  /** Draw order when refilling a pick zone. null = never a source. */
  replenSourceRank: number | null
  isSystem: boolean
  isActive: boolean
}

/** Neutral stone, matching the layout palette's default object fill. Used when a
 *  role key has no row yet — an operator can create a role before a given client
 *  bundle knows about it, and a missing colour must never render as a crash. */
const UNKNOWN_FILL = '#e7e5e4'
const UNKNOWN_STROKE = '#78716c'

function find(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): LevelRoleRecord | undefined {
  if (!key) return undefined
  return roles.find((r) => r.key === key)
}

/**
 * Operator-facing name for a role key.
 *
 * Falls back to the key itself rather than to a placeholder: an unknown role is
 * far more legible as "quarantine" than as "Unknown", and this is exactly the
 * state a client sees between a role being created and its bundle refreshing.
 * A null key means an unlevelled/legacy bin, which has no role at all.
 */
export function roleLabel(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): string {
  if (!key) return ''
  return find(roles, key)?.displayName ?? key
}

export function roleFill(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): string {
  return find(roles, key)?.colorFill ?? UNKNOWN_FILL
}

export function roleStroke(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): string {
  return find(roles, key)?.colorStroke ?? UNKNOWN_STROKE
}

export function roleTextColor(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): string | null {
  return find(roles, key)?.colorText ?? null
}

/** A role's palette for a PANEL surface (the rack level editor), as opposed to
 *  the flat canvas swatch that colorFill/colorStroke give directly.
 *
 *  Derived rather than stored: four more columns per role would be four more
 *  things an operator has to get right, and a panel that disagrees with its own
 *  canvas swatch is worse than one that is merely a shade off. `bg` is the fill
 *  mixed most of the way to white so form controls stay legible on it. */
export interface RoleTint {
  bg: string
  border: string
  text: string
  bar: string
}

function mixWithWhite(hex: string, weight: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const mix = (c: number) => Math.round(c + (255 - c) * weight)
  const r = mix((n >> 16) & 0xff)
  const g = mix((n >> 8) & 0xff)
  const b = mix(n & 0xff)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export function roleTint(
  roles: readonly LevelRoleRecord[],
  key: string | null | undefined,
): RoleTint {
  const fill = roleFill(roles, key)
  const stroke = roleStroke(roles, key)
  return {
    bg: mixWithWhite(fill, 0.72),
    border: fill,
    text: roleTextColor(roles, key) ?? stroke,
    bar: stroke,
  }
}

/** Active roles in operator-defined display order. */
export function sortedRoles(roles: readonly LevelRoleRecord[]): LevelRoleRecord[] {
  return roles
    .filter((r) => r.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
}

/** Keys of every active pick zone — replenishment destinations, and the bins
 *  inv_reserve_order prefers (mig 00083). */
export function pickZoneKeys(roles: readonly LevelRoleRecord[]): string[] {
  return sortedRoles(roles)
    .filter((r) => r.isPickZone)
    .map((r) => r.key)
}

/** Keys of every active replenishment source, best first (reserve before bulk). */
export function replenSourceKeys(roles: readonly LevelRoleRecord[]): string[] {
  return roles
    .filter((r) => r.isActive && r.replenSourceRank !== null)
    .slice()
    .sort(
      (a, b) =>
        (a.replenSourceRank ?? 0) - (b.replenSourceRank ?? 0) || a.key.localeCompare(b.key),
    )
    .map((r) => r.key)
}

/**
 * Level roles a given handling-unit type belongs on — the data that replaced
 * `ROLES_BY_HU_TYPE` (pallet -> bulk/reserve, carton -> pick).
 *
 * Set membership, not order: the only consumer is wie_putaway_candidates'
 * `l.level_role = ANY(p_roles)`, so no behaviour rides on the ordering. Returns
 * an empty array when no role claims this plate type, which callers must read as
 * "no preference", never as "nowhere is allowed".
 */
export function rolesForHuType(
  roles: readonly LevelRoleRecord[],
  huType: string | null | undefined,
): string[] {
  if (!huType) return []
  return sortedRoles(roles)
    .filter((r) => r.huTypes.includes(huType))
    .map((r) => r.key)
}

/**
 * The role a newly drawn level defaults to — the first in operator order.
 *
 * This replaces a scatter of `levelRole ?? 'pick'` fallbacks, which were a
 * different bug from the label maps: they hardcoded a stored VALUE, so they
 * would have survived a naive label refactor and silently pinned every new level
 * to 'pick' even in a warehouse that had renamed or retired it.
 */
export function defaultRoleKey(roles: readonly LevelRoleRecord[]): string {
  const active = sortedRoles(roles)
  return active[0]?.key ?? ''
}

/**
 * Combine a SKU's own level-role rule with the plate's preferred roles.
 *
 * Moved here from _shared/putawayTasks.ts (which held the hardcoded
 * ROLES_BY_HU_TYPE) so the pure engine and the frontend share one definition.
 * The plate preference now arrives as data via `rolesForHuType`.
 *
 * The SKU rule (product_wms_attributes.allowed_level_roles) is HARD — enforced
 * in wie_putaway_candidates' WHERE clause. The plate type is a preference. So
 * they are intersected, but if the intersection is EMPTY the SKU rule wins
 * alone: letting a plate preference empty the candidate set would wedge the
 * queue with nowhere to put the stock, which is the failure mode mig 00072's
 * role gate already had to grow an override for.
 *
 * null means unconstrained. Bins with a NULL level_role (every legacy bin) stay
 * eligible regardless — that predicate lives in the RPC, not here.
 */
export function resolveRolesForPutaway(
  skuRoles: string[] | null,
  plateRoles: string[] | null,
): string[] | null {
  if (!plateRoles || plateRoles.length === 0) return skuRoles
  if (!skuRoles || skuRoles.length === 0) return plateRoles
  const intersection = skuRoles.filter((r) => plateRoles.includes(r))
  return intersection.length > 0 ? intersection : skuRoles
}
