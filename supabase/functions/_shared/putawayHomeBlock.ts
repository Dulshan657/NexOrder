// Ask the home-bin rule first (NX-0032, mig 00142).
//
// A product with a home bin goes there, or is refused while the home still has
// room. The rule lives once, in SQL: wie_home_block(rec, target) answers NULL
// (allowed) or the exact refusal text, and every putaway transaction re-asks it
// under its own row lock. This is the same question put EARLIER, from the edge
// function, so the floor reads "Put this in its home bin ..." before it is
// asked to say why it went elsewhere, and before any role or level gate that a
// flag could lift. Nothing lifts this one: not a role, not a reason, not
// role_override.
//
// NULL does not prove the task exists (an unknown task also answers NULL), so a
// caller reads its task first and asks this afterwards.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError, isEdgeFunctionError } from './errors.ts'

/** What the floor sees when the home could not be read. Detail goes to the log. */
export const HOME_UNAVAILABLE = 'Home bin unavailable, try again.'

/** True for the fail-closed answer above, wherever it was thrown. */
export function isHomeUnavailable(e: unknown): boolean {
  return isEdgeFunctionError(e) && e.code === 'INTERNAL' && e.message === HOME_UNAVAILABLE
}

/**
 * Throw CONFLICT with the refusal text when `toLocationId` is not an allowed
 * place for task `recId`. Fails closed: if the rule cannot be read, or answers
 * with anything other than NULL or a text, nothing is placed and the floor is
 * told to try again.
 */
export async function refuseIfHomeBlocked(
  admin: SupabaseClient,
  recId: number,
  toLocationId: number,
): Promise<void> {
  const { data, error } = await admin.rpc('wie_home_block', {
    p_rec_id: recId,
    p_to_location_id: toLocationId,
  })
  if (error) {
    console.error(`[wie_home_block] task ${recId} -> bin ${toLocationId}: ${error.message}`)
    throw new EdgeFunctionError('INTERNAL', HOME_UNAVAILABLE)
  }
  // NULL is the only "allowed". Anything else that is not a refusal text is a
  // reply this code does not understand, and an unknown reply must not read as
  // permission.
  if (data === null || data === undefined) return
  if (typeof data === 'string' && data.length > 0) {
    throw new EdgeFunctionError('CONFLICT', data)
  }
  console.error(`[wie_home_block] task ${recId} -> bin ${toLocationId}: unexpected reply ${JSON.stringify(data)}`)
  throw new EdgeFunctionError('INTERNAL', HOME_UNAVAILABLE)
}
