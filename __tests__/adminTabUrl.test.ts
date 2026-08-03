import { describe, it, expect } from 'vitest'
import {
  ADMIN_TABS,
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
