import { describe, it, expect } from 'vitest'
import {
  ADMIN_TABS,
  ADMIN_TAB_LABELS,
  adminTabFromSearch,
  parseAdminTab,
  roleCanOpenTab,
} from '../lib/adminTabUrl'

describe('parseAdminTab', () => {
  it('reads a valid tab, with or without a leading ?', () => {
    expect(parseAdminTab('?tab=Warehouse')).toBe('Warehouse')
    expect(parseAdminTab('tab=Warehouse')).toBe('Warehouse')
  })

  it('decodes tab names containing spaces', () => {
    expect(parseAdminTab('?tab=Pick+Queue')).toBe('Pick Queue')
    expect(parseAdminTab('?tab=Pick%20Queue')).toBe('Pick Queue')
    expect(parseAdminTab('?tab=PO%20Inbox')).toBe('PO Inbox')
  })

  it('returns null for missing, empty or unknown values', () => {
    // null rather than a fallback: the caller distinguishes "no tab requested"
    // from "Dashboard requested" — role landing views depend on it.
    expect(parseAdminTab('')).toBeNull()
    expect(parseAdminTab('?subtab=warehouse')).toBeNull()
    expect(parseAdminTab('?tab=')).toBeNull()
    expect(parseAdminTab('?tab=Nonsense')).toBeNull()
  })

  it('is case-sensitive, so a near-miss does not open the wrong view', () => {
    expect(parseAdminTab('?tab=warehouse')).toBeNull()
  })

  it('survives an extra param alongside it', () => {
    expect(parseAdminTab('?tab=Stock&stockimport=1&wh=3')).toBe('Stock')
  })
})

describe('roleCanOpenTab', () => {
  it('lets Admin open everything', () => {
    for (const tab of ADMIN_TABS) expect(roleCanOpenTab('Admin', tab)).toBe(true)
  })

  it('keeps Manager out of the Admin-only views', () => {
    // AdminView gates these on ADMIN; without the check a deep link is a blank page.
    expect(roleCanOpenTab('Manager', 'Settings')).toBe(false)
    expect(roleCanOpenTab('Manager', 'Users')).toBe(false)
    expect(roleCanOpenTab('Manager', 'Suppliers')).toBe(false)
    expect(roleCanOpenTab('Manager', 'Audit Log')).toBe(false)
    expect(roleCanOpenTab('Manager', 'Promotions')).toBe(false)
  })

  it('lets Manager open the views it owns', () => {
    expect(roleCanOpenTab('Manager', 'Warehouse')).toBe(true)
    expect(roleCanOpenTab('Manager', 'Stock')).toBe(true)
    expect(roleCanOpenTab('Manager', 'Products')).toBe(true)
  })

  it('scopes Warehouse-role staff to the floor views', () => {
    expect(roleCanOpenTab('Warehouse', 'Pick Queue')).toBe(true)
    expect(roleCanOpenTab('Warehouse', 'Warehouse')).toBe(true)
    expect(roleCanOpenTab('Warehouse', 'Products')).toBe(false)
    expect(roleCanOpenTab('Warehouse', 'Settings')).toBe(false)
  })

  it('gives an unknown role nothing', () => {
    expect(roleCanOpenTab('Customer', 'Dashboard')).toBe(false)
    expect(roleCanOpenTab('', 'Dashboard')).toBe(false)
  })
})

describe('adminTabFromSearch', () => {
  it('honours a link the role can render', () => {
    expect(adminTabFromSearch('?tab=Warehouse', 'Manager')).toBe('Warehouse')
  })

  it('degrades a link the role cannot render to null, not a blank page', () => {
    expect(adminTabFromSearch('?tab=Settings', 'Manager')).toBeNull()
    expect(adminTabFromSearch('?tab=Settings', 'Admin')).toBe('Settings')
  })

  it('returns null when no tab is requested at all', () => {
    expect(adminTabFromSearch('?wh=3', 'Admin')).toBeNull()
  })
})

describe('ADMIN_TAB_LABELS', () => {
  // The mobile top bar renders this map. A tab added to the union without a
  // label here would show a blank title on the handheld, and nothing else in
  // the app would notice — `Record<AdminTab, string>` catches a MISSING key at
  // compile time, but this repo ships no strict mode and the top bar reads the
  // map at runtime, so the test is what actually holds.
  it('covers every tab, with no blanks', () => {
    for (const tab of ADMIN_TABS) {
      const label = ADMIN_TAB_LABELS[tab]
      expect(label, `no label for the '${tab}' tab`).toBeTruthy()
      expect(label.trim(), `the '${tab}' label is blank`).not.toBe('')
    }
  })

  it('has no labels for tabs that do not exist', () => {
    expect(Object.keys(ADMIN_TAB_LABELS).sort()).toEqual([...ADMIN_TABS].sort())
  })

  it("keeps the one label that is NOT its tab's own name", () => {
    // This is the entire reason the map exists. `adminView` is 'Receiving';
    // every operator knows the screen as "Receive Stock", and the sidebar has
    // always said so. Showing the raw tab value is right 26 times out of 27 and
    // wrong on the screen a warehouse operator is on most of the day.
    expect(ADMIN_TAB_LABELS.Receiving).toBe('Receive Stock')
  })
})
