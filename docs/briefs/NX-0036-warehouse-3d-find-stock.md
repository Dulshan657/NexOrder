# NX-0036 — Find stock in the 3D warehouse map

```json brief
{
  "id": "NX-0036-warehouse-3d-find-stock",
  "base": "c64b0493c60e629250ca2e0bd8f9b4efbf3e8d0a",
  "approved": "2026-11-12 owner",
  "acceptance": [
    { "id": "A1", "check": "Given a product, the lookup returns every location on this site holding on-hand stock of it (allocated stock included — it is physically there), and none holding zero." },
    { "id": "A2", "check": "The product picker in 3D offers only products in stock somewhere on this site, sorted by name, so an operator cannot search for something that would light up nothing." },
    { "id": "A3", "check": "While a product is found, every level NOT holding it is dimmed to a neutral stone, the levels holding it keep their colour, and each rack holding it gets one beacon above it." },
    { "id": "A4", "check": "Finding a product moves the camera to frame every matching level; clearing the search leaves the camera where it is." },
    { "id": "A5", "check": "The find bar reports how many placed locations hold the product and, separately, how many units are on site but not in a rack (dock / unplaced), and has a Clear button that ends the highlight." },
    { "id": "A6", "check": "Finding uses only data the map already holds — no new query, no server change.", "manual": "diff review: no new hook, service or Edge Function in the change" },
    { "id": "A7", "check": "Merged and deployed to dev; /version.json shows the merge sha; finding a SKU on the demo lights its bins and the 2D map is unchanged.", "manual": "deploy:dev verification + owner browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/warehouse3d/findStock.test.ts", "test": "locationsHoldingProduct > returns every location holding on-hand stock of the product, allocated included", "proves": ["A1"] },
    { "file": "__tests__/warehouse3d/findStock.test.ts", "test": "locationsHoldingProduct > ignores a location whose on-hand for the product is zero", "proves": ["A1"] },
    { "file": "__tests__/warehouse3d/findStock.test.ts", "test": "productOptionsInWarehouse > lists only products in stock on this site, by name", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/findStock.test.ts", "test": "stockSummary > splits placed locations from units not in a rack", "proves": ["A5"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene highlight > dims every level that does not hold the product and keeps the colour of those that do", "proves": ["A3"] },
    { "file": "__tests__/warehouse3d/buildScene.test.ts", "test": "buildScene highlight > raises one beacon per rack holding the product", "proves": ["A3"] },
    { "file": "__tests__/warehouse3d/cameraPresets.test.ts", "test": "framePoints > centres on the matches and stands back far enough to see them all", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/findStockBar.test.tsx", "test": "FindStockBar > picking a product reports its locations and the counts", "proves": ["A2", "A5"] },
    { "file": "__tests__/warehouse3d/findStockBar.test.tsx", "test": "FindStockBar > Clear ends the search", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

Second of three PRs for the 3D map (NX-0035 shipped the scene). An Admin or
Manager in the 3D view picks a product and sees, at a glance, every rack level
holding it — everything else fades to stone, matching racks get a beacon and
the camera swings to frame them. "Where is the X?" answered without reading a
tree or a stock table.

## Approach

- **Pure, `lib/warehouse3d/findStock.ts`:** `locationsHoldingProduct(binContents,
  productId)`, `productOptionsInWarehouse(binContents, products)`,
  `stockSummary(binContents, productId, placedIds)`. All read
  `model.binContents`, which the map already loads (warehouse-scoped balances,
  refreshed by the existing realtime subscription) — no new query.
- **`buildScene`** gains an optional `highlightIds`: a non-matching level gets
  `colorSource: 'dimmed'`; matches keep their colour; `scene.beacons` holds one
  point above each matching rack. Absent `highlightIds` → output unchanged.
- **`cameraPresets.ts`** gains `framePoints(points, bounds)`; `CameraRig` takes
  an optional framing target applied when a search starts.
- **`three/FindStockBar.tsx`** wraps the existing
  `components/admin/ProductSearchDropdown.tsx`, adds the counts line and Clear;
  rendered top-left inside `Warehouse3DView`. `RackedWorkspace` passes
  `binContents` and the products it already fetches (≈2 lines).
- `RackInstances` renders beacons (instanced, same `InstancedBoxes`).

## Out of scope

- Find in the 2D map (3D only for this PR).
- Searching by lot/batch, by handling unit, or several products at once.
- Pick-route paths (NX PR3).
- Any server, migration or new data.

## FINAL
