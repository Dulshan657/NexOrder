# NX-0037 — Pick routes in the 3D warehouse map

```json brief
{
  "id": "NX-0037-warehouse-3d-pick-route",
  "base": "b83a997bc3321c6800662bab61f6f3bde728d464",
  "approved": "2026-11-12 owner",
  "acceptance": [
    { "id": "A1", "check": "Path reconstruction: alongside its distances, the engine's Dijkstra returns how each node was reached, and the path it gives from the dock to any reachable node is edge-contiguous and its edge weights sum to the reported distance; an unreachable node has no path. The existing distance-only `dijkstra` is unchanged." },
    { "id": "A2", "check": "Each leg of a sequenced pick route (dock → stop 1 → stop 2 …) has a node path whose length plus the stop's access offset equals that leg's `legDistanceM`, and a simplified path keeps only its corners." },
    { "id": "A3", "check": "`recommend-pick-route` returns each stop's walking path as {floor, x, y} corner points; an older client ignores the field and a client given no path falls back to a straight leg." },
    { "id": "A4", "check": "The 3D route draws each leg along those aisle corners in metres at walking height, with a riser up to the stop's rack level and the stop's sequence number; only legs on the floor being viewed are drawn." },
    { "id": "A5", "check": "Choosing an order in 'Ask the engine' while in 3D draws its route along the aisles.", "manual": "fn:deploy:dev recommend-pick-route (with owner consent) + owner browser walk" },
    { "id": "A6", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/wie/graph.test.ts", "test": "dijkstraWithPaths > gives an edge-contiguous path whose weights sum to the distance", "proves": ["A1"] },
    { "file": "__tests__/wie/graph.test.ts", "test": "dijkstraWithPaths > gives no path to an unreachable node", "proves": ["A1"] },
    { "file": "__tests__/wie/picking.test.ts", "test": "legPaths > each leg's path length plus access offset equals its legDistanceM", "proves": ["A2"] },
    { "file": "__tests__/wie/picking.test.ts", "test": "simplifyPath > keeps only the corners of a walk", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > draws each leg along its corners in metres, with a riser to the stop's level", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > falls back to a straight leg when a stop has no path", "proves": ["A3", "A4"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > draws only legs on the floor being viewed", "proves": ["A4"] }
  ],
  "allow": []
}
```

## Goal

Third and last PR for the 3D map. Choosing an order in "Ask the engine" already
sequences its pick walk server-side (`recommend-pick-route`), but the client only
ever got the stop ORDER, so the 2D map draws straight lines between stops —
through racks. This makes the engine return the walk it actually computed, and
the 3D view draws it along the aisles: dock → each stop in sequence, a riser up
to the rack level being picked, a numbered marker per stop.

## Approach

- **Pure, `_shared/wie/graph.ts`:** `dijkstraWithPaths(graph, source)` returns
  `{ dist, prev }`; `dijkstra` delegates to it and returns `.dist` — one
  implementation, unchanged behaviour, the existing graph tests untouched.
  `pathTo(prev, source, target)` returns a node-id path or null.
- **Pure, `_shared/wie/picking.ts`:** `legPaths(graph, startNodeId, routedStops)`
  (one node path per leg, from the same Dijkstra the sequencer uses) and
  `simplifyPath(points)` (corners only — graph nodes are grid cells, so a straight
  aisle collapses to its two ends).
- **`recommend-pick-route/index.ts`:** each stop gains an optional
  `path: {floor, x, y}[]` (grid cells); `PickRouteStop.path?` in `types.ts`. Optional
  both ways, so an older function or an older client still works.
- **Pure, `lib/warehouse3d/routeScene.ts`:** route stops + the scene's level boxes →
  per-leg polylines in metres at walking height on the viewed floor, a riser to
  each stop's level, and labelled stop markers. No path → a straight leg.
- **`three/RoutePath3D.tsx`:** drei `Line` + `Html` (both on the allow-list).
  `Warehouse3DView` takes the `routeStops` `RackedWorkspace` already holds.
- **Deploy order** (CLAUDE.md): the function to dev FIRST
  (`npm run fn:deploy:dev recommend-pick-route` — needs the owner's consent),
  then the frontend.

## Out of scope

- Drawing paths on the 2D map (it keeps straight lines).
- Putaway / replenishment walks (`recommend-putaway-route`, `recommend-replen-route`).
- Changing how the route is sequenced; any migration; Amadiya.

## FINAL
