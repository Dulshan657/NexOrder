# NX-0021 — the shared page header on the admin pages

```json brief
{
  "id": "NX-0021-admin-page-headers",
  "base": "34f809c76c5f85f3ae61a4d8473812d70c1d0637",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "Products, HoReCa, HoReCa Insights, Promotions, Users, Suppliers, Accounts, Audit Log, System Health, PO Inbox, New Order, Order Import, Scheduled Visits and Walk-in Review render through PageFrame and PageHeader, with no hand-rolled page h1 and no header icon." },
    { "id": "A2", "check": "Those fourteen titles come from ADMIN_TAB_LABELS, so 'Manage Users', 'HoReCa Customers', 'Accounts Receivable' and 'Scheduled Visit Management' are gone." },
    { "id": "A3", "check": "Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs; their hand-rolled tab rows are gone. Audit Log's Mutations / Errors switch does too." },
    { "id": "A4", "check": "New Order and System Health start at the standard spot, no longer flush to the edge, and New Order's form stays capped at max-w-5xl.", "manual": "Measured on dev at 1280px." },
    { "id": "A5", "check": "At 360px all fourteen pages have no sideways overflow, and header buttons and menus stay reachable, including PO Inbox's two menus.", "manual": "Measured on dev at 360px; --project=mobile against a build of the branch, with any skipped spec named in FINAL." },
    { "id": "A6", "check": "Reps and customers see the same header on the pages they share: HoReCa, Accounts and Order Import.", "manual": "Logged in as Field Rep and Customer on dev." },
    { "id": "A8", "check": "From 640px to 1279px, PO Inbox's Auto-approval and Mailboxes panels open fully inside the page, because wrapped header controls stay on the right from sm up.", "manual": "Both panels opened as Admin on dev at 640, 700, 744, 768, 820, 912, 1024 and 1280px." },
    { "id": "A7", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the admin pages use PageFrame and PageHeader with no hand-rolled h1 or header icon", "proves": ["A1"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the admin pages take their title from ADMIN_TAB_LABELS", "proves": ["A2"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs", "proves": ["A3"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Audit Log's mode switch uses PageTabs", "proves": ["A3"] },
    { "file": "__tests__/pageHeader.test.tsx", "test": "PageHeader > keeps wrapped actions on the right from sm up", "proves": ["A8"] }
  ],
  "allow": []
}
```

## Goal

The admin pages use the same header style only loosely: several titles disagree with
the sidebar, five use `h2`, and two sit flush to the edge. This finishes them, and
covers the pages reps and customers share with admins.

## Approach

- Each page swaps its header for `PageFrame` and `PageHeader`; header buttons drop to
  the standard size (`px-3 py-1.5 touch-target-y text-sm`), keeping their colours.
- **Products:** picker, "Hide not stocked here", Import and Add go in the header.
- **HoReCa:** the count leaves the header; the list already shows it, as the filtered
  count while a filter is on.
- **HoReCa Insights:** the count leaves the header and isn't moved; the segment cards show the split.
- **Promotions:** the filter becomes `PageTabs`, with counts as badges.
- **Audit Log:** the count leaves the header; the page's footer already shows it.
  "Refreshing" text goes, and the Refresh button's spinner still shows it. The Mutations /
  Errors chips are a tab switch, so they become `PageTabs` (added during the work).
- **System Health:** the title is "System Health"; the status banner stays in the body.
- **PO Inbox:** its private tab button goes; the Auto-approval and Mailboxes menus move
  to the header, right; the stats tile sits in a row under the title, as Warehouse's KPI
  strip does (changed during the work: in the header it moved the title for Managers and
  pushed the menus to a second row for Admins at 1280px).
- **New Order:** standard frame, with the form below still capped at `max-w-5xl`.
- **Order Import:** tabs become `PageTabs` and move from centre to left; the QR approval
  panel stays above them; the Back button keeps its behaviour and takes the standard size;
  a tab with no orders shows no count, where it used to show 0.
- **Scheduled Visits:** tabs become `PageTabs` and lose their icons.
- **Walk-in Review:** the two filter buttons become `PageTabs`.
- `PageHeader`: wrapped actions stay on the right from `sm` up (`sm:ml-auto`). Added after
  the gate found PO Inbox's right-anchored menu panels cut off between 640px and 912px, where
  the actions wrapped to the left. Phones keep left-aligned controls.
- `__tests__/appShellSidebarLayout.test.ts`: its check for the text "Scheduled Visit
  Management" becomes a check for the shared title. Same number of assertions.

Descriptions:

| Page | Sentence | |
|---|---|---|
| Products | Your catalogue: add, edit and import products. | **new** |
| HoReCa | Your restaurant, hotel and café customers. | **new** |
| HoReCa Insights | How your customers break down by segment. | **new** |
| Promotions | Manage discounts, deals, and clearance pricing | unchanged |
| Users | Invite staff and customers and manage their roles. | **new** |
| Suppliers | The suppliers you buy stock from. | **new** |
| Accounts | Outstanding balances and how long they have been owing. | **new** |
| Audit Log | A record of every sensitive change and client error. | **new** |
| System Health | Live status of the database, app and client errors. | **new** |
| PO Inbox | Inbound purchase orders extracted from email, ready to review. | unchanged |
| New Order | Key an order in for a customer and send it to the warehouse to pick. | reworded |
| Order Import | Review incoming orders and move them through to completion. | **new** |
| Scheduled Visits | Plan, assign and track visits to customers. | **new** |
| Walk-in Review | Temporary customers reps added during visits, ready to review and promote. | reworded |

## Out of scope

- Rep Dashboard, Order home, Order History, rep Scheduled Visits and Shop (batch 4).
- The whole-app version of the drift test (batch 4).
- Manager blank pages and the dead Order Import Back button.
- Tables, cards and empty states.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `page header adoption > the admin pages use PageFrame and PageHeader with no hand-rolled h1 or header icon` fails on base by assertion, passes on tip | |
| A2 | claimed | `page header adoption > the admin pages take their title from ADMIN_TAB_LABELS` fails on base by assertion, passes on tip | |
| A3 | claimed | `page header adoption > Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs` and `page header adoption > Audit Log's mode switch uses PageTabs` fail on base by assertion, pass on tip. On dev at 5c93b50 as Admin at 360px, each of the 19 tabs on those six pages was pressed and became the current tab | The source tests prove which component is used; the pressing is the only proof the tabs work |
| A4 | claimed | Measured on dev at 5c93b50 as Admin at 1280px: both titles at x=32, y=32 within main. Measured on dev at 9666be8 at 1920px: New Order's form is 1024px wide, starting at x=32 under the title. The header fix since then does not touch the form | The form no longer centres on a wide screen, so it lines up with the title |
| A5 | claimed | Measured on dev at 5c93b50 as Admin at 360px: default view of all fourteen, and all 19 tabs on the six pages with tabs, 0px overflow; page header buttons and page tabs 44px, including New Template. PO Inbox's menus open inside the screen (8 to 352 of 360). `--project=mobile` against a build of the branch: 27 passed, 2 skipped. Skipped: `touch-targets.spec.ts:35` Putaway and Replenishment walk cards | Of these fourteen, the mobile suite visits only Products, so the 360px evidence is the measurement script. PO Inbox overflowed 26px at 360px through its inner status row, which this batch fixed. The Aliases tab has its own inner row at 42px, not changed |
| A6 | claimed | On dev at 5c93b50 at 1280px: Field Rep and Office Rep on HoReCa, Order Import and Accounts, and Customer (Seaside Bistro) on Accounts, each with the shared title at x=32, y=32 and 0px overflow | Customers never see Order Import or HoReCa: `OrdersHistoryView` gives them Order History, which is batch 4 |
| A8 | claimed | `PageHeader > keeps wrapped actions on the right from sm up` fails on base by assertion, passes on tip. On dev at 5c93b50 as Admin, both panels opened fully inside the page at 640, 700, 744, 768, 820, 912, 1024 and 1280px | Found by the gate on the first attempt |
| A7 | not-claimed | | Dev serves 5c93b50f65d11b52c5b24ba41f023a277601d394, health 200, but that is a throwaway merge so the unmerged NX-0012/0013/0014 demo work stays on dev, not the merge sha. Not pushed |

Added during the work, each recorded in a brief-only revision or here: Audit Log's Mutations / Errors switch became `PageTabs`; PO Inbox's stats tile sits under the title rather than in the header; the stats tile is a two-by-two grid below `sm`; the Auto-approval and Mailboxes buttons reach the 44px floor; PO Inbox's status row scrolls sideways instead of overflowing and reaches the tap floor; `PageHeader` keeps wrapped actions on the right from `sm` up, which also moves wrapped controls on the batch 1 and 2 pages at those widths. `docs/claude/po-inbox.md` now lists the Archive sub-tab.

### Not claimed

- No walk on the RS35 handheld. All 360px evidence is Playwright at that viewport.
- Tablet widths were measured for PO Inbox's menus only. The other pages, and the batch 1 and 2 pages whose wrapped controls `sm:ml-auto` moves to the right, were not walked at those widths.
- Field Rep, Office Rep and Customer were measured at 1280px only. Manager was measured at 1280px only, on the nine of the fourteen pages a Manager can open by link: Promotions, Users, Suppliers, Audit Log and System Health sent them to the Dashboard, so those five were not seen as Manager.
- Nothing was saved through these pages in a browser, and New Order was not submitted. The controls pressed were sign-in, sidebar links, toast close buttons, page tabs and PO Inbox's two menus. A script's stray click also opened one PO's detail window against a local build, and it was left without any action.
- PO Inbox's row cards are still cramped at 360px, with badges overlapping. Cards are out of scope and the layout there was not changed.
- Scheduled Visits' body table still scrolls inside its own box at 360px. Tables are out of scope.
- Order Import's Back button still does nothing for Admin and Manager, and Manager blank pages were not looked at. Both are a separate task by owner decision.
- While a filter is on, HoReCa shows the filtered count only, so the total is not on the page.
- Page descriptions are hidden below `md`, so phone users do not see them.
- The ten new sentences have not been read by staff who use these pages.
- `--project=contrast` covers the Warehouse surfaces only (1 passed), so contrast on these admin pages was not measured. The chromium project was not run.
- Playwright logins used the demo accounts the dev login page publishes.
