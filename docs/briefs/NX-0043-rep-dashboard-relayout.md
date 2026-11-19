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
    { "id": "A7", "check": "The Rep dashboard works for a Field Rep and an Office Rep on dev.", "manual": "deploy:dev; the owner walks it as a Field Rep and an Office Rep (the assistant may not sign in to the app on this host)" }
  ],
  "failFirst": [
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > KPI deltas compare this period with the previous one", "proves": ["A1"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > offers the same period picker as Admin", "proves": ["A1"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > a top customer row starts an order", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > a low-stock row opens Stock", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashNav.test.ts", "test": "repDashNav > withholds a view the rep cannot open", "proves": ["A4"] },
    { "file": "__tests__/dashboard/repDashboardLayout.test.tsx", "test": "RepDashboard > every card title shares one style", "proves": ["A5", "A6"] }
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
