// Which of the `qr_staff` rows a kitchen phone can read is its OWN unlock.
//
// The table is readable by column only, and `auth_user_id` -- the one column that
// says whose row is whose -- is deliberately not granted (mig 00129). What RLS
// does give a QR Staff login:
//
//   unlocked   every row of its venue (via `user_horeca_id()`), its own included
//   lapsed     only its OWN row (`auth_user_id = auth.uid()`) -- which is how the
//              phone learns it must show the PIN pad again
//   revoked    nothing: `listQrStaff` filters `revoked_at IS NULL`
//
// So the rows returned already carry the answer, and this picks it out:
//
//   0 rows     revoked (or nothing visible): the session is over
//   1 row      that row, whoever it is
//   2+ rows    only possible while UNLOCKED (siblings are invisible otherwise).
//              The login's profile name IS the staff name (mutate-qr-access sets
//              both and keeps them in step on rename), so match on it. Two staff
//              sharing a name leave it ambiguous; take the EARLIEST expiry among
//              the candidates. The worst a wrong guess does is lock the phone a
//              little early -- the database, not this, decides what is readable.

import { isUnlocked } from '@/lib/qr/qrEntryDecision'
import type { QrStaff } from '@/types'

type Unlockable = Pick<QrStaff, 'name' | 'unlockedUntil'>

function earliest(rows: readonly Unlockable[]): string | null {
  let best: string | null = null
  let bestMs = Infinity
  for (const r of rows) {
    const ms = r.unlockedUntil ? Date.parse(r.unlockedUntil) : NaN
    if (Number.isFinite(ms) && ms < bestMs) {
      best = r.unlockedUntil
      bestMs = ms
    }
  }
  return best
}

/**
 * The ISO `unlocked_until` of the caller's own row, or null when there is none /
 * it is unknown. `staffName` is the signed-in profile's name.
 */
export function ownUnlockedUntil(rows: readonly Unlockable[], staffName: string): string | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0].unlockedUntil ?? null

  const named = rows.filter((r) => r.name === staffName)
  if (named.length > 0) return earliest(named)

  // Several rows but none by this name (a rename the profile has not caught up
  // with). Being able to read siblings means the caller IS unlocked; use the
  // soonest FUTURE expiry among them rather than guess a row.
  const now = new Date()
  return earliest(rows.filter((r) => isUnlocked(r.unlockedUntil, now)))
}
