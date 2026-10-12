// One-shot "this page load came from a venue's QR" marker, handed from the entry
// screen to the app shell.
//
// QrEntryScreen strips `?qr=` from the address bar as soon as it lets the user in,
// so by the time AppShell mounts nothing in the URL says the visit came from a
// sticker. A signed-in Customer who scanned should land on the Kitchen screen
// rather than the Shop; this flag is how AppShell knows. It lives in
// sessionStorage: it describes THIS tab's visit, and must not leak into the next
// time the browser is opened.
//
// Reading is split into `peek` and `clear` because React StrictMode runs state
// initialisers twice in development -- a read-and-clear initialiser would return
// true to the first call and false to the second, and which one React keeps is an
// implementation detail. Peek in the initialiser, clear in an effect.
//
// Every storage access is wrapped: blocked site data must degrade to "no flag",
// never to a thrown render.

export const QR_ENTRY_FLAG_KEY = 'nexorder.qr.entry'

/** The slice of `Storage` used here, so tests can pass a fake. */
export type QrEntryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): QrEntryStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    // Merely touching sessionStorage can throw (blocked site data).
    return null
  }
}

/** Remember that this visit came through a venue QR. Silently does nothing if storage is unavailable. */
export function markQrEntry(storage: QrEntryStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(QR_ENTRY_FLAG_KEY, '1')
  } catch {
    // Quota / private mode: the visit just lands on the usual screen.
  }
}

/** Did this visit come through a venue QR? Does not clear the flag. */
export function peekQrEntry(storage: QrEntryStorage | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(QR_ENTRY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** Forget the marker once the shell has acted on it. */
export function clearQrEntry(storage: QrEntryStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(QR_ENTRY_FLAG_KEY)
  } catch {
    // Nothing useful to do.
  }
}
