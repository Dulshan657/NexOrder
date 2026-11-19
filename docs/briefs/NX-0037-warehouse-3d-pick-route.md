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
    { "id": "A6", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" },
    { "id": "A7", "check": "The 2D map draws the same walk: from the dock along the engine's aisle corners to each stop on the floor being viewed, a Start marker at the dock, and the route line and stop markers keep a constant on-screen size at every zoom in a colour distinct from the rack fills; a stop without a path falls back to a straight leg from the previous stop." },
    { "id": "A8", "check": "In 3D, while a route is shown the area names fade so they no longer hide the line, and the Start pill sits above the dock point instead of on top of stop 1." },
    { "id": "A9", "check": "Dev carries a demo order whose route visits several aisles, so the walk is visible end to end.", "manual": "order placed on dev through place-order; wie_order_pick_stops returns 6 stops; owner browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/wie/graph.test.ts", "test": "dijkstraWithPaths > gives an edge-contiguous path whose weights sum to the distance", "proves": ["A1"] },
    { "file": "__tests__/wie/graph.test.ts", "test": "dijkstraWithPaths > gives no path to an unreachable node", "proves": ["A1"] },
    { "file": "__tests__/wie/picking.test.ts", "test": "legPaths > each leg's path length plus access offset equals its legDistanceM", "proves": ["A2"] },
    { "file": "__tests__/wie/picking.test.ts", "test": "simplifyPath > keeps only the corners of a walk", "proves": ["A2"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > draws each leg along its corners in metres, with a riser to the stop's level", "proves": ["A4"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > falls back to a straight leg when a stop has no path", "proves": ["A3", "A4"] },
    { "file": "__tests__/warehouse3d/routeScene.test.ts", "test": "routeScene > draws only legs on the floor being viewed", "proves": ["A4"] },
    { "file": "__tests__/warehouse/routeOverlay2d.test.ts", "test": "routeOverlay2d > draws each leg from the dock along the engine's walk to the stop", "proves": ["A7"] },
    { "file": "__tests__/warehouse/routeOverlay2d.test.ts", "test": "routeOverlay2d > falls back to a straight leg from the previous stop when a stop has no path", "proves": ["A7"] },
    { "file": "__tests__/warehouse/routeOverlay2d.test.ts", "test": "routeOverlay2d > draws only the floor being viewed", "proves": ["A7"] },
    { "file": "__tests__/warehouse3d/routeLabels.test.tsx", "test": "route labels > fade the area names while a route is shown", "proves": ["A8"] },
    { "file": "__tests__/warehouse3d/routeLabels.test.tsx", "test": "route labels > anchor the Start pill above the dock", "proves": ["A8"] }
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

## Revision 2026-11-13 (owner: "go")

The owner walked dev and saw no line. Testing in their Chrome showed the 3D route
drawing correctly but invisible in practice: dev's only routable order was one
stop 5.5 m from the dock, its line hidden under the "Inbound staging" label and
START covering stop 1; and the 2D route was a 7 px emerald dot on emerald racks
with no line from the dock. So this PR now also (A7) draws the engine's walk on
the 2D map in fuchsia at constant screen size, (A8) fades area names in 3D while a
route is shown and lifts the Start pill above the dock, and (A9) places a
multi-aisle demo order on dev. 2D drawing was out of scope before; it is not now.

## Out of scope

- Putaway / replenishment walks (`recommend-putaway-route`, `recommend-replen-route`).
- Changing how the route is sequenced; any migration; Amadiya.

## FINAL

Verified at `f656a7e`: `npx tsc --noEmit`, `npm run lint`, `npm run check:edge-types` (88 functions), `npm run check:demo` and `npm test` (451 files, 7027 tests) pass. `npm run check:brief`: every named test fails on the base and passes on the tip. 4 fail by assertion (`dijkstraWithPaths`, `legPaths`, `simplifyPath`) and 8 by absence (new modules). Review fixes are in `cfc4158`.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `dijkstraWithPaths > gives an edge-contiguous path whose weights sum to the distance`, `dijkstraWithPaths > gives no path to an unreachable node`, both by assertion (check:brief) | `dijkstra` is unchanged. |
| A2 | claimed | `legPaths > each leg's path length plus access offset equals its legDistanceM`, `simplifyPath > keeps only the corners of a walk`, both by assertion (check:brief) | |
| A3 | claimed | `routeScene > falls back to a straight leg when a stop has no path` (check:brief); `recommend-pick-route` deployed to dev 2026-11-17, exit 0 | The response shape is additive. An older client ignoring the field is by construction, not tested. |
| A4 | claimed | `routeScene > draws each leg along its corners in metres, with a riser to the stop's level`, `routeScene > draws only legs on the floor being viewed` (check:brief) | Proven by absence. |
| A5 | claimed | Owner, 2026-11-17: "it works". Ask the engine → Pick route on MAIN with `ORD-1794572122642`, in 2D and 3D, against dev at `c86b3b2` (contains `f656a7e`) | |
| A6 | not-claimed | | Written before the merge. Dev serves `c86b3b2`, a local merge of this tip with NX-0038, not the merge sha. |
| A7 | claimed | `routeOverlay2d > draws each leg from the dock along the engine's walk to the stop`, `routeOverlay2d > falls back to a straight leg from the previous stop when a stop has no path`, `routeOverlay2d > draws only the floor being viewed` (check:brief); owner walk as A5 | Proven by absence. Constant on-screen size and colour were checked by the owner's walk, not by a unit test. |
| A8 | claimed | `route labels > fade the area names while a route is shown`, `route labels > anchor the Start pill above the dock` (check:brief); owner walk as A5 | Proven by absence. |
| A9 | claimed | On dev, `wie_order_pick_stops('ORD-1794572122642', 1)` returns 6 stops (MAIN), queried 2026-11-17; owner walk as A5 | The order routes at MAIN only. It has 0 stops at AMADIYA (2873). |

### Not claimed

- The owner's walk was on dev's combined NX-0037 + NX-0038 build (`c86b3b2`), not on this branch alone or on the merge sha.
- Putaway and replenishment walks still draw no path. That is next: NX-0039, scan a product → the putaway and pick walks.
- Only one demo order (MAIN) was walked. Multi-order batch routes (up to 3 orders) were not walked in a browser.
- Not checked on the RS35, because the map is a desktop surface.
