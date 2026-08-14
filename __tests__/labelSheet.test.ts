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
  MIN_BAR_HEIGHT_PT,
  MIN_QUIET_ZONE_PT,
  MAX_X_DIMENSION_PT,
  QUIET_ZONE_MODULES,
  SHEET_PRESET_INFO,
  SHEET_PRESETS,
  MM,
} from '@/supabase/functions/_shared/labelSheet'
import { encodeCode128 } from '@/supabase/functions/_shared/labels/code128'

const spec = sheetSpec('a4-24')
const PRESETS = Object.keys(SHEET_PRESETS) as (keyof typeof SHEET_PRESETS)[]

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
  // A real Amadiya location code, encoded. 13 characters, no digit run long
  // enough to reach Code Set C, so it is start + 13 + checksum + stop.
  const BIN = encodeCode128('AMD-B-12-7-L3').modules
  const art = (c = cell, o: { modules?: number; withContext?: boolean } = {}) =>
    labelArtwork(c, { modules: o.modules ?? BIN, withContext: o.withContext })

  it('lays the bars across the top of the cell', () => {
    const a = art()
    expect(a.barcode.width).toBeGreaterThan(0)
    expect(a.barcode.height).toBeGreaterThan(0)
    expect(a.barcode.x).toBeGreaterThanOrEqual(cell.inner.x - 0.001)
    expect(a.barcode.x + a.barcode.width).toBeLessThanOrEqual(
      cell.inner.x + cell.inner.width + 0.001,
    )
    expect(a.barcode.y + a.barcode.height).toBeCloseTo(cell.inner.y + cell.inner.height, 6)
  })

  it('stacks the code below the bars, sharing their centre', () => {
    const a = art()
    expect(a.code.y + a.code.fontSize).toBeLessThanOrEqual(a.barcode.y + 0.001)
    expect(a.code.centerX).toBeCloseTo(a.barcode.x + a.barcode.width / 2, 6)
    expect(a.context!.centerX).toBeCloseTo(a.code.centerX, 6)
    expect(a.context!.y).toBeLessThan(a.code.y)
  })

  it('gives the text the full inner width — the bug this layout exists to fix', () => {
    const a = art()
    expect(a.code.maxWidth).toBe(cell.inner.width)
    // MAIN's bin codes are 12 chars; Courier-Bold costs 0.6em each, so at the
    // 15pt this cell yields a code needs 108pt. The old side-by-side column was
    // 97.5pt, which is why every sticker printed `MAIN-O01-…`.
    const needed = 'MAIN-F03-L12'.length * 0.6 * a.code.fontSize
    expect(needed).toBeGreaterThan(97.5)
    expect(a.code.maxWidth).toBeGreaterThan(needed)
  })

  it('grants at least 10 modules of quiet zone either side', () => {
    // The commonest cause of a barcode that "scans sometimes". Nothing else
    // supplies it: the symbol runs edge to edge of its own width.
    for (const preset of PRESETS) {
      const c = layoutLabels(1, sheetSpec(preset))[0].cells[0]
      const a = art(c)
      expect(a.barcode.quietZone, preset).toBeGreaterThanOrEqual(
        QUIET_ZONE_MODULES * a.barcode.moduleWidth - 0.001,
      )
      expect(a.barcode.quietZone, preset).toBeGreaterThanOrEqual(MIN_QUIET_ZONE_PT - 0.001)
    }
  })

  it('clears the bars from the code beneath them', () => {
    // A scan line that drifts low must read white, not the top of a glyph.
    const a = art()
    expect(a.barcode.y - (a.code.y + a.code.fontSize)).toBeGreaterThan(0)
  })

  it('caps the module width so a short code does not print as giant stripes', () => {
    // A 7-character aisle code on a full-page sign would otherwise be handed a
    // module wider than GS1 permits.
    const big = layoutLabels(1, sheetSpec('a4-1'))[0].cells[0]
    const a = art(big, { modules: encodeCode128('AMD-A03').modules })
    expect(a.barcode.moduleWidth).toBeLessThanOrEqual(MAX_X_DIMENSION_PT + 0.001)
    // The slack lands in the quiet zone, centred — which reads as deliberate.
    expect(a.barcode.quietZone).toBeGreaterThan(a.barcode.moduleWidth * QUIET_ZONE_MODULES)
  })

  it('keeps the bars tall enough for a scan line to cross', () => {
    // Never the binding constraint at our stocks — width always is — but a
    // future preset could break it silently, so it is pinned.
    for (const preset of PRESETS) {
      const c = layoutLabels(1, sheetSpec(preset))[0].cells[0]
      expect(art(c).barcode.height, preset).toBeGreaterThanOrEqual(MIN_BAR_HEIGHT_PT)
    }
  })

  it('keeps bar height at or above 15% of symbol width on the stocks we print', () => {
    // The usual rule of thumb for a scannable linear symbol. Asserted rather
    // than enforced in the formula, so it is a proven property of the actual
    // stock rather than a runtime clamp that could mask a bad preset.
    for (const preset of ['a4-24', 'a4-21', 'a4-14', 'a4-12', 'a4-8'] as const) {
      const c = layoutLabels(1, sheetSpec(preset))[0].cells[0]
      const a = art(c)
      expect(a.barcode.height, preset).toBeGreaterThanOrEqual(a.barcode.width * 0.15)
    }
  })

  it('keeps every piece of artwork inside the cell, on every preset', () => {
    for (const preset of PRESETS) {
      for (const withContext of [true, false]) {
        const c = layoutLabels(1, sheetSpec(preset))[0].cells[0]
        const a = art(c, { withContext })
        const { inner } = c
        expect(a.barcode.x, preset).toBeGreaterThanOrEqual(inner.x - 0.001)
        expect(a.barcode.x + a.barcode.width, preset).toBeLessThanOrEqual(
          inner.x + inner.width + 0.001,
        )
        expect(a.barcode.y + a.barcode.height, preset).toBeLessThanOrEqual(
          inner.y + inner.height + 0.001,
        )
        expect(a.barcode.y, preset).toBeGreaterThanOrEqual(inner.y - 0.001)
        const lowest = a.context ?? a.code
        expect(lowest.y, preset).toBeGreaterThanOrEqual(inner.y - 0.001)
      }
    }
  })

  it('gives a longer code narrower bars — the whole reason sizing has to be checked', () => {
    const short = art(cell, { modules: encodeCode128('AMD-A03').modules })
    const long = art(cell, { modules: encodeCode128('MAIN-B-189-5-L5').modules })
    expect(long.barcode.moduleWidth).toBeLessThan(short.barcode.moduleWidth)
  })

  it('scales the code with the label — a big sign prints big text', () => {
    // Regression guard for the old clamp ceiling of 15pt, which was tuned for
    // the 24-up bin sticker and left a 99x67mm aisle sign no larger.
    const bin = art(layoutLabels(1, sheetSpec('a4-24'))[0].cells[0])
    const sign = art(layoutLabels(1, sheetSpec('a4-8'))[0].cells[0])
    expect(sign.code.fontSize).toBeGreaterThan(bin.code.fontSize * 1.5)
    expect(sign.barcode.moduleWidth).toBeGreaterThan(bin.barcode.moduleWidth)
  })

  it('drops the context line when there is no context', () => {
    expect(art(cell, { withContext: false }).context).toBeNull()
  })

  it('keeps the code legible — never smaller than the floor', () => {
    const tiny = layoutLabels(1, { ...spec, rows: 20 })[0].cells[0]
    expect(art(tiny).code.fontSize).toBeGreaterThanOrEqual(MIN_CODE_FONT_SIZE)
  })

  it('lets the context shrink further than the code before giving up', () => {
    // The code is what gets typed when the bars will not scan, so it stops
    // shrinking sooner and takes the ellipsis instead.
    const a = art()
    expect(a.code.minFontSize).toBe(MIN_CODE_FONT_SIZE)
    expect(a.context!.minFontSize).toBeLessThan(a.code.minFontSize)
  })
})

describe('the preset library', () => {
  it('describes every preset it offers', () => {
    for (const preset of PRESETS) {
      expect(SHEET_PRESET_INFO[preset], preset).toBeDefined()
    }
    expect(Object.keys(SHEET_PRESET_INFO).sort()).toEqual([...PRESETS].sort())
  })

  it('lays out exactly as many labels per sheet as it claims', () => {
    for (const preset of PRESETS) {
      expect(labelsPerPage(sheetSpec(preset)), preset).toBe(SHEET_PRESET_INFO[preset].perSheet)
    }
  })

  it('produces cells the exact size of the Avery die-cut it names', () => {
    // Every preset must land on stock you can actually buy, and the tolerance is
    // tight on purpose: with no vertical gutter the rows tile contiguously, so a
    // per-row error COMPOUNDS. `a4-8` was 0.55mm out per row, which by the
    // bottom row of a sheet is 2.2mm — enough to walk the artwork off its
    // die-cut. It survived only because the 10pt padding absorbed it.
    for (const preset of PRESETS) {
      const cell = layoutLabels(1, sheetSpec(preset))[0].cells[0]
      const info = SHEET_PRESET_INFO[preset]
      expect(cell.width / MM, `${preset} width`).toBeCloseTo(info.widthMm, 1)
      expect(cell.height / MM, `${preset} height`).toBeCloseTo(info.heightMm, 1)
    }
  })

  it('never lets accumulated row drift walk a label off the page', () => {
    for (const preset of PRESETS) {
      const spec = sheetSpec(preset)
      const info = SHEET_PRESET_INFO[preset]
      const cells = layoutLabels(labelsPerPage(spec), spec)[0].cells
      const last = cells[cells.length - 1]
      // Bottom edge of the final row, measured from the top of the page.
      const consumed = (A4_HEIGHT - last.y) / MM
      expect(consumed, preset).toBeLessThanOrEqual(297 - spec.marginY / MM + 0.05)
      expect(last.height / MM, preset).toBeCloseTo(info.heightMm, 1)
    }
  })

  it('fits every preset on the page', () => {
    for (const preset of PRESETS) {
      const spec = sheetSpec(preset)
      const pages = layoutLabels(labelsPerPage(spec), spec)
      expect(pages, preset).toHaveLength(1)
      for (const c of pages[0].cells) {
        expect(c.x, preset).toBeGreaterThanOrEqual(0)
        expect(c.y, preset).toBeGreaterThanOrEqual(0)
        expect(c.x + c.width, preset).toBeLessThanOrEqual(A4_WIDTH + 0.001)
        expect(c.y + c.height, preset).toBeLessThanOrEqual(A4_HEIGHT + 0.001)
      }
    }
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
