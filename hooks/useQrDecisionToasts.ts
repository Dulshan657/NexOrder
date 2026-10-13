// Tells a kitchen phone, as it happens, that an approver decided on its order.
//
// A cook leaves the phone on Order home and goes back to work; when the approver
// approves or declines, the phone says so ("Your order was approved" / "Your order
// was not approved -- <reason>") instead of waiting to be looked at.
//
// It watches the notifications the shell ALREADY loads (App.tsx useNotifications,
// refreshed by the realtime channel) -- no new query, no new subscription -- and
// toasts each NEW `qr_order_approved` / `qr_order_rejected` once. It never marks
// anything read: the bell still shows it, and the bell's own tap does that.
//
// What "new" means is the careful part:
//   - Anything already in the list when watching BEGINS is baseline, never toasted.
//     A person who reopens the app after a week must not get a burst of old news.
//   - The list is the empty default until its query lands. `ready` is false then, so
//     the baseline is taken from the real list, not from "nothing" (which would make
//     every historical decision look new the moment it loaded).
//   - The baseline is taken once. A refresh that fails and later recovers does not
//     reset it, so a decision made in between is still announced.
//
// Mounted once, in AppShell, for kitchen staff on a build with the Shop. Does
// nothing when `enabled` is false.

import { useEffect, useRef } from 'react'
import { decisionToastFor, isQrDecision, newDecisionNotifications } from '@/lib/qr/decisionToasts'
import type { AppNotification, ToastType } from '@/types'

export interface UseQrDecisionToastsArgs {
  /** True for QR Staff on a build with the Shop; false does nothing at all. */
  enabled: boolean
  /** The notifications the shell already has, for this user. */
  notifications: readonly AppNotification[]
  /** False while that list is still loading (or has never loaded). Defaults to true. */
  ready?: boolean
  addToast: (message: string, type: ToastType) => void
}

export function useQrDecisionToasts({ enabled, notifications, ready = true, addToast }: UseQrDecisionToastsArgs): void {
  // null = no baseline yet. Replaced, never mutated.
  const seen = useRef<ReadonlySet<string> | null>(null)

  // Declared before the watcher so a render that changes both uses the latest addToast.
  const addToastRef = useRef(addToast)
  useEffect(() => {
    addToastRef.current = addToast
  }, [addToast])

  useEffect(() => {
    if (!enabled || !ready) return

    if (seen.current === null) {
      seen.current = new Set(notifications.filter(isQrDecision).map((n) => n.id))
      return
    }

    const fresh = newDecisionNotifications(notifications, seen.current)
    if (fresh.length === 0) return

    seen.current = new Set([...seen.current, ...fresh.map((n) => n.id)])
    for (const n of fresh) {
      const toast = decisionToastFor(n)
      addToastRef.current(toast.message, toast.type)
    }
  }, [enabled, ready, notifications])
}
