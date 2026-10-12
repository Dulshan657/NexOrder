// What the app should do when it is opened on a venue's `?qr=` URL.
//
// Pure: no React, no Supabase, no clock (the caller passes `now`). The entry
// screen reads the facts it has -- is there a session, whose is it, which venue
// does the token name, is a QR Staff unlock still live -- and this returns the one
// thing to do. Keeping the verdict out of the component is what makes the awkward
// cases testable: an expired kitchen phone, a Customer of a DIFFERENT venue, a rep
// who happens to be signed in on a shared tablet.
//
// ── THE FOUR ANSWERS ────────────────────────────────────────────────────────
//
//   'enter'              skip the PIN pad and go to the kitchen screen. A Customer
//                        login of THIS venue, or a QR Staff login of this venue
//                        whose unlock is still in the future.
//
//   'pin'                show the PIN pad. There is no session.
//
//   'pin_after_signout'  show the PIN pad, but FIRST sign the current session out
//                        locally. It is a QR Staff session that can no longer be
//                        used here: its unlock lapsed (the database already treats
//                        it as nobody -- see `user_horeca_id()`), or it belongs to
//                        another venue. Leaving it in place would make `verifyOtp`
//                        for the new PIN fight a stale session. The caller signs
//                        out with `scope: 'local'`: the server-side sessions are
//                        already gone or inert.
//
//   'other_user'         somebody else is signed in -- a rep, an admin, a Customer
//                        of another venue, a Warehouse login. NEVER sign them out
//                        silently: show "Signed in as X -- continue / use kitchen
//                        PIN" and let them choose.
//
// The server remains the control. This only chooses a screen; a wrong 'enter'
// shows a landing page whose every query RLS then answers with nothing.

import { UserRole } from '@/types'

export type QrEntryDecision = 'enter' | 'pin' | 'pin_after_signout' | 'other_user'

export interface QrEntryInput {
  /** Is anybody signed in on this browser? */
  session: boolean
  /** profiles.role of that session (a `UserRole` value). Ignored when `session` is false. */
  role?: string | null
  /** profiles.horeca_id of that session. */
  profileHorecaId?: number | null
  /** The venue the token in the URL names (`qr-unlock` `resolve` -> `horecaId`). */
  tokenHorecaId: number
  /** ISO timestamp from qr_staff.unlocked_until / the unlock response's `expiresAt`. QR Staff only. */
  qrUnlockedUntil?: string | null
  now: Date
}

/** True when `iso` parses and is strictly after `now`. Anything unreadable is "not unlocked". */
export function isUnlocked(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t > now.getTime()
}

export function decideQrEntry(input: QrEntryInput): QrEntryDecision {
  if (!input.session) return 'pin'

  const sameVenue = input.profileHorecaId != null && input.profileHorecaId === input.tokenHorecaId

  if (input.role === UserRole.CUSTOMER) {
    return sameVenue ? 'enter' : 'other_user'
  }

  if (input.role === UserRole.QR_STAFF) {
    return sameVenue && isUnlocked(input.qrUnlockedUntil, input.now) ? 'enter' : 'pin_after_signout'
  }

  return 'other_user'
}
