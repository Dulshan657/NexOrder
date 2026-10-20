// Whether the transcript should follow new lines: only if the reader was already
// at (or within a hair of) the bottom. Someone scrolled up to re-read an earlier
// answer must not be yanked down by every word of the next one.

/** How close to the bottom still counts as "at the bottom", in CSS px. */
export const STICK_THRESHOLD_PX = 48

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold: number = STICK_THRESHOLD_PX): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
