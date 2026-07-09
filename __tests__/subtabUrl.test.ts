import { describe, it, expect } from 'vitest'

import {
  parseSubtab,
  settingsSubtabFromSearch,
  SETTINGS_SUBTABS,
} from '../lib/subtabUrl'

describe('parseSubtab', () => {
  const valid = ['queue', 'archive', 'aliases'] as const

  it('returns a valid subtab from the search string', () => {
    expect(parseSubtab('?subtab=aliases', valid, 'queue')).toBe('aliases')
  })

  it('falls back on unknown values', () => {
    expect(parseSubtab('?subtab=mailboxes', valid, 'queue')).toBe('queue')
  })

  it('falls back when subtab is missing', () => {
    expect(parseSubtab('', valid, 'queue')).toBe('queue')
    expect(parseSubtab('?other=1', valid, 'queue')).toBe('queue')
  })

  it('handles search strings without the leading question mark', () => {
    expect(parseSubtab('subtab=archive', valid, 'queue')).toBe('archive')
  })
})

describe('settingsSubtabFromSearch', () => {
  it('returns general when no params are present', () => {
    expect(settingsSubtabFromSearch('')).toBe('general')
  })

  it('parses each valid settings subtab', () => {
    for (const tab of SETTINGS_SUBTABS) {
      expect(settingsSubtabFromSearch(`?subtab=${tab}`)).toBe(tab)
    }
  })

  it('routes ?designer= deep links to the warehouse tab', () => {
    expect(settingsSubtabFromSearch('?designer=3')).toBe('warehouse')
  })

  it('designer deep link wins over an explicit subtab param', () => {
    expect(settingsSubtabFromSearch('?designer=3&subtab=customers')).toBe('warehouse')
  })

  it('routes ?import= floor-plan deep links to the warehouse tab', () => {
    expect(settingsSubtabFromSearch('?import=1')).toBe('warehouse')
  })

  it('returns customers for ?subtab=customers', () => {
    expect(settingsSubtabFromSearch('?subtab=customers')).toBe('customers')
  })

  it('degrades a stale PO Inbox ?subtab=queue to general', () => {
    expect(settingsSubtabFromSearch('?subtab=queue')).toBe('general')
  })
})
