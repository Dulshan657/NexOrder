# NX-0020 — the shared page header on the warehouse pages

```json brief
{
  "id": "NX-0020-warehouse-page-headers",
  "base": "041ccf89996de7be0b8774bd828e7bcd377d7cdc",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "Receive Stock, Replenishment, Off-home, Stocktake, Dispatched, Documents, Warehouse and Stock render through PageFrame and PageHeader, with no hand-rolled h1 and no header icon." },
    { "id": "A2", "check": "Those eight titles come from ADMIN_TAB_LABELS, so 'Stock Levels' and 'Off-home stock' are gone." },
    { "id": "A3", "check": "Replenishment, Off-home and Documents use PageTabs; their grey pills and blue filter buttons are gone." },
    { "id": "A4", "check": "Stock's Look up / Browse switch is underlined, keeps aria-pressed and keeps its full-width tap targets." },
    { "id": "A5", "check": "PageFrame's column option swaps its spacing for a flex column, for pages whose scan dock has to reach the foot." },
    { "id": "A6", "check": "Receive Stock's dock bleed matches the standard frame, and the unused 'xl' bleed is removed." },
    { "id": "A7", "check": "At 360px the scan docks on Receive Stock, Stock, Stocktake, Putaway and Replenishment stay pinned, and pickers are in the first row.", "manual": "--project=mobile against a build of the branch, plus a browser walk on dev; any skipped spec is named in FINAL." },
    { "id": "A8", "check": "Receive Stock's receipt lines do not overflow sideways between 1024px and 1279px, the range its old padding existed for.", "manual": "Measured in a browser at 1024px and 1279px." },
    { "id": "A9", "check": "Warehouse keeps its map, KPI strip, layout badge and setup panel working, with the KPI strip and badge in a row under the title.", "manual": "Browser walk on dev, as Admin." },
    { "id": "A10", "check": "Colour contrast still passes on the Warehouse surfaces.", "manual": "--project=contrast against a build of the branch." },
    { "id": "A11", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the warehouse pages use PageFrame and PageHeader with no hand-rolled h1 or header icon", "proves": ["A1"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > the warehouse pages take their title from ADMIN_TAB_LABELS", "proves": ["A2"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Replenishment, Off-home and Documents use PageTabs", "proves": ["A3"] },
    { "file": "__tests__/pageHeaderConsistency.test.ts", "test": "page header adoption > Receive Stock's dock bleed matches the standard frame", "proves": ["A6"] },
    { "file": "__tests__/stockModeTabs.test.tsx", "test": "StockModeTabs > is underlined, and keeps aria-pressed and full-width tap targets", "proves": ["A4"] },
    { "file": "__tests__/pageFrame.test.tsx", "test": "PageFrame > column swaps the spacing for a flex column", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

Warehouse staff use these eight pages all day and they differ the most: three have
no title and the picker moves around. This brings them onto the header you approved.

## Approach

- `PageFrame` gains `column`, because Receive Stock and Stock's lookup mode need a
  flex column to push the scan dock to the foot.
- Page order everywhere: header, then tabs, then the page's hint, filters and content.
- **Receive Stock:** icon tile goes; padding moves from `xl:p-8` to the standard
  `lg:p-8`, with the dock bleed changed in the same commit.
- **Replenishment:** picker and "Scan for shortfalls" go in the header; tabs become
  `PageTabs` and lose their icons, as Putaway's did.
- **Off-home:** `h2` becomes `h1`; tabs become `PageTabs`; "Check now" drops to the
  standard button size.
- **Stocktake:** picker goes in the header; the scan hint stays, under the header.
- **Dispatched:** icon tile goes.
- **Documents:** icon tile goes; type buttons become `PageTabs` above the search.
- **Warehouse:** gets the standard frame; KPI strip and layout badge move under the title.
- **Stock:** picker and buttons go in the header at the standard size;
  `StockModeTabs` is restyled in place.
- `tests/e2e/mobile/nav-clearance.spec.ts`: correct the comment saying these pages
  have no heading. Comment only.

Descriptions:

| Page | Sentence | |
|---|---|---|
| Receive Stock | Pick the supplier, then scan each carton as it comes in. | reworded |
| Replenishment | Top up pick slots from reserve stock when they run low. | **new** |
| Off-home | Stock outside its slotted blocks, which you can choose to move. | shortened |
| Stocktake | Count what is in a bin and post any difference. | **new** |
| Dispatched | Orders that have left the warehouse, most recent first. | unchanged |
| Documents | Pick slips & dispatch advices generated for orders. | unchanged |
| Warehouse | See your site's map, locations and stock at a glance. | **new** |
| Stock (staff) | Scan to look something up, or browse levels across products. | **new** |
| Stock (customer) | Product availability overview | unchanged |

## Out of scope

- The admin, rep and customer pages (batches 3 and 4).
- A shared warehouse-picker component; the pickers keep their own behaviour.
- Replenishment Setup's inner filter, inside the Min/max tab.
- Tables, cards and empty states.
- The stale `rack-levels` specs.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `page header adoption > the warehouse pages use PageFrame and PageHeader with no hand-rolled h1 or header icon` fails on base by assertion, passes on tip | |
| A2 | claimed | `page header adoption > the warehouse pages take their title from ADMIN_TAB_LABELS` fails on base by assertion, passes on tip | |
| A3 | claimed | `page header adoption > Replenishment, Off-home and Documents use PageTabs` fails on base by assertion, passes on tip | |
| A4 | claimed | `StockModeTabs > is underlined, and keeps aria-pressed and full-width tap targets` fails on base by assertion, passes on tip | |
| A5 | claimed | `PageFrame > column swaps the spacing for a flex column` fails on base by assertion, passes on tip | |
| A6 | claimed | `page header adoption > Receive Stock's dock bleed matches the standard frame` fails on base by assertion, passes on tip | |
| A7 | claimed | Replenishment has no scan dock at this commit, so that part of the check does not apply; the brief was wrong to name it. `--project=mobile` against a build of this branch: 27 passed, 2 skipped, 0 failed. Skipped: `touch-targets.spec.ts:35` Putaway and Replenishment walk cards. Measured on dev at b0183e1 as Warehouse at 360px: Receive Stock and Stock docks end at 664 of 664, 0px overflow on all eight, tabs 44px | Stock's filter clamp came after the full mobile run; `stock-lookup.spec.ts` was rerun after it (5 passed) |
| A8 | claimed | Measured on dev at b0183e1 as Warehouse with a real line added and opened, at 1024, 1100, 1279 and 1280px: 0px overflow, no control past the page edge | Nothing was posted |
| A9 | not-claimed | | Seen on a build of this branch as Admin at 1280px: map, KPI strip and setup panel render, with the KPI strip in a row under the title, and 0px overflow on dev at 1280px and 360px. But the check also covers the layout badge, which did not appear in the screenshot and was not confirmed, and the map was not exercised beyond rendering |
| A10 | claimed | `--project=contrast` against a build of this branch: 1 passed | Run before the two clamps, which change layout only |
| A11 | not-claimed | | Dev serves b0183e1269cdc5dca0033e791bb0ed63ee459759, health 200, but that is a throwaway merge onto 16824f9 so the unmerged NX-0013/0014 demo work stays on dev, not the merge sha. Not pushed |

Added during the work: `WarehousePicker` and Stock's two filter selects are clamped at 360px. Both overflowed before this change (5px and 134px when measured on the old pages), and removing it fits the batch's scope. Stock's product count was not lost: the Browse list already shows "251 products".

### Not claimed

- No walk on the RS35 handheld. All 360px evidence is Playwright or Chromium at that viewport.
- Manager was not logged in. Admin and Warehouse were.
- All page descriptions are hidden below `md`, so handheld users do not see them. Off-home's sentence was also shortened and no longer says that nothing there is wrong.
- The two skipped specs need a walk with stops at the Warehouse user's site, so walk-card touch targets on Putaway and Replenishment were not measured by them.
- The chromium run (8 passed, excluding `rack-levels`) was against a build before the two clamps, and from an accepted CORS origin. The six `rack-levels` specs were not rerun; they failed the same way on main in NX-0016.
- Nothing was saved through these pages in a browser: no stock was received, moved or counted.
- Replenishment Setup's inner filter stays a grey pill by the owner's agreed exception.
- The Playwright admin login used the demo account the dev login page publishes.
