// Every page used to build its own header, which is how the app arrived at seven
// title styles. These read the source because the point is what a page is built
// from: a rendered test of the header would pass just as well on a hand-copied one.
//
// The last test turns this into a rule for the whole app: a new page that hand-rolls
// its title fails it, and an exception has to be named in TITLE_EXCEPTIONS with a reason.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

const WAREHOUSE_PAGES = [
  { path: 'components/inventory/ReceiveStockView.tsx', titleFrom: 'ADMIN_TAB_LABELS.Receiving' },
  { path: 'components/inventory/ReplenQueuePage.tsx', titleFrom: 'ADMIN_TAB_LABELS.Replenishment' },
  { path: 'components/inventory/OffHomeQueuePage.tsx', titleFrom: "ADMIN_TAB_LABELS['Off-home']" },
  { path: 'components/inventory/StocktakePage.tsx', titleFrom: 'ADMIN_TAB_LABELS.Stocktake' },
  { path: 'components/inventory/DispatchedOrdersView.tsx', titleFrom: 'ADMIN_TAB_LABELS.Dispatched' },
  { path: 'components/inventory/DocumentsView.tsx', titleFrom: 'ADMIN_TAB_LABELS.Documents' },
  { path: 'components/inventory/warehouse/WarehousePage.tsx', titleFrom: 'ADMIN_TAB_LABELS.Warehouse' },
  { path: 'components/StockView.tsx', titleFrom: 'ADMIN_TAB_LABELS.Stock' },
]

const ADMIN_PAGES = [
  { path: 'components/ProductAdmin.tsx', titleFrom: 'ADMIN_TAB_LABELS.Products' },
  { path: 'components/HoReCaListView.tsx', titleFrom: 'ADMIN_TAB_LABELS.HoReCa' },
  { path: 'components/HoReCaInsightsPanel.tsx', titleFrom: "ADMIN_TAB_LABELS['HoReCa Insights']" },
  { path: 'components/PromotionAdmin.tsx', titleFrom: 'ADMIN_TAB_LABELS.Promotions' },
  { path: 'components/UserAdmin.tsx', titleFrom: 'ADMIN_TAB_LABELS.Users' },
  { path: 'components/SupplierAdmin.tsx', titleFrom: 'ADMIN_TAB_LABELS.Suppliers' },
  { path: 'components/AccountsAgingTable.tsx', titleFrom: 'ADMIN_TAB_LABELS.Accounts' },
  { path: 'components/admin/AuditLogTab.tsx', titleFrom: "ADMIN_TAB_LABELS['Audit Log']" },
  { path: 'components/admin/SystemHealthTab.tsx', titleFrom: "ADMIN_TAB_LABELS['System Health']" },
  { path: 'components/admin/POInboxView.tsx', titleFrom: "ADMIN_TAB_LABELS['PO Inbox']" },
  { path: 'components/admin/NewOrderView.tsx', titleFrom: "ADMIN_TAB_LABELS['New Order']" },
  { path: 'components/OrderImportPage.tsx', titleFrom: "ADMIN_TAB_LABELS['Order Import']" },
  { path: 'components/admin/ScheduledVisitsAdmin.tsx', titleFrom: "ADMIN_TAB_LABELS['Scheduled Visits']" },
  { path: 'components/admin/WalkInReviewTab.tsx', titleFrom: "ADMIN_TAB_LABELS['Walk-in Review']" },
]

// The icon that sat beside a title on the pages without a tinted tile.
const HEADER_ICON = /w-5 h-5 text-stone-700/

const REP_PAGES = [
  'components/RepDashboardV2.tsx',
  'views/KitchenHomeView.tsx',
  'components/OrderHistory.tsx',
  'components/scheduled-visits/ScheduledVisitsView.tsx',
]

// Every file allowed to write its own page title, and why.
const TITLE_EXCEPTIONS: Record<string, string> = {
  'components/ui/PageHeader.tsx': 'the shared header itself',
  'views/ShopView.tsx': 'the screen-reader-only heading, by owner decision',
  'components/auth/AuthGate.tsx': 'shown before the app loads',
  'components/auth/LoginPage.tsx': 'not a page inside the app',
  'components/auth/ResetPasswordView.tsx': 'not a page inside the app',
  'components/qr/QrEntryScreen.tsx': 'not a page inside the app',
  'components/HoReCaProfile.tsx': 'a detail screen headed by the customer name',
  'components/HoReCaAdmin.tsx': 'nothing imports it',
  'components/InvoiceAdmin.tsx': 'nothing imports it',
}

const STANDARD_TITLE_STYLE = 'text-lg sm:text-xl font-display font-bold text-stone-900'

const tsxFilesIn = (dir: string): string[] =>
  readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, '/')
    if (statSync(resolve(process.cwd(), path)).isDirectory()) return tsxFilesIn(path)
    return path.endsWith('.tsx') ? [path] : []
  })

const writesAPageTitle = (path: string): boolean =>
  source(path)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .some((line) => /<h1[\s>]/.test(line) || line.includes(STANDARD_TITLE_STYLE))

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

  it('the warehouse pages use PageFrame and PageHeader with no hand-rolled h1 or header icon', () => {
    for (const { path } of WAREHOUSE_PAGES) {
      const code = source(path)
      expect(code, `${path} should render <PageFrame>`).toContain('<PageFrame')
      expect(code, `${path} should render <PageHeader>`).toContain('<PageHeader')
      expect(code, `${path} hand-rolls an h1`).not.toContain('<h1')
      expect(code, `${path} still has an icon tile`).not.toMatch(ICON_TILE)
    }
  })

  it('the warehouse pages take their title from ADMIN_TAB_LABELS', () => {
    for (const { path, titleFrom } of WAREHOUSE_PAGES) {
      expect(source(path), `${path} types its own title`).toContain(`title={${titleFrom}}`)
    }
    expect(source('components/StockView.tsx')).not.toContain('Stock Levels')
    expect(source('components/inventory/OffHomeQueuePage.tsx')).not.toContain('Off-home stock')
  })

  it('Replenishment, Off-home and Documents use PageTabs', () => {
    const withTabs = [
      'components/inventory/ReplenQueuePage.tsx',
      'components/inventory/OffHomeQueuePage.tsx',
      'components/inventory/DocumentsView.tsx',
    ]
    for (const path of withTabs) {
      const code = source(path)
      expect(code, `${path} should render <PageTabs>`).toContain('<PageTabs')
      expect(code, `${path} still has the grey pill`).not.toContain('role="tablist"')
    }
    expect(source('components/inventory/DocumentsView.tsx')).not.toContain("typeFilter === t ? 'bg-nexgen-blue")
  })

  it('the admin pages use PageFrame and PageHeader with no hand-rolled h1 or header icon', () => {
    for (const { path } of ADMIN_PAGES) {
      const code = source(path)
      expect(code, `${path} should render <PageFrame>`).toContain('<PageFrame')
      expect(code, `${path} should render <PageHeader>`).toContain('<PageHeader')
      expect(code, `${path} hand-rolls an h1`).not.toContain('<h1')
      expect(code, `${path} still has an icon tile`).not.toMatch(ICON_TILE)
      expect(code, `${path} still has a header icon`).not.toMatch(HEADER_ICON)
    }
  })

  it('the admin pages take their title from ADMIN_TAB_LABELS', () => {
    for (const { path, titleFrom } of ADMIN_PAGES) {
      expect(source(path), `${path} types its own title`).toContain(`title={${titleFrom}}`)
    }
    expect(source('components/ProductAdmin.tsx')).not.toContain('Manage Products')
    expect(source('components/UserAdmin.tsx')).not.toContain('Manage Users')
    expect(source('components/SupplierAdmin.tsx')).not.toContain('Manage Suppliers')
    expect(source('components/HoReCaListView.tsx')).not.toContain('HoReCa Customers')
    expect(source('components/AccountsAgingTable.tsx')).not.toContain('Accounts Receivable')
    expect(source('components/admin/ScheduledVisitsAdmin.tsx')).not.toContain('Scheduled Visit Management')
  })

  it('Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs', () => {
    const withTabs = [
      'components/PromotionAdmin.tsx',
      'components/admin/WalkInReviewTab.tsx',
      'components/admin/POInboxView.tsx',
      'components/OrderImportPage.tsx',
      'components/admin/ScheduledVisitsAdmin.tsx',
    ]
    for (const path of withTabs) {
      expect(source(path), `${path} should render <PageTabs>`).toContain('<PageTabs')
    }
    expect(source('components/PromotionAdmin.tsx')).not.toContain('filter === tab ?')
    expect(source('components/admin/WalkInReviewTab.tsx')).not.toContain("setFilter('unreviewed')")
    expect(source('components/admin/POInboxView.tsx')).not.toContain('SubtabButton')
    expect(source('components/OrderImportPage.tsx')).not.toContain('role="tab"')
    expect(source('components/admin/ScheduledVisitsAdmin.tsx')).not.toContain("subTab === tab.key ? 'bg-nexgen-blue")
  })

  it("Audit Log's mode switch uses PageTabs", () => {
    const code = source('components/admin/AuditLogTab.tsx')
    expect(code).toContain('<PageTabs')
    expect(code).not.toContain("handleSwitchMode('errors')")
  })

  it('the rep and customer pages use PageHeader with no hand-rolled h1 or header icon', () => {
    for (const path of REP_PAGES) {
      const code = source(path)
      expect(code, `${path} should render <PageHeader>`).toContain('<PageHeader')
      expect(code, `${path} hand-rolls an h1`).not.toContain('<h1')
      expect(code, `${path} still has a header icon`).not.toMatch(HEADER_ICON)
    }
    for (const path of REP_PAGES.filter((page) => page !== 'views/KitchenHomeView.tsx')) {
      expect(source(path), `${path} should render <PageFrame>`).toContain('<PageFrame')
    }
    expect(source('views/KitchenHomeView.tsx'), 'Order home keeps its column').toContain('mx-auto max-w-2xl')
  })

  it('rep Scheduled Visits and Order History use the standard titles', () => {
    const visits = source('components/scheduled-visits/ScheduledVisitsView.tsx')
    expect(visits).toContain("title={ADMIN_TAB_LABELS['Scheduled Visits']}")
    expect(visits).not.toContain('Scheduled Visits & Check-ins')
    expect(source('components/OrderHistory.tsx')).toContain('title="Order History"')
  })

  it('Rep Dashboard and Order home stay visible on phones', () => {
    const rep = source('components/RepDashboardV2.tsx')
    expect(rep).toContain('visibleOnMobile')
    expect(rep).toContain('title={`Good ${greetingTime}, ')
    expect(rep).not.toContain("toLocaleDateString('en-US'")

    const kitchen = source('views/KitchenHomeView.tsx')
    expect(kitchen).toContain('visibleOnMobile')
    expect(kitchen).toContain('title={hoReCa.name}')
  })

  it('rep Scheduled Visits and Shop use PageTabs', () => {
    for (const path of ['components/scheduled-visits/ScheduledVisitsView.tsx', 'components/OrderingTabBar.tsx']) {
      const code = source(path)
      expect(code, `${path} should render <PageTabs>`).toContain('<PageTabs')
      expect(code, `${path} still hand-rolls a tab icon`).not.toMatch(/icon: /)
    }
    expect(source('components/scheduled-visits/ScheduledVisitsView.tsx')).not.toContain("activeTab === tab.key")
    expect(source('components/OrderingTabBar.tsx')).not.toContain('lucide-react')
  })

  it('Shop has a screen-reader heading and no visible title', () => {
    const shop = source('views/ShopView.tsx')
    expect(shop).toContain('<PageFrame')
    expect(shop).toContain('<h1 className="sr-only">{ADMIN_TAB_LABELS.Shop}</h1>')
    expect(shop).not.toContain('<PageHeader')
  })

  it('no page outside the allow-list hand-rolls a page title', () => {
    const writers = [...tsxFilesIn('components'), ...tsxFilesIn('views')].filter(writesAPageTitle).sort()
    expect(writers).toEqual(Object.keys(TITLE_EXCEPTIONS).sort())
  })

  it("Receive Stock's dock bleed matches the standard frame", () => {
    expect(source('components/inventory/ReceiveStockView.tsx')).not.toContain('bleed="xl"')
    expect(source('components/inventory/StickyScanBar.tsx')).not.toContain("xl: '")
  })
})
