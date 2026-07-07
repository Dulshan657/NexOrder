# Warehouse Intelligence Engine (WIE) — Phased Implementation Plan

## Context

The user's PRD (`OrderSystem/Untitled document.md`) describes a spatial optimization engine: warehouses modeled as a graph-based digital twin, with a grid layout designer, rule engine, two-stage putaway scoring with explainability, pick-route optimization, layout versioning, and analytical what-if simulation. NexOrder already has substantial groundwork: a `locations` hierarchy (WAREHOUSE→ZONE→BIN→SHELF, materialized paths), per-bin `capacity_slots`/`slot_kind`, `products.size_factor`, `product_home_bins` (single home-bin putaway), directed bin-level reservations (mig 00040), and a ledger-backed inventory core mutated only via `inv_*` SECURITY DEFINER RPCs. What's missing is exactly the engine: in-warehouse geometry, a routing graph, rules, scoring, versioned layouts, and simulation.

### Decisions locked in with the user (interview 2026-07-06)

1. **Module inside NexOrder** — same app, same Supabase project, existing auth/roles/UI shell.
2. **Full product build-out** planned in phases; architecture sized for the whole vision.
3. **Designer**: 2D grid editor; **multi-floor in schema from day one** (UI single-floor first); CAD/PDF import deferred to the last phase.
4. **Engine runtime stays in Supabase** — pure TS engine library shared by Edge Functions; graph distances **precomputed into Postgres at layout-publish time**; overnight batch via pg_cron.
5. **Bin-level inventory as source of truth, phased per warehouse** — a warehouse opts in when a layout is published; bulk warehouses keep current behavior indefinitely.
6. **Extend the existing `locations` tree** (add AISLE/RACK/BAY/STAGING kinds + versioned geometry), not a parallel spatial model.
7. **Rules**: visual rule-builder UI; rules stored as structured JSON evaluated by the engine.
8. **Simulation**: analytical what-if (KPI recompute + diff on historical data), no discrete-event sim.
9. **Roles**: reuse Admin (layout design) / Manager (ops + optimization) / Warehouse staff (execute + accept/override, scoped by `home_warehouse_id`).
10. **Picking**: generated pick routes (sequenced pick lists, batch picking) AND pick patterns feed slotting.
11. **Sequencing**: vertical slice first (Phase 1 = thin end-to-end loop on one warehouse), then deepen each layer.

---

## Key architectural decisions

### 1. Single-source engine at `supabase/functions/_shared/wie/` — no twin files
Verified: `tsconfig.json` has `moduleResolution: "bundler"` + `allowImportingTsExtensions: true`, the `@` alias maps to repo root in both tsconfig and Vite, and Vitest already imports from `_shared` (`__tests__/orderStatusRollup.test.ts`). Frontend imports `@/supabase/functions/_shared/wie/*.ts`; Deno uses the same `.ts`-suffixed relative imports. **Rules for the module (enforced by a purity test):** no `Deno.*`, no URL/npm imports, no I/O — plain data in, plain data out; data loading stays in edge functions / services.

```
supabase/functions/_shared/wie/
  types.ts     graph.ts     rules.ts     scoring.ts
  explain.ts   putaway.ts   picking.ts(P5)  simulate.ts(P6)  version.ts
```

### 2. Graph = walkway skeleton + bin snapping — NOT a bin×bin matrix
Bin×bin at 100k bins is 10^10 rows. Instead:
- `layout_graph_nodes/edges` — walkway skeleton only (junctions, docks, lifts): ~1–5k nodes even for huge warehouses. Auto-derived from walkway objects at publish.
- Every placement stores `graph_node_id` (nearest walkway node) + `access_offset_m`.
- `layout_travel_distances` — precomputed shortest paths **from anchors only** (docks + zone entries, ~10–50) to every node: ≤250k rows worst case, written by `publish-layout`.
- Ad-hoc bin↔bin routing (pick paths) runs Dijkstra in the edge function at request time over the small skeleton.
- ≤2s recommendation budget: stage-1 candidate filter in SQL (top ~200 by dock distance + fill headroom), stage-2 scoring in TS over that set. Never load 100k rows into Deno.

### 3. Layout versioning = versioned overlay tables over stable `locations` identities
Live stock has FKs into `locations` — never clone the tree. A `locations` row is the permanent physical identity; all geometry/graph/version data lives in `layout_*` tables keyed by `layout_id`. Clone copies overlay rows only. Draft-created bins are real `locations` rows with `is_active=false` + `created_in_layout_id`; publish activates them, and deactivates removed bins only if empty (else publish blocks with a structured rejection list). One published layout per warehouse via partial unique index. Rollback = re-publish an archived version.

### 4. Bin-level opt-in rides the existing `bulk`/`racked` rails
Mig 00040's `inv_warehouse_draw_locations` / `inv_root_warehouse` already implement coexistence. Publishing a warehouse's first layout sets `location_type='racked'` + `active_layout_id`. Receipts keep landing at the warehouse root (= un-put-away staging); putaway acceptance is an `inv_transfer_stock` root→bin move. **Phase 1 touches no `inv_*` RPC.**

### 5. Non-storage objects live in `layout_objects`, not `locations`
Walls/walkways/obstacles can't hold stock and are version-specific; keeping them out of `locations` protects every stock query and draw-location function. Exception handling for docks: dock is a `layout_objects` row with optional `staging_location_id` → a `locations` row of new kind `STAGING` (Phase 1 default: none).

### 6. Velocity/demand stats = nightly rollup tables from `inventory_movements` (pg_cron)
`wie_product_velocity` (A/B/C classes per warehouse) and `wie_location_traffic` (visits per graph node → congestion/heatmaps). Batch re-optimization writes suggestions to `wie_slotting_suggestions` — never auto-moves stock.

### 7. Designer canvas = plain SVG (no new dependency)
viewBox pan/zoom + viewport culling + zoom LOD keeps visible elements in the low thousands. Renderer-agnostic editor state (pure reducer) so the render layer can swap to `<canvas>` at Phase 8 scale if profiling demands.

---

## Phase 1 — Vertical Slice (size L)

**Goal:** on ONE opted-in warehouse: draw a minimal grid layout → publish (graph + distances precomputed) → receive stock → scored, explained putaway recommendation in `ReceiveStockView` → accept (stock moves root→bin) or override.

### Migrations
- **`00045_wie_core.sql`** (single BEGIN/COMMIT):
  - Widen `locations.kind` CHECK to add `AISLE`,`RACK`,`BAY`,`STAGING` (⚠ verify auto-generated constraint name in `pg_constraint` first — created inline in 00027). Add `locations.active_layout_id`, `created_in_layout_id`.
  - `warehouse_layouts` (warehouse_id FK, name, status draft|published|archived, version, cloned_from, grid_width/height, cell_size_m, **floor_count**, published_at, created_by). Partial unique index: one published per warehouse.
  - `layout_placements` (layout_id, location_id, **floor**, x, y, w, h, rotation, graph_node_id, access_offset_m; UNIQUE(layout_id, location_id)).
  - `layout_objects` (layout_id, object_type wall|dock|walkway|obstacle|label, floor, x/y/w/h, meta JSONB, staging_location_id).
  - `layout_graph_nodes` (layout_id, floor, x, y, node_type walk|junction|dock|lift) + `layout_graph_edges` (from/to, weight_m, bidirectional).
  - `layout_travel_distances` (layout_id, from_node_id, to_node_id, distance_m; PK on the triple).
  - `wie_rules` (warehouse_id nullable=global, rule_type putaway|picking|slotting, enforcement hard|soft, priority, definition JSONB, is_active).
  - `wie_putaway_recommendations` (warehouse_id, layout_id, product_id, quantity, goods_receipt_id, recommended_location_id, alternatives JSONB, explanation JSONB, engine_version, status suggested|accepted|overridden|expired, chosen_location_id, actor_id, decided_at).
  - `wie_publish_layout_tx` SECURITY DEFINER RPC (service_role-only) so publish is atomic.
- **`00046_wie_rls.sql`** (deployed LAST): enable RLS on all new tables; SELECT for Admin/Manager/Warehouse (mirror `product_home_bins_select_ops` from 00039); no client write policies — writes via edge functions only.

### Edge functions (template: `receive-stock/index.ts` — requireAuth → rateLimit → zod → service client → logAuditEvent)
| Function | Roles | Purpose |
|---|---|---|
| `mutate-layout` | Admin | Discriminated-union actions: create/update-meta/upsert_placements/delete_placements/upsert_objects/delete_objects/clone/archive. Drafts only. New-bin placement also inserts the `locations` row (is_active=false, auto code `WH-A01-R02-B03`). |
| `publish-layout` | Admin | Validate (reachability, ≥1 inbound dock, no stock in removed bins) → build skeleton via engine → snap placements → Dijkstra from anchors → bulk-insert distances → activate/deactivate locations → flip statuses + set `racked`/`active_layout_id`. All inside `wie_publish_layout_tx`. Returns structured rejections. |
| `recommend-putaway` | Admin, Manager, Warehouse | Input `{warehouse_id, lines[], goods_receipt_id?}` (Warehouse scoped to home warehouse). SQL stage-1 top-200 candidates → engine `recommendPutaway()` → persist recommendation rows → return winner + explanation + alternatives. No published layout → `{mode:'legacy'}`. |
| `decide-putaway` | Admin, Manager, Warehouse | accept/override/re-evaluate; executes root→bin move via existing `inv_transfer_stock`; marks recommendation row. |

### Engine (Phase 1 scope)
- `graph.ts`: walkway raster → skeleton (junction = walkway cell with ≠2 walkway neighbors) → weighted edges (cell_size_m); binary-heap Dijkstra; `snapBinToNode()`.
- `scoring.ts`: factors `travel_distance`, `capacity_fit` (best-fit vs `capacity_slots` × `size_factor`), `grouping` (same product nearby; `product_home_bins` as hint). Default weights in `types.ts`.
- `rules.ts`: generic interpreter over structured JSON; 3 seed rule templates — hard "product category requires zone tag", hard "bin fill ≤ 100%", soft "prefer zone with existing stock of product". Same JSON shape the Phase 3 builder will emit.
- `explain.ts`: `PutawayExplanation` = engineVersion, candidatesConsidered, hardFilters (with rejected samples), winner + alternatives each with per-factor `{weight, rawValue, normalized, weighted, detail}` and ruleTriggers.

### Frontend
- `types.ts` + `lib/adapters.ts`: `WarehouseLayout`, `LayoutPlacement`, `LayoutObject`, `PutawayRecommendation`, `PutawayExplanation`; extend `LocationKind`. Regenerate `lib/database.types.ts`.
- Services `services/supabase/layoutService.ts`, `putawayService.ts`; hooks `hooks/queries/useLayouts.ts`, `usePutawayRecommendation.ts`.
- Designer (Admin, new tab in `components/admin/WarehousesSettingsSection.tsx` beside `WarehouseTreeEditor`):
  - `components/admin/layout/LayoutDesignerView.tsx` — layout list, draft/published badges, create/clone/publish (+validation rejection UI).
  - `components/admin/layout/LayoutCanvas.tsx` — SVG grid, pan/zoom, drag-paint walkways/walls, place racks/bins/docks, click-select → `PlacementInspector.tsx` (code, kind, capacity_slots, slot_kind). Floor written as 0.
  - `components/admin/layout/useLayoutEditorState.ts` — pure reducer, renderer-agnostic, unit-tested.
- `components/inventory/ReceiveStockView.tsx`: after successful receipt into a layout-enabled warehouse, show a "Put away" panel — per line: recommended bin + score + **Why?** popover (`PutawayExplanationCard.tsx` — factor bars + rule chips) + Accept / Choose another bin / Skip. Non-layout warehouses unchanged.

### Tests (`__tests__/`)
`wie/graph.test.ts` (skeleton extraction, Dijkstra, unreachable bins), `wie/scoring.test.ts` (filter+score determinism, explanation snapshot), `wie/rules.test.ts` (seed templates), `wie/purity.test.ts` (no Deno globals / URL imports in `_shared/wie/**`), `layoutEditorState.test.ts` (reducer), `wieMigration.integration.test.ts` (publish small layout → distances rows; receive → recommend → accept moves stock root→bin; **bulk-warehouse regression** — reserve/receive on bulk unchanged).

### Deploy order
Edge functions → frontend → `00045` DDL → `00046` RLS last (house convention). Migrations applied via Management API (`supabase/apply-sql.mjs`).

---

## Later phases

| Phase | Size | Goal & key deliverables | Depends on |
|---|---|---|---|
| **2 — Full designer + zone semantics** | L | Full palette (zones as painted regions, aisle tool, rack wizard "4 bays × 3 shelves × 6 bins"), undo/redo, copy/paste, layout compare/diff view, rollback, publish-validation UX. Schema: `zone_profiles` (zone_type enum fast/slow/hazardous/cold/bulk/returns/quarantine/overflow, allowed_categories, priority_weight, max_utilization_pct) + `locations.zone_profile_id`. Editor perf (culling, LOD). | 1 |
| **3 — SKU attributes + rule engine + builder UI** | L | `product_wms_attributes` (hazard_class, temp_min/max, FEFO/FIFO, stackable, handling_type, weight/volume/dims, custom JSONB — separate table, not products columns); `category_compatibility` matrix (forbidden/restricted/allowed, normalized a≤b). Full condition grammar (AND/OR, scopes, priority conflict resolution). `RuleBuilderView.tsx` structured pickers + live client-side "test this rule" (same engine import); `CompatibilityMatrixView.tsx`; `mutate-wie-rule` edge fn. | 1, 2 |
| **4 — Full optimization + putaway queue + re-slotting** | XL | Velocity pipeline (`wie_refresh_velocity()` + pg_cron), congestion + velocity_match + zone_preference factors, per-warehouse `wie_scoring_profiles` weights + admin UI, `PutawayQueueView.tsx` for Warehouse role, overnight `wie-batch-reoptimize` → `wie_slotting_suggestions` reviewed by Manager, executed via `inv_transfer_stock`. `product_home_bins` becomes a "pinned bin" preference. | 1–3 |
| **5 — Pick routing + batch picking** | L | `picking.ts` nearest-neighbor + 2-opt over skeleton (request-time Dijkstra), S-shape fallback; batch grouping under cart capacity; sequence numbers into pick flow (`pick_route_stops` or `pick_progress.sequence`); route overlay on read-only canvas; optional distance-aware tiebreak in `inv_reserve_order` (additive; bulk invariant preserved + regression-tested). | 1, 2 (4 improves) |
| **6 — Analytical simulation** | M | `simulate.ts` replays historical picks/orders through a draft layout+rules → KPIs (travel m, utilization %, congestion heatmap, rule violations); `wie-simulate` edge fn (chunked) + `wie_simulations` table; diff view in designer ("draft cuts travel 12.4%"). | 1, 2, 4, 5 |
| **7 — Reporting & analytics** | M | `WarehouseIntelligenceView.tsx`: utilization per zone, travel trend, hot/cold heatmap overlay on canvas, empty-location tracking, re-slotting inbox; `wie_kpi_daily` rollups via pg_cron; Recharts (existing dep). | 4–6 |
| **8 — Scale, multi-floor UI, CAD import** | XL | Designer virtualization/canvas swap, floor switcher + lift edges (schema already supports), async publish pipeline (distance precompute at 100k bins), `layout_travel_distances` pruning, CAD/PDF import as ingestion edge fn producing draft objects for human confirmation. | all |

---

## Risks & gotchas

1. **BIN-above-SHELF inversion** in legacy trees: don't mass-migrate. Engine treats "storage node" structurally (leaf-most active node with capacity or balances), not by kind. Hierarchy canonicalizes per-warehouse at first layout creation; `publish-layout` flags inverted chains advisorily.
2. **Uncommitted migs 00042–00044** on the current branch: WIE branches from the commit containing them (numbering starts at 00045; `database.types.ts` regen collides otherwise). Note 00042's tenant scoping doesn't cover `locations` — demo personas share warehouses/layouts; acceptable for now, add a `tenant` column to `warehouse_layouts` later if not.
3. **`locations.kind` CHECK constraint name** is auto-generated — verify via `pg_constraint` before DROP; keep 00045 in one transaction (Management API applies scripts whole).
4. **Edge-function limits**: stage-1 in SQL, stage-2 over ≤200 candidates; chunk distance inserts (~5k rows/statement); publish goes async at Phase 8 scale.
5. **Bulk-warehouse regressions**: Phase 1 touches no `inv_*` RPC; Phase 5's reservation tiebreak must preserve 00040's bulk draw-set invariant, with an integration regression test before merge.
6. **RLS window**: between 00045 and 00046 the tables are service-role-only (no grants) — frontend must tolerate empty reads.
7. **Seeds/demo personas**: all new columns nullable/defaulted so existing seeds run unmodified; WIE demo layout ships as a separate optional seed.
8. **Engine purity**: `supabase/functions` is excluded from the root tsconfig program — the `purity.test.ts` guard is the insurance against Deno-isms breaking the Vite build late.

## Verification (Phase 1 definition of done)

1. `npx tsc --noEmit`, `npm test` (all new suites + existing 447 green), `npm run build`.
2. Integration: seed a small racked warehouse → draw layout (2 zones, 1 dock, walkways, ~20 bins) → publish → assert `layout_graph_*` + `layout_travel_distances` populated → `receive-stock` → `recommend-putaway` returns winner + full explanation ≤2s → `decide-putaway` accept → `inventory_balances` shows stock at the bin, movement ledger has transfer_out/transfer_in pair.
3. Bulk regression: place-order + receive-stock against a bulk warehouse behave byte-identically to before.
4. Manual: designer draw/publish in the browser; Why? popover renders factor bars; override path picks a different bin.

## Post-approval first steps

1. Commit/land the current branch (00042–00044) or branch from it; create `feat/wie-phase-1`.
2. Write the design spec to `docs/superpowers/specs/2026-07-06-warehouse-intelligence-engine-design.md` (condensed from this plan) and commit, per the brainstorming workflow.
3. Implement Phase 1 in order: engine library + tests → migrations → edge functions → frontend.
