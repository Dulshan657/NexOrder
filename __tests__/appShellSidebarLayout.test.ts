// A source assertion, for the reason appShellStaffOrderingNav.test.ts gives: no
// test in this repo mounts AppShell. Whether the labels actually fit is measured
// in a browser (NX-0015 A6); this pins the decisions that make them fit.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const src = readFileSync(resolve(process.cwd(), 'components/AppShell.tsx'), 'utf8')

describe('AppShell sidebar layout', () => {
  it('is 216px wide with the nav padded to the logo edge', () => {
    expect(src).toMatch(/<aside className=\{`[^`]*\bw-54\b/)
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
    expect(admin).toContain('Scheduled Visit Management')
  })
})
