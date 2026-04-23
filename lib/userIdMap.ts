/**
 * Deterministic mapping between the mock numeric User.id (1..n) used by the
 * frontend and the UUID used by Supabase profiles.id / every FK that points
 * at it. Mirrors the mapping in supabase/seed.ts so seeded rows round-trip
 * correctly. Remove this helper when auth migration replaces mock users
 * with real Supabase auth UUIDs.
 */

const USER_UUID_PREFIX = '00000000-0000-0000-0000-'
const UUID_PATTERN = /^00000000-0000-0000-0000-(\d{12})$/

export function numericIdToUuid(id: number): string {
  return USER_UUID_PREFIX + String(id).padStart(12, '0')
}

export function uuidToNumericId(uuid: string | null | undefined): number {
  if (!uuid) return 0
  const m = UUID_PATTERN.exec(uuid)
  return m ? Number(m[1]) : 0
}
