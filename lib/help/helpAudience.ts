// Who a help article is for (NX-0038).
//
// Two audiences, not one per role: the Phase 1 guide splits cleanly into the
// people who carry stock (`floor`) and the people who decide where it goes
// (`supervisor`). The URL carries the audience slug rather than the role,
// because role values are display strings ("Restaurant/Hotel Customer").
//
// This filter is a convenience, never a control: every article is public.

import { UserRole } from '../../types'

export type HelpAudience = 'floor' | 'supervisor'

const AUDIENCES: readonly HelpAudience[] = ['floor', 'supervisor']

/**
 * The audience a signed-in role reads as, or null for a role with no guide yet.
 * Null is what keeps the Help link out of a Customer's or a rep's menu: they
 * would land on articles about work they never do.
 */
export function helpAudienceForRole(role: UserRole | string | null | undefined): HelpAudience | null {
  switch (role) {
    case UserRole.WAREHOUSE:
      return 'floor'
    case UserRole.ADMIN:
    case UserRole.MANAGER:
      return 'supervisor'
    default:
      return null
  }
}

/** Reads `?for=` from a query string; anything that is not an audience reads as none. */
export function parseHelpAudience(search: string): HelpAudience | null {
  const value = new URLSearchParams(search).get('for')
  return AUDIENCES.find((a) => a === value) ?? null
}

/** The articles an audience sees, in the order given. No audience sees them all. */
export function visibleArticles<T extends { audiences: readonly HelpAudience[] }>(
  articles: readonly T[],
  audience: HelpAudience | null,
): T[] {
  return audience ? articles.filter((a) => a.audiences.includes(audience)) : [...articles]
}
