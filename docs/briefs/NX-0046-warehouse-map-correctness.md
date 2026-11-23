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
    { "id": "A15", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
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
    { "file": "__tests__/warehouse3d/mapViewToggle.test.tsx", "test": "useCan3d > withdraws 3D when the window stops being a wide fine-pointer screen", "proves": ["A9"] }
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
- No migration, no Edge Function change, no new dependency.

## Out of scope

- Map speed, the zoom-out limit on 200-cell grids, keyboard and screen-reader access,
  splitting the oversized files, 3D load testing. A14 records them in the roadmap.
- The enrichment pieces of the plan.
- The audit's "narrow areas cannot be renamed" finding: `regionLabelBudget` gives every
  area at least six cells of label width, so the name and its rename target are always drawn.

## FINAL
