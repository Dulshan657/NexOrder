/**
 * Bridge between the mock numeric User.id (1..n) the frontend uses and the
 * real Supabase auth UUID stored in profiles.id.
 *
 * The seed script in supabase/seed.ts creates auth users first and writes the
 * auth-generated UUID into profiles.id; the deterministic mapUserId() there
 * is only used as a fallback when auth user creation returns no UUID. That
 * means production profiles.id values are real auth UUIDs, NOT
 * 00000000-0000-0000-0000-00000000000X.
 *
 * App.tsx loads profiles at boot and calls setUserIdMap() to populate this
 * registry so the adapters can round-trip between numeric IDs and real
 * UUIDs. The pad-with-zeros UUID is kept only as a dev fallback for
 * environments where profiles haven't been seeded yet.
 *
 * Remove this helper when auth migration replaces mock numeric IDs with
 * real Supabase auth UUIDs throughout the app.
 */

const FALLBACK_UUID_PREFIX = '00000000-0000-0000-0000-'
const FALLBACK_UUID_PATTERN = /^00000000-0000-0000-0000-(\d{12})$/

let numericToUuid: Map<number, string> = new Map()
let uuidToNumeric: Map<string, number> = new Map()

export function setUserIdMap(entries: ReadonlyArray<readonly [number, string]>): void {
  numericToUuid = new Map(entries)
  uuidToNumeric = new Map(entries.map(([n, u]) => [u, n]))
}

export function numericIdToUuid(id: number): string {
  const real = numericToUuid.get(id)
  if (real) return real
  return FALLBACK_UUID_PREFIX + String(id).padStart(12, '0')
}

export function uuidToNumericId(uuid: string | null | undefined): number {
  if (!uuid) return 0
  const real = uuidToNumeric.get(uuid)
  if (real !== undefined) return real
  const m = FALLBACK_UUID_PATTERN.exec(uuid)
  return m ? Number(m[1]) : 0
}
