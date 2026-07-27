import { describe, it, expect } from 'vitest'
import { GROUP_LABEL, labelSheetFileName } from '@/lib/labelFileName'

// A fixed local-time date: the helper formats in local time on purpose (the day
// the operator printed), so constructing it from parts keeps this stable
// wherever the suite runs.
const DAY = new Date(2026, 6, 27, 14, 30)

describe('labelSheetFileName', () => {
  it('names a layout sheet by warehouse, stock and day', () => {
    expect(labelSheetFileName({ group: 'slots', layoutName: 'MAIN', date: DAY })).toBe(
      'main-bin-level-stickers-2026-07-27.pdf',
    )
    expect(labelSheetFileName({ group: 'wayfinding', layoutName: 'MAIN', date: DAY })).toBe(
      'main-zone-aisle-signs-2026-07-27.pdf',
    )
  })

  it('gives each sheet of one job a distinct name', () => {
    const names = (['wayfinding', 'slots', 'staging'] as const).map((group) =>
      labelSheetFileName({ group, layoutName: 'MAIN', date: DAY }),
    )
    expect(new Set(names).size).toBe(3)
  })

  it('falls back to a dated name when nothing is known', () => {
    expect(labelSheetFileName({ date: DAY })).toBe('labels-2026-07-27.pdf')
  })

  it('drops the layout prefix when there is no layout', () => {
    expect(labelSheetFileName({ kind: 'product', date: DAY })).toBe('products-2026-07-27.pdf')
    expect(labelSheetFileName({ kind: 'handling_unit', date: DAY })).toBe(
      'pallets-cartons-2026-07-27.pdf',
    )
  })

  it('prefers the group over the kind when both are given', () => {
    // A layout run always passes kind: 'location' to the Edge Function; the
    // group is the more specific truth about what is on the sheet.
    expect(labelSheetFileName({ group: 'staging', kind: 'location', date: DAY })).toBe(
      'staging-dock-2026-07-27.pdf',
    )
  })

  it('slugs punctuation and spacing out of a layout name', () => {
    expect(labelSheetFileName({ group: 'slots', layoutName: 'Main DC / Bldg 2', date: DAY })).toBe(
      'main-dc-bldg-2-bin-level-stickers-2026-07-27.pdf',
    )
  })

  it('pads single-digit months and days', () => {
    expect(labelSheetFileName({ kind: 'product', date: new Date(2026, 0, 5) })).toBe(
      'products-2026-01-05.pdf',
    )
  })

  it('exports one wording for every sheet group', () => {
    expect(Object.keys(GROUP_LABEL).sort()).toEqual(['slots', 'staging', 'wayfinding'])
  })
})
