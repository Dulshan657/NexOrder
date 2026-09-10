# The warehouse map — areas, floor signs, zone binding, location names, code sweeps

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**

**Named areas** (mig `00090`) — an operator-drawn, tinted, labelled region ("Cold Storage", "Bulk"). A `layout_objects` row of `object_type='area'` whose `meta` is `{ name, zoneProfileId? }`, painted **cell-by-cell like a wall** (the data model stays 1×1, so erase/select keep working per cell).
- **An area's identity is its NAME, per floor.** `objectRegions.regionGroupKey` subdivides the flood fill by it, which is what lets a 50-cell area merge into one labelled region while a touching "Bulk" stays separate — merging on type alone would fuse them under one of the two names, the same failure that keeps `obstacle` out of `MERGED_OBJECT_TYPES`. Renaming therefore goes through `rename_area` (moves every cell); renaming the one selected cell would split the region.
- Areas **co-occupy with everything** in `ALLOWED_COOCCUPANTS` (like `label`): an area names the ground the racks stand on, so it must lie over them. It is **inert in `buildWalkableCells`** — neither walkable nor subtracted — so routing and publish readiness are untouched.
- Both canvases render it identically: wash under the grid, name above the bins, tinted via `zoneTint(zoneProfileId → zone_type)` so an area, its zone and the COLD_ROOM storage form agree on what "cold" looks like. `OBJECT_FILL.area` is only the no-profile fallback.
- **`meta.zoneProfileId` IS the binding, as of `00096`** — it was inert from `00090` until then, and the entry that used to sit here said so. What has not changed is HOW a bin's zone is read: **materialized-path ancestry to a `kind='ZONE'` location** (`00047`'s header; `wie_putaway_candidates`' LATERAL join). `locations.zone_profile_id` *on a bin* is still read by nothing and is still never stamped — binding moves the bin, it does not label it. See "Zone binding" below.
- **`meta.name` IS read, as of `00094`** — it is where a bin's friendly name comes from. That is display text, not zone semantics; the note above is unchanged.

**Floor signs** (mig `00097`) — plain wayfinding text on the map ("Inbound Staging"), placeable on a **published** layout. Backed by `object_type='label'`, legal since `00045` but until now authorable only on a draft, because `save_geometry` was its only writer and it `requireDraft`s. MAIN carries five from its seed.
- **A SIGN IS NOT AN AREA, and every difference follows.** An area is warehouse vocabulary with consequences: it renames the bins standing on it (`00094`) and re-parents them under a ZONE (`00096`). A sign is text. `paint_labels` therefore has **no `cascade_names`, no `include_custom`, and runs no binding pass** — do not add them "for symmetry" with `paint_areas`. The asymmetry is the feature.
- Safe on a live layout for exactly `00095`'s reason, if anything more strongly: `buildWalkableCells` whitelists `walkway|dock|lift|staging` and subtracts `wall|conveyor`, `publish-layout` reads `object_type` only for `staging_location_id`, and `resolveOverlaps` exempts labels outright. No graph node, no edge weight, no `access_offset_m`. **`warehouse_layouts.updated_at` is NOT bumped** — same rule as areas and `rename_area`.
- **`_shared/wie/signPaint.ts` is pure and imported by both runtimes** (re-exported by `lib/signPaint.ts`). It **delegates** to `areaPaint.ts` rather than forking it: `areaSpecsFromObjects` / `areaObjectsFromSpecs` / `areaCellsFingerprint` / `diffAreas` now take an `objectType` (defaulted to `'area'`, so every existing call site is unchanged). Forking would duplicate `fnv1a` and the cell comparator, and the fingerprint must agree byte-for-byte across the two runtimes or every save 409s. `planAreaCascade` stays area-only.
- **Signs get their OWN fingerprint and their own baseline ref.** Sharing the area one would make an area paint 409 a sign save and vice versa — the two pictures move independently and each action checks only its own.
- **`label` is now in `MERGED_OBJECT_TYPES`, keyed by name** like `area`. It was excluded on the argument that "merging two adjacent labels would swallow both names" — true of a merge on *type*, which is precisely what `regionGroupKey` exists to stop doing. Leaving it out had a cost only visible once signs became paintable: a painted sign is N separate 1×1 objects and both canvases gate name text at ~48px, so it could **never draw its own text at any zoom**. MAIN's seeded signs only showed because the seed wrote them as single `w: 10` rows. `obstacle` stays out (discrete named rooms).
- Consequently `'label'` is **removed from `NAMED_OBJECT_TYPES`** on both canvases (that pass iterates every object and would stamp the text on every cell), and the text is drawn **once per region, centred on its bounding box, in the top text layer above the bins** — signs co-occupy with everything, so one over a rack row is the normal case and text under the bins would vanish. Centring (vs an area name's top-left anchor) is what keeps the seeded signs looking identical.
- **The first save on a site rewrites its seeded wide labels as 1×1 rows** (MAIN's five become ~42). Lossless: the fold expands `w`/`h` and merging redraws them in place. `__tests__/signPaint.test.ts` pins the fingerprint across that round trip — without it every sign save on MAIN would 409 forever.
- Live map: one **Annotate** button (not a third one beside "Paint areas") opening `AreaPaintToolbar` with an **Areas | Signs** toggle. One working set, **one undo stack spanning both layers**, one Save. Clicking a sign's text enters annotate mode on the sign layer and opens `EditSignModal`, which **edits the working set rather than calling the server** — `paint_labels` is a full replace, so a self-saving dialog would be a second implementation of the same write with its own fingerprint to get wrong. Designer: `label` joins `AREA_SCOPE_TOOLS`; Save issues `paint_labels` **then** `paint_areas`, each only if its own fingerprint moved (signs first — they cannot fail on a cascade, so an area failure leaves only the risky half to retry).
- **The scoped eraser reads `annotationBrush`, not stacking order.** Signs and areas overlap freely and there is no ordering that is right in both directions; the operator already said which layer they are on.
- **A blank brush is now REFUSED, out loud** (`blockedAt.reason = 'unnamed'`). This was the reported bug: the Area tool armed on click, so painting before typing wrote cells with no `meta.name` — merging into no region, drawing no text, and rejected by the server. For an area the only trace was a `#a8a29e` wash at 12% opacity *under* the grid, invisible on stone. "I painted and nothing showed" was exactly this. The designer's area input also gained the `sanitizeAreaName` / `maxLength` / inline-issue treatment the live map has had since `00095`.

**Zone binding** (mig `00096`) — what finally reads an area's `meta.zoneProfileId`. A bin's zone is not a column: it is derived by prefix-matching `materialized_path` against `kind='ZONE'` rows, and every drawn bin was parented at the warehouse ROOT, so that LATERAL returned NULL for every bin on every site and the whole zone subsystem (`allowed_categories`, `priority_weight`, `max_utilization_pct`, the `zoneTag` rule field) had never once fired. Binding means **re-parenting**: a new `parent_id` AND a new `materialized_path`, plus a rewritten path on every SHELF child.
- **The rule, for a unit** (a flat bin, or a levelled rack's RACK PARENT): its area's `zoneProfileId` → that profile's ZONE; else the placement's own `zone_profile_id` → that ZONE; else the warehouse root. **The AREA wins over the per-bin dropdown** (`PlacementInspector`/`RackWizard`), which predates areas and is invisible on the map.
- **Erase, shrink or un-profile is NOT a special case** — it is the third branch, reached by evaluating the same rule again. That is what makes the reverse free, and it is the half most likely to be missing.
- **One ZONE per (warehouse, profile), never per area.** Two areas tagged Cold share `<WH>-Z4`. A zone's `code` is a `materialized_path` segment, so per-area zones would make renaming an area rewrite the zone's path and every descendant's — a second, harder path rewrite on top of this one. The cost: `zone_tag` (= `lower(zone.name)`) is the PROFILE name, so a `wie_rules` row matching on it matches the profile, not the area.
- **`_shared/wie/zoneBinding.ts` is pure and imported by both runtimes** (re-exported by `lib/zoneBinding.ts`); I/O beside it in **`_shared/zoneResolve.ts`**, which now owns `resolveZone` — lifted verbatim out of `mutate-layout`, because two find-or-create implementations racing on one (warehouse, profile) pair leave two ZONE rows and a LATERAL that picks the longer path. **Containment is not redefined**: `areaForRect` (the majority-of-cells vote) is imported from `locationNaming.ts`, so naming and binding can never disagree about which area a rack is in.
- **`parent_id` and `materialized_path` are two independent hand-maintained copies of one edge** and nothing in the database enforces agreement. Every move writes both. A SHELF's path is composed from string parts at creation and never read back from its rack, so **re-parenting a rack silently invalidates every child path unless the children are in the same batch** — verified live: a level left out of the batch keeps its stale path. `planZoneBinding` always emits them, and checks them independently of the unit so a drifted level is repaired even when its rack is settled.
- `wie_reparent_locations_tx` mirrors `wie_rename_locations_tx` (one statement, count-mismatch → `serialization_failure`, service_role only) but carries **three** scope guards, not one: the row's current path, its NEW path, and its NEW PARENT must all be under the warehouse. The third is not implied by the second — a well-formed path string can point `parent_id` at another site.
- **Automatic on `paint_areas` and `save_geometry`; `bind_zones` is for the site painted before this existed.** New bins are inserted under the right parent first time (`resolveZone` at creation), so the binding pass only ever touches rows that already existed. Scope is `layout_placements`, so a hand-built `WarehouseTreeEditor` node is never re-parented. `bind_zones` has its own `:bind:` 10/min bucket and a `dry_run` that returns before any write — **the only surface that previews a re-parent**. Re-running it must report zero moves; that idempotence is the proof the rule is total.
- **`allowed_categories` WARNS, never blocks.** Binding turns a hard allow-list on for the first time, so a bin can become an illegal putaway target while still holding the stock the zone excludes. Refusing would not move the pallets.
- Emptied ZONE rows are left in place (`zoneRegions` derives a zone's shape from its bins, so an empty one draws nothing). `warehouse_layouts.updated_at` is **not** bumped — parentage contributes no graph node, edge weight or `access_offset_m`. `00096` also adds the first-ever index on `materialized_path` (`text_pattern_ops`, load-bearing: a default btree cannot serve `LIKE 'prefix%'`).
- **Three places answered "what zone is this bin in" and two were wrong.** `plan-reslot` read `bin.zone_profile_id` (never written on a bin) and sent `zone_type` as `zoneTag`; both fixed to ancestry + `lower(zone.name)`. `putawayGuards.resolveZoneProfileId` walks `parent_id` while SQL walks the path — they agree only because binding keeps both in step; the comment there says so.

**Friendly location names** (mig `00094`) — `L4 · NEXG-B-9-4-L4` is a grid COORDINATE (`${wh}-B-${x}-${y}[-L${n}]`), and a drawn layout has no AISLE or BAY to name either (its tree is Warehouse → [Zone] → Rack → Shelf). So the grouping comes from the painted **named area**, and a rack reads `Chiller · Rack 7`, its levels `Chiller · Rack 7 · L4`.
- **`locations.name` already existed, NOT NULL, written at draw time — with `Bin 9,4`.** The column was never the problem; the value and the display were. **The code is untouched and must stay so**: barcode payload, `resolveScan` key, `materialized_path` segment, CSV `bin_code`.
- **`_shared/wie/locationNaming.ts` is pure and imported by both runtimes** (re-exported by `lib/locationNaming.ts`); the I/O sits beside it in `_shared/locationNamingWrite.ts`, because `wie/` is under the purity contract (`__tests__/wie/purity.test.ts`). The designer's preview IS the server's decision. Display helpers: `lib/locationDisplay.ts` + `components/inventory/LocationLabel.tsx`; id→name lookups: `lib/locationLookup.ts` (warehouse-scoped) and `hooks/queries/useLocationNames.ts` (order-scoped pick surfaces only).
- **A number is assigned once and NEVER reassigned.** Delete rack 3 and the next is 6. A sign already on the racking cannot be un-printed, and re-minting 3 puts two racks under one name. Assignment fires only where `name_seq IS NULL`, which makes the pass monotonic — which is what lets the server recompute the client's answer rather than trust it.
- **Three columns, not one flag.** `name_is_auto` alone cannot say which pool a number came from: paint "Bulk" over `Chiller · Rack 1..5` and a geometry-derived pool finds Chiller empty, so the next Chiller rack duplicates a live name. **`name_area` is the pool key and is stored, never derived.** `name_seq` likewise cannot be derived from position (renumbers on delete) nor parsed back out of `name` (an area name is free text and may contain ` · Rack `).
- **The high-water mark comes from the WAREHOUSE, not the layout** (`loadAreaHighWater`, and `seqFloor` client-side). Deleting a rack drops its placement row but not its `locations` row — publishing never retires a bin. A rack drawn and deleted *before any save* leaves no claim, which is correct.
- **Pools are per area NAME, across floors**, so `rename_area` drops its floor predicate. `00090`'s "identity is its name, per floor" is about region MERGING — a flood fill cannot cross floors. A region is a per-floor blob; an area is every blob sharing a name.
- **`area_renames` rides on `save_geometry`; it cannot be inferred.** A full replace sends byte-identical geometry for "renamed Chiller" and "erased Chiller, painted Cold Room". Coalesced client-side (A→B→C ⇒ A→C).
- **The live rename is on `mutate-warehouse-location`, not `mutate-layout`** — see the lockdown table. `mutate-layout` is Admin-only and gates *before* body parse; this one is already Admin+Manager and already writes `layout_placements`. The area↔bin join is purely geometric (`layout_objects` cells ∩ `layout_placements` cells on the same layout); the intersection is done in TS, not SQL, for the same reason `proposeHomeBins` is. `dry_run` on the real action, never a separate preview endpoint. Own 10/min bucket; one audit event; **`warehouse_layouts.updated_at` is deliberately NOT bumped** or `needsRepublish` would demand a routing-graph rebuild for a spelling fix.
- **Typing a name makes it custom and releases its number** — forced server-side in both `update` and the reducer, since a caller could otherwise leave a typed name marked auto and have the next cascade eat it. A cascade skips custom rows and *reports* how many; "also rename these" is the opt-in.
- **Scan prompts keep the CODE** ("expecting NEXG-B-9-4-L4"): the sticker prints the code large and the name only as small context, so the prompt must quote what is big on it. Toasts take `locationOneLine` (both). **CSV keeps `bin_code`; there is no `bin_name`** — a non-unique name cannot be an identity contract.
- On the canvases a bin draws the name's **tail** only (the area is its own wayfinding layer), falling back to the code when it will not fit; `fitName` is head-preserving where `fitCode` keeps the tail, and names are proportional (`SANS_ADVANCE`).
- **`claimedInTarget` (added `00095`) is what stops a moved BOUNDARY duplicating a name.** `assignAutoNames` keeps a unit's number when it came from either side of a rename, and the high-water fold protects only *fresh* mints — so sweeping `Bulk · Rack 3` into a Chiller that already holds `Chiller · Rack 3` produced two racks under one name. Harmless while an area could only be renamed (a rename moves the whole pool at once, so nothing can collide, and `rename_area` deliberately still passes nothing); reachable on day one of painting. `planAreaCascade` supplies it per group.

**Live area painting** (mig `00095`) — an area's shape, name, tint and existence are editable on a **published** layout, from the live map *and* from the designer opened on it. Everything else about a published layout stays read-only.
- **Why this is safe, precisely: an `area` is INERT in routing.** `buildWalkableCells` whitelists `walkway|dock|lift|staging` and subtracts `wall|conveyor`; `publish-layout` reads `object_type` only to collect `staging_location_id`. An area contributes no graph node, no edge weight and no `access_offset_m`, so it cannot invalidate anything `wie_publish_layout_tx` froze. **Therefore `warehouse_layouts.updated_at` is NOT bumped** — same rule as `rename_area`.
- **FULL REPLACE, not a diff, and that is the design.** The server reads the before-picture from the database, so "renamed Chiller to Cold Room" and "erased Chiller, painted Cold Room over the same cells" are *derived* as the same plan rather than told apart — correct, because both mean the same thing. This is exactly the ambiguity `save_geometry` needs `area_renames` for; **`paint_areas` has no such field and must never grow one.**
- **Storage stays 1×1 rows, enforced by the RPC.** The designer's `paint_cell` removes *the whole object covering a cell*, so a stored multi-cell run would vanish wholesale the first time one cell of it was repainted. Run-length packing is a **wire format only** (a blobby area compresses 10–40×).
- **`wie_replace_layout_areas_tx` exists because two supabase-js statements are not a transaction.** There is no ordering of a separate DELETE and INSERT that is correct — delete-first leaves a live warehouse with every area gone if the insert fails. Deliberately dumb: bounds backstop, 1×1 and non-blank-name checks, nothing else.
- **`_shared/wie/areaPaint.ts` is pure and imported by both runtimes** (re-exported by `lib/areaPaint.ts`). Two things depend on it being literally the same code: `areaCellsFingerprint` (a byte of drift and every save 409s on a picture nobody changed) and the summary panel's counts, which ARE the server's `dry_run`. `planAreaCascade` is the only new decision logic — it buckets moved units by `(beforeArea → afterArea)` and feeds each direction through `assignAutoNames` as a rename, so adopt / strip / boundary-move all fall out with no special case. **Groups are threaded, not independent**: separate calls lose the shared high-water mark and the record of which numbers have landed, without which `Bulk · Rack 3` and `Cold · Rack 3` both moving into Chiller would both keep 3.
- **The cascade is OPT-IN**, previewed by `dry_run` (which returns before any write and before the audit). A unit whose carried pool already disagreed with where it sat is reported as `skippedForeign` and **left alone** — this paint did not make it inconsistent. Own `:paint:` bucket at 10/min, deliberately not shared with `:area:` so a burst of paints cannot lock the operator out of fixing a spelling.
- **Concurrency is a fingerprint, not a timestamp** — see the `updated_at` rule above: *nothing* moves when areas change. `base_fingerprint` is captured once at paint-mode entry and held in a ref, never recomputed from live query data, or a background refetch would leave the check comparing the server's picture against itself. The designer's stale-draft banner compares fingerprints for the same reason.
- **`EditorState.editScope`** (`'all' | 'areas'`) is the designer's guard, and it lives in the **reducer**, not the toolbar: a keyboard shortcut, a stale render or a canvas drag must be refused by the same thing that refuses a bad co-occupancy. In `'areas'`, Save routes to `paint_areas` — **never** to `save_geometry`, which is a full replace plus an orphan sweep that hard-deletes `locations` rows. Note the eraser must look for an `area` *specifically* rather than take `objectAt`'s topmost hit: areas co-occupy with everything, so over a wall the topmost object is the wall.
- On the live map the cell is derived in **`MapStage`**, not the canvas (`WarehouseCanvas`'s scene memo excludes `viewport.tx/ty` so a pan is one `<g transform>` update). Paint mode takes pointer capture **eagerly** — correct there and only there, because the lazy capture in `useMapViewport` exists to preserve a trailing child `click` and paint mode has none; `Alt` falls through to the pan path. The ✎ rename pencil is suppressed while painting: both rewrite the same rows.

**Location code sweeps** (migs `00107`–`00108`) — the operator paints a block of bins on
the live map, names it, and every bin in it is recoded. `locations.code` was a grid
coordinate (`AMADIYA-B-3-4`) because that is where the cell happened to sit; this lets
the operator state the scheme instead.

- **`{row}`/`{col}` are SELECTION-RELATIVE; `{x}`/`{y}` are ABSOLUTE GRID.** That
  distinction is the whole feature. `{row}`/`{col}` count within the painted block, so
  the first bin of every block is `1-1` wherever it stands — which is what an operator
  means. Dense on both axes: a walkway between two rack runs burns no row number and a
  hole in a run burns no column. **Contiguity is `{n}`'s job; coordinates count things,
  not cells.**
- **`BUILTIN_PATTERN` and `WIZARD_DEFAULT_PATTERN` are two different jobs and must not
  be conflated.** BUILTIN (`{wh}-{block}-{x}-{y}`) keeps DRAW-TIME minting
  byte-identical to the historical code and must never change. A SWEEP's default is the
  wizard's (`{wh}-{block}-{row}-{col}`). They drifted apart once — the client planned
  `-1-1` and the server returned `-3-3`, reproducing the original bug through a second
  door — because each half was correct in isolation and only the FALLBACK CHAINS
  disagreed. The client now sends the template it planned with; the server's fallback is
  a backstop. Caught in a browser, not by tests.
- **A control may only be rendered when its token is in the template** (`usedTokens`).
  The original defect was not wrong numbering, it was that `Start at` and `Order` were
  shown against a pattern with no `{n}`: the operator set them, nothing happened, and
  there was no way from inside the UI to find out why. `visibleControls` makes that
  class of bug impossible rather than fixing one instance of it.
- **Selection is a BRUSH, with the rectangle demoted to a secondary tool that hit-tests
  by `contain`.** The rectangle tested INTERSECT, and a rack is `w×h` cells, so a band
  round the bulk block clipped one cell of the neighbouring fast-mover racks and
  swallowed them — with no shape the operator could draw that avoided it, because real
  blocks are not rectangles. Bands ACCUMULATE like strokes; one undo frame per stroke.
- **The origin is operator-chosen (`nw|ne|sw|se`) and decomposes into two INDEPENDENT
  axis directions**, shared by `buildSelectionFrame` and `orderCells` — so the counter
  starts at the same bin the coordinates call `1-1`. Two rules would let the walk go one
  way and the numbers the other with nothing downstream noticing.
- **Growing a block frames over the UNION and writes only the new units.** Members
  already in the block are planned but never written, purely to check they still render
  the code they hold; if a framing would move one that is a **`drift` refusal voiding the
  batch**, answered by re-framing or by opting into `renumber_block`. The origin that
  WOULD fit is **solved from the floor** (`solveBlockFraming`), never stored — storing
  `(row,col)` on `locations` would be a third hand-kept copy of geometry beside
  `parent_id` and `materialized_path`, and a stored high-water gets growth wrong anyway
  (a row added north of a north-origin block must become row 1 and push the rest down).
- **Ghost numbers are planned CLIENT-SIDE** from the same pure module (`plan.proposed`,
  which carries every unit's code even when the batch is refused — reading them off
  `writes` made a refused plan show only the offenders' new codes and everything else its
  OLD one). The `:recode:` bucket is 10/min, so four origin clicks would spend it. The
  server's `dry_run` fires ONCE on entering Review and is the authority. The client's
  `takenCodes` is SITE-scoped where the server's is GLOBAL — stated in
  `recodePlanView.ts` rather than left to be discovered.
- **`MapSelectionLayer` is a SIBLING of `WarehouseCanvas`, never a prop of it.** The
  canvas memoizes its whole scene; a value changing per painted cell would rebuild 945
  bins per cell. `renderMarkers`/`canvasObjects`/`placements` were already unmemoized
  scene deps busting it on every marquee frame — `__tests__/mapSceneIsolation.test.ts` is
  a source assertion because the failure mode is a tab that merely gets slow.
- **A sweep is revertible and the offer survives a reload** (`location_code_sweeps`).
  Only the newest un-reverted sweep is reachable and the action takes no sweep id —
  reverting an older one would collide with every newer one. Revert restores
  `code_block`/`code_seq` as well as the code, or the provenance would still claim the
  sweep happened and feed the next high-water mark. `recordSweep` is deliberately NOT
  fatal: the sweep has already committed, so the response carries `canRevert` and the
  panel withholds the button rather than reporting a successful write as an error.
- Panel is a **grid sibling of the map, not an overlay** (`components/inventory/warehouse/recode/`),
  so the map stays paintable and `check:overlays` is untouched. **Apply is visible at
  every step** with a one-line reason when disabled — the reported complaint was "I only
  see a Preview button and no button to apply", and the button existed.
- The `unswept` overlay tints bins whose `code_block IS NULL` — 00107's provenance
  signal, a fact about the row rather than a guess about the string. Arms on entering
  the panel, restored on cancel.
- Settings → Warehouse → **Bin code pattern** writes `warehouse_code_patterns`
  (`set_code_pattern` on **`mutate-warehouse`**, the sibling of `set_label_prefs` — not
  on `mutate-warehouse-location`, whose buckets are for actions rewriting hundreds of
  rows). Clearing DELETES the row: "no row = the built-in default" must have one
  representation. **Read by the sweep only** — drawing a new bin still mints a grid code.
