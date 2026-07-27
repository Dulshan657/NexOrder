import { describe, it, expect } from 'vitest'
import {
  A4_HEIGHT,
  A4_WIDTH,
  fitFontSize,
  fitText,
  labelArtwork,
  labelsPerPage,
  layoutLabels,
  sheetSpec,
  MIN_CODE_FONT_SIZE,
} from '@/supabase/functions/_shared/labelSheet'

const spec = sheetSpec('a4-24')

describe('sheetSpec', () => {
  it('is A4', () => {
    expect(spec.pageWidth).toBe(A4_WIDTH)
    expect(spec.pageHeight).toBe(A4_HEIGHT)
  })

  it('reports 24 labels per page for the default preset', () => {
    expect(labelsPerPage(spec)).toBe(24)
  })
})

describe('layoutLabels', () => {
  it('returns nothing for a zero-length run', () => {
    expect(layoutLabels(0, spec)).toEqual([])
  })

  it('fits a full page onto one page', () => {
    const pages = layoutLabels(24, spec)
    expect(pages).toHaveLength(1)
    expect(pages[0].cells).toHaveLength(24)
  })

  it('spills onto a second page at 25', () => {
    const pages = layoutLabels(25, spec)
    expect(pages).toHaveLength(2)
    expect(pages[0].cells).toHaveLength(24)
    expect(pages[1].cells).toHaveLength(1)
  })

  it('numbers cells continuously across pages', () => {
    const pages = layoutLabels(30, spec)
    expect(pages[0].cells[0].index).toBe(0)
    expect(pages[1].cells[0].index).toBe(24)
  })

  it('lays out left-to-right then top-to-bottom', () => {
    const [page] = layoutLabels(4, spec)
    const [a, b, c] = page.cells
    // Second cell is to the RIGHT of the first, at the same height.
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeCloseTo(a.y, 5)
    // Fourth cell wraps to the next row down — and PDF y grows upward, so the
    // next row DOWN has a SMALLER y. Getting this backwards prints the sheet
    // upside down relative to how it is peeled.
    expect(page.cells[3].x).toBeCloseTo(a.x, 5)
    expect(page.cells[3].y).toBeLessThan(c.y)
  })

  it('keeps every cell inside the page', () => {
    const [page] = layoutLabels(24, spec)
    for (const cell of page.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.y).toBeGreaterThanOrEqual(0)
      expect(cell.x + cell.width).toBeLessThanOrEqual(A4_WIDTH + 0.001)
      expect(cell.y + cell.height).toBeLessThanOrEqual(A4_HEIGHT + 0.001)
    }
  })

  it('honours startOffset on the first page only', () => {
    // Reusing a part-used sticker sheet: skip 3, print 24. The first page holds
    // 21 and the remainder rolls to page 2 starting at slot 0.
    const pages = layoutLabels(24, spec, 3)
    expect(pages).toHaveLength(2)
    expect(pages[0].cells).toHaveLength(21)
    expect(pages[1].cells).toHaveLength(3)
    // The skipped run means page 1's first printed cell is the 4th slot, i.e.
    // the second row's first column is NOT where it starts.
    const firstPrinted = pages[0].cells[0]
    const unskipped = layoutLabels(24, spec)[0].cells[3]
    expect(firstPrinted.x).toBeCloseTo(unskipped.x, 5)
    expect(firstPrinted.y).toBeCloseTo(unskipped.y, 5)
  })

  it('clamps an absurd startOffset rather than producing an empty page', () => {
    const pages = layoutLabels(2, spec, 999)
    expect(pages[0].cells.length).toBeGreaterThan(0)
  })

  it('rejects a spec whose margins exceed the page', () => {
    expect(() => layoutLabels(1, { ...spec, marginX: 400 })).toThrow(/exceed the page/)
  })

  it('rejects a spec with no columns', () => {
    expect(() => layoutLabels(1, { ...spec, columns: 0 })).toThrow(/positive/)
  })
})

describe('labelArtwork', () => {
  const [page] = layoutLabels(1, spec)
  const cell = page.cells[0]

  it('puts a square QR inside the cell', () => {
    const art = labelArtwork(cell)
    expect(art.qr.size).toBeGreaterThan(0)
    expect(art.qr.size).toBeLessThanOrEqual(cell.inner.height + 0.001)
    expect(art.qr.x).toBeGreaterThanOrEqual(cell.inner.x)
    expect(art.qr.y).toBeGreaterThanOrEqual(cell.inner.y - 0.001)
  })

  it('stacks the code below the QR, sharing its centre', () => {
    const art = labelArtwork(cell)
    // Top of the code's glyphs clears the bottom of the QR.
    expect(art.code.y + art.code.fontSize).toBeLessThanOrEqual(art.qr.y + 0.001)
    expect(art.code.centerX).toBeCloseTo(art.qr.x + art.qr.size / 2, 6)
    expect(art.context!.centerX).toBeCloseTo(art.code.centerX, 6)
    expect(art.context!.y).toBeLessThan(art.code.y)
  })

  it('gives the text the full inner width — the bug this layout exists to fix', () => {
    const art = labelArtwork(cell)
    expect(art.code.maxWidth).toBe(cell.inner.width)
    // MAIN's bin codes are 12 chars; Courier-Bold costs 0.6em each, so at the
    // 15pt this cell yields a code needs 108pt. The old side-by-side column was
    // 97.5pt, which is why every sticker printed `MAIN-O01-…`.
    const needed = 'MAIN-F03-L12'.length * 0.6 * art.code.fontSize
    expect(needed).toBeGreaterThan(97.5)
    expect(art.code.maxWidth).toBeGreaterThan(needed)
  })

  it('reserves a quiet zone between the QR and the code', () => {
    // qrcode's create() emits the bare symbol, so nothing else supplies one.
    const art = labelArtwork(cell)
    const gap = art.qr.y - (art.code.y + art.code.fontSize)
    expect(gap).toBeGreaterThanOrEqual(art.qr.size * 0.1)
  })

  it('keeps every piece of artwork inside the cell, on all presets', () => {
    for (const preset of ['a4-24', 'a4-14', 'a4-8'] as const) {
      for (const withContext of [true, false]) {
        const c = layoutLabels(1, sheetSpec(preset))[0].cells[0]
        const art = labelArtwork(c, { withContext })
        const { inner } = c
        expect(art.qr.x).toBeGreaterThanOrEqual(inner.x - 0.001)
        expect(art.qr.x + art.qr.size).toBeLessThanOrEqual(inner.x + inner.width + 0.001)
        expect(art.qr.y + art.qr.size).toBeLessThanOrEqual(inner.y + inner.height + 0.001)
        expect(art.qr.y).toBeGreaterThanOrEqual(inner.y - 0.001)
        const lowest = art.context ?? art.code
        expect(lowest.y).toBeGreaterThanOrEqual(inner.y - 0.001)
      }
    }
  })

  it('scales the code with the label — a big sign prints big text', () => {
    // Regression guard for the old clamp ceiling of 15pt, which was tuned for
    // the 24-up bin sticker and left a 99x67mm aisle sign no larger.
    const bin = labelArtwork(layoutLabels(1, sheetSpec('a4-24'))[0].cells[0])
    const sign = labelArtwork(layoutLabels(1, sheetSpec('a4-8'))[0].cells[0])
    expect(sign.code.fontSize).toBeGreaterThan(bin.code.fontSize * 1.5)
    expect(sign.qr.size).toBeGreaterThan(bin.qr.size)
  })

  it('drops the context line when there is no context', () => {
    expect(labelArtwork(cell, { withContext: false }).context).toBeNull()
  })

  it('keeps the code legible — never smaller than the floor', () => {
    const tiny = layoutLabels(1, { ...spec, rows: 20 })[0].cells[0]
    expect(labelArtwork(tiny).code.fontSize).toBeGreaterThanOrEqual(MIN_CODE_FONT_SIZE)
  })

  it('lets the context shrink further than the code before giving up', () => {
    // The code is what gets typed when a QR won't scan, so it stops shrinking
    // sooner and takes the ellipsis instead.
    const art = labelArtwork(cell)
    expect(art.code.minFontSize).toBe(MIN_CODE_FONT_SIZE)
    expect(art.context!.minFontSize).toBeLessThan(art.code.minFontSize)
  })
})

describe('fitFontSize', () => {
  // Fake metric: every character is exactly 1 unit wide per point of size.
  const measure = (s: string, size: number) => s.length * size

  it('keeps the preferred size when the text already fits', () => {
    // 7 chars at 15pt needs 105 units, so give it 200 and expect no shrinking.
    expect(fitFontSize('MAIN-Z1', 200, 15, 7, measure)).toBe(15)
  })

  it('shrinks the moment the text overflows, by exactly what it overflows by', () => {
    expect(fitFontSize('MAIN-Z1', 105, 15, 7, measure)).toBe(15)
    expect(fitFontSize('MAIN-Z1', 104, 15, 7, measure)).toBeCloseTo(104 / 7, 6)
  })

  it('shrinks proportionally rather than truncating', () => {
    // 20 chars at 1 unit/char/pt needs 20 * size; 60 units allows size 3.
    expect(fitFontSize('X'.repeat(20), 60, 15, 1, measure)).toBeCloseTo(3, 6)
  })

  it('never goes below the floor, leaving the ellipsis to fitText', () => {
    const size = fitFontSize('X'.repeat(500), 10, 15, 7, measure)
    expect(size).toBe(7)
    expect(fitText('X'.repeat(500), 10, size, measure).endsWith('…')).toBe(true)
  })

  it('handles empty text and a zero-width slot', () => {
    expect(fitFontSize('', 100, 15, 7, measure)).toBe(7)
    expect(fitFontSize('ABC', 0, 15, 7, measure)).toBe(7)
  })
})

describe('fitText', () => {
  // Fake metric: every character is exactly 1 unit wide per point of size.
  const measure = (s: string, size: number) => s.length * size

  it('returns short text untouched', () => {
    expect(fitText('MAIN-Z1', 100, 1, measure)).toBe('MAIN-Z1')
  })

  it('truncates with an ellipsis when too long', () => {
    const out = fitText('MAIN-B-4-2-LEVEL-2-EXTRA', 10, 1, measure)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out, 1)).toBeLessThanOrEqual(10)
  })

  it('handles empty input', () => {
    expect(fitText('', 10, 1, measure)).toBe('')
  })
})
