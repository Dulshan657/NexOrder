import { describe, it, expect } from 'vitest'
import {
  isUninformativeName,
  locationOneLine,
  locationSubtitle,
  locationTitle,
  nameTail,
  nameTailPair,
} from '../lib/locationDisplay'

const NAMED = { code: 'NEXG-B-9-4-L4', name: 'Chiller · Rack 7 · L4' }
// Every bin on a warehouse that predates mig 00094.
const LEGACY = { code: 'MAIN-F01-L01', name: 'Bin 9,4' }

describe('locationTitle', () => {
  it('leads with the friendly name', () => {
    expect(locationTitle(NAMED)).toBe('Chiller · Rack 7 · L4')
  })

  it('falls back to the code when the name says nothing the code does not', () => {
    // `Bin 9,4` repeats the grid coordinate and drops the warehouse, so it is
    // strictly worse than the code — this is the normal case on MAIN, not an
    // edge case.
    expect(locationTitle(LEGACY)).toBe('MAIN-F01-L01')
    expect(locationTitle({ code: 'X-1', name: 'Level 4' })).toBe('X-1')
    expect(locationTitle({ code: 'X-1', name: '' })).toBe('X-1')
    expect(locationTitle({ code: 'X-1' })).toBe('X-1')
  })

  it('keeps a hand-typed name', () => {
    expect(locationTitle({ code: 'X-1', name: 'Damaged goods bay' })).toBe('Damaged goods bay')
  })

  it('has something to say about nothing', () => {
    expect(locationTitle(null)).toBe('—')
    expect(locationTitle(undefined)).toBe('—')
  })
})

describe('locationSubtitle', () => {
  it('is the code, which is the scan identity and never disappears', () => {
    expect(locationSubtitle(NAMED)).toBe('NEXG-B-9-4-L4')
  })

  it('is empty when the code is already the headline, so nothing renders twice', () => {
    expect(locationSubtitle(LEGACY)).toBe('')
  })
})

describe('locationOneLine', () => {
  it('carries both, for a toast or a confirm', () => {
    expect(locationOneLine(NAMED)).toBe('Chiller · Rack 7 · L4 (NEXG-B-9-4-L4)')
  })

  it('does not repeat itself when there is no useful name', () => {
    expect(locationOneLine(LEGACY)).toBe('MAIN-F01-L01')
  })
})

describe('nameTail / nameTailPair', () => {
  it('drops the area, which the canvas already draws across the region', () => {
    expect(nameTail('Chiller · Rack 7 · L4')).toBe('L4')
    expect(nameTail('Chiller · Rack 7')).toBe('Rack 7')
    expect(nameTailPair('Chiller · Rack 7 · L4')).toBe('Rack 7 · L4')
  })

  it('passes through a name with no separator', () => {
    expect(nameTail('Rack 12')).toBe('Rack 12')
    expect(nameTailPair('Rack 12')).toBe('Rack 12')
  })

  it('is empty for nothing', () => {
    expect(nameTail('')).toBe('')
    expect(nameTail(null)).toBe('')
    expect(nameTailPair(undefined)).toBe('')
  })
})

describe('isUninformativeName is re-exported from the pure module', () => {
  it('matches the two legacy generators and nothing else', () => {
    expect(isUninformativeName('Bin 12,3', 'X')).toBe(true)
    expect(isUninformativeName('Level 2', 'X')).toBe(true)
    // A name that contains the whole code adds nothing over it.
    expect(isUninformativeName('Bin WIEDEMO-Z1-AL-R1-B3', 'WIEDEMO-Z1-AL-R1-B3')).toBe(true)
    // Deliberately NOT matched: a legitimate name for a rack outside any area.
    expect(isUninformativeName('Rack 12', 'X')).toBe(false)
    expect(isUninformativeName('Chiller · Rack 7', 'NEXG-B-9-4')).toBe(false)
  })
})
