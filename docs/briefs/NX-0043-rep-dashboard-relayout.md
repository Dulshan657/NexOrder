# NX-0043 — Rep dashboard, re-laid out on the shared kit and type scale

```json brief
{
  "id": "NX-0043-rep-dashboard-relayout",
  "base": "7b949947d2b197d126dbb6bf31376bf98c0fbe21",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "The Rep dashboard has the same period picker as Admin; Revenue, Orders and Avg order value count the rep's own orders in that period, and their deltas compare with the previous period (not the first half of all their orders against the second half)." },
    { "id": "A2", "check": "Visit completion is measured over the chosen period and compared with the previous one, instead of a fixed last 30 days." },
    { "id": "A3", "check": "Layout, top to bottom: greeting with visits-today and $-to-go chips; pending QR approvals; Today's route with segment, days since last order and amount owed inline (no More details expander); Needs attention; Targets; Key numbers with the period picker on the band; trend; Top customers | Top products, shown directly (no collapsed sections).", "manual": "deploy:dev; the owner walks it as a Field Rep and an Office Rep" },
    { "id": "A4", "check": "Everything leads somewhere the rep can go, under the sidebar's own rules: Revenue/Orders/AOV open Order History; Visit completion and the no-visits card open Scheduled Visits (Field Rep with field_ops only); a top customer or reorder-due row starts an order; an at-risk row opens a visit check-in; low-stock rows and top products open Stock (where stock is shown); the amount-owed chip opens Accounts (invoicing only). No link renders for a view the rep cannot open." },
    { "id": "A5", "check": "Same look as Admin: every card title shares DashCard's one style, numbers share one face, the trend is the 220px chart with the previous period dashed, and trend days use the Sydney calendar keys (not UTC)." },
    { "id": "A6", "check": "Top customers and products follow the period (no stale memo), and every date is formatted en-AU." },
    { "id": "A8", "check": "From the owner's Field Rep walk: Targets lists only targets that have not ended (ended ones sit behind a 'Past targets (n)' toggle); the '$ to go' chip comes from the current revenue target and is absent when there is none; Visit completion shows no change when the period has no planned visits; and the Visit completion tile is hidden from Office Reps." },
    { "id": "A7", "check": "The Rep dashboard works for a Field Rep and an Office Rep on dev.", "manual": "deploy:dev; the owner walks it as a Field Rep and an Office Rep (the assistant may not sign in to the app on this host)" }
  ],
  "failFirst": [
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > KPI deltas compare this period with the previous one", "proves": ["A1"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > offers the same period picker as Admin", "proves": ["A1"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > visit completion follows the period", "proves": ["A2"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > a top customer row starts an order", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > a low-stock row opens Stock", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashNav.test.ts", "test": "repDashNav > withholds a view the rep cannot open", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashboardShopOff.test.tsx", "test": "RepDashboard without the shop module > offers no start-order link", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > every card title shares one style", "proves": ["A5", "A6"] },
    { "file": "__tests__/dashboard/repDashboardWalkFixes.test.tsx", "test": "RepDashboard walk fixes > shows only current targets, with ended ones behind Past targets", "proves": ["A8"] },
    { "file": "__tests__/dashboard/repDashboardWalkFixes.test.tsx", "test": "RepDashboard walk fixes > hides Visit completion from an Office Rep", "proves": ["A8"] },
    { "file": "__tests__/dashboard/repDashboardWalkFixes.test.tsx", "test": "RepDashboard walk fixes > shows no visit change when nothing was planned", "proves": ["A8"] }
  ],
  "allow": []
}
```

## Goal

PR 3 of 3 of the dashboard revamp. The Admin dashboard was rebuilt in NX-0042
after the owner's review; the Rep dashboard still has the old look, fake
half-split deltas, collapsed analytics and rows that lead nowhere. This gives
reps the same calm, consistent, actionable page.

## Approach

- `lib/repDashNav.ts`: a pure "may this rep open this view" rule mirroring the
  sidebar in `AppShell.tsx` (orders: sales_orders; accounts: invoicing and not
  QR staff; scheduled_visits: Field Rep with field_ops; stock:
  inventory_dispatch and showStockTab; hoReCas: reps).
- `AppShell.tsx` → `views/RepDashboardView.tsx` → `RepDashboardV2`: a new
  `onNavigate(view)` prop, gated by that rule.
- `components/RepDashboardV2.tsx`: rebuilt on `DashCard`, `KPICard`,
  `RankedList`, `TargetBar`, `EmptyState`, `TimePeriodToggle`,
  `useDashboardRange` and `SalesLineChart`; KPI deltas from `useMetric` over the
  current and previous range; visit completion from `getVisitCompletionRate`
  over both.

## Out of scope

- The Admin dashboard; server, data or query changes.
- The NX-0042 gate's tidy-ups (stale Order Import hand-off, brief wording, the
  order-numbers e2e spec run) — a follow-up PR.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `RepDashboard > KPI deltas compare this period with the previous one` (prev month 2×$100, this month $300 → $300.00, +50.0%; the old half-split said +300% on all-time $500), `RepDashboard > offers the same period picker as Admin` | |
| A2 | claimed | `RepDashboard > visit completion follows the period` (this period 2/2 visited, previous 1/2 → 100%, +50.0 pts) | Added after check:brief flagged A2 as unproved |
| A3 | claimed | Walked on dev (`454e1c0`) as Field Rep Charlie Brown and Office Rep Emma Chen: layout order as specified; Office Rep has no route card, no Visit completion tile, no Scheduled Visits links | Owner signed in; the assistant drove the page |
| A4 | claimed | `RepDashboard > a top customer row starts an order`, `RepDashboard > a low-stock row opens Stock`, `repDashNav > withholds a view the rep cannot open`, `RepDashboard without the shop module > offers no start-order link` | The gate found start-order links reaching a blank page on a build without the shop module (Amadiya); fixed in `repCanStartOrder`. Reorder, at-risk, accounts and visits links are wired the same way but not each unit-tested |
| A5 | claimed | `RepDashboard > every card title shares one style`; trend is the shared `SalesLineChart` with `previous`; `dailySeries` uses `appDateKeysBetween` | |
| A6 | claimed | rankings are memoised on the period's metric rows; every date goes through `'en-AU'` / `formatShortDate` | |
| A7 | claimed | Field Rep: Plan visits → Scheduled Visits, low-stock row → Stock, at-risk Visit → check-in (cancelled), Revenue → the rep's orders. Office Rep: dashboard renders with her 61 orders after a reload | Found on the way: the app keeps the previous user's cached data across sign-out/sign-in (see Not claimed) |
| A8 | claimed | `RepDashboard walk fixes > shows only current targets, with ended ones behind Past targets`, `… hides Visit completion from an Office Rep`, `… shows no visit change when nothing was planned` | From the Field Rep walk: six targets incl. ended Oct/Apr ones, a "$1,537 to go" chip off an ended target, and "−86 pts" against 0 planned visits |

Full suite: 463 files / 7058 tests pass. `tsc --noEmit`, `lint`, `check:overlays`, `check:viewport` clean.

Also in this PR, not named in the Approach: `ExpandableSection`, `HorizontalBarChart` and `AlertBanner` are deleted — the plan scheduled it for PR 3 once nothing used them, and `git grep` finds no users. `components/AdminDashboard.tsx` now imports the shared `Band` and `dailySeries` instead of its local copies (no behaviour change).

### Not claimed

- **Not fixed here, pre-existing:** signing out and in as someone else in the same tab keeps the previous user's cached orders (TanStack cache is never cleared on an auth change, keys carry no user, 5-min staleTime). Emma's dashboard first showed Charlie's 130 orders; a reload fixed it. Reported to the owner for its own PR.
- While orders load, the dashboard shows "All clear" and $0 rather than a loading state.
- Phone width (360px) not checked in a browser; the `mobile` Playwright project was not run.
- Colour contrast of the restyled route hero and chips not measured.
- Dev also carries unmerged NX-0040; the dev check is of that combination.
- `visit completion follows the period` now renders a Field Rep: Visit completion is hidden from Office Reps by A8.
- Visit completion counts routes the rep created (`createdBy`), not ones a manager assigned to them — existing service behaviour, now in a headline tile.
