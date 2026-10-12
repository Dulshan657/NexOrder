// Which profiles count as PEOPLE who work with the system.
//
// Every kitchen staff member behind a venue QR is a real auth user with a real
// `profiles` row (role 'QR Staff', mig 00129), minted and retired by
// `mutate-qr-access` -- not invited, not editable, and with an email ending
// `.invalid`. They have to stay in the profile lookups that resolve an order's
// "submitted by" and an audit row's actor, but they must never appear in a list
// of users somebody manages or picks from.
//
// So the full list stays the lookup table, and this is the filter for the lists
// that show people. Today that is the Users admin screen; any new picker over
// `users` should go through here too.

import { UserRole } from '../types'

export function isDirectoryUser(user: { role: UserRole | string }): boolean {
  return user.role !== UserRole.QR_STAFF
}

/** `users` without the hidden QR Staff logins. Returns a new array. */
export function directoryUsers<T extends { role: UserRole | string }>(users: readonly T[]): T[] {
  return users.filter(isDirectoryUser)
}
