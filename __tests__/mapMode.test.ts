// The live map's mode exclusion.
//
// This exists because the exclusion used to be five separate conjunctions in JSX,
// where forgetting one is SILENT — the rename pencil staying live during a code
// sweep does not throw, it just lets two writers loose on the same `locations` rows.
// A table test over the whole matrix is cheap; discovering the gap on a client's
// floor is not.

import { describe, it, expect } from 'vitest'
import { deriveMapMode, modeGuards, type MapMode } from '@/components/inventory/warehouse/mapMode'

describe('deriveMapMode', () => {
  // NOTE for whoever adds the FIFTH mode: this table and the `modes` array below
  // are hand-maintained, so widening the MapMode union fails NOTHING here on its
  // own. Extend both deliberately or the guard you think you have is inert.
  it.each([
    [{ paintActive: false, recodeActive: false, slotActive: false }, 'view'],
    [{ paintActive: true, recodeActive: false, slotActive: false }, 'annotate'],
    [{ paintActive: false, recodeActive: true, slotActive: false }, 'recode'],
    [{ paintActive: false, recodeActive: false, slotActive: true }, 'slotting'],
  ])('derives %o as %s', (inputs, expected) => {
    expect(deriveMapMode(inputs)).toBe(expected)
  })

  it('prefers the sweep in a tie, because its selection is the hand-built one', () => {
    expect(deriveMapMode({ paintActive: true, recodeActive: true, slotActive: false })).toBe('recode')
  })

  it('prefers a hand-built selection over a re-hydratable paint set', () => {
    expect(deriveMapMode({ paintActive: true, recodeActive: false, slotActive: true })).toBe('slotting')
    // ...and the sweep still wins over slotting, for the same reason.
    expect(deriveMapMode({ paintActive: false, recodeActive: true, slotActive: true })).toBe('recode')
  })
})

describe('modeGuards', () => {
  const modes: MapMode[] = ['view', 'annotate', 'recode', 'slotting']

  it('offers the area pencil and sign editing ONLY in view mode', () => {
    for (const mode of modes) {
      const g = modeGuards(mode, true)
      expect(g.canRenameArea).toBe(mode === 'view')
      expect(g.canEditSign).toBe(mode === 'view')
    }
  })

  it('withholds every rename affordance from a user without the role, in every mode', () => {
    for (const mode of modes) {
      const g = modeGuards(mode, false)
      expect(g.canRenameArea).toBe(false)
      expect(g.canEditSign).toBe(false)
      expect(g.showModeButtons).toBe(false)
    }
  })

  // Annotate deliberately KEEPS bin selection: painting an area over a rack does not
  // stop you asking what is in the rack. Only a sweep, whose stroke IS the selection,
  // takes it away.
  it('suppresses bin selection wherever a stroke IS the selection', () => {
    expect(modeGuards('recode', true).canSelectBin).toBe(false)
    expect(modeGuards('slotting', true).canSelectBin).toBe(false)
    expect(modeGuards('annotate', true).canSelectBin).toBe(true)
    expect(modeGuards('view', true).canSelectBin).toBe(true)
  })

  it('hides the mode-entry buttons once a mode is running', () => {
    expect(modeGuards('view', true).showModeButtons).toBe(true)
    expect(modeGuards('annotate', true).showModeButtons).toBe(false)
    expect(modeGuards('recode', true).showModeButtons).toBe(false)
    expect(modeGuards('slotting', true).showModeButtons).toBe(false)
  })
})
