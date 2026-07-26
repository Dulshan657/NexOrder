// Client-side entry point for rack level roles (mig 00081).
//
// The definitions live in the pure engine module so the Edge Functions and the
// browser run the very same code; this file re-exports them under `@/` and adds
// the one thing only the browser needs: a fallback set for first paint.

export {
  roleLabel,
  roleFill,
  roleStroke,
  roleTextColor,
  roleTint,
  sortedRoles,
  pickZoneKeys,
  replenSourceKeys,
  rolesForHuType,
  defaultRoleKey,
  resolveRolesForPutaway,
} from '@/supabase/functions/_shared/wie/levelRoles'

export type { LevelRoleRecord, RoleTint } from '@/supabase/functions/_shared/wie/levelRoles'

import type { LevelRoleRecord } from '@/supabase/functions/_shared/wie/levelRoles'

/**
 * The three seeded roles, hardcoded — used ONLY as TanStack `placeholderData`.
 *
 * Two jobs, both about the window before the query resolves. A warehouse canvas
 * that renders every level in neutral grey for 300ms reads as broken, and a
 * failed fetch would otherwise leave role dropdowns empty. With this, the
 * degraded state is exactly today's behaviour rather than a blank one.
 *
 * It is deliberately NOT a source of truth: nothing writes it back, nothing
 * merges it with the server rows, and a fourth operator-defined role simply
 * appears when the query lands. Keep it in sync with 00081's seed if the seed
 * ever changes — a drift here only affects first paint, never stored data.
 */
export const FALLBACK_LEVEL_ROLES: LevelRoleRecord[] = [
  {
    key: 'pick',
    displayName: 'Pick Zone',
    description: 'Working height. Pickers draw from here; replenishment keeps it stocked.',
    colorFill: '#a7f3d0',
    colorStroke: '#059669',
    colorText: null,
    sortOrder: 10,
    huTypes: ['carton'],
    isPickZone: true,
    replenSourceRank: null,
    isSystem: true,
    isActive: true,
  },
  {
    key: 'reserve',
    displayName: 'Reserve',
    description: 'Replenishment buffer directly above the pick zone.',
    colorFill: '#c7d2fe',
    colorStroke: '#4f46e5',
    colorText: null,
    sortOrder: 20,
    huTypes: ['pallet'],
    isPickZone: false,
    replenSourceRank: 1,
    isSystem: true,
    isActive: true,
  },
  {
    key: 'bulk',
    displayName: 'Bulk',
    description: 'Overstock. Drawn from only once reserve is empty.',
    colorFill: '#fde68a',
    colorStroke: '#d97706',
    colorText: null,
    sortOrder: 30,
    huTypes: ['pallet'],
    isPickZone: false,
    replenSourceRank: 2,
    isSystem: true,
    isActive: true,
  },
]
