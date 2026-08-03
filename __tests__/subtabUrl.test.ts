import { describe, it, expect } from 'vitest'

import { SETTINGS_SECTION_IDS } from '../lib/warehouseSetup/steps'
import {
  isKnownSettingsSection,
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

  // Setup-checklist deep links. Each must force the sub-tab that HOSTS its
  // target: a consuming effect that fires while its host is `hidden` pops a
  // modal over the wrong tab, and scrollIntoView silently no-ops there.
  it('routes ?whrules= to the warehouse tab', () => {
    expect(settingsSubtabFromSearch('?whrules=1')).toBe('warehouse')
    expect(settingsSubtabFromSearch('?whrules=1&subtab=general')).toBe('warehouse')
  })

  it('routes every known ?section= anchor to the tab hosting it', () => {
    for (const id of Object.values(SETTINGS_SECTION_IDS)) {
      expect(settingsSubtabFromSearch(`?section=${id}`)).toBe('warehouse')
    }
  })

  it('ignores an unknown ?section= rather than forcing a tab', () => {
    expect(settingsSubtabFromSearch('?section=nonsense')).toBe('general')
    expect(settingsSubtabFromSearch('?section=nonsense&subtab=customers')).toBe('customers')
  })

  it('recognises exactly the five warehouse section anchors', () => {
    for (const id of Object.values(SETTINGS_SECTION_IDS)) {
      expect(isKnownSettingsSection(id)).toBe(true)
    }
    expect(isKnownSettingsSection('nonsense')).toBe(false)
    // Guards against a prototype key being read as a known section.
    expect(isKnownSettingsSection('constructor')).toBe(false)
  })
})
