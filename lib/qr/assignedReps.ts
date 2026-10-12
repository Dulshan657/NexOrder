// Which people can be assigned to a venue, and whether an assignment changed.
//
// Pure, so the picker and the HoReCa form agree on both without either owning
// the rule. `mutate-horeca` `set_reps` accepts only Field and Office Sales Reps
// and REFUSES anything else, so the picker must never offer a Customer, an Admin
// or a hidden QR Staff login -- filtering here is what keeps that from being a
// runtime error.

import { UserRole } from '@/types'

export interface RepCandidate {
  id: string
  name: string
  email: string
  role: string
}

/**
 * An unsaved change a form section will persist when the form is saved. The form
 * calls `save()` before it saves the rest, and keeps itself open (showing the
 * error) if it rejects. An object rather than a bare function so it can sit in
 * React state without being mistaken for an updater.
 */
export interface PendingSave {
  save: () => Promise<void>
}

const REP_ROLES: ReadonlySet<string> = new Set([UserRole.FIELD_REP, UserRole.OFFICE_REP])

/** Field and Office Sales Reps, A to Z by name (then email, so equal names stay stable). New array. */
export function repCandidates<T extends RepCandidate>(profiles: ReadonlyArray<T> | null | undefined): T[] {
  return (profiles ?? [])
    .filter((p) => REP_ROLES.has(p.role))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))
}

/** The same set of ids, whatever the order. */
export function sameIdSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return set.size === new Set(b).size && b.every((id) => set.has(id))
}

/** `ids` with `id` switched on or off. New array; never mutates. */
export function toggleId(ids: ReadonlyArray<string>, id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}
