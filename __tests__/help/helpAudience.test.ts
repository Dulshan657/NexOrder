import { describe, expect, it } from 'vitest'
import { UserRole } from '@/types'
import { helpAudienceForRole, parseHelpAudience, visibleArticles } from '@/lib/help/helpAudience'
import type { HelpAudience } from '@/lib/help/helpAudience'

describe('helpAudienceForRole', () => {
  it('maps each role to its audience', () => {
    expect(helpAudienceForRole(UserRole.WAREHOUSE)).toBe('floor')
    expect(helpAudienceForRole(UserRole.ADMIN)).toBe('supervisor')
    expect(helpAudienceForRole(UserRole.MANAGER)).toBe('supervisor')
    for (const role of [UserRole.FIELD_REP, UserRole.OFFICE_REP, UserRole.CUSTOMER, UserRole.QR_STAFF]) {
      expect(helpAudienceForRole(role)).toBeNull()
    }
    expect(parseHelpAudience('?for=floor')).toBe('floor')
    expect(parseHelpAudience('?for=supervisor')).toBe('supervisor')
    expect(parseHelpAudience('?for=Admin')).toBeNull()
    expect(parseHelpAudience('')).toBeNull()
  })
})

describe('visibleArticles', () => {
  it('filters by audience in manifest order', () => {
    const list: { slug: string; audiences: HelpAudience[] }[] = [
      { slug: 'a', audiences: ['floor', 'supervisor'] },
      { slug: 'b', audiences: ['supervisor'] },
      { slug: 'c', audiences: ['floor'] },
    ]
    expect(visibleArticles(list, 'floor').map((a) => a.slug)).toEqual(['a', 'c'])
    expect(visibleArticles(list, 'supervisor').map((a) => a.slug)).toEqual(['a', 'b'])
    expect(visibleArticles(list, null).map((a) => a.slug)).toEqual(['a', 'b', 'c'])
  })
})
