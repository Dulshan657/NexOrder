# NX-0042 — Admin dashboard, re-laid out: warehouse picker, clickable pipeline, sized trend, one type scale

```json brief
{
  "id": "NX-0042-admin-dashboard-relayout",
  "base": "21307ca38d158c234d50f7bfd09f552be98a5de4",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "The Stock Health card carries its own warehouse picker; choosing a site changes the in-stock / low / out counts. It writes the shared warehouse scope (Stock and Products follow, as they already do); the Warehouse role sees its own site, locked." },
    { "id": "A2", "check": "Every Order pipeline stage is a button that opens Order Import on the matching tab: Processing -> Received; Processed, Picked, Packed -> In Progress; Dispatched, Delivered -> Completed." },
    { "id": "A3", "check": "The sales trend draws at a fixed 220px height whatever its width, with axis text that does not scale, and shows the previous period as a faint dashed line." },
    { "id": "A4", "check": "One type scale on the Admin dashboard: every card title shares one style (no text-lg title), big numbers share one number face, chart labels are a fixed size, and the PO Inbox tile drops its monospace capitals." },
    { "id": "A5", "check": "Everything leads somewhere through useDashNav: Revenue, Orders and Avg order value open Order Import; Collection rate opens Accounts; Top Products rows open Products; Top Customers rows open HoReCa; segments open HoReCa Insights; Promotions has View all. No link renders for a tab the role or build cannot open." },
    { "id": "A6", "check": "Layout, top to bottom: Needs attention; Key numbers; trend beside Top Reps (productivity folded in) and PO Inbox; Inventory & Dispatch; Top Products | Top Customers with segment counts; Programs (Promo ROI top 3, My Targets)." },
    { "id": "A7", "check": "The Admin dashboard looks and behaves as above on dev.", "manual": "deploy:dev, then walk it at 1440px and at phone width, clicking every tile and stage, with screenshots" }
  ],
  "failFirst": [
    { "file": "__tests__/inventoryDispatchSection.test.tsx", "test": "InventoryDispatchSection > offers a warehouse picker in the Stock Health card", "proves": ["A1"] },
    { "file": "__tests__/inventoryDispatchSection.test.tsx", "test": "InventoryDispatchSection > a pipeline stage opens the matching order list", "proves": ["A2"] },
    { "file": "__tests__/dashboard/orderImportInitialTab.test.tsx", "test": "OrderImportPage > opens on the tab it is given", "proves": ["A2"] },
    { "file": "__tests__/dashboard/salesLineChart.test.tsx", "test": "SalesLineChart > draws at a fixed height whatever its width", "proves": ["A3"] },
    { "file": "__tests__/dashboard/adminDashboardLayout.test.tsx", "test": "AdminDashboard layout > every card title shares one style", "proves": ["A4"] },
    { "file": "__tests__/dashboard/adminDashboardLayout.test.tsx", "test": "AdminDashboard layout > the Revenue tile opens Order Import", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

PR 2 of 3 of the dashboard revamp. The owner reviewed PR 1 on dev and was not
happy: Stock Health cannot be pointed at a warehouse, the pipeline leads
nowhere, the sales trend is far too large, "Top Selling Products" shouts, and
the fonts are inconsistent. This PR fixes each of those and re-lays out the
Admin/Manager dashboard on the PR 1 kit, so the page itself changes this time.

## Approach

- `components/admin/InventoryDispatchSection.tsx`: `WarehousePicker` in the
  Stock Health header (replacing the "Showing:" chip), cards on `DashCard`,
  `onOpenOrders(tab)` for the pipeline. `components/charts/DispatchFunnelChart.tsx`:
  stages become buttons.
- `components/OrderImportPage.tsx`: an `initialTab` prop; `AdminView` /
  `AppShell` carry the requested tab when the dashboard navigates there.
- `components/charts/SalesLineChart.tsx`: a fixed-height responsive chart
  (Recharts, already a dependency) with 11px axis text and an optional
  previous-period series; the dashboard passes the previous window.
- `components/AdminDashboard.tsx`: re-laid out on `DashCard`, `KPICard`,
  `RankedList`, `TargetBar` and `useDashNav`. `HorizontalBarChart` and
  `ExpandableSection` leave the Admin page.
- `components/admin/POInboxStatsTile.tsx`: restyled to the shared type scale.

## Out of scope

- The Rep dashboard (PR 3).
- An exact single-status filter on Order Import; a stage opens its tab.
- New data, queries or server changes.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `InventoryDispatchSection > offers a warehouse picker in the Stock Health card` fails on base, passes on tip; on dev the card shows the picker set to Amadiya (AMADIYA) | |
| A2 | claimed | `InventoryDispatchSection > a pipeline stage opens the matching order list`, `OrderImportPage > opens on the tab it is given`; on dev, clicking Confirmed opened Order Import on In Progress | The tab lists all orders in those statuses, not only this period's |
| A3 | claimed | `SalesLineChart > draws at a fixed height whatever its width`; on dev at 1440px the trend is 220px with 11px axis text and a dashed previous-period line | |
| A4 | claimed | `AdminDashboard layout > every card title shares one style` (all h3 share CARD_TITLE_CLASS, none text-lg); on dev every card title, number and toggle matches | |
| A5 | claimed | `AdminDashboard layout > the Revenue tile opens Order Import`; useDashNav unit tests from NX-0041 cover role/module withholding | |
| A6 | claimed | on dev: Needs attention, Key numbers with trend / Top reps / PO Inbox, Inventory & dispatch, Breakdown, Programs, in that order | |
| A7 | not-claimed | dev serves `5ec2703` (previous dev build + this branch), health 200; walked at 1440px with screenshots | Phone width not checked: the Chrome window does not resize below desktop width here |

Full suite: 461 files / 7050 tests pass. `tsc --noEmit`, `lint` (baseline pruned by 13), `check:overlays`, `check:viewport` clean.

### Not claimed

- Phone width (360px) was not checked in a browser, and the `mobile` Playwright project was not run.
- The Manager role was not walked; it uses the same page, and its link withholding (no Users tab) is covered by the useDashNav tests.
- A pipeline stage opens the whole Order Import tab, not only the orders that stage counts for the chosen period (brief: out of scope).
- Colour contrast of the restyled cards was not measured.
- Dev also carries unmerged NX-0040; the dev check is of that combination.
