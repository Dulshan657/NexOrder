// A source assertion, for the reason appShellStaffOrderingNav.test.ts gives: no
// test in this repo mounts AppShell. Whether the labels actually fit is measured
// in a browser (NX-0015 A6); this pins the decisions that make them fit.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { moduleForTab, type AdminTab } from '../lib/adminTabUrl'

const src = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8')

describe('AppShell sidebar layout', () => {
  it('is 224px wide with the nav padded to the logo edge', () => {
    expect(src).toMatch(/<aside className=\{`[^`]*\bw-56\b/)
    // nav px-3 + row px-3 = 24px, the header's px-6.
    expect(src).toMatch(/<nav className="[^"]*\bpx-3\b/)
    expect(src).toMatch(/h-\[73px\][^"]*\bpx-6\b/)
  })

  it('has no hand-written nav rows left', () => {
    expect(src).not.toContain('w-5 h-5 mr-3')
    expect(src).toContain('<SidebarNavItem')
  })
})

const sourceFiles = (dir: string): string[] =>
  readdirSync(resolve(process.cwd(), dir))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(dir, name))

// Strips what a user never sees, then looks for the type name used as a word:
// after a word, after a tag or quote, or followed by another word.
const visibleUses = (file: string): string[] =>
  readFileSync(resolve(process.cwd(), file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(import\b|\/\/|\*|\/\*)/.test(line))
    .map((line) => line.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\/.*$/, ''))
    .filter((line) => {
      const typeUse = /\b(as|type|extends|interface|typeof)\s+ScheduledVisit/
      const asWord =
        /[A-Za-z&]\sScheduledVisits?(?![A-Za-z])|[>'"`]\s*ScheduledVisits?\s*[<'"`]|\bScheduledVisits?\s+[A-Za-z]/
      return asWord.test(line.replace(typeUse, ''))
    })
    .map((line) => `${file}: ${line.trim()}`)

describe('Scheduled Visit wording', () => {
  it("shows no 'ScheduledVisit' to a user", () => {
    const files = [...sourceFiles('components/admin'), ...sourceFiles('components/scheduled-visits')]
    expect(files.flatMap(visibleUses)).toEqual([])

    const admin = readFileSync(resolve(process.cwd(), 'components/admin/ScheduledVisitsAdmin.tsx'), 'utf8')
    expect(admin).toContain("title={ADMIN_TAB_LABELS['Scheduled Visits']}")
  })
})

// NX-0027: the customer list is core, so it has its own heading that is always there, and
// "Field Ops" holds only what is sold as Field Ops. Read from the source for the same reason
// as above: whether a heading shows with a module off is a property of the build, and the
// module flags fold to constants, so it is a property of this text.
const nav = src.replace(/\r\n/g, '\n')
const HEADING = /<p className="px-3 pt-4 pb-1 [^"]*">([^<]+)<\/p>/g

const headings = [...nav.matchAll(HEADING)]

/** Where a heading's `<p>` starts, or -1. */
const headingIndex = (title: string): number => headings.find((match) => match[1] === title)?.index ?? -1

/** From a heading to the next heading, so the items filed under it and nothing else. */
const section = (title: string): string => {
  const at = headings.findIndex((match) => match[1] === title)
  if (at < 0) return ''
  return nav.slice(headings[at].index, headings[at + 1]?.index ?? nav.length)
}

const opensTabs = (text: string): string[] =>
  [...text.matchAll(/setAdminView\('([^']+)'\)/g)].map((match) => match[1])

// What stands directly before a heading once whitespace and JSX comments are set aside.
const before = (title: string): string =>
  nav
    .slice(0, headingIndex(title))
    .replace(/(\{\/\*[\s\S]*?\*\/\}\s*)+$/, '')
    .trimEnd()

describe('customer tab nav', () => {
  it('puts HoReCa under its own Customers heading outside Field Ops', () => {
    expect(nav.match(/>Customers<\/p>/g) ?? []).toHaveLength(1)

    const customers = section('Customers')
    expect(opensTabs(customers)).toContain('HoReCa')
    // It sits above Field Ops, and nothing Field Ops owns moved with it.
    expect(headingIndex('Customers')).toBeLessThan(headingIndex('Field Ops'))
    expect(opensTabs(section('Field Ops'))).not.toContain('HoReCa')

    // Always shown: no module flag or condition between the heading and the link.
    const toLink = customers.slice(0, customers.indexOf("setAdminView('HoReCa')"))
    expect(toLink).not.toMatch(/MODULE_|&&/)
    expect(before('Customers')).not.toMatch(/(&& \(|<>|\?)$/)
  })

  it('leaves no Field Ops heading behind when the module is off', () => {
    expect(headingIndex('Field Ops')).toBeGreaterThan(-1)
    // The heading is inside the module's condition, so a build without the module drops it.
    expect(before('Field Ops')).toMatch(/\{MODULE_FIELD_OPS && \(\s*<>$/)
  })

  it('files only Field Ops tabs under Field Ops and only core tabs under Customers', () => {
    const fieldOps = opensTabs(section('Field Ops'))
    expect(fieldOps.length).toBeGreaterThan(0)
    expect(fieldOps.map((tab) => moduleForTab(tab as AdminTab))).toEqual(fieldOps.map(() => 'field_ops'))

    const customers = opensTabs(section('Customers'))
    expect(customers).toEqual(['HoReCa'])
    expect(customers.map((tab) => moduleForTab(tab as AdminTab))).toEqual([null])
  })
})
