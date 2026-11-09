// A putaway line may name its plate (NX-0032).
//
// recommend-putaway takes `hu_id` per line so the receive screen's Retry can
// send back exactly what receive-stock tried: the same plates, which is what
// lets a mixed pallet be recognised and a plate drain as it is put away. A task
// stores that id as its handling_unit_id, so a caller must not be able to hang
// a task on any plate it likes. A plate is accepted only when it belongs to the
// goods receipt the request names, and with no receipt named none is accepted.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'

/** The plate ids in `requested` that are not in `owned`, each listed once. */
export function unownedPlateIds(requested: readonly number[], owned: Iterable<number>): number[] {
  const have = new Set(owned)
  return [...new Set(requested)].filter((id) => !have.has(id))
}

/**
 * Throw INVALID_INPUT when a line names a plate that is not on `goodsReceiptId`
 * (or names a plate with no receipt to check it against). Throws INTERNAL if the
 * plates cannot be read: an unchecked id is not let through.
 */
export async function assertPlatesOnReceipt<L extends { hu_id?: number }>(
  admin: SupabaseClient,
  goodsReceiptId: number | undefined,
  lines: readonly L[],
): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.hu_id).filter((id): id is number => id != null))]
  if (ids.length === 0) return
  if (goodsReceiptId === undefined) {
    throw new EdgeFunctionError('INVALID_INPUT', 'hu_id needs goods_receipt_id')
  }

  const { data, error } = await admin.from('handling_units')
    .select('id')
    .eq('goods_receipt_id', goodsReceiptId)
    .in('id', ids)
  if (error) {
    console.error(`[putawayPlateOwnership] receipt ${goodsReceiptId}, plates ${ids.join(',')}: ${error.message}`)
    throw new EdgeFunctionError('INTERNAL', 'Could not check the plates, try again.')
  }

  const missing = unownedPlateIds(ids, ((data ?? []) as Array<{ id: number }>).map((r) => Number(r.id)))
  if (missing.length > 0) {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      `Plate ${missing.join(', ')} is not on receipt ${goodsReceiptId}`,
    )
  }
}
