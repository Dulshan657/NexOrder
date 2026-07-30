// Turning a short-lived signed document URL into something an <iframe> will
// actually render.
//
// Two constraints meet here, and the resolution is not obvious from either:
//
//   1. Chrome refuses to instantiate its built-in PDF viewer inside a
//      SANDBOXED iframe — no combination of sandbox tokens helps, and the user
//      gets Chrome's own "This page has been blocked by Chrome" interstitial.
//      So the frame that shows a PDF cannot be sandboxed.
//
//   2. Dropping the sandbox means the framed document is a same-origin
//      `blob:` URL, and a blob whose type is `text/html` executes AS THE APP.
//      For PO Inbox attachments — which arrive from inbound email and are
//      attacker-controlled — that would be stored XSS holding the operator's
//      session.
//
// The type is therefore PINNED here rather than inherited from the response.
// Chrome's PDFium viewer then always handles the document, and PDFium does not
// execute PDF-embedded scripts by default. That pinning is what replaces the
// sandbox as the safety property — it is the load-bearing line in this file.
//
// Callers own the returned URL and must `URL.revokeObjectURL` it.

/** Never read from the response. See the note above — this is a security control. */
const PDF_MIME = 'application/pdf'

/**
 * Fetch a signed document URL and return a same-origin `blob:` URL for it,
 * typed as a PDF regardless of what the server claimed.
 *
 * @param url    a signed URL; short-lived, so the blob also outlives its expiry
 * @param signal optional abort signal — the caller's cancellation path
 */
export async function fetchPdfObjectUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Couldn't load document (${res.status})`)
  const bytes = await res.arrayBuffer()
  return URL.createObjectURL(new Blob([bytes], { type: PDF_MIME }))
}
