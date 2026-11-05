// Every page used to build its own header, which is how the app arrived at seven
// title styles. These read the source because the point is what a page is built
// from: a rendered test of the header would pass just as well on a hand-copied one.
//
// Batches add their pages to PROOF_PAGES until the rule covers the whole app.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

const PROOF_PAGES = [
  { path: 'components/AdminDashboard.tsx', titleFrom: 'ADMIN_TAB_LABELS.Dashboard' },
  { path: 'components/inventory/PickQueueView.tsx', titleFrom: "ADMIN_TAB_LABELS['Pick Queue']" },
  { path: 'components/inventory/PutawayQueuePage.tsx', titleFrom: 'ADMIN_TAB_LABELS.Putaway' },
  { path: 'components/admin/settings/SettingsView.tsx', titleFrom: 'ADMIN_TAB_LABELS.Settings' },
]

// Putaway's header moved up to the page; the view it wraps must not grow a second.
const MUST_NOT_HEAD_A_PAGE = ['components/inventory/PutawayQueueView.tsx']

const ICON_TILE = /p-2 rounded-lg bg-/

describe('page header adoption', () => {
  it('the four proof pages use PageFrame and PageHeader with no hand-rolled h1 or header icon', () => {
    for (const { path } of PROOF_PAGES) {
      const code = source(path)
      expect(code, `${path} should render <PageFrame>`).toContain('<PageFrame')
      expect(code, `${path} should render <PageHeader>`).toContain('<PageHeader')
      expect(code, `${path} hand-rolls an h1`).not.toContain('<h1')
      expect(code, `${path} still has an icon tile`).not.toMatch(ICON_TILE)
    }
    for (const path of MUST_NOT_HEAD_A_PAGE) {
      const code = source(path)
      expect(code, `${path} hand-rolls an h1`).not.toContain('<h1')
      expect(code, `${path} still has an icon tile`).not.toMatch(ICON_TILE)
    }
  })

  it('the four proof pages take their title from ADMIN_TAB_LABELS', () => {
    for (const { path, titleFrom } of PROOF_PAGES) {
      expect(source(path), `${path} types its own title`).toContain(`title={${titleFrom}}`)
    }
  })

  it('Pick Queue, Putaway and Settings use PageTabs', () => {
    const withTabs = [
      'components/inventory/PickQueueView.tsx',
      'components/inventory/PutawayQueuePage.tsx',
      'components/admin/settings/SettingsView.tsx',
    ]
    for (const path of withTabs) {
      const code = source(path)
      expect(code, `${path} should render <PageTabs>`).toContain('<PageTabs')
      expect(code, `${path} still has the grey pill`).not.toContain('role="tablist"')
      expect(code, `${path} still has a hand-rolled sub-tab`).not.toContain('SubtabButton')
    }
    expect(source('components/inventory/PickQueueView.tsx')).not.toContain("tab === t ? 'bg-nexgen-blue")
  })
})
