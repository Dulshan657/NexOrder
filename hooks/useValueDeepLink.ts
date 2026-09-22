// Consume a one-shot deep-link param that CARRIES A VALUE, exactly once, then
// strip it.
//
// The twin of `useFlagDeepLink`, and it exists as a separate hook rather than a
// reader bolted onto that one for a specific reason: `useFlagDeepLink` deletes
// the param inside its own effect, so anything reading the value alongside it
// is racing the deletion, and which of the two effects runs first depends on
// component order. That is precisely the cross-fire its header warns about.
//
// STRIPPING IS STILL THE WHOLE POINT. Admin tabs unmount on switch, so a param
// left behind re-fires on every later visit to that tab — a "count this bin"
// link would drag the operator back to the same bin every time they opened
// Stocktake for the rest of the session.

import { useEffect, useRef } from 'react'

/**
 * Hand `onValue` the value of `param` once, if it is present and non-empty,
 * then delete it from the URL.
 *
 * `enabled` gates the read for callers that must wait for data — the effect
 * simply does not consume the param until it flips true. A caller that needs to
 * match the value against a loaded list should gate on that list, or it will
 * consume the param before it can do anything with it.
 */
export function useValueDeepLink(
  param: string,
  onValue: (value: string) => void,
  enabled = true,
): void {
  const consumed = useRef(false)
  // Kept in a ref so a caller passing an inline arrow doesn't re-run the effect.
  const handler = useRef(onValue)
  handler.current = onValue

  useEffect(() => {
    if (consumed.current || !enabled) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const raw = params.get(param)
    if (!raw) return

    consumed.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState({}, '', url.toString())
    handler.current(raw)
  }, [param, enabled])
}
