# NX-0041 â€” Dashboard kit: one set of calm, actionable parts (and Set Targets works again)

```json brief
{
  "id": "NX-0041-dashboard-kit",
  "base": "ed0823bbca15cd4506d7713a0a243fcbd8a8bbda",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "On the Admin Dashboard, clicking Set Targets opens the Sales Targets dialog listing the signed-in user's existing targets, instead of crashing (it passes props SalesTargetModal does not take, so existingTargets is undefined)." },
    { "id": "A2", "check": "KPICard renders as a button only when it has an onClick; without one it renders no button (today every tile is a cursor-default button)." },
    { "id": "A3", "check": "useDashNav(role, navigate) returns a handler for a tab the role can open whose module is on, and undefined for a tab the role cannot open or whose module is off." },
    { "id": "A4", "check": "ActionItemsBoard rows that have an onClick are buttons a keyboard can reach and activate with Enter; dismiss and snooze are reachable by Tab; the board still reads and writes the same storage key and BoardState shape." },
    { "id": "A5", "check": "TimePeriodToggle marks the selected period with aria-pressed=true and the others aria-pressed=false." },
    { "id": "A6", "check": "Kit parts behave: RankedList renders rows with an action as buttons and rows without as plain items; TargetBar shows achieved/target, the percent and en-AU dates; EmptyState renders its action; formatMoney formats whole and cent amounts in en-AU dollars and pctDelta returns 0/100 for a zero previous value as the dashboard does today." },
    { "id": "A7", "check": "Both dashboards still render for Admin, Manager, Field Rep and Office Rep; KPI tiles show the new calm style; nothing else on either page changes layout in this PR.", "manual": "deploy:dev, then walk both dashboards at 1440px and 360px with screenshots" }
  ],
  "failFirst": [
    { "file": "__tests__/dashboard/adminSetTargets.test.tsx", "test": "AdminDashboard Set Targets > opens the targets dialog with the user's existing targets", "proves": ["A1"] },
    { "file": "__tests__/dashboard/kpiCard.test.tsx", "test": "KPICard > renders no button when it has no onClick", "proves": ["A2"] },
    { "file": "__tests__/dashboard/useDashNav.test.ts", "test": "useDashNav > withholds a tab the role cannot open", "proves": ["A3"] },
    { "file": "__tests__/dashboard/actionItemsBoard.test.tsx", "test": "ActionItemsBoard > a clickable row is a keyboard-operable button", "proves": ["A4"] },
    { "file": "__tests__/dashboard/timePeriodToggle.test.tsx", "test": "TimePeriodToggle > marks the selected period with aria-pressed", "proves": ["A5"] },
    { "file": "__tests__/dashboard/kit.test.tsx", "test": "RankedList > renders a row with an action as a button", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

PR 1 of 3 of the dashboard revamp (plan approved 2026-11-19). The owner wants the
Admin and Rep dashboards calm and minimal, consistent with each other, actionable and
pleasant to look at. This PR builds the shared parts both pages will be rebuilt on,
makes the existing interactive pieces keyboard-usable, and fixes the Admin "Set Targets"
button, which crashes on main today.

## Approach

- `components/dashboard/`: new `DashCard`, `RankedList`, `TargetBar` and `EmptyState`.
  `KPICard` and `DeltaBadge` are reworked in place to the visual spec: a flat white card
  with a hairline border, a large tabular number, a soft delta pill with "vs prev.", and
  a button only when clickable.
- `lib/dashboardFormat.ts`: `formatMoney` (en-AU) and `pctDelta`. The latter replaces
  the private `delta()` in `AdminDashboard.tsx`, with identical results.
- `hooks/useDashNav.ts`: wraps `roleCanOpenTab` (`lib/adminTabUrl.ts`) and the tabâ†’module
  map, so a link to a tab the user cannot open is never rendered as clickable.
- `components/ActionItemsBoard.tsx`: rows become buttons; snooze and dismiss become
  visible on focus; restyled to the kit. The storage keys and the `BoardState` shape are unchanged.
- `components/dashboard/TimePeriodToggle.tsx`: adds `aria-pressed`.
- `components/AdminDashboard.tsx`: passes `SalesTargetModal` the props it actually
  takes (`isOpen`, `existingTargets`, `userId`, `onSave`, `onClose`), and target dates use `'en-AU'`.
  No layout change.

## Out of scope

- Re-laying out either dashboard (PRs 2 and 3), the period picker on Rep, the rep
  `onNavigate` prop, and the trend chart restyle.
- Deleting `HorizontalBarChart`, `ExpandableSection` or `AlertBanner`, which are still in use until PRs 2 and 3.
- Gating Rep's static `SalesTargetModal` import.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `AdminDashboard Set Targets > opens the targets dialog with the user's existing targets` fails on base with `TypeError: Cannot read properties of undefined (reading 'filter')`, passes on tip; on dev (`923588d`) Edit opened the dialog showing the existing $20,000 revenue target | |
| A2 | claimed | `KPICard > renders no button when it has no onClick`, plus `is a named button when it has an onClick` | |
| A3 | claimed | `useDashNav > withholds a tab the role cannot open`, `useDashNav with field_ops off > withholds a tab whose module is off` | |
| A4 | claimed | `ActionItemsBoard > a clickable row is a keyboard-operable button`, `… dismiss and snooze are named buttons, and dismissing persists under the same key` (asserts the `nexorder_v1_admin_action_items` key and the four BoardState fields) | |
| A5 | claimed | `TimePeriodToggle > marks the selected period with aria-pressed` | |
| A6 | claimed | `__tests__/dashboard/kit.test.tsx` (RankedList, TargetBar, EmptyState, DashCard, dashboardFormat) | |
| A7 | not-claimed | dev serves `923588d` (merge of dev's previous `a1c4b4a` = main + unmerged NX-0040, with this branch), health 200; Admin dashboard walked at 1440px: new KPI tiles, Action Items header "116 open · 7 urgent", columns, Set Targets | Only partly verified: Rep, Manager and Office Rep not walked; 360px not checked in a browser — see Not claimed |

Full suite: 458 files / 7044 tests pass. `tsc --noEmit`, `lint` (baseline pruned by 2), `check:overlays`, `check:viewport`, `check:demo` all clean.

### Not claimed

- The Rep, Manager and Office Rep dashboards were not walked in a browser — doing so meant signing the owner's session out. Their only changes are the shared KPICard / ActionItemsBoard styling, covered by the tests above.
- 360px: the Chrome window would not resize below desktop width, so the handheld layout of the new tiles and board is not eyeballed. The `mobile` Playwright project was not run.
- Colour contrast of the new styles was not measured (`tests/contrast/` needs credentials and is not in CI); the classes follow the CLAUDE.md rules (`stone-600` on tints, `nexgen-blue-dark` text).
- Dev currently also carries unmerged NX-0040; the dev check is of that combination.
