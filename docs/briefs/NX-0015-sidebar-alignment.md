# NX-0015 — Sidebar: rows that line up, labels on one line

```json brief
{
  "id": "NX-0015-sidebar-alignment",
  "base": "d645c55f2e41045a04ca5477a9b1793deb6d7d40",
  "approved": "2026-11-04 owner",
  "acceptance": [
    { "id": "A1", "check": "A sidebar row's icon cannot shrink and its label cannot wrap: the icon carries shrink-0 and the label carries truncate and min-w-0." },
    { "id": "A2", "check": "A row sets aria-current=\"page\" only when active, and calls onClick when pressed." },
    { "id": "A3", "check": "Every count badge has the same shape and differs only in colour; no badge renders when the count is 0." },
    { "id": "A4", "check": "AppShell's sidebar is w-56 and its nav is px-3, and no nav row is hand-written any more (no 'w-5 h-5 mr-3' left in AppShell)." },
    { "id": "A5", "check": "No user-visible text under components/admin or components/scheduled-visits reads 'ScheduledVisit'; the heading reads 'Scheduled Visit Management'." },
    { "id": "A6", "check": "For Admin, Manager, Field Rep, Warehouse and Customer, no nav label wraps or truncates, including when active; icon and label left edges match across rows, and icons line up with the logo.", "manual": "Chrome on nexorder.vercel.app, measured on Windows with real scrollbars" },
    { "id": "A7", "check": "Products at a 1280px viewport is measured before and after, and the result is reported. If it flips to cards, the owner decides; the 1000px threshold is not lowered.", "manual": "Chrome at 1280px on dev" },
    { "id": "A8", "check": "The mobile suite still passes at 360x720, and the drawer opens and navigates by row name.", "manual": "npx playwright test --project=mobile" },
    { "id": "A9", "check": "Deployed to dev without removing the NX-0011, NX-0013 and NX-0014 demo work; /version.json shows the deployed sha.", "manual": "deploy:dev stacked on the current dev commit" }
  ],
  "failFirst": [
    { "file": "__tests__/sidebarNavItem.test.tsx", "test": "SidebarNavItem > keeps the icon from shrinking and the label from wrapping", "proves": ["A1"] },
    { "file": "__tests__/sidebarNavItem.test.tsx", "test": "SidebarNavItem > marks only the active row as the current page and fires onClick", "proves": ["A2"] },
    { "file": "__tests__/sidebarNavItem.test.tsx", "test": "SidebarNavItem > draws every badge in one shape and hides a zero count", "proves": ["A3"] },
    { "file": "__tests__/appShellSidebarLayout.test.ts", "test": "AppShell sidebar layout > is 224px wide with the nav padded to the logo edge", "proves": ["A4"] },
    { "file": "__tests__/appShellSidebarLayout.test.ts", "test": "AppShell sidebar layout > has no hand-written nav rows left", "proves": ["A4"] },
    { "file": "__tests__/appShellSidebarLayout.test.ts", "test": "Scheduled Visit wording > shows no 'ScheduledVisit' to a user", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

The sidebar's rows don't line up, and "Scheduled Visits" and "HoReCa Insights" wrap
onto two lines. The owner wants tidy rows on one line, at 224px with tighter padding.
Revised from 216px on 2026-11-04 with the owner: measured on dev, Products already shows
cards at 1280px on Windows, so 216px protected nothing, and it still cut off a Field
Rep's "Scheduled Visits" beside a count badge. "ScheduledVisit" with no space is also fixed everywhere a user sees it.

## Approach

- New `components/SidebarNavItem.tsx`: one definition of a row, replacing every
  hand-copied nav button in `components/AppShell.tsx`. Gates, order and labels are unchanged.
- `aside` w-52 → w-56 and `nav` px-4 → px-3, so icons and headings start at the logo's
  24px edge. The `<ProfileMenu>` footer is aligned too if it differs.
- `.sidebar-nav-scroll` in `index.css`: 4px scrollbar, stable gutter.
- Text-only fixes in `RepDashboardV2`, `ScheduledVisitDetail`, `ScheduledVisitList`, `ScheduledVisitsView`, `ScheduledVisitsAdmin`, `ChangeRequestModal`, `ScheduledVisitForm`,
  `ScheduledVisitTemplateForm` and `ScheduledVisitWizard`. Type names are untouched.
- Comments stating 208px are updated in the five files that carry them.

## Out of scope

Row spacing, group spacing, colours, the active and hover styles, heading styles, badge
colours, nav order, collapsing the sidebar, and the Products 1000px threshold.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `SidebarNavItem > keeps the icon from shrinking and the label from wrapping` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `SidebarNavItem > marks only the active row as the current page and fires onClick` fails on base, passes on tip | |
| A3 | claimed | `SidebarNavItem > draws every badge in one shape and hides a zero count` fails on base, passes on tip | |
| A4 | claimed | `AppShell sidebar layout > is 224px wide with the nav padded to the logo edge` and `> has no hand-written nav rows left` fail on base, pass on tip | Revised from 216px with the owner after measuring |
| A5 | claimed | `Scheduled Visit wording > shows no 'ScheduledVisit' to a user` fails on base, passes on tip | Two more strings fixed in RepDashboardV2, outside the folders the test scans |
| A6 | not-claimed | | Admin measured on dev at 224px: all 27 rows one line, icons at 24px, labels at 56px, profile at 24px, no clipping with or without active weight. Field Rep, Warehouse, Manager and Customer were not logged in; their labels were checked by text-width calculation only |
| A7 | claimed | Measured with Windows scrollbars, app constrained to the width in a maximised window: at 208px the container is 993px at 1280; at 224px it is 977px at 1280, 993px at 1296, 1001px at 1304. Cards at 1280 before and after; table from about 1303px | Threshold not changed |
| A8 | not-claimed | | `--project=mobile`: 24 passed, 2 skipped, 3 failed. All 3 are products-handheld and stopped on the missing E2E_ADMIN_EMAIL, so they never ran. The Warehouse specs do open the drawer and navigate by row name |
| A9 | claimed | /version.json = 7271130bfef474faba7ee77f612702ccbc57ba42, health 200 | A throwaway merge of this branch onto 68d3498, so the NX-0011/0013/0014 demo work stayed on dev. Not pushed |

### Not claimed

- No login as Field Rep, Manager, Warehouse or Customer. A two-digit badge beside an active "Scheduled Visits" fits by calculation (110.2px + 4px + about 24px against 139px), not by observation.
- No check on macOS, or with overlay scrollbars generally. There the content area is about 12px wider than measured here.
- No browser walk on the RS35 handheld.
- The 1280px readings constrain the app inside a wider window, because the window could not be resized. Viewport breakpoints still saw the wide window; only the container width was at 1280.
