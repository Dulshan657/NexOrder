import { describe, expect, it } from 'vitest'

import { ALL_MODULES, TARGETS } from '../config/environments.mjs'
import {
  ADMIN_TABS,
  moduleForTab,
  roleCanOpenTab,
  adminTabFromSearch,
  tabModuleEnabled,
  type AdminTab,
} from '../lib/adminTabUrl'
import { MODULE_FIELD_OPS, MODULE_INVENTORY_DISPATCH, MODULE_SALES_ORDERS } from '../lib/modules'
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
  it('is exactly the three surfaces the sidebar groups by', () => {
    expect(ALL_MODULES).toEqual(['sales_orders', 'field_ops', 'inventory_dispatch'])
  })

  it('is all-on for every target, so the gate ships proven inert', () => {
    for (const target of Object.values(TARGETS)) {
      expect(target.modules, `${target.name}`).toEqual([...ALL_MODULES])
    }
  })

  it('exposes one boolean per module — never an array', () => {
    // An array would be read at runtime, nothing would fold, and every byte of
    // a disabled module would ship. See lib/modules.ts.
    for (const flag of [MODULE_SALES_ORDERS, MODULE_FIELD_OPS, MODULE_INVENTORY_DISPATCH]) {
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
    ['Shop', 'sales_orders'],
    ['Order Import', 'sales_orders'],
    ['PO Inbox', 'sales_orders'],
    ['Accounts', 'sales_orders'],
    ['Promotions', 'sales_orders'],
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

  it('keeps the field rep even though Field Ops can be off', () => {
    // A field rep without Scheduled Visits still has the Shop, Order Import,
    // Accounts and the customer list. Only withhold a role when a module takes
    // away everything it could do.
    expect(assignableRoles).toContain(UserRole.FIELD_REP)
  })
})
