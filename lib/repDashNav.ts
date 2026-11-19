// NX-0043: which views a link on the Rep dashboard may lead to.
//
// Mirrors the rep sidebar in components/AppShell.tsx — a view the sidebar would
// not show is a view AppShell renders nothing for, so a dashboard link to it is
// a blank page. Module flags are build-time constants (lib/modules.ts).

import {
  MODULE_FIELD_OPS,
  MODULE_INVENTORY_DISPATCH,
  MODULE_INVOICING,
  MODULE_SALES_ORDERS,
} from './modules'

export type RepDashView = 'orders' | 'accounts' | 'hoReCas' | 'scheduled_visits' | 'stock'

export interface RepNavContext {
  isFieldRep: boolean
  /** AppShell's showStockTab for this user. */
  canSeeStock: boolean
  isQrStaff: boolean
}

export function repCanOpen(view: RepDashView, ctx: RepNavContext): boolean {
  switch (view) {
    case 'orders':
      return MODULE_SALES_ORDERS
    case 'accounts':
      return MODULE_INVOICING && !ctx.isQrStaff
    case 'hoReCas':
      return true
    case 'scheduled_visits':
      return MODULE_FIELD_OPS && ctx.isFieldRep
    case 'stock':
      return MODULE_INVENTORY_DISPATCH && ctx.canSeeStock
    default:
      return false
  }
}

/** Given a view, a click handler — or `undefined` when the link must not render as one. */
export type RepNav = (view: RepDashView) => (() => void) | undefined

export function repNavFor(ctx: RepNavContext, navigate: ((view: RepDashView) => void) | undefined): RepNav {
  return (view) => (navigate && repCanOpen(view, ctx) ? () => navigate(view) : undefined)
}
