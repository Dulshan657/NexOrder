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
