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
    { "id": "A7", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the admin pages use PageFrame and PageHeader with no hand-rolled h1 or header icon", "proves": ["A1"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the admin pages take their title from ADMIN_TAB_LABELS", "proves": ["A2"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs", "proves": ["A3"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Audit Log's mode switch uses PageTabs", "proves": ["A3"] }
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
- **HoReCa:** the count leaves the header; the list already shows it.
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
  panel stays above them; the Back button is unchanged.
- **Scheduled Visits:** tabs become `PageTabs` and lose their icons.
- **Walk-in Review:** the two filter buttons become `PageTabs`.
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
| A3 | claimed | `page header adoption > Promotions, Walk-in Review, PO Inbox, Order Import and Scheduled Visits use PageTabs` and `page header adoption > Audit Log's mode switch uses PageTabs` fail on base by assertion, pass on tip | |
| A4 | claimed | Measured on dev at 9666be8 as Admin at 1280px: both titles at x=32, y=32 within main. At 1920px New Order's form is 1024px wide, starting at x=32 under the title | The form no longer centres on a wide screen, so it lines up with the title |
| A5 | claimed | Measured on dev at 9666be8 as Admin at 360px on all fourteen: 0px overflow, no header control past the screen edge, header buttons and tabs 44px. PO Inbox's menus open inside the screen (8 to 352 of 360). `--project=mobile` against a build of the branch: 27 passed, 2 skipped. Skipped: `touch-targets.spec.ts:35` Putaway and Replenishment walk cards | PO Inbox overflowed 26px at 360px through its inner status row, which this batch fixed |
| A6 | claimed | On dev at 9666be8 at 1280px: Field Rep on HoReCa, Order Import and Accounts, and Customer (Seaside Bistro) on Accounts, each with the shared title at x=32, y=32 and 0px overflow | Customers never see Order Import: `OrdersHistoryView` gives them Order History, which is batch 4. HoReCa's header was not checked as a Customer, because a Customer has no such page |
| A7 | not-claimed | | Dev serves 9666be8ba24b9ff55705cfafb52762861f6b97d1, health 200, but that is a throwaway merge so the unmerged NX-0012/0013/0014 demo work stays on dev, not the merge sha. Not pushed |

Added during the work, each recorded in a brief-only revision or here: Audit Log's Mutations / Errors switch became `PageTabs`; PO Inbox's stats tile sits under the title rather than in the header; the stats tile is a two-by-two grid below `sm`; the Auto-approval and Mailboxes buttons reach the 44px floor; PO Inbox's status row scrolls sideways instead of overflowing.

### Not claimed

- No walk on the RS35 handheld. All 360px evidence is Playwright at that viewport.
- Field Rep and Customer were measured at 1280px only. Manager was measured at 1280px only, on the nine of the fourteen pages a Manager can open by link: Promotions, Users, Suppliers, Audit Log and System Health sent them to the Dashboard, so those five were not seen as Manager.
- Nothing was saved through these pages in a browser, and New Order was not submitted. The controls pressed were sign-in, sidebar links, toast close buttons and PO Inbox's two menus. A script's stray click also opened one PO's detail window against a local build, and it was left without any action.
- PO Inbox's row cards are still cramped at 360px, with badges overlapping. Cards are out of scope and the layout there was not changed.
- Scheduled Visits' body table still scrolls inside its own box at 360px. Tables are out of scope.
- Order Import's Back button still does nothing for Admin and Manager, and Manager blank pages were not looked at. Both are a separate task by owner decision.
- Page descriptions are hidden below `md`, so phone users do not see them.
- The ten new sentences have not been read by staff who use these pages.
- `--project=contrast` covers the Warehouse surfaces only (1 passed), so contrast on these admin pages was not measured. The chromium project was not run.
- Playwright logins used the demo accounts the dev login page publishes.
