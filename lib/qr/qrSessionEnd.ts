// Ending a kitchen (QR Staff) session on THIS phone: sign out locally, then go
// back to the venue's PIN pad.
//
// Three things reach here and want exactly the same outcome:
//   - the client timer reaching `qr_staff.unlocked_until` (hooks/useQrSessionExpiry.ts)
//   - any QR call answered QR_SESSION_EXPIRED / UNAUTHORIZED (`QrApiError.sessionEnded`)
//   - the person pressing "Lock" in the profile menu
//
// The server is the control: at expiry `user_horeca_id()` already returns NULL and
// every venue query comes back empty whatever tokens the phone still holds. This
// only tidies the screen, so it is deliberately forgiving -- it never throws and
// it never waits on the network (`signOutQrLocally` is a local-scope sign-out).
//
// Navigation is a full document load (`location.replace`), not a router push, on
// purpose: a kitchen phone is shared, and the next person must not inherit the
// previous one's cart, query cache or half-typed notes. A reload is the only
// reset that cannot miss a piece of in-memory state.

import { signOutQrLocally } from '@/services/supabase/qrService'
import { readLastQrToken } from '@/lib/qr/qrLink'
import { qrReturnUrl } from '@/lib/qr/qrReturnUrl'

export { qrReturnUrl }

export interface QrSessionEndDeps {
  /** Drop the local session. Defaults to `signOutQrLocally`. */
  signOut?: () => Promise<void>
  /** Leave the page. Defaults to `window.location.replace`. */
  navigate?: (url: string) => void
  /** The venue token to return to. Defaults to the remembered one. */
  token?: string | null
}

function defaultNavigate(url: string): void {
  if (typeof window !== 'undefined') window.location.replace(url)
}

let inFlight: Promise<void> | null = null

/**
 * Sign this phone out of the kitchen session and return it to the PIN pad.
 * Idempotent while running: the timer, a failing request and a visibility event
 * can all fire in the same tick and must produce ONE sign-out and ONE navigation.
 */
export function handleQrSessionEnded(deps: QrSessionEndDeps = {}): Promise<void> {
  if (inFlight) return inFlight
  const signOut = deps.signOut ?? signOutQrLocally
  const navigate = deps.navigate ?? defaultNavigate
  const url = qrReturnUrl(deps.token === undefined ? readLastQrToken() : deps.token)

  const run = (async () => {
    try {
      await signOut()
    } catch {
      // signOutQrLocally never throws; an injected one might. The navigation
      // below must still happen -- a stuck kitchen screen is the worse outcome.
    }
    try {
      navigate(url)
    } catch {
      // Same reasoning: nothing left to do, and nothing worth throwing into a timer.
    }
  })()
  inFlight = run
  // Cleared only after it settles, so a second trigger in the same tick shares
  // this run; and compared by identity so a late clear cannot drop a newer one.
  void run.then(() => {
    if (inFlight === run) inFlight = null
  })
  return run
}

/** The "Lock" button: the same outcome as an expiry, chosen by the person. */
export const lockKitchen = handleQrSessionEnded
