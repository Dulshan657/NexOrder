# NX-0039 — Scan a product: where it lives, and how to walk it

```json brief
{
  "id": "NX-0039-ask-engine-where-is-it",
  "base": "ed0823bbca15cd4506d7713a0a243fcbd8a8bbda",
  "approved": "2026-11-17 owner",
  "acceptance": [
    { "id": "A1", "check": "Given a product on a racked site, the answer names its home bin (or none), and lists every location holding on-hand stock of it. Each row is marked home, off home (any other bin) or at the dock (the warehouse root, not yet put away). A location holding zero is not listed." },
    { "id": "A2", "check": "The answer says where a new delivery of the product would go and why, using the home-first rule: the home bin when it has room ('home'), the nearest overflow bin when the home is full ('overflow', with the home's headroom), or the engine's bin when the product has no home ('engine', 'no home bin set')." },
    { "id": "A3", "check": "The pick walk starts at the dock and visits every bin holding AVAILABLE stock of the product, in the engine's sequence. It never visits the dock root, and a bin whose stock is all allocated is not a stop." },
    { "id": "A4", "check": "Each walk (putaway: dock → the new-delivery bin; pick: dock → the stock bins) is returned as numbered stops with leg distances and the aisle corner points, in the same stop shape the 2D/3D route drawing already takes, plus a total distance and one plain step line per stop ('1. A-03-02 — 14 m')." },
    { "id": "A5", "check": "A new read-only Edge Function `explain-product-location` returns A1–A4 for { warehouse_id, product_id }. It is allowed to Admin, Manager and Warehouse (a Warehouse user only for their home warehouse), is rate-limited, is owned by `inventory_dispatch`, and writes nothing.", "manual": "fn:deploy:dev (owner consent) + a call on dev for a product with stock in its home and in overflow" },
    { "id": "A6", "check": "In 'Ask the engine', a new first section 'Find a product' takes a scan or a typed barcode or name and shows the summary (home bin, stock by bin with home / off home / at dock badges, where a new delivery goes and why). Choosing 'Put away walk' or 'Pick walk' draws that walk on the map. An unknown barcode says so and asks the server nothing." },
    { "id": "A7", "check": "A Warehouse user has a 'Where is it?' screen (inventory_dispatch only) that shows the same answer on the handheld as text: the summary and the two walks as numbered step lists, with the scan field pinned. Admin and Manager can open it too." },
    { "id": "A8", "check": "Merged and deployed to dev; /version.json shows the merge sha; the owner scans a product on dev in Ask the engine (2D and 3D) and on the 'Where is it?' screen at 360 px.", "manual": "deploy:dev + owner browser walk" },
    { "id": "A9", "check": "Every place is described by what it is, never as a 'bin': a rack level as 'Rack <rack> · Level <n>', a rack as 'Rack <rack>', a bay or floor spot by its name with its zone, a staging spot as staging, and stock at the warehouse root as 'Dock — awaiting putaway'. The scannable code stays beneath the label. The Find a product summary, the walk steps and the Where is it? screen say no 'bin'." },
    { "id": "A10", "check": "Finding a product highlights every place holding it on the map: outlined on the 2D map, and in 3D the existing find-stock highlight (NX-0036) is switched on for that product, framing it. Clearing the product clears the highlight." },
    { "id": "A11", "check": "The putaway tab in Ask the engine takes a scanned or typed product (the same scan box as Find a product) instead of a product dropdown." },
    { "id": "A12", "check": "Ask the engine is ONE card: a header, a 'preview only — nothing moves' note and one tab per question (Find a product, Put away, Pick route, Simulate). There is no second 'Test bench' box inside it." },
    { "id": "A13", "check": "On the warehouse map page the 'Locations' panel beside the place detail stays open, and the groups inside its tree (zones, aisles, racks) all start collapsed; selecting a place on the map still opens the groups above it." },
    { "id": "A14", "check": "No screen calls a place a 'bin': every user-visible string in the app's components, views and lib (labels, headings, buttons, placeholders, toasts, aria-labels, help text) says 'location' instead ('Bin detail' → 'Location detail', 'home bin' → 'home location'). Identifiers, enum values ('BIN'), CSV column names ('bin_code'), element ids and database names are unchanged." },
    { "id": "A15", "check": "Messages composed by the Edge Functions and their shared modules (errors, refusals, problem lists, explanations an operator reads) say 'location', not 'bin', as does the public site's description and its pages. Error CODES, identifiers and stored values are unchanged.", "manual": "fn:deploy:dev of every function and migrate:dev of 00147 (owner asked: 'deploy it when done to dev'); 00147 rehearsed rolled-back on dev first; a refused putaway on dev reads 'location'" }
  ],
  "failFirst": [
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "productWhereabouts > marks stock in the home bin as home, other bins as off home and the warehouse root as at the dock", "proves": ["A1"] },
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "productWhereabouts > leaves out a location holding none of the product", "proves": ["A1"] },
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "newDeliveryReason > says home when the home has room, overflow with the headroom when it is full, and no home bin set without one", "proves": ["A2"] },
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "pickWalkStops > visits every bin with available stock and never the dock root or a fully allocated bin", "proves": ["A3"] },
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "walkSummary > numbers the stops, sums the legs and writes one step line per stop", "proves": ["A4"] },
    { "file": "__tests__/warehouse/findProductSection.test.tsx", "test": "FindProductSection > a scanned product shows its home bin, stock badges and where a new delivery goes", "proves": ["A6"] },
    { "file": "__tests__/warehouse/findProductSection.test.tsx", "test": "FindProductSection > choosing a walk hands its stops to the map", "proves": ["A6"] },
    { "file": "__tests__/warehouse/findProductSection.test.tsx", "test": "FindProductSection > an unknown barcode says so and asks the server nothing", "proves": ["A6"] },
    { "file": "__tests__/inventory/whereIsItScreen.test.tsx", "test": "WhereIsItScreen > shows the summary and both walks as numbered step lists", "proves": ["A7"] },
    { "file": "__tests__/adminTabUrl.test.ts", "test": "roleCanOpenTab > a Warehouse user can open Where is it", "proves": ["A7"] },
    { "file": "__tests__/wie/productWhereabouts.test.ts", "test": "describePlace > names a rack level by its rack and level, a bay by its name and zone, and the root as the dock", "proves": ["A9"] },
    { "file": "__tests__/warehouse/findProductSection.test.tsx", "test": "FindProductSection > never calls a place a bin", "proves": ["A9"] },
    { "file": "__tests__/warehouse/findProductSection.test.tsx", "test": "FindProductSection > hands the places holding the product to the map to highlight, and clears them", "proves": ["A10"] },
    { "file": "__tests__/warehouse/holdingMarkers.test.tsx", "test": "holdingMarkers > outlines every place holding the product on the floor being viewed", "proves": ["A10"] },
    { "file": "__tests__/warehouse/askEnginePanel.test.tsx", "test": "AskEnginePanel > the putaway tab takes a scanned product", "proves": ["A11"] },
    { "file": "__tests__/warehouse/askEnginePanel.test.tsx", "test": "AskEnginePanel > is one card with a tab per question and no test bench box", "proves": ["A12"] },
    { "file": "__tests__/warehouse/warehouseTreePanel.test.tsx", "test": "WarehouseTreePanel > starts with every group collapsed and opens the groups above a selected place", "proves": ["A13"] },
    { "file": "__tests__/ui/noBinWording.test.ts", "test": "user-facing wording > no screen calls a place a bin", "proves": ["A14"] },
    { "file": "__tests__/ui/noBinWording.test.ts", "test": "user-facing wording > no server message calls a place a bin", "proves": ["A15"] }
  ],
  "allow": []
}
```

## Goal

The owner asked for "Ask the engine" to show how to walk an item. Today it routes whole
ORDERS (NX-0037), finds stock in 3D (NX-0036), and suggests a putaway bin as a marker
with no walk. This adds: scan one product, then see where it lives and how to walk it.

The owner's rule (2026-11-17): stock belongs in its **home bin** unless the home is full,
and a new delivery goes home once it is put away. Until then it is **at the dock**. The
answer shows where the stock actually is against that rule, and draws both walks: the
putaway walk (dock → bin) and the pick walk (dock → the stock). It is used at the desk
on the map and on the floor on the RS35.

## Approach

- **Pure, `_shared/wie/productWhereabouts.ts`.** Imports `homeFirst.ts` and does not fork it.
  - `productWhereabouts`: stock rows and badges.
  - `newDeliveryReason`: the source plus a plain reason.
  - `pickWalkStops`: available-only, no root.
  - `walkSummary`: numbered stops, total distance, step lines.
- **Edge Function `explain-product-location`.**
  - `loadWalkGraph` provides the graph and dock.
  - Balances are expanded through `inv_warehouse_draw_locations`, never a path prefix.
  - The home bin comes from `product_home_bins`.
  - The new-delivery bin comes from the existing dry-run putaway path (home-first), for a quantity of 1 handling unit's worth of base units.
  - Walks use `sequencePickRoute` + `legPaths` + `simplifyPath`, the same as `recommend-pick-route`.
  - It is added to `config/moduleOwnership.mjs`, with its own rate-limit bucket. `verify_jwt` stays on.
- **Desktop.**
  - `components/inventory/warehouse/FindProductSection.tsx` becomes the first, open section of `WarehouseTestBench`.
  - The scan field is `ScanField` + `resolveScan`.
  - `RackedWorkspace` draws the chosen walk through the existing 2D/3D route drawing (`routeStops`). It shows one walk at a time, chosen by a two-way toggle, so the existing renderers are reused unchanged.
- **Handheld.**
  - New `WhereIsIt` tab: `lib/adminTabUrl.ts` (union, labels, `TAB_MODULES` → `inventory_dispatch`, `TABS_BY_ROLE` for Warehouse, Admin and Manager).
  - The nav item and lazy declaration are gated in both `AppShell.tsx` and `AdminView.tsx`.
  - `components/inventory/WhereIsItScreen.tsx` uses `StickyScanBar`, `h-svh` and `.touch-target`.
- **Service and hook:** `services/supabase/productWhereaboutsService.ts` and `hooks/queries/useProductWhereabouts.ts`.

### Revision (2026-11-17, after the owner's first dev look)

The owner asked for four more things: highlight where the product is on the map; stop
calling every place a "bin" (say which rack and level, or what the place is); a scan
input on the putaway tab; and one tidy card instead of "Ask the engine" wrapping a
"Test bench" box. A9–A12 add them.

- **Pure:** `describePlace` in `_shared/wie/productWhereabouts.ts`. It takes the location, its
  parent and its zone name, uses `isUninformativeName` from `locationNaming.ts`, and does not
  fork it. The server returns a `place` label for every stock row, the home and each walk
  stop, and the step lines and reasons use it.
- **2D:** `holdingMarkers` in `warehouseMarkers.tsx`, drawn in `RackedWorkspace`'s marker layer.
- **3D:** a `focusProductId` prop on `Warehouse3DView` drives its existing find state.
- **The card:** `AskEnginePanel` + `WarehouseTestBench` are folded into one tabbed card. The
  putaway tab uses `ProductScanBox`.
- **A13 (asked while this was being built, then corrected by the owner):** the Locations
  PANEL stays open; the groups inside `WarehouseTreePanel` no longer auto-expand the top
  level on load.
- **A14 (owner, 2026-11-17: "rename them to location in this change"):** a sweep of
  user-visible text in `components/`, `views/` and `lib/`, pinned by a source-scanning
  test. Error text composed by Edge Functions is not part of it (it is a server
  change and a redeploy of every function that says it), and it is listed under Not claimed.
- **A15 (owner, 2026-11-17: "fix other areas saying bin"):** the same sweep over
  `supabase/functions` (non-test) plus `config/environments.mjs`'s public description and
  `site/*.md`; every function redeployed to dev. The NX-0038 help centre is fixed on its
  own branch (PR #54), not here. Messages raised by SQL functions (home rule, overflow
  confirm, putaway/replen completion, shortfalls, publish) are reworded by migration
  `00147_location_wording.sql`, which redefines each function from its own current
  definition with only the message phrases replaced (no logic copied from old files).

## Out of scope

- Changing the home-first rule, putaway or pick sequencing, or any migration.
- Moving stock, or creating putaway or replenishment tasks. It is read-only.
- Bulk (non-racked) warehouses get the summary but no walk ('legacy', as the other route functions do).
- Showing both walks on the map at once.
- Amadiya. `inventory_dispatch` is on there, but this ships to it only at its next `rel-*` release.

## FINAL
