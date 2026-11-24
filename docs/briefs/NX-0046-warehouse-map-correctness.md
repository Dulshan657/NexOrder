# NX-0046 — Warehouse map and 3D view: correctness fixes

```json brief
{
  "id": "NX-0046-warehouse-map-correctness",
  "base": "455cfd74393c109ff36a6610280203b803eec499",
  "approved": "2026-11-24 owner",
  "acceptance": [
    { "id": "A1", "check": "Replacing the map's object list (painting a cell, entering or leaving Annotate) keeps the operator's zoom and pan; the map re-fits only on first size, a floor change, or the Fit button." },
    { "id": "A2", "check": "In the Save annotations dialog, when the signs saved and the area save then failed, pressing Save again sends only the areas." },
    { "id": "A3", "check": "Clearing an engine product highlight does not clear a product the operator picked in the 3D find bar themselves." },
    { "id": "A4", "check": "The Ask the engine card offers no Simulate tab to a user who cannot run a simulation (Warehouse role)." },
    { "id": "A5", "check": "Location detail shows the Warehouse role a rack's levels but no control that changes them, and no Split into levels." },
    { "id": "A6", "check": "With the Codes or Blocks overlay on, a rack level holding no stock still shows its overlay colour in the level stripe; the Occupancy look of an empty level is unchanged." },
    { "id": "A7", "check": "The Locations tree shows the fill pill and product count on a rack level (SHELF), as it does on a bin." },
    { "id": "A8", "check": "In 3D an area's name floats above the tallest rack on the floor, not at a fixed three levels." },
    { "id": "A9", "check": "The 3D offer is withdrawn when the window stops being a wide, fine-pointer screen, and returns when it is one again." },
    { "id": "A10", "check": "Losing the graphics context in 3D returns to 2D with a message saying so; leaving the 3D offer while in 3D returns to 2D.", "manual": "Chrome on the built app: WEBGL_lose_context from the console while in 3D; resize below 1024px while in 3D" },
    { "id": "A11", "check": "When locations or stock fail to load, the map area says so and offers a retry instead of an empty map.", "manual": "Playwright spec aborts the locations request and asserts the message" },
    { "id": "A12", "check": "A Playwright spec walks the fixes against a built app on the dev database: paint a cell while zoomed in and the zoom holds; a Warehouse login sees no Simulate tab and no level-editing control; a rack level in the tree shows a fill pill.", "manual": "npx playwright test tests/e2e/warehouse-map-fixes.spec.ts against a build served on port 3004; result recorded in FINAL" },
    { "id": "A13", "check": "The five unconfirmed suspicions are each checked in a browser and recorded as reproduced-and-fixed, reproduced-and-deferred, or not reproduced.", "manual": "browser walk on the built app; outcomes listed in FINAL" },
    { "id": "A14", "check": "docs/claude/warehouse-map.md no longer says area names use drei Html; docs/claude/roadmap.md carries the deferred list from the audit.", "manual": "read the diff" },
    { "id": "A15", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" },
    { "id": "A16", "check": "A press on the map's own controls (Zoom in, Zoom out, Fit, the floor switcher) is never a paint stroke, a sweep stroke, a pan or a pinch, so those buttons work while Annotate or a code sweep is on." }
  ],
  "failFirst": [
    { "file": "__tests__/mapViewportHook.test.tsx", "test": "useMapViewport > keeps the zoom when the object list is replaced", "proves": ["A1"] },
    { "file": "__tests__/areaPaintSummaryModal.test.tsx", "test": "AreaPaintSummaryModal > a retry after the area save failed does not send the signs again", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/findFocus.test.ts", "test": "nextFindProduct > clearing an engine highlight leaves the operator's own search", "proves": ["A3"] },
    { "file": "__tests__/warehouse/askEnginePanel.test.tsx", "test": "AskEnginePanel > offers no Simulate tab to someone who cannot run one", "proves": ["A4"] },
    { "file": "__tests__/warehouse/binDetailPanelRole.test.tsx", "test": "BinDetailPanel > shows the Warehouse role a rack's levels with nothing to change", "proves": ["A5"] },
    { "file": "__tests__/warehouseCanvasLabels.test.tsx", "test": "WarehouseCanvas — level spine > shows a code or block colour on a level with no stock", "proves": ["A6"] },
    { "file": "__tests__/warehouse/warehouseTreePanel.test.tsx", "test": "WarehouseTreePanel > shows fill and product count on a rack level", "proves": ["A7"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene > floats an area name above the tallest rack", "proves": ["A8"] },
    { "file": "__tests__/warehouse3d/mapViewToggle.test.tsx", "test": "useCan3d > withdraws 3D when the window stops being a wide fine-pointer screen", "proves": ["A9"] },
    { "file": "__tests__/mapGesture.test.ts", "test": "decidePointerDown — the map's own controls > is never a stroke, a pan or a pinch", "proves": ["A16"] }
  ],
  "allow": []
}
```

## Goal

The audit of 2026-11-23 found faults on the warehouse live map and its 3D view that make
it lose the operator's place, fail a retry, show floor staff buttons the server refuses,
and hide information it has. This fixes those before the enrichment work (one search box,
the manager's live map, realistic 3D, the handheld picking mini-map) builds on the same files.

## Approach

- A1: `components/inventory/warehouse/useMapViewport.ts` stops re-fitting on the object
  list's identity.
- A2: `AreaPaintSummaryModal.tsx` remembers that the signs saved.
- A3: a new pure `lib/warehouse3d/findFocus.ts`, used by `three/Warehouse3DView.tsx`.
- A4/A5: `AskEnginePanel.tsx` and `BinDetailPanel.tsx` take the existing `canRename`
  permission from `RackedWorkspace.tsx`.
- A6: the level stripe in `WarehouseCanvas.tsx`, told by `useWarehouseMapLayers.ts`
  whether the active overlay is a category colour.
- A7: `WarehouseTreePanel.tsx`.
- A8: `lib/warehouse3d/buildScene.ts`.
- A9/A10: `three/useCan3d.ts` listens to its media query; `RackedWorkspace.tsx` toasts on
  the fallback.
- A11: an error state in `RackedWorkspace.tsx`.
- A12: a new `tests/e2e/warehouse-map-fixes.spec.ts`.
- A16 (revision 1, 2026-11-24): `mapGesture.ts` `decidePointerDown` learns that a press
  landed on a map control, and `MapStage.tsx` tells it. Found by A12's browser walk: with
  Annotate on, the stage began a paint stroke on the Zoom and Fit buttons and took the
  pointer capture, so their click never fired. It is on the deployed dev site too.
- No migration, no Edge Function change, no new dependency.

## Out of scope

- Map speed, the zoom-out limit on 200-cell grids, keyboard and screen-reader access,
  splitting the oversized files, 3D load testing. A14 records them in the roadmap.
- The enrichment pieces of the plan.
- The audit's "narrow areas cannot be renamed" finding: `regionLabelBudget` gives every
  area at least six cells of label width, so the name and its rename target are always drawn.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `useMapViewport > keeps the zoom when the object list is replaced` fails on base (0.4566 vs 0.5479), passes on tip. Browser: `the zoom holds when Annotate is entered and when a cell is painted` passes on build 0faa259 and fails on the deployed dev build 79edf70 (2.486 expected, 1.726 received) | |
| A2 | claimed | `AreaPaintSummaryModal > a retry after the area save failed does not send the signs again` fails on base (signs sent 2 times), passes on tip | Not walked in a browser: it needs a real save to fail half way |
| A3 | claimed | `nextFindProduct > clearing an engine highlight leaves the operator's own search` passes on tip | Proven by absence only: `lib/warehouse3d/findFocus.ts` is new. Not walked in a browser |
| A4 | claimed | `AskEnginePanel > offers no Simulate tab to someone who cannot run one` fails on base, passes on tip. Browser: `the Warehouse role is offered nothing the server refuses` passes on 0faa259, fails on 79edf70 | |
| A5 | claimed | `BinDetailPanel > shows the Warehouse role a rack's levels with nothing to change` fails on base (8 editable controls), passes on tip. Same browser test as A4 | |
| A6 | claimed | `WarehouseCanvas — level spine > shows a code or block colour on a level with no stock` fails on base, passes on tip | Not looked at in a browser with the Codes overlay on |
| A7 | claimed | `WarehouseTreePanel > shows fill and product count on a rack level` fails on base, passes on tip. Same browser test as A4 asserts the pill on a real level | |
| A8 | claimed | `buildScene > floats an area name above the tallest rack` fails on base (6.5 vs 10), passes on tip. Screenshot of the demo site in 3D shows the names above the five-level racks | |
| A9 | claimed | `useCan3d > withdraws 3D when the window stops being a wide fine-pointer screen` fails on base, passes on tip | |
| A10 | claimed | Playwright on build 0faa259: `a lost graphics context returns to 2D and says so` and `3D is withdrawn when the window is no longer a desktop one` both pass | Headless Chromium with software WebGL, not a real GPU reset |
| A11 | claimed | Playwright on build 0faa259: `a failed stock load is said above the map, with a retry` passes; fails on 79edf70 (no message) | The banner is shown ABOVE the map, not in place of it, so a failed background refresh keeps the last good picture |
| A12 | claimed | `E2E_BASE_URL=http://localhost:3004 npx playwright test tests/e2e/warehouse-map-fixes.spec.ts --project=chromium --workers=1`: 5 passed on build 0faa259 (`vite build --mode dev`, `vite preview` on 3004, dev database). The three 2D tests fail against 79edf70. `tests/e2e/recode-gestures.spec.ts`: 6 passed on the same build. Final form of the spec (commit a5bb792, no skips and no per-call time limits): 5 passed on build 3d640b1, and its three 2D tests fail against 79edf70 | The spec asserts its preconditions (open floor, a levelled rack, 3D offered) and fails without them; it never skips. Slow waits poll in 500 ms steps inside the test's own 30 s limit |
| A13 | not-claimed | | Three of five checked. Aisle camera preset: reproduced (stands inside the bulk pallet grid with nothing selected), deferred to the realistic-3D piece. Clipped shadows: not reproduced on the demo site. Grid geometry leak: not reachable, by reading (the workspace remounts per layout). Clicks passing through walls and the designer wiping unsaved edits: not checked. All five are in `docs/claude/roadmap.md` |
| A14 | claimed | commit 0faa259 | |
| A15 | not-claimed | | Not merged and not deployed. Dev is serving 79edf70, the unmerged NX-0041 dev-merge, so a `deploy:dev` from this branch would replace it; that is the owner's call |
| A16 | claimed | `decidePointerDown — the map's own controls > is never a stroke, a pan or a pinch` fails on base, passes on tip. Browser: the Fit assertion at the end of the zoom test failed before the fix (scale stayed 2.486) and passes after; the same dead buttons were measured on 79edf70 | Added by revision 1 after the browser walk found it |

### Not claimed

- Nothing was tried on a real RS35 or any touch device. The map-control rule changes what a finger on the zoom buttons does, and that was only exercised with a mouse.
- The full unit suite had 11 failures in one run (HoReCa form, Import PO, Receive Stock, QR approval), all timeouts at 5 to 7 seconds on a loaded machine. Those six files pass when run alone (77 tests). None touches the map.
- The Codes and Blocks overlay fix (A6), the save retry (A2) and the 3D find bar (A3) were proven by unit tests only.
- The tenant build was not rebuilt and checked for three.js. This change does not touch the lazy gate.
- `npm ci` was run in this checkout because `three` was missing from `node_modules`; `package-lock.json` is unchanged.
- The browser spec signs in through the demo roster on the login page, so it cannot run in CI as it stands and proves nothing about a tenant build.
