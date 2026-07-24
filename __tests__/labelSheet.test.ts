import { describe, it, expect } from 'vitest'
import {
  A4_HEIGHT,
  A4_WIDTH,
  fitText,
  labelArtwork,
  labelsPerPage,
  layoutLabels,
  sheetSpec,
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

  it('places the human-readable code to the right of the QR', () => {
    const art = labelArtwork(cell)
    expect(art.code.x).toBeGreaterThan(art.qr.x + art.qr.size - 0.001)
    expect(art.code.maxWidth).toBeGreaterThan(0)
  })

  it('drops the context line when there is no context', () => {
    expect(labelArtwork(cell, { withContext: false }).context).toBeNull()
  })

  it('keeps the code legible — never smaller than 6pt', () => {
    const tiny = layoutLabels(1, { ...spec, rows: 20 })[0].cells[0]
    expect(labelArtwork(tiny).code.fontSize).toBeGreaterThanOrEqual(6)
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
