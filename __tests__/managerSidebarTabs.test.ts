// AdminView renders nothing when a role gate fails, so a sidebar link to a tab the
// role cannot render is a blank page with no error. Managers had three of those.
// A source assertion, for the reason appShellStaffOrderingNav.test.ts gives: no test
// in this repo mounts AppShell. The browser walk in NX-0023 is what proves the pages.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { roleCanOpenTab, type AdminTab } from '../lib/adminTabUrl'

const source = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')

const adminViewGate = (tab: string): string => {
  const line = source('components/AdminView.tsx')
    .split('\n')
    .find((text) => text.includes(`activeTab === '${tab}'`))
  if (!line) throw new Error(`AdminView has no branch for ${tab}`)
  return line
}

interface SidebarLink {
  tab: AdminTab
  adminOnly: boolean
}

// Each <SidebarNavItem> in AppShell that opens an admin tab, and whether it sits
// directly behind `{isAdmin && (`.
const sidebarLinks = (): SidebarLink[] => {
  const parts = source('components/AppShell.tsx').split('<SidebarNavItem')
  return parts.slice(1).flatMap((part, index) => {
    const opens = part.slice(0, 300).match(/onClick=\{\(\) => \{ setAdminView\('([^']+)'\)/)
    if (!opens) return []
    return [{ tab: opens[1] as AdminTab, adminOnly: parts[index].trimEnd().endsWith('{isAdmin && (') }]
  })
}

describe('Manager tabs', () => {
  it('AdminView renders Promotions and Suppliers for a Manager', () => {
    expect(adminViewGate('Promotions')).toContain('UserRole.MANAGER')
    expect(adminViewGate('Suppliers')).toContain('UserRole.MANAGER')
    expect(adminViewGate('Users')).not.toContain('UserRole.MANAGER')
  })

  it('the Users link is for Admins only', () => {
    const users = sidebarLinks().find((link) => link.tab === 'Users')
    expect(users).toBeDefined()
    expect(users?.adminOnly).toBe(true)
  })

  it('every link a Manager can see opens a tab they can render', () => {
    const links = sidebarLinks()
    expect(links.length).toBeGreaterThan(10)

    const blank = links.filter((link) => !link.adminOnly && !roleCanOpenTab('Manager', link.tab))
    expect(blank.map((link) => link.tab)).toEqual([])
  })
})
