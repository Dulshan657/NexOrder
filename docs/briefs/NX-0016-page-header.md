# NX-0016 — one page header, proven on four pages

```json brief
{
  "id": "NX-0016-page-header",
  "base": "137b73915da31b6a56e3343a1e8105b67bdb24f4",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "PageHeader renders the title as a level 1 heading with the description, in the standard classes." },
    { "id": "A2", "check": "Below md the title and description are visually hidden but stay in the accessibility tree; visibleOnMobile keeps them visible; actions stay visible either way." },
    { "id": "A3", "check": "PageTabs marks the selected tab, reports a change, shows a count badge and carries the 44px tap floor." },
    { "id": "A4", "check": "PageFrame applies the standard page padding and spacing." },
    { "id": "A5", "check": "Dashboard, Pick Queue, Putaway and Settings render through PageFrame and PageHeader, with no hand-rolled h1 and no header icon." },
    { "id": "A6", "check": "Those four titles come from ADMIN_TAB_LABELS rather than typed text." },
    { "id": "A7", "check": "Pick Queue, Putaway and Settings use PageTabs; the grey pill and the blue filter buttons are gone from them." },
    { "id": "A8", "check": "Putaway shows its title on both stages and its warehouse picker sits in the header actions.", "manual": "Browser walk on dev: Assign and Walk at desktop width; picker is the first row at 360px." },
    { "id": "A9", "check": "At 360px the four pages show no empty gap where the header was and no sideways overflow.", "manual": "Browser walk on dev at 360px, plus nav-clearance in the Playwright mobile project." },
    { "id": "A10", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification, after checking what dev currently serves." }
  ],
  "failFirst": [
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the four proof pages use PageFrame and PageHeader with no hand-rolled h1 or header icon", "proves": ["A5"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the four proof pages take their title from ADMIN_TAB_LABELS", "proves": ["A6"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Pick Queue, Putaway and Settings use PageTabs", "proves": ["A7"] },
    { "file": "__tests__/pageHeader.test.tsx", "test": "PageHeader > renders a level 1 title and its description", "proves": ["A1"] },
    { "file": "__tests__/pageHeader.test.tsx", "test": "PageHeader > hides the text below md but keeps it accessible, and always shows actions", "proves": ["A2"] },
    { "file": "__tests__/pageHeader.test.tsx", "test": "PageHeader > visibleOnMobile keeps the text visible", "proves": ["A2"] },
    { "file": "__tests__/pageTabs.test.tsx", "test": "PageTabs > marks the selected tab and reports a change", "proves": ["A3"] },
    { "file": "__tests__/pageTabs.test.tsx", "test": "PageTabs > shows a count badge and the tap floor", "proves": ["A3"] },
    { "file": "__tests__/pageFrame.test.tsx", "test": "PageFrame > applies the standard padding and spacing", "proves": ["A4"] }
  ],
  "allow": []
}
```

## Goal

Every page builds its own header, so no two parts of the app match. This adds the
one header, frame and tab row, and proves them on four different kinds of page so
the owner can approve the look on dev before the other 25 or so pages follow.

## Approach

- New in `components/ui/`: `PageFrame`, `PageHeader`, `PageTabs`. `SubtabButton`
  moves there from `components/admin/settings/primitives.tsx`; Settings and
  PO Inbox only change their import.
- `PageHeader`: Dashboard's title and description classes, `sr-only md:not-sr-only`
  on the text, wrapping actions clamped so a long site name can't overflow 360px.
- `PageTabs`: underlined, sideways-scrolling, `aria-current` on the selected tab.
  Putaway's `role="tab"` goes, because it has no matching panels.
- **Dashboard:** header swapped; CSV button raised to the standard size and tap floor.
- **Pick Queue:** tile removed; its status buttons become `PageTabs`.
- **Putaway:** the header moves up to `PutawayQueuePage`, so it shows on both stages;
  picker in the actions; tile and duplicate sentence removed; stage hints stay.
- **Settings:** title drops from 24px to Dashboard's size; `PageTabs` under the header.
- `MobileTopBar.tsx:45-47`: correct the comment claiming every page has its own h1.

Descriptions:

| Page | Sentence | |
|---|---|---|
| Dashboard | Overview of business performance | unchanged |
| Pick Queue | Open an order to pick its lines, then pack & dispatch. | unchanged |
| Putaway | Move received stock from the dock into its bins. | **new** |
| Settings | Company profile, ordering rules, inventory, warehouses and automation. | unchanged |

## Out of scope

- The other pages (batches 2 to 4), and the whole-app version of the drift test.
- `PageFrame`'s full-bleed option, until the Warehouse designer needs it in batch 2.
- PO Inbox's header, beyond its import line.
- Button colours; tables, cards and empty states.
- Manager blank pages and the dead Order Import Back button.

## FINAL
