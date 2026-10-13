// The "Not approved" cards a person has put away, as React state backed by
// localStorage (lib/qr/dismissedRequests.ts). Shared by the Order home card and
// Order history's "Edit and resend", so resending from either clears the card.
//
// State is the source of truth for the visit; storage is only how it survives a
// reload, and may be unavailable -- a dismissal then lasts until the page does.

import { useCallback, useEffect, useRef, useState } from 'react'
import { readDismissed, withDismissed, writeDismissed } from '@/lib/qr/dismissedRequests'

export function useDismissedQrRequests(userId: string | null | undefined): {
  dismissed: readonly string[]
  dismiss: (requestId: string) => void
} {
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId))

  // A different login on the same screen reads its own list rather than inheriting this one.
  const owner = useRef(userId)
  useEffect(() => {
    if (owner.current === userId) return
    owner.current = userId
    setDismissed(readDismissed(userId))
  }, [userId])

  const dismiss = useCallback(
    (requestId: string) => {
      const next = withDismissed(dismissed, requestId)
      setDismissed(next)
      writeDismissed(userId, next)
    },
    [dismissed, userId],
  )

  return { dismissed, dismiss }
}
