// Putaway settings read from app_settings (NX-0049).
//
// putaway_ignore_capacity: the owner's "space is unlimited for now". When on,
// no home is ever full (capacity or max_qty), the planner does not limit a bin
// by slots or pallet positions, and nothing overflows. Weight limits still
// apply. The SQL home rule (wie_home_block, mig 00151) reads the same column.
//
// A failed read answers false: capacity is then enforced as it always was,
// which is the stricter answer, and the error is logged.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export async function loadIgnoreCapacity(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from('app_settings')
    .select('putaway_ignore_capacity')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    console.error(`[putawaySettings] putaway_ignore_capacity read failed: ${error.message}`)
    return false
  }
  return (data as { putaway_ignore_capacity?: unknown } | null)?.putaway_ignore_capacity === true
}
