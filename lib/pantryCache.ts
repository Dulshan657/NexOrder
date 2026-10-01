// Pure helpers for the pantry query cache. The pantry hooks write the cache
// optimistically (hooks/queries/usePantry.ts), and PantryContext resolves
// every edit against the CACHED row at the moment of the click rather than a
// render-time snapshot — three quick "+" clicks used to all send the same
// `defaultQuantity + 1` and move the quantity by one.

export const MIN_PANTRY_QUANTITY = 1

export interface PantryCacheRow {
  product_id: number
  preferred_pack_size: number | null
  default_quantity: number
  [joined: string]: unknown
}

export interface PantryWrite {
  horeca_id: number
  product_id: number
  preferred_pack_size: number | null
  default_quantity: number
}

export interface PantryUpdate {
  /** Present-with-undefined clears the preference. */
  preferredPackSize?: number
  defaultQuantity?: number
  /** Relative change, applied to the latest cached quantity. */
  quantityDelta?: number
}

export function resolvePantryUpdate(
  existing: PantryCacheRow,
  updates: PantryUpdate,
): Pick<PantryWrite, 'preferred_pack_size' | 'default_quantity'> {
  const base = updates.defaultQuantity ?? existing.default_quantity
  const quantity = base + (updates.quantityDelta ?? 0)
  const packSize = 'preferredPackSize' in updates
    ? updates.preferredPackSize ?? null
    : existing.preferred_pack_size
  return {
    preferred_pack_size: packSize,
    default_quantity: Math.max(MIN_PANTRY_QUANTITY, quantity),
  }
}

export function upsertPantryRow<T extends PantryCacheRow>(rows: readonly T[], item: PantryWrite): T[] {
  const index = rows.findIndex((r) => r.product_id === item.product_id)
  if (index === -1) return [...rows, item as unknown as T]
  return rows.map((r, i) => (i === index ? { ...r, ...item } : r))
}

export function removePantryRow<T extends PantryCacheRow>(rows: readonly T[], productId: number): T[] {
  return rows.filter((r) => r.product_id !== productId)
}
