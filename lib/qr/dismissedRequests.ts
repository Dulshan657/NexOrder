// Which "Not approved" cards a person has put away.
//
// Per user: a kitchen phone is often shared by whoever is on shift, and one cook
// dismissing a card must not hide it from the next. Two places hold the list:
//
//   localStorage    survives a reload. It is a CONVENIENCE -- it can be missing, blocked
//                   (private window, webview), full, or corrupt -- so every access is
//                   guarded and nothing here ever throws.
//   module memory   survives navigation within the visit, and is shared by every
//                   component that asks, because it lives here and not in React state.
//                   Without it, with storage blocked, a card dismissed on Order home came
//                   back on return from another screen, and resending from Order history
//                   could not clear the home card at all.
//
// Every write goes to both. A read joins them, so a dismissal held by either counts.
//
// Only the card on Order home reads this. Order history is the record and shows
// everything regardless.

/** The most ids remembered. A dismissed card is also hidden by age after a week, so old ids are dead weight. */
export const MAX_DISMISSED = 100

const KEY_PREFIX = 'nexorder.qr.dismissedNotApproved.'

export function dismissedKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

/** userId -> dismissed ids, for this page load. Entries are replaced, never edited in place. */
const memory = new Map<string, readonly string[]>()

/** Forget everything held in memory (tests; a future sign-out). Does not touch localStorage. */
export function clearDismissedMemory(): void {
  memory.clear()
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' || localStorage === null ? null : localStorage
  } catch {
    return null
  }
}

function readStored(userId: string): string[] {
  try {
    const raw = storage()?.getItem(dismissedKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** The request ids this user has dismissed. Empty for no user, or when nothing was. A fresh array each call. */
export function readDismissed(userId: string | null | undefined): string[] {
  if (!userId) return []
  return [...new Set([...readStored(userId), ...(memory.get(userId) ?? [])])]
}

/** Remember `ids` for this user: in memory always, and in localStorage if the browser allows. */
export function writeDismissed(userId: string | null | undefined, ids: readonly string[]): void {
  if (!userId) return
  memory.set(userId, [...ids])
  try {
    storage()?.setItem(dismissedKey(userId), JSON.stringify(ids))
  } catch {
    // Blocked or full: the in-memory copy above still carries it for this visit.
  }
}

/** A new list with `id` added (once), keeping only the newest MAX_DISMISSED. */
export function withDismissed(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return [...current]
  return [...current, id].slice(-MAX_DISMISSED)
}
