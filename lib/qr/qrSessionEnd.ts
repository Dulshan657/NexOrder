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
// only tidies the screen, so it is deliberately forgiving -- it never throws, and
// the one network call it makes (below) is capped at a couple of seconds.
//
// Before signing out it asks the server to end this login's unlock and sessions
// (`lockQrSelf`, mutate-qr-access `lock_self`), so "Lock" means the SERVER stops
// honouring this session too, not just that this phone forgot it. That call is
// best effort in every way: its failure is ignored (a session that already lapsed
// is refused, which is fine -- the database shut it), and it gets
// `SERVER_LOCK_BUDGET_MS` at most, because a kitchen screen stuck waiting on a bad
// network is the worse outcome.
//
// Navigation is a full document load (`location.replace`), not a router push, on
// purpose: a kitchen phone is shared, and the next person must not inherit the
// previous one's cart, query cache or half-typed notes. A reload is the only
// reset that cannot miss a piece of in-memory state.

import { lockQrSelf, signOutQrLocally } from '@/services/supabase/qrService'
import { readLastQrToken } from '@/lib/qr/qrLink'
import { qrReturnUrl } from '@/lib/qr/qrReturnUrl'

export { qrReturnUrl }

/** The longest the screen waits for the server to acknowledge the lock. */
export const SERVER_LOCK_BUDGET_MS = 2_500

export interface QrSessionEndDeps {
  /** End the unlock on the SERVER (best effort, before `signOut`). Defaults to `lockQrSelf`. */
  lockServer?: () => Promise<void>
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

/**
 * Ask the server to lock this login, waiting no longer than the budget and
 * swallowing every failure (a rejection, a synchronous throw, a timeout).
 */
async function lockServerQuietly(lock: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve()
        .then(lock)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SERVER_LOCK_BUDGET_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

let inFlight: Promise<void> | null = null

/**
 * Sign this phone out of the kitchen session and return it to the PIN pad.
 * Idempotent while running: the timer, a failing request and a visibility event
 * can all fire in the same tick and must produce ONE sign-out and ONE navigation.
 */
export function handleQrSessionEnded(deps: QrSessionEndDeps = {}): Promise<void> {
  if (inFlight) return inFlight
  const lockServer = deps.lockServer ?? lockQrSelf
  const signOut = deps.signOut ?? signOutQrLocally
  const navigate = deps.navigate ?? defaultNavigate
  const url = qrReturnUrl(deps.token === undefined ? readLastQrToken() : deps.token)

  const run = (async () => {
    // First: once the local session is gone there is no token to ask with.
    await lockServerQuietly(lockServer)
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
