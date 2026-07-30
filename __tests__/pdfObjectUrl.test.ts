import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { fetchPdfObjectUrl } from '../lib/pdfObjectUrl'

// Runs under the `node` vitest project (vitest.config.ts), where Blob exists
// but URL.createObjectURL does not — stub it and capture the Blob it is handed
// so the pinned MIME type can be asserted directly.
let created: Blob[] = []

function stubFetch(res: Partial<Response> & { ok: boolean }) {
  vi.stubGlobal('fetch', vi.fn(async () => res as Response))
}

beforeEach(() => {
  created = []
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      created.push(blob)
      return `blob:mock/${created.length}`
    },
    revokeObjectURL: () => {},
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchPdfObjectUrl', () => {
  it('returns a blob: URL for the fetched bytes', async () => {
    stubFetch({ ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer })
    const url = await fetchPdfObjectUrl('https://example.test/signed.pdf')
    expect(url).toBe('blob:mock/1')
    expect(created).toHaveLength(1)
  })

  it('passes the body bytes through unchanged', async () => {
    const body = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
    stubFetch({ ok: true, arrayBuffer: async () => body.buffer })
    await fetchPdfObjectUrl('https://example.test/signed.pdf')
    expect(new Uint8Array(await created[0].arrayBuffer())).toEqual(body)
  })

  // THE security property. An attachment arrives from inbound email and is
  // framed same-origin without a sandbox; if its type came from the response,
  // a text/html "PDF" would execute as the app.
  it('pins the blob type to application/pdf even when the server says text/html', async () => {
    stubFetch({
      ok: true,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      arrayBuffer: async () => new TextEncoder().encode('<script>alert(1)</script>').buffer,
    })
    await fetchPdfObjectUrl('https://example.test/evil.pdf')
    expect(created[0].type).toBe('application/pdf')
  })

  it('throws with the status on a non-OK response', async () => {
    stubFetch({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) })
    await expect(fetchPdfObjectUrl('https://example.test/gone.pdf')).rejects.toThrow('403')
    expect(created).toHaveLength(0)
  })

  it('rejects on abort without creating an object URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }),
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchPdfObjectUrl('https://example.test/slow.pdf', controller.signal),
    ).rejects.toThrow(/abort/i)
    expect(created).toHaveLength(0)
  })

  it('forwards the abort signal to fetch', async () => {
    const spy = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }))
    vi.stubGlobal('fetch', spy)
    const controller = new AbortController()
    await fetchPdfObjectUrl('https://example.test/signed.pdf', controller.signal)
    expect(spy).toHaveBeenCalledWith('https://example.test/signed.pdf', {
      signal: controller.signal,
    })
  })
})
