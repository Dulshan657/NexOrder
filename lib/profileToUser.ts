import type { User } from '../types';
import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

/**
 * Bridge from a real Supabase auth profile (UUID id) to the numeric-id User
 * shape the frontend uses everywhere for keying, comparisons, and filters.
 * Remove when User.id becomes a UUID string.
 *
 * ── WHY THIS NO LONGER CONSULTS A SEEDED ROSTER ─────────────────────────────
 *
 * It used to match `constants.ts`'s six demo users by email so their ids stayed
 * 1..6 across the auth migration, and hash-derived anything else. Two reasons
 * that had to go:
 *
 * 1. `constants.ts` is imported by `App.tsx`, so keeping the roster reachable
 *    from here is what put `alice@nexorder.com.au` in the browser bundle.
 * 2. It was only ever stable for accounts that happened to be seeded. On a
 *    client's database — where none of them exist — every id came from the
 *    hash branch anyway. The special case bought nothing there and hid the
 *    fact that the hash branch is the real implementation.
 *
 * No persisted data depends on 1..6: every user reference in the database is a
 * UUID (`orders.submitted_by`, `sales_targets.user_id`, `visits.user_id`, …).
 * The numeric id lives only in memory, for the length of a session.
 */
export function profileToUser(p: Profile): User {
  return {
    id: numericIdForProfile(p.id),
    name: p.name,
    email: p.email,
    role: p.role as User['role'],
    avatarUrl: p.avatar_url ?? undefined,
    hoReCaId: p.horeca_id ?? undefined,
    homeWarehouseId: p.home_warehouse_id ?? undefined,
  };
}

/**
 * The single derivation of a profile's in-memory numeric id.
 *
 * Exported because `App.tsx` must build the numeric↔UUID registry
 * (`lib/userIdMap.ts`) with EXACTLY this function. When the two disagreed —
 * and they did, because the registry was built by matching the seeded roster
 * while the ids came from here — every profile outside that roster got a
 * numeric id with no registry entry, and `numericIdToUuid()` silently returned
 * the `00000000-0000-0000-0000-…` placeholder instead. That is invisible on a
 * seeded demo, where the six accounts that matter are all in the roster, and
 * total on a fresh client database, where none of them are: the Audit Log's
 * actor filter, walk-in review and the visit scheduler would all have been
 * looking up users that do not exist.
 *
 * Offset by 100 so a derived id can never collide with a legacy 1..6 reference
 * left in a fixture.
 */
export function numericIdForProfile(uuid: string): number {
  return 100 + (Math.abs(hashString(uuid)) % 10_000);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
