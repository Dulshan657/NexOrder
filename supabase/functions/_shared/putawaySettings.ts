// Putaway settings read from app_settings (NX-0049).
//
// putaway_ignore_capacity: the owner's "space is unlimited for now". When on,
// no home is ever full (capacity or max_qty), the planner does not limit a bin
// by slots or pallet positions, and nothing overflows. Weight limits still
// apply. The SQL home rule (wie_home_block, mig 00151) reads the same column.
//
// A failed read THROWS, like every other safety read of the planner: the SQL
// home rule reads the column itself, so a planner that guessed "off" while it
// is on would create overflow stops the rule then refuses.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

export async function loadIgnoreCapacity(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from('app_settings')
    .select('putaway_ignore_capacity')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`putaway settings load failed: ${error.message}`)
  return (data as { putaway_ignore_capacity?: unknown } | null)?.putaway_ignore_capacity === true
}
