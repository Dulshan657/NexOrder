import { describe, expect, it } from 'vitest'

import { ALL_MODULES, MODULE_REQUIRES, TARGETS, assertModuleSet } from '../config/environments.mjs'
import {
  ADMIN_TABS,
  moduleForTab,
  roleCanOpenTab,
  adminTabFromSearch,
  tabModuleEnabled,
  type AdminTab,
} from '../lib/adminTabUrl'
import {
  MODULE_FIELD_OPS,
  MODULE_INVENTORY_DISPATCH,
  MODULE_INVOICING,
  MODULE_PO_INBOX,
  MODULE_PROMOTIONS,
  MODULE_SALES_ORDERS,
  MODULE_SHOP,
} from '../lib/modules'
import { assignableRoles } from '../lib/assignableRoles'
import { UserRole } from '../types'

/**
 * The suite builds with every module ON (vitest.config.ts `define`), because
 * these tests assert what the product DOES and a run against a reduced feature
 * set would be silently meaningless. A Vite `define` is global to a config and
 * cannot vary per test file, so the OFF behaviour is proven two other ways:
 *
 *   - the pure mapping (`moduleForTab`) is asserted directly here, and
 *   - `npm run build` with a module removed is grepped for its symbols. That is
 *     the only check that can prove "not shipped" rather than "not rendered",
 *     and it is a build step rather than a unit test.
 */

describe('module vocabulary', () => {
  it('is the two whole sidebar headings plus the five "Sales & Orders" splits', () => {
    expect(ALL_MODULES).toEqual([
      'sales_orders',
      'shop',
      'po_inbox',
      'promotions',
      'invoicing',
      'field_ops',
      'inventory_dispatch',
    ])
  })

  it('gives the demo every module — a demo that cannot show a surface is not one', () => {
    expect(TARGETS.dev.modules).toEqual([...ALL_MODULES])
  })

  it('only ever lets a target name modules that exist', () => {
    // This replaced an "all-on for every target" assertion, which was a
    // tripwire for the gate never having been used in anger. It has now: a
    // tenant may legitimately carry a subset, so the invariant that survives
    // is that a subset is all it can be.
    for (const target of Object.values(TARGETS)) {
      for (const slug of target.modules) {
        expect(ALL_MODULES, `${target.name}`).toContain(slug)
      }
      expect(new Set(target.modules).size, `${target.name} has duplicates`).toBe(
        target.modules.length,
      )
    }
  })

  it('refuses a module set that omits a module its members stand on', () => {
    // The four surfaces carved out of sales_orders each need the order object
    // behind them. Enabling one without it renders a nav entry whose Edge
    // Function 403s, which reads as a bug rather than as a licensing decision.
    for (const [slug, deps] of Object.entries(MODULE_REQUIRES)) {
      for (const dep of deps) {
        expect(() => assertModuleSet('t', [slug])).toThrow(dep)
      }
    }
    expect(() => assertModuleSet('t', ['not_a_module'])).toThrow(/unknown module/)
    // The set Amadiya actually ships must pass.
    expect(() => assertModuleSet('t', ['sales_orders', 'inventory_dispatch'])).not.toThrow()
  })

  it('exposes one boolean per module — never an array', () => {
    // An array would be read at runtime, nothing would fold, and every byte of
    // a disabled module would ship. See lib/modules.ts.
    const flags = [
      MODULE_SALES_ORDERS,
      MODULE_SHOP,
      MODULE_PO_INBOX,
      MODULE_PROMOTIONS,
      MODULE_INVOICING,
      MODULE_FIELD_OPS,
      MODULE_INVENTORY_DISPATCH,
    ]
    expect(flags).toHaveLength(ALL_MODULES.length)
    for (const flag of flags) {
      expect(typeof flag).toBe('boolean')
    }
  })
})

describe('tab → module mapping', () => {
  it('leaves the core surfaces ungated', () => {
    // These are the ones a future tidy-up would try to file under a module.
    // Products in particular LOOKS like Inventory (the sidebar draws it there)
    // and is not: Sales & Orders reads its prices.
    for (const tab of [
      'Dashboard',
      'Products',
      'HoReCa',
      'Users',
      'Suppliers',
      'Settings',
      'Audit Log',
      'System Health',
    ] as AdminTab[]) {
      expect(moduleForTab(tab), `${tab} must stay core`).toBeNull()
    }
  })

  it.each([
    // 'Order Import' and 'New Order' are the order object; the other four were
    // split out of sales_orders when a tenant wanted the first two alone.
    ['New Order', 'sales_orders'],
    ['Order Import', 'sales_orders'],
    ['Shop', 'shop'],
    ['PO Inbox', 'po_inbox'],
    ['Accounts', 'invoicing'],
    ['Promotions', 'promotions'],
    ['HoReCa Insights', 'field_ops'],
    ['Scheduled Visits', 'field_ops'],
    ['Walk-in Review', 'field_ops'],
    ['Stock', 'inventory_dispatch'],
    ['Receiving', 'inventory_dispatch'],
    ['Putaway', 'inventory_dispatch'],
    ['Replenishment', 'inventory_dispatch'],
    ['Stocktake', 'inventory_dispatch'],
    ['Pick Queue', 'inventory_dispatch'],
    ['Dispatched', 'inventory_dispatch'],
    ['Documents', 'inventory_dispatch'],
    ['Warehouse', 'inventory_dispatch'],
  ] as Array<[AdminTab, string]>)('%s belongs to %s', (tab, slug) => {
    expect(moduleForTab(tab)).toBe(slug)
  })

  it('assigns every tab to a known module or to core', () => {
    for (const tab of ADMIN_TABS) {
      const slug = moduleForTab(tab)
      if (slug !== null) expect(ALL_MODULES).toContain(slug)
    }
  })

  it('distinguishes HoReCa (core) from HoReCa Insights (Field Ops)', () => {
    // The customer list is how orders get placed at all; the analytics on top
    // of it is the thing being sold. Collapsing the two breaks a Sales-only
    // tenant, which is the whole reason the distinction is tested.
    expect(moduleForTab('HoReCa')).toBeNull()
    expect(moduleForTab('HoReCa Insights')).toBe('field_ops')
  })
})

describe('roleCanOpenTab respects the module as well as the role', () => {
  it('still honours role gates with every module on', () => {
    expect(roleCanOpenTab('Admin', 'Warehouse')).toBe(true)
    expect(roleCanOpenTab('Warehouse', 'Settings')).toBe(false)
    expect(roleCanOpenTab('Manager', 'Audit Log')).toBe(false)
    expect(roleCanOpenTab('nobody', 'Dashboard')).toBe(false)
  })

  it('agrees with tabModuleEnabled for every tab in this build', () => {
    for (const tab of ADMIN_TABS) {
      if (!tabModuleEnabled(tab)) {
        expect(roleCanOpenTab('Admin', tab), `${tab} module off`).toBe(false)
      }
    }
  })

  it('degrades a deep link rather than opening a blank page', () => {
    // AdminView renders NOTHING when a gate fails, so an unchecked ?tab= is a
    // blank screen — the exact bug ?tab= was added to close.
    expect(adminTabFromSearch('?tab=Settings', 'Warehouse')).toBeNull()
    expect(adminTabFromSearch('?tab=Warehouse', 'Admin')).toBe('Warehouse')
    expect(adminTabFromSearch('?tab=Nonsense', 'Admin')).toBeNull()
    expect(adminTabFromSearch('', 'Admin')).toBeNull()
  })
})

describe('assignable roles', () => {
  it('offers every role while every module is on', () => {
    expect(assignableRoles).toEqual(Object.values(UserRole))
  })

  it('includes Warehouse exactly when Inventory & Dispatch is on', () => {
    // With that module off the role has no nav, no landing view and nothing to
    // render — an admin could otherwise create an account that logs in
    // successfully to a blank page, with no error anywhere to explain it.
    expect(assignableRoles.includes(UserRole.WAREHOUSE)).toBe(MODULE_INVENTORY_DISPATCH)
  })

  it('includes the Customer exactly when the Shop is on', () => {
    // A customer login is the Shop and their own order history, and both are
    // self-service ordering. A tenant whose office staff key the orders in has
    // no customer logins at all.
    expect(assignableRoles.includes(UserRole.CUSTOMER)).toBe(MODULE_SHOP)
  })

  it('keeps the field rep even though Field Ops can be off', () => {
    // A field rep without Scheduled Visits still has the Shop, Order Import,
    // Accounts and the customer list. Only withhold a role when a module takes
    // away everything it could do.
    expect(assignableRoles).toContain(UserRole.FIELD_REP)
  })
})
