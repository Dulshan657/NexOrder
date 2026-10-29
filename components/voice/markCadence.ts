// When the Nex mark shimmers on its own. Pure, so it can be pinned by tests.
//
// A few times while the page is new, to be noticed; then never again until
// someone hovers or taps it, so it does not nag a rep on a scan screen all day.

/** Seconds after mount at which the idle shimmers play. */
const IDLE_SHIMMERS_SEC = [1.7, 8, 15, 22, 29] as const

/** No idle shimmer starts after this long. */
export const IDLE_WINDOW_MS = 30_000

/** Milliseconds after mount for each idle shimmer; none under reduced motion. */
export function shimmerSchedule(reducedMotion: boolean): readonly number[] {
  if (reducedMotion) return []
  return IDLE_SHIMMERS_SEC.map((sec) => Math.round(sec * 1000)).filter((ms) => ms < IDLE_WINDOW_MS)
}
