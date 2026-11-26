# NX-0047: Warehouse 2D map feels smooth, robust and premium

```json brief
{
  "id": "NX-0047-warehouse-map-premium",
  "base": "060edeb71276db287c6a817fe8bd30d778ee85d8",
  "approved": "2026-11-26 owner",
  "acceptance": [
    { "id": "A1", "check": "Zoom in, Zoom out, the + - 0 keys, Fit and a floor change move the map with a short ease-out animation instead of jumping; with prefers-reduced-motion they jump straight to the target." },
    { "id": "A2", "check": "A wheel or trackpad zoom scales in proportion to the scroll distance (line-mode and pixel-mode deltas normalised), not by a fixed step per event." },
    { "id": "A3", "check": "Releasing a fast pan lets the map glide to a stop; it does not glide after a pinch, a marquee drag or a paint stroke, nor under prefers-reduced-motion, and a new press stops it." },
    { "id": "A4", "check": "Zooming does not rebuild the map scene on every frame: the scene memo depends on a settled scale that changes only when a gesture or animation ends and the label level-of-detail would change." },
    { "id": "A5", "check": "The floor grid is drawn as one patterned rect rather than a line per row and column, and each zone's wash is one path rather than a rect per cell." },
    { "id": "A6", "check": "A floor larger than the screen can be zoomed out past the fitted view; the minimum zoom is relative to the fit, not a fixed 0.4." },
    { "id": "A7", "check": "WarehouseCanvas and the map markers use the map colour tokens and the app's fonts: no hard-coded hex colours and no generic sans-serif or monospace font families." },
    { "id": "A8", "check": "Racks render with depth (a shared shadow filter on the rack group, never per bin, and a subtle gradient); a selected bin shows a two-ring highlight; hover is a ring, not a brightness change." },
    { "id": "A9", "check": "The occupancy ramp is a refined, perceptually even ramp and every stop keeps the map's label ink at 4.5:1 or better." },
    { "id": "A10", "check": "The overlay legend sits on the map in a frosted card carrying data-map-control, with an occupancy gradient bar and text no smaller than 12px." },
    { "id": "A11", "check": "The bin hover card is placed with lib/popoverPosition so it never clips on a top-row or edge bin, and it shows the bin's friendly name with its code." },
    { "id": "A12", "check": "The map controls are one frosted stack with 36px buttons (44px on a coarse pointer), a tabular zoom percentage, and tooltips naming their keys." },
    { "id": "A13", "check": "A 2-second wheel zoom on dev MAIN commits no React render mid-gesture and holds near 60 fps; before/after numbers are in the PR.", "manual": "Chrome Performance trace on the built app against dev MAIN, before and after" },
    { "id": "A14", "check": "Browser walk at 1440px and 360x664 (pan with momentum, pinch, wheel, Fit, floor switch, hover on a top-row bin, legend vs controls, reduced motion on) shows no regression, and the contrast crawl passes on the Warehouse map.", "manual": "browser walk + tests/contrast crawl on a build served on port 3004; outcomes in FINAL" },
    { "id": "A15", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/mapViewport.test.ts", "test": "interpolateViewport > interpolates zoom in log space and eases out", "proves": ["A1"] },
    { "file": "__tests__/mapViewportHook.test.tsx", "test": "useMapViewport > Fit animates to the fitted view instead of jumping", "proves": ["A1"] },
    { "file": "__tests__/mapViewportHook.test.tsx", "test": "useMapViewport > a wheel zoom scales with the scroll distance", "proves": ["A2"] },
    { "file": "__tests__/mapViewportHook.test.tsx", "test": "useMapViewport > a released fast pan keeps gliding", "proves": ["A3"] },
    { "file": "__tests__/mapSceneIsolation.test.ts", "test": "WarehouseCanvas zooms without rebuilding its scene > the scene memo depends on the settled scale, not the live one", "proves": ["A4"] },
    { "file": "__tests__/mapSceneIsolation.test.ts", "test": "WarehouseCanvas zooms without rebuilding its scene > draws the grid as one pattern and each zone wash as one path", "proves": ["A5"] },
    { "file": "__tests__/mapViewport.test.ts", "test": "clampViewport > lets a floor larger than the screen zoom out past its fit", "proves": ["A6"] },
    { "file": "__tests__/warehouseMapPolish.test.ts", "test": "warehouse map polish > the canvas and markers use tokens and the app fonts", "proves": ["A7"] },
    { "file": "__tests__/warehouseCanvasLabels.test.tsx", "test": "WarehouseCanvas — depth > racks share one shadow filter on the group and a selected bin has two rings", "proves": ["A8"] },
    { "file": "__tests__/warehouseOverlays.test.ts", "test": "occupancyColor > every stop keeps the label ink at 4.5:1", "proves": ["A9"] },
    { "file": "__tests__/warehouseMapPolish.test.ts", "test": "warehouse map polish > the legend sits on the map as a map control", "proves": ["A10"] },
    { "file": "__tests__/warehouseMapPolish.test.ts", "test": "warehouse map polish > the hover card is placed by popoverPosition and shows the friendly name", "proves": ["A11"] },
    { "file": "__tests__/warehouseMapPolish.test.ts", "test": "warehouse map polish > the controls are touch-sized with key-hint tooltips", "proves": ["A12"] }
  ],
  "allow": []
}
```

## Goal

The 2D live map works but feels cheap and fragile. Zoom and Fit snap instead of moving.
Every wheel tick rebuilds every bin, label and grid line. Zoom-out stops at 0.4. The fills
are flat pastels, the labels use generic fonts, the legend sits outside the map, and the
hover card clips on top-row bins. The owner wants it robust and premium. This PR covers
feel and speed plus visual polish.

## Approach

**Stacked on NX-0046 (PR #62).** That PR edits the same files, so this branch starts at
its tip and opens only after #62 merges. A merge commit keeps the base an ancestor of `main`.

Feel and speed:
- `components/inventory/warehouse/mapViewport.ts` gains:
  - pure `interpolateViewport` and `easeOutCubic`;
  - a fit-relative minimum scale.
- `useMapViewport.ts` gains:
  - an rAF `animateTo`;
  - an exponential wheel zoom;
  - pan momentum with friction;
  - a reduced-motion check;
  - a `settledScale`.
- `WarehouseCanvas.tsx`:
  - keys its scene memo on `settledScale` (LOD-quantised);
  - draws the grid as one `<pattern>` and the zone washes as paths from `zoneRegions.ts`;
  - hoists the per-rack capacity and spine maps out of the zoom path.

Visual polish:
- `index.css` gains `--color-map-*` tokens.
- `WarehouseCanvas.tsx` / `warehouseMarkers.tsx` use them. They also get:
  - a shared `<defs>` shadow filter and gradient;
  - the app's fonts;
  - a counter-scaled slotting quantity.
- `warehouseOverlays.ts` gets a new occupancy ramp.
- `OverlayControls.tsx` and `MapStage.tsx` put the legend on the map.
- `MapStage.tsx`'s hover card is placed by `lib/popoverPosition.ts`, with its name from `lib/locationDisplay.ts`.
- `MapControls.tsx` is restyled with `components/ui/Tooltip.tsx`.

The visual half is drafted by a Fable 5.2 subagent and reviewed here before it is committed.

## Out of scope

- Minimap, fullscreen, find-stock dimming and fly-to, and keyboard navigation between bins. These are a later PR.
- The layout designer canvas (`components/admin/layout/LayoutCanvas.tsx`), beyond the shared palette tokens.
- The 3D view.

## FINAL
