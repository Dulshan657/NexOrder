# NX-0035 — 3D view of the warehouse live map (scene, toggle, flag)

```json brief
{
  "id": "NX-0035-warehouse-3d-scene",
  "base": "11b8bcfb99b6413ec1848eda627d44dd7fb5bdeb",
  "approved": "2026-11-12 owner",
  "acceptance": [
    { "id": "A1", "check": "A ninth module slug `warehouse_3d` exists, requires `inventory_dispatch`, and is enabled on `dev` only — Amadiya's module set is unchanged." },
    { "id": "A2", "check": "The 3D view is declared lazily in exactly one place, behind `MODULE_WAREHOUSE_3D`, and nothing imports a drei export outside the allow-list (CameraControls, Html, Line)." },
    { "id": "A3", "check": "The pure scene model places racks in metres from the layout's `cellSizeM`, stacks a rack's levels bottom-first, and makes each level `(pallet base + max load height + clearance)` tall, from the pallet spec in app_settings." },
    { "id": "A4", "check": "Each level carries its location id and is coloured by its fill (a null fill reads as 'unknown'); an active overlay colour wins over occupancy; only the active floor is built." },
    { "id": "A5", "check": "Camera presets: Top looks straight down at the scene centre, Iso views from an oblique corner, Aisle sits at 1.7 m eye height at the selected rack (scene centre when nothing is selected)." },
    { "id": "A6", "check": "While the map is in 3D, the mode buttons, area rename and sign edit are off; the 3D toggle is offered only when the map is in plain view mode (never mid-paint, mid-sweep or mid-slotting)." },
    { "id": "A7", "check": "The 2D/3D toggle is hidden for the Warehouse role, on a coarse-pointer or narrow device, and when WebGL is unavailable." },
    { "id": "A8", "check": "Clicking a level in 3D opens the same Bin detail panel the 2D map opens.", "manual": "browser walk on nexorder.vercel.app as Admin" },
    { "id": "A9", "check": "The Amadiya build ships no 3D code: `npm run check:demo` then grep of the amadiya dist for WebGLRenderer|CameraControls|Warehouse3DView finds nothing; on dev those symbols sit only in the lazy chunk.", "manual": "build every target and grep dist/" },
    { "id": "A10", "check": "Merged and deployed to dev; /version.json shows the merge sha; toggling 3D and back leaves 2D painting, signs and renames working, with no CSP reports in the console.", "manual": "deploy:dev verification + owner browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/warehouse3d/lazyGate.test.ts", "test": "warehouse_3d module > requires inventory_dispatch and is enabled on dev only", "proves": ["A1"] },
    { "file": "__tests__/warehouse3d/lazyGate.test.ts", "test": "3D lazy gate > declares the 3D view only behind MODULE_WAREHOUSE_3D", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/lazyGate.test.ts", "test": "3D lazy gate > imports nothing from drei outside the allow-list", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/dimensions.test.ts", "test": "levelHeightM > is pallet base plus max load height plus clearance, in metres", "proves": ["A3"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene > places a rack in metres from cellSizeM and stacks its levels bottom-first", "proves": ["A3"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene > carries each level's location id and colours it by fill, null fill as unknown", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene > prefers the active overlay colour over occupancy", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene > builds only the active floor", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/cameraPresets.test.ts", "test": "cameraPreset > top looks straight down at the scene centre", "proves": ["A5"] },
    { "file": "__tests__/warehouse3d/cameraPresets.test.ts", "test": "cameraPreset > aisle sits at eye height at the selected rack", "proves": ["A5"] },
    { "file": "__tests__/mapMode.test.ts", "test": "modeGuards in 3D > turns off the mode buttons, area rename and sign edit", "proves": ["A6"] },
    { "file": "__tests__/mapMode.test.ts", "test": "modeGuards in 3D > offers the 3D toggle only in view mode", "proves": ["A6"] },
    { "file": "__tests__/warehouse3d/mapViewToggle.test.tsx", "test": "can3d > is false for the Warehouse role", "proves": ["A7"] },
    { "file": "__tests__/warehouse3d/mapViewToggle.test.tsx", "test": "can3d > is false on a coarse pointer or without WebGL", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

Admins and Managers on desktop get a 3D view of the published warehouse beside
the existing 2D live map — rack levels as boxes tinted by fill and zone, orbit
camera with Top / Iso / Aisle presets, and a click on a level opening the
existing Bin detail panel. It is the first of three PRs (next: find stock, then
pick routes). Dev/demo only for now, behind its own module flag so the three.js
chunk is not shipped to Amadiya.

## Approach

- **Flag:** `warehouse_3d` in `config/environments.mjs` (`ALL_MODULES`,
  `MODULE_REQUIRES: ['inventory_dispatch']`, `dev.modules` only), mirrored in
  `lib/modules.ts` (`MODULE_WAREHOUSE_3D`) and `_shared/modules.ts`
  (`MODULE_SLUGS`). The existing vocabulary test in `__tests__/modules.test.ts`
  is updated to the nine-slug list. Docs: module count in CLAUDE.md,
  `docs/claude/environments.md`, a 3D section in `docs/claude/warehouse-map.md`.
- **Dependencies:** `three@0.187.0`, `@react-three/fiber@9.8.2`,
  `@react-three/drei@10.7.9` pinned exactly, `@types/three` dev. `vite.config.ts`:
  anchor the react/scheduler `manualChunks` regex to top-level `node_modules`, so
  fiber's nested scheduler stays out of the eager vendor chunk.
- **Pure model, `lib/warehouse3d/`** (no three, no React): `dimensions.ts`
  (`levelHeightM`, `cellToWorld`), `buildScene.ts` (level/rack/object/area specs
  from the same viewer model the 2D map uses — `binFillPct`, `binColors`,
  placements, objects, `zoneTint`), `cameraPresets.ts`.
  `groupPlacementsByCell` moves from `LayoutCanvas.tsx` to
  `components/admin/layout/placementGroups.ts` (re-exported) so node tests can
  import it.
- **Components, `components/inventory/warehouse/three/`**: `lazy3d.ts` (the one
  gated `lazyWithRetry` declaration), `Warehouse3DView.tsx` (Canvas,
  `frameloop="demand"`, falls back to 2D on context loss), `RackInstances.tsx`
  (instanced meshes; click → location id), `SceneObjects.tsx`, `AreaLabels.tsx`
  (drei `Html`), `CameraRig.tsx` (`CameraControls`), `MapViewToggle.tsx` +
  `useCan3d.ts`.
- **Wiring:** `RackedWorkspace.tsx` gains a `viewMode` and renders the 3D view
  in an `ErrorBoundary` + `Suspense` in the map slot, passing the existing
  `selectFromMap` as `onSelect` (~40 lines). `mapMode.ts` `modeGuards` gains a
  `threeD` input and `canToggle3d`. `WarehousePage.tsx` passes `canView3d`.

## Out of scope

- Find stock / SKU highlight (NX PR2) and pick-route paths (NX PR3).
- Any editing in 3D; the layout designer stays 2D.
- Real rack heights (no migration — every level is the same pallet height, so a
  carton shelf renders as tall as a pallet level).
- Other floors than the active one; the RS35 handheld and the Warehouse role.
- Shipping to Amadiya (`warehouse_3d` is not in its module set).

## FINAL

Verified at `c761968`: `npx tsc --noEmit`, `npm run lint`, `check:overlays`, `check:viewport`, `check:csp`, `check:edge-types`, `check:claude-md`, `check:demo` and `npm test` (446 files, 7001 tests) pass. `npm run check:brief`: every named test fails on the base and passes on the tip — 6 by assertion, 8 by absence (new modules).

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `warehouse_3d module > requires inventory_dispatch and is enabled on dev only` fails by assertion on the base, passes on the tip (check:brief) | Amadiya's set asserted unchanged in the same test. |
| A2 | claimed | `3D lazy gate > declares the 3D view only behind MODULE_WAREHOUSE_3D` and `3D lazy gate > imports nothing from drei outside the allow-list`, both by assertion (check:brief) | |
| A3 | claimed | `levelHeightM > is pallet base plus max load height plus clearance, in metres`, `buildScene > places a rack in metres from cellSizeM and stacks its levels bottom-first` (check:brief) | Proven by absence on the base. |
| A4 | claimed | `buildScene > carries each level's location id and colours it by fill, null fill as unknown`, `buildScene > prefers the active overlay colour over occupancy`, `buildScene > builds only the active floor` (check:brief) | Proven by absence. The overlay test was tightened after review: a level the overlay omits is now neutral, not its occupancy colour. |
| A5 | claimed | `cameraPreset > top looks straight down at the scene centre`, `cameraPreset > aisle sits at eye height at the selected rack` (check:brief); Iso and the no-selection fallback have their own unnamed tests | Proven by absence. |
| A6 | claimed | `modeGuards in 3D > turns off the mode buttons, area rename and sign edit`, `modeGuards in 3D > offers the 3D toggle only in view mode`, both by assertion (check:brief) | |
| A7 | claimed | `can3d > is false for the Warehouse role`, `can3d > is false on a coarse pointer or without WebGL` (check:brief) | Proven by absence. The pure rule is tested; the live media query and WebGL probe are not. |
| A8 | claimed | Owner, 2026-11-12: "i tested it on dev", against nexorder.vercel.app at `c761968` | Owner's own check; the steps run are not recorded here. |
| A9 | claimed | `check:demo` OK for both targets; amadiya build of `c761968` grepped for `WebGLRenderer\|CameraControls\|webglcontextlost`: 0 files. Dev build: those symbols only in the lazy `Warehouse3DView-*.js` chunk (999 kB, 268 kB gzip); `vendor-react` 194,402 B dev vs 194,394 B amadiya (no nested scheduler pulled in) | |
| A10 | claimed | `npm run deploy:dev` from `c761968`: VERIFIED, version.json = `c761968`, health 200; owner tested on dev the same day | Deployed from the branch, not the merge — the merge sha is not yet on dev. |

### Not claimed

- No console check for CSP reports was recorded; the owner's test does not say whether the console was opened, and the CSP is Report-Only.
- The merge commit is not yet deployed to dev; A10's deploy evidence is the branch tip `c761968`.
- Real rack heights: every level renders one pallet tall (~2.0 m), so carton shelves look as tall as pallet levels — by design, no migration.
- Selecting a rack, zone or area in the tree highlights nothing in 3D; only a selected level is outlined, and the Aisle preset frames only a selected level.
- Performance at the 200-cell grid cap or on a low-end GPU was not measured; only MAIN-sized sites on the dev data.
- The 3D view has no automated rendering test (jsdom has no WebGL); `InstancedBoxes`, `CameraRig` and `Warehouse3DView` are verified by the browser walk only.
