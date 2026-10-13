// The "Staff ordering" group in AppShell's rep / venue nav.
//
// A source assertion rather than a mount: AppShell takes several dozen data props,
// mutations and contexts, so no test in this repo renders it, and a render would
// prove less than it costs. What can silently regress here is ORDER and GATING --
// the group drifting back to the top of the nav, or the Customer-only QR button
// losing its guards -- and both are visible in the source.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8')

// The rep / venue nav is the first `(isRep || isHoReCaUser)` block; the admin nav
// starts at `isAdminOrManager`. Slicing keeps a heading elsewhere from satisfying
// the order checks below.
const navStart = src.indexOf('{(isRep || isHoReCaUser) && (')
const navEnd = src.indexOf('{isAdminOrManager && (', navStart)
const nav = src.slice(navStart, navEnd)

const at = (needle: string) => nav.indexOf(needle)

describe('AppShell: Staff ordering nav group', () => {
  it('slices the venue nav it is asserting on', () => {
    expect(navStart).toBeGreaterThan(-1)
    expect(navEnd).toBeGreaterThan(navStart)
  })

  it('is a heading, styled like every other group heading', () => {
    expect(nav).toContain(
      '<p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Staff ordering</p>',
    )
  })

  it('comes after the Orders, Field and Inventory & Dispatch groups: last in the nav', () => {
    const staff = at('>Staff ordering</p>')
    expect(staff).toBeGreaterThan(-1)
    for (const earlier of ['>Orders</p>', '>Field</p>', '>Inventory &amp; Dispatch</p>']) {
      expect(at(earlier), `${earlier} is missing from the venue nav`).toBeGreaterThan(-1)
      expect(staff, `Staff ordering must follow ${earlier}`).toBeGreaterThan(at(earlier))
    }
    // ...and no other group heading follows it.
    expect(nav.slice(staff + 1)).not.toContain('<p className="px-3 pt-4 pb-1')
  })

  it('carries "Order home" and, for the Customer login only, "Staff QR & PINs"', () => {
    const staff = at('>Staff ordering</p>')
    const group = nav.slice(staff)
    expect(group).toContain('Order home')
    expect(group).toContain('Staff QR &amp; PINs')

    // The QR sheet is the venue's own admin: a Customer login with a venue, never QR Staff.
    const qrButton = group.indexOf('Staff QR &amp; PINs')
    const gate = group.lastIndexOf('isCustomerLogin && currentUser.hoReCaId != null', qrButton)
    expect(gate, 'the QR & PINs button lost its Customer-login guard').toBeGreaterThan(-1)
    expect(gate).toBeLessThan(qrButton)
    expect(group.indexOf('Order home')).toBeLessThan(gate)
  })

  it('stays gated by the Shop module and by belonging to a venue', () => {
    const staff = at('>Staff ordering</p>')
    const gateAt = nav.lastIndexOf('{MODULE_SHOP && isHoReCaUser && (', staff)
    expect(gateAt, 'the group is no longer behind MODULE_SHOP && isHoReCaUser').toBeGreaterThan(-1)
    // The heading is the first thing inside that gate, so the heading cannot render alone.
    expect(nav.slice(gateAt, staff)).not.toMatch(/<button/)
  })

  it('no longer opens the nav, and the old labels are gone', () => {
    // First item of the rep / venue nav is the rep Dashboard (reps only).
    expect(at('Staff ordering')).toBeGreaterThan(at('Dashboard'))
    expect(nav).not.toMatch(/>\s*Kitchen/)
    expect(nav).not.toContain('Kitchen QR')
    expect(nav).not.toContain('ChefHat')
  })

  it('keeps the internal view key but names the screen "Order home" on the mobile top bar', () => {
    expect(src).toMatch(/kitchen: 'Order home',/)
    expect(src).toContain("setView('kitchen')")
    expect(src).not.toMatch(/\bChefHat\b/)
  })
})
