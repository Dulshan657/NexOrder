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
- `lib/adminTabUrl.ts`: Manager's tab list gains Promotions and Suppliers.
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
