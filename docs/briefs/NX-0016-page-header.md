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

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `PageHeader > renders a level 1 title and its description` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `PageHeader > hides the text below md but keeps it accessible, and always shows actions` and `PageHeader > visibleOnMobile keeps the text visible` fail on base, pass on tip | Class checks in jsdom. Measured in a browser at 360px: the h1 is 1px wide and still in the DOM |
| A3 | claimed | `PageTabs > marks the selected tab and reports a change` and `PageTabs > shows a count badge and the tap floor` fail on base, pass on tip | Measured on dev: 44px at 360px, 42px on desktop, where the floor does not apply by design |
| A4 | claimed | `PageFrame > applies the standard padding and spacing` fails on base, passes on tip | |
| A5 | claimed | `page header adoption > the four proof pages use PageFrame and PageHeader with no hand-rolled h1 or header icon` fails on base by assertion, passes on tip | |
| A6 | claimed | `page header adoption > the four proof pages take their title from ADMIN_TAB_LABELS` fails on base by assertion, passes on tip | |
| A7 | claimed | `page header adoption > Pick Queue, Putaway and Settings use PageTabs` fails on base by assertion, passes on tip | |
| A8 | claimed | Measured on nexorder.vercel.app at 16824f9 as Admin: on Walk at 1280px the Putaway h1 is shown and the picker is in the title row (top 38px, right edge 1248px); at 360px the picker is the first row (top 68px, right edge 344px of 360px) | |
| A9 | claimed | Measured on dev at 360px: all four pages have content starting 16px below the top bar and 0px sideways overflow. `--project=mobile` against a build of this branch: 27 passed, 2 skipped, 0 failed, including `nav-clearance` | |
| A10 | not-claimed | | Dev serves 16824f938a5d16530e5cb6f4e9561bb2364a13ef, health 200, but that is a throwaway merge of this branch onto 7271130 so the unmerged NX-0013/0014 demo work stays on dev, not the merge sha. Not pushed |

The brief's Approach said PO Inbox would change one import line. It has its own private tab button and never imported the shared one, so it was not touched. It moves to `PageTabs` in batch 3.

### Not claimed

- No walk on the RS35 handheld. All 360px evidence is Playwright or Chromium at that viewport.
- Only Admin was walked on dev. The Warehouse role ran only through the `mobile` and `contrast` suites; Manager was not logged in.
- Six `rack-levels` specs in `--project=chromium` do not pass, so they prove nothing here. They fail with the same errors on a clean build of base 137b739. The first stops at "draft created", because the designer now opens a dialog with a "Create draft" button the spec never clicks. The spec files were last edited in July. Eight other chromium tests passed, and `--project=contrast` passed.
- Those eight chromium tests and the contrast run were served from localhost:3010, which the Edge Functions' CORS list refuses, so anything in them that saves through a function was not exercised. The mobile run used the same port.
- The Playwright admin login used the demo account the dev login page publishes, because this machine has no `E2E_ADMIN_*` set.
