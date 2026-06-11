import type { User } from '../types';
import { USERS } from '../constants';
import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

/**
 * Bridge from a real Supabase auth profile (UUID id) to the numeric-id User
 * shape the frontend uses everywhere for keying, comparisons, and filters.
 *
 * Seeded users (USERS in constants.ts) are matched by email so their
 * numeric ids stay stable across the auth migration. Any profile without
 * a seeded counterpart gets a stable hash-derived id >= 100 to avoid
 * colliding with seeded 1..6. Remove when User.id becomes a UUID string.
 */
export function profileToUser(p: Profile): User {
  const seeded = USERS.find(u => u.email.toLowerCase() === p.email.toLowerCase());
  const id = seeded?.id ?? (100 + Math.abs(hashString(p.id)) % 10_000);
  return {
    id,
    name: p.name,
    email: p.email,
    role: p.role as User['role'],
    avatarUrl: p.avatar_url ?? undefined,
    hoReCaId: p.horeca_id ?? undefined,
    homeWarehouseId: p.home_warehouse_id ?? undefined,
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
