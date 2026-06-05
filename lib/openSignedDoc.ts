/**
 * Download a signed document as a file. Unlike a tab open, this fetches the URL
 * into a Blob and clicks a temporary `<a download>` — so it works after `await`
 * (no popup-blocker dependency), produces a real file with a chosen name, and
 * leaves no blank tab. The Storage signed URL is CORS-open and serves the PDF
 * with attachment disposition, so the fetch succeeds cross-origin.
 *
 * @param resolver  Returns the signed URL.
 * @param filename  Suggested download filename (e.g. "ORD-123-pick_slip.pdf").
 */
export async function downloadSignedDoc(
  resolver: () => Promise<string>,
  filename: string,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<void> {
  try {
    const url = await resolver()
    const res = await fetch(`${url}&download=`)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch (err) {
    opts.onError?.(err)
  }
}
