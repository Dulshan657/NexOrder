// The client half of the kitchen's 2-hour unlock.
//
// The DATABASE ends the session: at `qr_staff.unlocked_until` the helper behind
// every own-venue policy returns NULL and the phone sees nothing, whatever tokens
// it still holds. This hook is the courtesy on top -- it notices the time, warns
// ten minutes ahead, and at expiry puts the PIN pad back instead of leaving a
// screen that quietly shows empty lists.
//
//   - Mounted once, in AppShell. Does nothing for any role but QR Staff, and
//     nothing at all on a build without the `shop` module.
//   - A timer is not trusted on its own: a phone that slept through the expiry
//     fires it late (or never), so becoming visible / focused re-checks the clock
//     and re-reads the time from the database.
//   - An unlock that vanished (revoked, PIN reset, code regenerated) is treated
//     exactly like an expired one.
//
// `handleQrSessionEnded` is re-exported from here because the other places that
// can discover the session is over -- a failed submit, a failed cancel -- are not
// in this hook's tree and need the identical response.

import { useEffect, useRef } from 'react'
import { MODULE_SHOP } from '@/lib/modules'
import { isQrStaffRole } from '@/lib/venueUser'
import { handleQrSessionEnded } from '@/lib/qr/qrSessionEnd'
import { formatClockTime } from '@/lib/qr/qrPinMessages'
import { useQrOwnUnlock } from '@/hooks/queries/useQrOwnUnlock'
import type { ToastType, User } from '@/types'

export { handleQrSessionEnded, lockKitchen } from '@/lib/qr/qrSessionEnd'

/** How long before the end the gentle heads-up appears. */
export const QR_EXPIRY_WARNING_MS = 10 * 60 * 1000

/** setTimeout stores its delay in a signed 32-bit int and fires at once past it. */
const MAX_TIMER_MS = 2_147_483_647

export interface UseQrSessionExpiryArgs {
  currentUser: Pick<User, 'role' | 'name' | 'hoReCaId'>
  /** The auth user id (profiles.id). */
  currentUserUuid: string
  addToast: (message: string, type: ToastType) => void
}

export interface QrSessionExpiry {
  /** ISO end of the unlock; null for anyone but QR Staff, or until it has loaded. */
  unlockedUntil: string | null
  /** The same as a Date, for display. */
  endsAt: Date | null
}

export function useQrSessionExpiry({ currentUser, currentUserUuid, addToast }: UseQrSessionExpiryArgs): QrSessionExpiry {
  const enabled = MODULE_SHOP && isQrStaffRole(currentUser.role) && currentUser.hoReCaId != null
  const query = useQrOwnUnlock({
    enabled,
    userId: currentUserUuid,
    horecaId: currentUser.hoReCaId,
    staffName: currentUser.name,
  })

  const unlockedUntil = enabled && query.isSuccess ? query.data : null

  // Latest values for the event handlers below, which must not re-subscribe on every render.
  const addToastRef = useRef(addToast)
  const unlockedUntilRef = useRef<string | null>(unlockedUntil)
  const refetchRef = useRef(query.refetch)
  useEffect(() => {
    addToastRef.current = addToast
    unlockedUntilRef.current = unlockedUntil
    refetchRef.current = query.refetch
  }, [addToast, unlockedUntil, query.refetch])
  // One heads-up per unlock, however many times the effect below re-runs.
  const warnedFor = useRef<string | null>(null)

  // The clock: end at the expiry, warn ahead of it.
  useEffect(() => {
    if (!enabled || !query.isSuccess) return

    // No usable unlock at all: revoked, reset or regenerated. Same as expired.
    if (query.data === null) {
      void handleQrSessionEnded()
      return
    }

    const endMs = Date.parse(query.data)
    // Unreadable: leave it to the server, which is the control either way.
    if (!Number.isFinite(endMs)) return

    const now = Date.now()
    if (endMs <= now) {
      void handleQrSessionEnded()
      return
    }

    const warn = () => {
      warnedFor.current = query.data
      const at = formatClockTime(new Date(endMs))
      addToastRef.current(`Kitchen session ends at ${at}. You will need your PIN again.`, 'info')
    }

    const endTimer = setTimeout(() => void handleQrSessionEnded(), Math.min(endMs - now, MAX_TIMER_MS))
    let warnTimer: ReturnType<typeof setTimeout> | undefined
    if (warnedFor.current !== query.data) {
      const untilWarn = endMs - QR_EXPIRY_WARNING_MS - now
      if (untilWarn <= 0) warn()
      else warnTimer = setTimeout(warn, Math.min(untilWarn, MAX_TIMER_MS))
    }

    return () => {
      clearTimeout(endTimer)
      if (warnTimer !== undefined) clearTimeout(warnTimer)
    }
  }, [enabled, query.isSuccess, query.data])

  // A phone that slept: on coming back, trust the clock first, then the database.
  useEffect(() => {
    if (!enabled) return
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const current = unlockedUntilRef.current
      const endMs = current ? Date.parse(current) : NaN
      if (Number.isFinite(endMs) && endMs <= Date.now()) {
        void handleQrSessionEnded()
        return
      }
      void refetchRef.current()
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [enabled])

  return {
    unlockedUntil,
    endsAt: unlockedUntil && Number.isFinite(Date.parse(unlockedUntil)) ? new Date(unlockedUntil) : null,
  }
}
