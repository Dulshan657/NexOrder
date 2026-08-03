// Consume a one-shot boolean deep-link param exactly once, then strip it.
//
// The setup checklist links to surfaces that are plain local modal state
// (`?stockimport=1`, `?prodimport=1`, `?whrules=1`). The pattern is always the
// same: read on mount, fire, remove from the URL.
//
// STRIPPING IS THE WHOLE POINT. Admin tabs unmount on switch, so a param left
// behind re-fires the modal on every later visit to that tab. And the param
// namespace here is flat and already crowded — `?import=` means *floor-plan
// import* globally, `?subtab=` is shared between PO Inbox and Settings — so a
// stale flag does not merely repeat, it cross-fires into a different tab.

import { useEffect, useRef } from 'react'

/**
 * Fire `onFire` once if `param` is present and truthy, then delete it.
 *
 * `enabled` gates the read for callers that must wait for data (the effect
 * simply does not consume the param until it flips true). Leave it at the
 * default for flags with no data dependency.
 */
export function useFlagDeepLink(param: string, onFire: () => void, enabled = true): void {
  const consumed = useRef(false)
  // Kept in a ref so a caller passing an inline arrow doesn't re-run the effect.
  const handler = useRef(onFire)
  handler.current = onFire

  useEffect(() => {
    if (consumed.current || !enabled) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (!params.get(param)) return

    consumed.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState({}, '', url.toString())
    handler.current()
  }, [param, enabled])
}
