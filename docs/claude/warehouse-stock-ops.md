# Warehouse stock operations — stocktake, replenishment, slotting, receiving, putaway, pallets

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**

**Stocktake by location** (`count-bin`, **no migration**) — one number per SKU per location, posted as `stocktake_variance`. Closes onboarding gap H2: `AdjustStockModal` corrects one (product, location, batch) slot at a time and the opening-stock CSV is *additive*, so a re-count finding LESS than the system believed had nowhere to go. Nav item **Stocktake** (Admin/Manager/Warehouse), `components/inventory/StocktakePage.tsx` + `inventory/stocktake/*`.
- **`inv_adjust_stock` fans out over PLATES but only within ONE batch** (`COALESCE(batch_id,0) = COALESCE(v_batch_id,0)`, mig `00075` §7). `p_batch_id => NULL` names the **untracked slot**, not "every lot". A one-number-per-SKU count therefore cannot be one RPC call, and that — not the rate limit — is why `count-bin` exists rather than a client loop over `adjust-stock`. It does the **batch** fan-out; the RPC does the **plate** fan-out inside each batch. (The rate limit is the second reason: `adjust-stock` is 30/min/user and a 12-line bin would burn 12.)
- **`_shared/binCount.ts` is pure and imported by both runtimes**, re-exported by `lib/binCount.ts` — the sheet's live prediction *is* the server's decision, evaluated early, not a second copy of it. Same split as `_shared/wie/levelRoles.ts` ↔ `lib/levelRoles.ts`.
- **A surplus goes to the only lot present, or to untracked.** One lot holding stock → that lot. Zero or several → `batch NULL`, and the sheet **says so** — stamping one of two lots asserts an expiry nobody stated, while always-untracked would give a single-lot bin a second expiry-less row that FEFO has nothing to order by.
- **A shortfall deeper than `Σ available` is refused for the WHOLE line and writes nothing**, while every other line still posts. Half-applying leaves the SKU matching neither the count nor the prior belief, and the operator cannot re-count without double-applying. Shortfalls consume FEFO across lots (undated last). The sheet predicts the refusal from `allocated` before anything is sent.
- **Blank ≠ zero.** A line nobody typed into is untouched; a write-off must be typed as `0`. `parseCountedQty` returns `null` for blank and `undefined` for unusable text — never 0.
- **Any stock-holding location is countable, including a warehouse ROOT** — that is how a bulk / floor-stacked area is counted at all, and a root has no label to scan, so the picker list is not a convenience. `getWarehouseLocations` matches `LIKE '<wh>/%'` and **excludes the root**, so `StocktakePage` prepends it. ZONE/AISLE/RACK are excluded: a levelled rack's stock is on its SHELF rows.
- Upward counts route through `generatePutawayTasks` exactly as `adjust-stock` does — it self-skips for a specific bin, so counting a bin raises nothing and counting a racked root raises real tasks. **One** audit event per location (`resource: 'inventory_count'`), not one per line.
- No line ever throws: an unexpected RPC error is reported as a failed line so the response still says which of the other lines landed.

**Bulk min/max** (mig `00093`, closes onboarding H3) — `ReplenQueuePage`'s third sub-view, `?subtab=setup`, **Admin/Manager only** (`mutate-product-home-bin`'s roles; Warehouse staff walk the queue, they do not set thresholds). One grid per site: every active product ranked by demand, its home bin, its two figures, CSV export/import.
- **Read is `wie_replen_config_rows(warehouse)`**, one STABLE `SECURITY DEFINER` RPC granted to `authenticated` — same pattern and calling convention as `wie_warehouse_report` (including `supabase.rpc.bind`). It reports **facts only**: policy maths and free-bin assignment are deliberately not in SQL.
- **`_shared/wie/replenPolicy.ts` is pure and imported by both runtimes**, re-exported by `lib/replenPolicy.ts` — the grid's suggested figures and inline refusals ARE the server's decision, evaluated early. Same split as `_shared/binCount.ts`.
- **The suggestion is capacity, never demand.** A site being stood up has no picks, and days-of-cover from three days of history is a fiction. `capacityBaseUnits` inverts `capacity.ts`: a carton bay holds `capacity_slots / size_factor`; a **pallet** bay holds `capacity_slots × units-per-pallet`, which exists nowhere but the product's largest UOM — without one there is **no suggestion**, because an invented figure becomes a real transfer to a real rack.
- **`proposeHomeBins` is greedy in demand order and cannot double-claim** — that is precisely why it is JS and not a SQL subquery, which would hand one nearest bin to every SKU. Stock-held bin first (a person put it there), else nearest free pick bin. An *untouched* proposal is not a change: counting them made Save offer to commit 118 assignments nobody had looked at.
- **`bulkSet` takes `replenEnabled` at CALL level, not per row.** It maps onto the two acts (save figures / arm), and PostgREST needs a uniform key set across an upsert batch — omitting it leaves the column untouched on existing rows and `false` on new ones. Every row is validated in JS **before** the single upsert, because the table's CHECKs and its pick-zone trigger abort the whole statement on one bad row. A refused row is reported, never fatal; **one** audit event per batch (`product_home_bins_bulk`). Own rate bucket, 10/min.
- **A row already armed still has to satisfy the pick-zone rule when merely edited** — `willBeArmed(row, 'leave')` is the row's own `replen_enabled`, not `false`.
- Blank ≠ zero on both the grid and the CSV (`min_packs`/`max_packs` are authoritative; the exported `*_base` columns are read-only arithmetic).
- **Never render a per-row `<select>` of bins.** 158 rows × ~400 locations froze the tab hard enough that Chrome could not be scripted; the grid renders ONE `<datalist>` and every row's bin input points at it.
- The setup checklist's `replen_min_max` step counts **armed** rows only (`countReplenConfigured`), so saving figures does not tick it — which is the honest test of whether replenishment is on.

**Slotting rules & off-home** (migs `00114`–`00121`) — the operator states where a product
*belongs*. Until `00115` exactly ONE thing constrained that: `zone_profiles.allowed_categories`,
an exact-string match on `products.category` applied as hard filter #4 in `scoring.ts`.
"All the Milwaukee goes in aisle C, and if C is full put it in the mezzanine" could not be
said at all. A rule ANDs product / brand / category / supplier conditions onto **ranked
blocks** of bins; precedence is a fixed specificity ladder, not a priority number.

- **`products.brand` (`00114`) is the third classification axis** — a distributor's supplier
  is not its manufacturer and "Fertiliser" is not "Yara", so neither existing column can
  stand in. Nullable, **no default and no backfill**: `''` is a value a rule condition can
  match, so seeding one would silently enrol the whole back catalogue in the first
  blank-field rule anyone writes. Unbranded has exactly one representation and it is NULL.
  The index is on the **folded expression** (`lower(btrim(brand))`), because a plain btree
  cannot serve that predicate and would sit there looking like coverage.
- **Not `wie_rules`, and it is worth knowing why** — that table's targets are PREDICATES
  over `resolveAttr`'s closed vocabulary, with one JSONB column and nowhere to hang forty
  location ids; its `priority` breaks ties where this needs a ladder; rank is per (rule,
  block); and `mutate-wie-rule` is Admin-only where this is Admin+Manager. `rule_type =
  'slotting'` has sat unused in `00045`'s CHECK since the beginning — **leave it dead.**
- **`_shared/wie/slotting.ts` is pure and imported by both runtimes** (`lib/slotting.ts`),
  loader beside it in `_shared/slottingLoad.ts`. It decides **ORDER, never HEADROOM**, and
  that is a correctness requirement, not an optimisation: `reslot.ts` deliberately calls
  `filterCandidates` with a falsified `quantity: 1`. A tier test asking "does this tier have
  room" would read that 1, collapse every plan into the primary block and spill the rest
  into `overflow` — which carries **no reason field**, so the operator sees "could not be
  placed anywhere" with nothing pointing at slotting. Legality and preference order here;
  which bin actually has room is `putawayPlan.ts`, whose greedy fill already spills.
- **`wie_putaway_candidates` filters NOTHING new** (`00116`) — it *reports* `block_ids` and
  `is_hold`. A `WHERE` clause there would delete exactly the non-block bins that overflow
  depends on, would force the ladder and the reservation union to be restated in SQL beside
  the TypeScript that already does it, and would be **invisible** where the TS path yields
  real `rejectedCount`s and samples (see `scoring.ts:178-196`, which had to fabricate them).
- **Precedence has ONE implementation, `resolveSlotting`.** `wie_slotting_rule_rows` reports
  a rule's MATCH COUNT and never which rule governs a product — counting is not ranking. The
  count exists because `match_category` has no FK (free text since `00069`), so renaming a
  category silently stops a rule matching; a zero beside the rule is the only way anyone
  finds out.
- **Both writes are delete-then-insert transactions, and that is forced.**
  `uq_slotting_rule_rank` is DEFERRABLE (a drag-reorder rewrites every rank at once and a
  non-deferrable UNIQUE trips 23505 mid-statement) — **and a deferrable constraint cannot be
  an `ON CONFLICT` arbiter**; Postgres rejects the inference outright.
- **Off-home** (`00119`) is the other half: a rule written today finds forty pallets already
  scattered, and the operator needs a list they can walk. **Its own table**, because
  `uq_wie_slotting_open` is keyed (warehouse, product, from, to) and a travel-saving reslot
  row for the same pair would collide — the `uq_wie_replen_open` arbiter trap again. **ONE
  stage, not two**: the stock is already in a bin and the walker is standing at it, so an
  assign stage would only add a state to abandon. Sized from `available`, never `on_hand`.
- **`wie_offhome_replace_tx` (`00121`) exists because a partial index's predicate cannot
  travel over PostgREST** — `.upsert({onConflict})` sends column names only and Postgres
  answers *"no unique or exclusion constraint matching the ON CONFLICT specification"*. The
  delete is scoped to the products the sweep **actually examined** (it is capped by
  `MAX_SCANNED_PRODUCTS`), or a truncated run silently retires tasks for the rest.
- **A dismissal carries a QUANTITY** (`_shared/wie/offHomeSuppress.ts`, pure): it is a
  statement about a *situation*, not a bin. "Double-stacked behind the Ryobi pallets" is true
  of today's pile. Same stock or less stays silent; more stock arriving is a new situation
  nobody refused. Suppressing on the (warehouse, product, bin) triple would need the operator
  to *remember* to lift it, and forgetting is silent — `restore` is the act you take when you
  know, not the maintenance you must not forget.
- **The Blocks overlay reads `wie_slotting_block_bin_map`** (`00120`), a STABLE SECURITY
  DEFINER function with the staff check in its body — the `wie_replen_config_rows` pattern.
  Granting `v_slotting_block_bins` to `authenticated` would hand Customers the whole
  membership map past `user_is_staff()`; expanding `slotting_block_members` client-side would
  be a second implementation of unit → leaf-bin expansion. **Staff, not Admin/Manager** — it
  is looked at while standing in the aisle.
- Frontend: rules live in **Settings → Warehouse** (`SlottingRulesSection`, beside level
  roles and label stock); suggestions in `WarehousesSettingsSection` via
  `SlottingSuggestionsView`; `admin/layout/ReslotPlannerModal.tsx`; the map's block picker is
  `inventory/warehouse/slotting/*`; the walk is the **Off-home** tab
  (`components/inventory/OffHomeQueuePage.tsx`, Admin/Manager/Warehouse). Hooks
  `useSlottingRules`, `useSlottingSuggestions`, `useReslotPlan`, `useOffHome`.

**Receiving: "Arrived on", and mixed pallets** (**no migration** — the payload already said all of this).

- **The reported bug was an inverted control.** The receipt line's `Pallet / carton` column stacked a plate PICKER ("Pallet 1", "Carton 2", "+ New unit…") over a TYPE selector, reading specific → general while the data ran general → specific: the type select's value came off the **plate**, not the line, so on a shared plate changing one line silently retyped every sibling. The column is now **`Arrived on`** with ONE select, and a normal line owns its plate one-for-one — the hazard is gone by construction, not by a guard.
- **Arrival is not storage, and the label now says so.** `plateDestinationLabel` reads `rolesForHuType` (mig `00081`) exactly as before but renders `Pallet (usually → Reserve/Bulk)`. Putaway may place it anywhere, the SKU's own rule outranks the plate preference, and a pallet can be broken down on the floor — so a bare arrow read as a commitment it never was.
- **A mixed pallet is a CONTAINER, not three identical dropdown selections.** `+ Mixed pallet` opens a card (`components/inventory/receive/MixedPalletCard.tsx`); everything added while it is open rides on it, **including dock scans**, because `handleDockScan` funnels through `addProduct`. Walk the pallet, scan, scan, scan, press **Done**. It is **always `hu_type: 'pallet'`** (a carton holds one product, so a mixed carton names nothing) and its member lines withhold their own `Arrived on` (`inGroup`) so none can contradict the container. The button is on the footer **and the empty state** — without the second one a receipt could never *start* with a mixed pallet.
- **Nothing changed server-side.** `createPlates` already accepted one declared plate carrying several lines; that IS a mixed pallet, and `generatePutawayTasks` already passes `hu_id` so it lands as one physical object. `__tests__/receiveMixedPallet.test.tsx` asserts the **payload** for that reason.
- **`addProduct` read `plates` from its own render closure.** Two adds in one React batch — which is exactly what a gun does — and the second dropped the first's plate, leaving a line naming a `plate_key` that was never declared. `createPlates` rejects that and fails the WHOLE receipt. Now a functional `setPlates`. Latent before mixed pallets; reachable after.
- **`components/ui/Tooltip.tsx` portals to `document.body` and positions `fixed` from the trigger's rect.** Not decoration: the staged-lines container is `overflow-hidden` and clipped an inline popover on the right-hand columns, and `ProductForm` sits inside a `<Modal>` at `BASE_Z` it could not climb over. It is **not** an overlay — no backdrop, no focus trap, no scroll lock, not in `overlayStack`. `position: fixed` is not `fixed inset-0`, so `check:overlays` is satisfied on both counts. It uses **`aria-describedby`, never `aria-controls`** — it is a tooltip, not a disclosure, and `aria-controls` would also make it match `tests/e2e/mobile/receive-stock.spec.ts`'s `button[aria-expanded][aria-controls]` line-disclosure selector.
- **The receipt row switches on a CONTAINER query, not a viewport breakpoint** (`@min-[1180px]:`, with `@container` declared once on the staged-lines card so the headings and the rows cannot disagree). `ReceiveLineCard`'s measurement table was always right and always in CONTAINER widths — 904px of columns + 112px of gaps + 32px of padding = 1048px before the product column gets anything, and its "1180px → 132px" row is exactly `1180 - 1048`. Encoding that as `xl:` made it a VIEWPORT figure, which differs by the 208px sidebar plus page padding: at a 1280px viewport the container is 997px, so **the product column computed to 0px and the row overflowed**. Do not turn it back into a breakpoint; the receipt HEADER card's `xl:` classes are page layout and stay.
- **Hover, focus and pin are three separate states, not one `open` flag.** A single boolean toggled by click was opened by `mouseenter` and shut again by the click that followed, so the hint never appeared on a mouse. jsdom fires no hover, so only a browser showed it.

**Pallet break-down at putaway** (mig `00126`) — take part of a pallet off it, at the rack, mid-walk. Each portion becomes a **new labelled handling unit** with its own destination and its own walk stop.

- **Partial putaway looked like it already did this and did not.** `p_qty` on `wie_assign_putaway_tx` / `wie_complete_putaway_tx` splits the **task**; it never splits the **plate**. `inv_transfer_stock` copies each balance row's `handling_unit_id` onto both legs (`00080`), so placing part of a plate left ONE `handling_units` row with stock in two locations — `hu_recompute` saw `v_locs > 1`, deliberately declined to pick a winner, and left `location_id` stale, while `v_bin_fill` charged a pallet position in **both** bays. Breaking a pallet down is not a quantity operation; it is a **container** operation.
  - **It does NOT repair the damage already done.** Dev carried three such plates on 2026-08-26 (`HU-000209` across `E2ERACKLVL` and two of its levels, plus `HU-000214`/`HU-000219`), all partial-putaway artefacts. `00126`'s verify block says to compare before/after, not to expect zero. Repairing one means deciding where the pallet physically is, which is a stocktake.
- **NOTHING moves to a bay.** The portions are re-plated **where they already are** — at the warehouse root — and become `assigned` tasks; `complete-putaway` still moves each, per plate, with the plate + bin scan that already exists. That keeps `00080`'s promise, and it makes `00123` work for free: `v_bin_pending_putaway` charges one position per **distinct plate** on open tasks, so the destination bays are spoken for the instant the children exist, with no change to that view. **Verified on dev: a 2-portion break-down put `pending_slots = 1` on each of two bays.**
- **The legs are `transfer_out`/`transfer_in` at the SAME location** with different `handling_unit_id`s (legal since `00075` rebuilt the slot key), `ref_type = 'hu_split'`, `ref_id` = the parent plate. A new `replate` movement type would render blank in every stock-history surface until each learned the word; `ref_type` answers "why" without teaching anyone a new one.
- **FEFO, and `available` NOT `on_hand`** — same `ORDER BY` as `inv_transfer_stock`, so FEFO means one thing here. Reserved stock cannot change container any more than it can change bin: dev's plate 240 holds 49 with **28 allocated**, and a 30-unit portion is refused `short by 9` rather than quietly moving someone's reservation onto a plate walking to a pick face.
- **The whole sheet is validated BEFORE any plate is minted.** The transaction would roll an orphan `handling_units` row back anyway, but `handling_unit_code_seq` is a **sequence and sequences do not roll back** — checking first is what keeps a site's plate codes contiguous instead of pocked with gaps from attempts that never happened.
- **Allocating 100% is allowed**: the parent task closes as `'expired'` (which `00123`'s pending view excludes, so its bay stops being spoken for in the same statement) and `hu_recompute` marks the plate `'empty'` on its own. There is no `'split'` status and none is needed.
- **`_shared/palletBreakdown.ts` is pure and imported by both runtimes** (re-exported by `lib/palletBreakdown.ts`) — the sheet's running total and inline refusals ARE the server's decision, evaluated early. Same split as `_shared/binCount.ts`. It **must not import `lib/palletFit.ts`**, which is browser-only by deliberate decision: the client converts layers to base units and the wire carries `{ base_qty, counted_unit }`. The unit survives only to derive `hu_type` and for the audit trail; the invariant that protects the ledger is arithmetic on the base quantity, re-checked server-side and again under the row lock.
- **`hu_type` is DERIVED from the unit counted in** — pallet/layer → `pallet`, carton/base → `carton`. Not cosmetic: it is what `rolesForHuType` (`00081`) reads to route each portion's engine suggestion, and what `v_bin_fill` (`00122`) charges one position for.
- **`dry_run` scores each portion AS THE CONTAINER IT WILL BECOME**, which is why the suggestion cannot be lifted off the parent's own `alternatives` — those were scored for a pallet. **ONE call for the whole sheet, not one per portion**, so the greedy `overlay` stops two carton portions being offered the same pick bay. That needed an opaque **`ref` on `PutawayLineInput`**: `recommendations` is a FLAT array, one line can produce several allocations, and every portion shares a SKU, so nothing else can map a result back to its input.
- **Labels needed no server work.** `generate-labels` already takes an explicit `ids` list on the `handling_unit` kind, flips `label_printed` and returns a signed URL. It is rendered as a **link the operator taps** — a programmatic `window.open` after the await is popup-blocked. Between commit and the child stop the plates are labelled in the database and may not be on the floor; the child stop's **plate scan is what closes that window**.
- Only an **`assigned`** task on a **`pallet`** plate can be broken down. A `suggested` one is refused (the desk queue has no entry point, and an unreachable branch is untested code); loose stock has no plate, and `complete-putaway`'s partial quantity already covers it. Own rate bucket at **10/min/user** — it mints plates and rows, and must not share a budget with the 120/min putaway traffic the same walk generates.

**Identifying the goods at putaway** (**no migration**) — the walk's first step asks
for whatever actually identifies what is being carried, which is usually the PRODUCT
barcode and only sometimes the plate.

- **The reported bug: the walk demanded a code printed on nothing.** `receive-stock`'s
  `createPlates` mints a handling unit for EVERY line — that is what makes "every receipt
  line is on a plate" true — but it renders no sticker, and until now nothing offered to.
  So `HU-000509` existed in the database and on no physical object, the stop said
  *"Scan the plate — expecting HU-000509"*, and the operator holding a carton with
  `4796009868869` printed on it was told *"That is plate 4796009868869, but this task is
  for HU-000509"* — which calls a barcode a plate. There was no skip; the only exit was
  abandoning the stop.
- **The operating rule is the other way round.** The product barcode identifies the goods.
  A plate label is needed for a **pallet** (a carton barcode names the SKU and cannot tell
  two pallets of it apart), for goods carrying **no barcode**, and for a barcode that
  arrived **damaged**.
- **`_shared/putawayIdentity.ts` is pure and imported by both runtimes** (re-exported by
  `lib/putawayIdentity.ts`). Five ordered branches, each pinned by a `reason`:
  no plate → skip; label printed → plate; unlabelled pallet → plate + offer to print;
  product has a barcode → product; nothing scannable → skip + offer to print.
- **What is ASKED FOR and what is ACCEPTED are different, deliberately.** The prompt names
  one thing (a prompt naming two teaches nobody what to do); the field accepts either code
  and `classifyPutawayScan` routes it to the right evidence key — plate if it normalises
  equal to the task's `huCode`, product otherwise. An unrelated string goes to
  `productCode` **on purpose**, so `checkPutawayScan` answers *"that item is not <SKU>"*
  rather than calling it a plate.
- **The server was never the obstacle, and this is worth remembering as a shape.**
  `checkPutawayScan` has always accepted and validated `productCode`, `complete-putaway`'s
  zod schema has always taken `scan.productCode`, and `putawayService.ts` has always typed
  it. The card simply never populated it — so **every product-identified placement was
  recorded `scan_verified: false`**, understating evidence that had in fact been collected.
  Before assuming a capability is missing, check whether it is merely unreached.
- **The identity is captured ONCE, on opening the stop, never derived per render.**
  `generate-labels` flips `handling_units.label_printed` the instant the PDF renders (right
  for a plate, wrong for a rack — see `confirm-label-print`'s header), so a live reading
  would swap the card into "scan the plate" the moment the operator taps Print, while the
  sticker is still in a printer on the other side of the building.
- **Two unlabelled plates of one product cannot be told apart by barcode, and the stop says
  so.** `PutawayWalkView` computes the twins (it holds every stop; the card sees one) and
  the card warns. They are NOT merged into one stop — that would hide a real container
  distinction.
- **Plate labels are now printable at Receive Stock**, which is the only place they are
  cheap and the reason the backlog exists. `getReceiptPlates()` had been written, exported
  and **called by nothing**; it is wired up and now carries `label_printed` plus the
  barcodes of what is on each plate, because the desk's question is not "which plates
  exist" but "which need a sticker" — `plateNeedsLabel`, the receiving half of the same
  rule, stated once beside it. Pallets pre-tick; barcoded cartons do not, but stay
  printable for the damaged-barcode case.
- **A task can outlive its plate, and used to lie about why.** A count, an adjustment or a
  transfer at the warehouse ROOT consumes balance rows without naming a plate (`count-bin`
  passes `p_handling_unit_id => NULL` deliberately); `hu_recompute` marks the plate
  `'empty'` and **nothing touches `wie_putaway_recommendations`**. The stop stayed on the
  walk and the placement died inside `inv_transfer_stock` as `INSUFFICIENT_STOCK`, which
  `complete-putaway` rewrote as *"reserved for an order"* — untrue for this case. The card
  now warns on `huStatus`, and `complete-putaway` gained the two checks `record-pick` has
  had all along: `UNKNOWN_PLATE` (resolve the SCANNED code — previously a bogus plate was
  refused only by string coincidence, and on a plateless task was **silently accepted**)
  and `PLATE_CONSUMED` (the task's plate still holds this product **at the root**, scoped
  there because that is the source leg the transaction will use).
- **No migration:** `label_printed` and `status` are columns on a table the walk already
  joins. `wie_putaway_stops` is untouched — the walk reads them off the PostgREST queue
  query, and the route's `huCode` is discarded in `PutawayWalkView` anyway.

**Pallet quantities** (mig `00125`) — what makes a full pallet countable as one line at the dock. `app_settings` gains the global pallet spec (seeded AU standard **1165 × 1165**, 150 mm deck, **1650 mm of load**); `products` gains nullable `carton_{length,width,height}_cm`.

- **`lib/palletFit.ts` is pure and deliberately BROWSER-ONLY, not `_shared/`.** That rule exists where the client previews a decision the server re-makes (`_shared/binCount.ts`, `_shared/wie/replenPolicy.ts`). The server never computes a fit — it stores a factor the admin confirmed, which `validateUoms` already checks — so a `_shared` copy would be imported by nothing on the Deno side. It is dependency-free and takes plain numbers, so it lifts unchanged if that stops being true.
- **Integer millimetres throughout.** `1165` is exact in mm and 116.5 in cm, and the whole computation is a stack of `floor()`s — a value one part in a million short loses a whole carton off a layer. `cmToMm` rounds at the boundary.
- **`pallet_max_load_height_mm` is already LOAD-only.** Do not subtract `pallet_base_height_mm` from it "to account for the deck" — that counts it twice and silently loses a layer. The base height is stored for the overall-height readout and a future clear-height check, and is otherwise write-only on purpose.
- **Two orientations per layer, best wins; no pinwheel, no overhang.** Both fit more and both stop the answer being something an operator can check against the pallet in front of them. A carton that does not fit is **refused by name**, never returned as `unitsPerPallet: 0` — a zero offered as a UOM factor is the worst outcome available here.
- **An unmeasured carton is ESTIMATED from the unit box** by scoring every `a×b×c = N` arrangement on **minimum surface area**. Volume is identical across candidates (always `N` × the unit), so "most cube-like" reduces to one metric with nothing to weight — and it is what a packaging engineer optimises anyway. Plus a 5% allowance **per edge**, because the fit divides by linear dimensions.
- **Nothing is written without a press.** `ProductPalletFitSection` computes continuously, shows its working, and only the button touches the ladder — with the number editable first. The row is **receivable and NOT orderable**, which matters twice: selling by the pallet was not asked for, *and* `set_product_uoms` (mig `00067`) recomputes `products.carton_size` from the non-base **orderable** rows, so an orderable pallet row would silently redefine what a carton is for the whole ordering side.
- **Provenance is RECOMPUTED, not stored, and not "are the carton dims null".** A stored flag goes stale in silence. "Are the dims null" answers the wrong question — whether a *fresh* computation would be an estimate, not where *this* stored number came from — and gets three real cases wrong: a hand-edited suggestion, dims filled in later, dims cleared later. `palletUom.ts` recomputes and compares into `measured | estimated | manual | unknown`. Its stated cost: change the pallet spec and every previously-`measured` row reclassifies to `manual`, which is honest and is the only signal anyone gets that a spec change invalidated a catalogue's figures.
- **The label is shown where the figure is USED, not only where it is set** — an estimated pallet quantity is a guess, and Receive Stock is where it becomes stock.
- Receiving needs **no special casing**: a receivable Pallet UOM already flows through `receivableUoms` into the per-line Unit select, and `toBaseLines` in `receive-stock` already converts by `factor_to_base`. A product with no pallet config still allows `Arrived on: Pallet` — there is simply no Pallet unit to count in.
- The spec lives in **Settings → Products** (a new seventh sub-tab, `?subtab=products`). It is consumed by the PRODUCT form, not a warehouse surface; Warehouse holds level roles and label stock, and Inventory holds the low-stock threshold.
- **Known gap, unchanged by this:** `wie_replen_config_rows` still infers `palletFactor` as `MAX(factor_to_base)` (mig `00118:405-419`), so a three-tier each/inner/carton ladder with no pallet has its **carton** read as a pallet. A declared Pallet row makes the inference correct for any product an admin configures — dev currently has **no product with more than 2 tiers**, so it bites nothing today. A real fix needs a marker on the row, not more inference.
