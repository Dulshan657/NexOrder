// Which of App.tsx's role-dependent global lists a role can ever read through
// props. App used to load all twelve for every role, so a Warehouse user on a
// handheld fetched invoices, sales targets and visits it can never display.
//
// Derived from tracing every consumer reachable from AppShell. The traps:
//  - promotions feed CUSTOMER pricing (ShopView, OrderSummary, the submit
//    re-check), not just the Promotions tab.
//  - invoices feed the customer's overdue-order block, cart balance banner,
//    order history and OrderDetailView.
//  - routes and visits feed RepDashboardV2 and HoReCaListView with NO module
//    gate, so reps need them even when field_ops is off.
//  - suppliers reach the Warehouse role only through ReceiveStockView and
//    SlottingRulesSection, which call useSuppliers() themselves.
//  - users: Customer and Warehouse can read only their own profile under RLS,
//    so App substitutes the signed-in profile instead of fetching it.
//
// products, horecas, orders, settings and notifications are needed by every
// role and are not listed here.

import { UserRole } from '../types'

export interface AppDataNeeds {
  invoices: boolean
  suppliers: boolean
  promotions: boolean
  routes: boolean
  visits: boolean
  users: boolean
  salesTargets: boolean
}

export function appDataNeeds(role: UserRole | string | null | undefined): AppDataNeeds {
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER
  const isRep = role === UserRole.FIELD_REP || role === UserRole.OFFICE_REP
  const isCustomer = role === UserRole.CUSTOMER
  const staffOrRep = isAdminOrManager || isRep
  return {
    invoices: staffOrRep || isCustomer,
    suppliers: isAdminOrManager,
    promotions: staffOrRep || isCustomer,
    routes: staffOrRep,
    visits: staffOrRep,
    users: staffOrRep,
    salesTargets: staffOrRep,
  }
}
