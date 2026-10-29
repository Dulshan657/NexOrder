// When the Nex mark shimmers on its own. Pure, so it can be pinned by tests.
//
// A few times while the page is new, to be noticed; then never again until
// someone hovers or taps it, so it does not nag a rep on a scan screen all day.

/** Seconds after mount at which the idle shimmers play. */
const IDLE_SHIMMERS_SEC = [1.7, 8, 15, 22, 29] as const

/** No idle shimmer starts after this long. */
export const IDLE_WINDOW_MS = 30_000

/**
 * Milliseconds from now for each idle shimmer still to come, given how long ago the
 * page first showed a mark; none under reduced motion. Counting from the page's
 * first mark, not this mount, is what stops a remount (the launcher comes back
 * every time the sheet closes) from starting the whole show again.
 */
export function shimmerSchedule(reducedMotion: boolean, elapsedMs = 0): readonly number[] {
  if (reducedMotion) return []
  return IDLE_SHIMMERS_SEC.map((sec) => Math.round(sec * 1000))
    .filter((ms) => ms < IDLE_WINDOW_MS && ms >= elapsedMs)
    .map((ms) => ms - elapsedMs)
}
