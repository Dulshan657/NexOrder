// openPoster -- getting a poster in front of the person who asked for it.
//
// Named .test.tsx only to run under jsdom (it needs `document` and `URL`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { discardPendingWindow, openPendingWindow, showPoster } from '@/lib/qr/openPoster'

const blob = new Blob(['%PDF-1.4'], { type: 'application/octet-stream' })

beforeEach(() => {
  vi.useFakeTimers()
  URL.createObjectURL = vi.fn(() => 'blob:poster')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('openPendingWindow', () => {
  it('opens a blank tab', () => {
    const fake = { document: { title: '', body: { textContent: '' } }, closed: false }
    const open = vi.spyOn(window, 'open').mockReturnValue(fake as unknown as Window)

    expect(openPendingWindow()).toBe(fake)
    expect(open).toHaveBeenCalledWith('', '_blank')
  })

  it('returns null when the browser refuses, and never throws', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openPendingWindow()).toBeNull()

    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(openPendingWindow()).toBeNull()
  })
})

describe('showPoster', () => {
  it('points the waiting tab at the PDF, typed as a PDF whatever the response said', () => {
    const win = { closed: false, location: { href: '' } }

    expect(showPoster(blob, 'qr-cafe-a4.pdf', win as unknown as Window)).toBe('opened')

    expect(win.location.href).toBe('blob:poster')
    const made = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    expect(made.type).toBe('application/pdf')
  })

  it('revokes the object URL later, not while the tab may still be reading it', () => {
    const win = { closed: false, location: { href: '' } }
    showPoster(blob, 'x.pdf', win as unknown as Window)

    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster')
  })

  it('saves a file instead when the tab was refused', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    expect(showPoster(blob, 'qr-cafe-sticker.pdf', null)).toBe('downloaded')

    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull() // cleaned up
  })

  it('saves a file when the person closed the tab while it rendered', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const win = { closed: true, location: { href: '' } }

    expect(showPoster(blob, 'x.pdf', win as unknown as Window)).toBe('downloaded')

    expect(win.location.href).toBe('')
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('discardPendingWindow', () => {
  it('closes an open placeholder, ignores a closed or missing one, and never throws', () => {
    const close = vi.fn()
    discardPendingWindow({ closed: false, close } as unknown as Window)
    expect(close).toHaveBeenCalledTimes(1)

    discardPendingWindow({ closed: true, close } as unknown as Window)
    discardPendingWindow(null)
    expect(close).toHaveBeenCalledTimes(1)

    expect(() =>
      discardPendingWindow({
        closed: false,
        close: () => {
          throw new Error('gone')
        },
      } as unknown as Window),
    ).not.toThrow()
  })
})
