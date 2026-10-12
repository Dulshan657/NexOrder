// Getting a generated poster in front of the person who asked for it.
//
// The PDF only exists after an `await` (the Edge Function renders it on demand),
// and a browser blocks `window.open` once a click handler has awaited anything --
// the click's permission to open a tab is spent by then. So the tab is opened
// BLANK, synchronously, inside the click, and pointed at the PDF when it arrives:
// `openPendingWindow()` before the call, `showPoster()` after, `discardPendingWindow()`
// if the call fails. If the browser refused even the blank tab, or the person
// closed it while waiting, the poster is saved as a file instead -- they asked for
// it, so something must arrive.
//
// The blob's type is PINNED to application/pdf, not taken from the response, for
// the reason lib/pdfObjectUrl.ts gives: a same-origin blob typed text/html would
// run as the app.

const PDF_MIME = 'application/pdf'
/** The tab is still reading the blob after navigation starts; revoke well after. */
const REVOKE_AFTER_MS = 60_000
const REVOKE_DOWNLOAD_AFTER_MS = 5_000

/** Call SYNCHRONOUSLY from the click handler, before any await. Null if the browser refused. */
export function openPendingWindow(message = 'Preparing your poster...'): Window | null {
  try {
    const win = window.open('', '_blank')
    if (!win) return null
    try {
      win.document.title = 'QR poster'
      win.document.body.textContent = message
    } catch {
      // A browser that will not let us write to the blank tab still navigates it later.
    }
    return win
  } catch {
    return null
  }
}

/** Close the placeholder tab after a failure, so a blank tab is not left behind. */
export function discardPendingWindow(win: Window | null): void {
  try {
    if (win && !win.closed) win.close()
  } catch {
    // Already gone.
  }
}

export type PosterDelivery = 'opened' | 'downloaded'

/**
 * Show the PDF in the placeholder tab, or save it as `fileName` when there is no
 * usable tab. Never throws on a refused popup; the object URL is revoked later.
 */
export function showPoster(blob: Blob, fileName: string, win: Window | null): PosterDelivery {
  const url = URL.createObjectURL(new Blob([blob], { type: PDF_MIME }))

  if (win && !win.closed) {
    win.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    return 'opened'
  }

  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DOWNLOAD_AFTER_MS)
  return 'downloaded'
}
