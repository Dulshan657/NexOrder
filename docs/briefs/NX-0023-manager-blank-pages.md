# NX-0023 — Managers get working Promotions and Suppliers, and no Users link

```json brief
{
  "id": "NX-0023-manager-blank-pages",
  "base": "f2e3d8811201ece8cd2c30e606b55b1c440926af",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "A Manager can open Promotions and Suppliers, by sidebar and by ?tab= link." },
    { "id": "A2", "check": "A Manager no longer sees Users in the sidebar, and a ?tab=Users link still lands on their normal page. An Admin still sees Users." },
    { "id": "A3", "check": "Every sidebar link a Manager can see opens a page they can render, and a test fails if a new link breaks that." },
    { "id": "A4", "check": "A Manager's click on any sidebar link shows a page with a title: no blank pages.", "manual": "Every sidebar link clicked as Manager on dev at 1280px." },
    { "id": "A5", "check": "A Manager can really save: create, edit and delete a promotion, and create, edit and delete a supplier.", "manual": "Done as Manager in a browser on dev with clearly named test records, each deleted afterwards. The result of each is named in FINAL." },
    { "id": "A6", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/adminTabUrl.test.ts", "test": "roleCanOpenTab > lets Manager open Promotions and Suppliers", "proves": ["A1"] },
    { "file": "__tests__/managerSidebarTabs.test.ts", "test": "Manager tabs > AdminView renders Promotions and Suppliers for a Manager", "proves": ["A1"] },
    { "file": "__tests__/managerSidebarTabs.test.ts", "test": "Manager tabs > the Users link is for Admins only", "proves": ["A2"] },
    { "file": "__tests__/managerSidebarTabs.test.ts", "test": "Manager tabs > every link a Manager can see opens a tab they can render", "proves": ["A3"] }
  ],
  "allow": []
}
```

## Goal

Managers see three sidebar links that open blank pages. By owner decision, Promotions and
Suppliers now work for them, since the server already allows both, and Users is hidden,
since the server refuses a Manager's invites and role changes.

## Approach

- `components/AdminView.tsx`: Promotions and Suppliers render for Admin and Manager.
  Users stays Admin-only.
- `lib/adminTabUrl.ts`: Manager's tab list gains Promotions and Suppliers, and also Shop
  (added during the work). Shop renders for Managers through `AppShell`, but was missing from
  the list, so a `?tab=Shop` link dropped them on their normal page. The new test found it.
- `components/AppShell.tsx`: the Users link sits behind `isAdmin`, like Settings. The
  "System" sidebar heading stays, because Suppliers is still under it.
- `__tests__/adminTabUrl.test.ts`: the two checks that keep Managers out of Promotions and
  Suppliers move to the checks that let them in. Same number of assertions.
- A new source test ties the sidebar to the tab list, because no test mounts `AppShell`.
- `CLAUDE.md`: the role table's Manager row is out of date and gets corrected.

## Out of scope

- Any server, database or permission change.
- Which Manager actions are audited or limited inside those two pages.
- The dead Order Import Back button, and the other follow-ups.
- `?subtab=queue` staying in the URL after leaving PO Inbox: seen while reproducing this,
  harmless so far, and reported separately.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `roleCanOpenTab > lets Manager open Promotions and Suppliers` and `Manager tabs > AdminView renders Promotions and Suppliers for a Manager` fail on base by assertion, pass on tip. On dev at 0f5344e as Manager: both open from the sidebar and from `?tab=` | Opening is what is claimed. Saving promotions does not work: see A5 |
| A2 | claimed | `Manager tabs > the Users link is for Admins only` fails on base by assertion, passes on tip. On dev at 0f5344e: no Users link for Manager, `?tab=Users` lands on Dashboard. As Admin, `?tab=Users` opens Users and the link is there | |
| A3 | claimed | `Manager tabs > every link a Manager can see opens a tab they can render` fails on base by assertion, passes on tip | The test reads `AppShell`'s source for `SidebarNavItem` links; it does not mount the sidebar. It found Shop, added during the work |
| A4 | claimed | On dev at 0f5344e as Manager at 1280px: all 23 sidebar links clicked, each showed a page with an h1, 0 blank. `?tab=Shop` and a refresh on it stay on Shop | |
| A5 | not-claimed | | Suppliers works: as Manager on dev at 0f5344e a test supplier was created (201), edited (200) and deleted (200), each confirmed after a reload. Promotions does not: create, edit, toggle and delete all return 400, for Admin as well as Manager. Create needs `created_by`, which the app never sends. Edit, toggle and delete require a UUID, while every promotion id is text such as `PROMO-001`. `promotions.id` also has no default. The cause dates from the lockdown of 2026-04-29, not from this change. By owner decision this merges as it is and the server fix follows in its own brief |
| A6 | not-claimed | | Dev serves 0f5344e64eacddfdd82257d3bab5615566c97e89, health 200, but that is a throwaway merge so the unmerged NX-0012/0013/0014 demo work stays on dev, and this is before the merge. Not pushed |

### Not claimed

- Managers can now reach a Promotions page whose Create, edit, toggle and delete controls all fail, with only "Edge Function returned a non-2xx status code" on screen. Admins already see the same.
- Promotion create was tried in a browser as Admin and Manager. Toggle and delete were tried as both on a test row. Edit was not tried on its own; the toggle uses the same update request, which is refused on the id before anything else is read.
- Supplier's Phone looks optional in the form, but the server requires it, so a save without one fails with the same unhelpful message. Not changed here.
- Promotion delete has no confirmation step. Not changed here.
- Only 1280px was walked as Manager. No phone or tablet width, and no RS35.
- Nothing about what Managers may do inside these pages was changed or audited beyond what the server already enforces.
- Linking a supplier to products from the Suppliers page was not exercised.
- `--project=mobile` and `--project=contrast` were not run: this change adds no layout.
- Test records on dev: a promotion `PROMO-NX0023` was inserted and removed by SQL, because the screen cannot create or delete one, and supplier 32 went through the screen. Both are gone, and dev is back to 6 promotions. The supplier's three saves remain in the audit log.
- The login used the demo accounts the dev login page publishes.
