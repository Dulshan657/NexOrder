# Warehouse Onboarding Plan — Amadiya

**Written:** 2026-08-03 · **Branch:** `fix/warehouse-onboarding-blockers` → merged to `main`

The plan for standing up a new warehouse on NexOrder, written against the decisions below rather than a generic checklist.

## The brief, as decided

| | |
|---|---|
| **Customer / environment** | Amadiya, on the **dev** Supabase project (Singapore, `lsgkznyiabqitqfpveey`) for now. Prod is still `projectRef: null`. |
| **Site shape** | **Mixed** — racked core plus bulk / floor-stacked areas. |
| **Go-live scope** | **Full WIE from day one**: published layout, QR labels, scan-enforced putaway + directed picking + replenishment. |
| **Layout capture** | Floor plan / PDF obtained in advance **and** measured on site. Pre-build with `extract-floorplan`, correct against reality. |
| **Opening stock** | **Physical stocktake, counted by bin.** |
| **Hardware** | Label printing sorted; scanning on **staff phones**. |
| **Accounts** | **Two only** — one admin for Amadiya, one for us. |
| **Timeline** | **Multiple visits, phased.** |

Two of those decisions carry consequences worth stating plainly before the phases.

**Full WIE on day one is the ambitious end of the range.** It requires the layout, the labels, the count, the catalogue and working logins to all land together. The phased-visit choice is what makes it survivable — see the dependency chain below.

**"We might not get any list" is the biggest single risk in this plan.** If the product list does not arrive before the visit, you are creating SKUs while counting, and full WIE on day one is not achievable. That is Path B, and it is called out separately rather than discovered on the floor.

---

## The dependency chain (why the phase order is not negotiable)

```
storage forms + level roles + zone profiles      (config; must exist BEFORE racks are drawn)
        ↓
layout drawn → published                          (publishing creates the bin `locations`)
        ↓
bin codes exist → QR labels generated → labels physically applied
        ↓
count BY BIN                                      (impossible before bins have names on the floor)
        ↓
opening-stock CSV with bin_code → stock lands in bins
        ↓
directed picking / replenishment become meaningful
```

Each arrow is a hard ordering, not a preference. A rack's capacity is derived from its storage form's `levels × positions`, so drawing racks before the forms exist produces bins with wrong capacity. Counting by bin before labels are on the racking produces a count nobody can transcribe.

---

## Blockers — fixed on this branch

Three gaps were found in the code while planning this, each of which stops a full-WIE go-live. All three are fixed, typechecked, and covered by tests (2112 passing).

### B1 · Sessions did not survive — **fixed, needs browser verification**

`lib/supabase.ts` ran `persistSession: false` and `autoRefreshToken: false`. A refresh or tab discard logged you out, and the JWT was never renewed, so a session died roughly an hour in. For pickers on phones — where the browser discards backgrounded tabs and a shift runs for hours — that made scan-enforced picking unusable.

The documented reason was a `getSession()` hang on Windows, but the storage was never the cause: supabase-js reaches for the Web Locks API (`navigatorLock`) whenever persistence is on, and that acquisition never resolved. `lib/auth/inProcessLock.ts` replaces it with a promise-chain lock. Persistence and auto-refresh are back on.

- **Cost:** no cross-*tab* serialisation. Two tabs can refresh at once; refresh tokens rotate and the loser retries.
- **⚠ Outstanding:** this is **not yet verified in a real browser.** The original hang never reproduced in tests or Node. Load the app on Windows, sign in, refresh, background the tab, and leave a session open past an hour before trusting it. Reverting is two booleans.

### B2 · Invited users could never sign in — **fixed**

`invite-user` calls `inviteUserByEmail`, which creates an auth row with **no password**, so the emailed link is the only way that user can ever get in. But `lib/auth/recoveryLink.ts` claimed only `type=recovery`, and the client runs `detectSessionInUrl: false` — so the invite landed on a bare login page and died. The only way to onboard anyone was a direct database write.

`type=invite` is now claimed. The parsed link carries `flow`, because `verifyOtp`'s type must match the issued token, and because "reset your password" is a lie to someone who never had one.

*Reprioritised:* with only two accounts needed, this is a convenience rather than a blocker — but it is what lets Amadiya add their own staff later without calling us.

### B3 · A counted-by-bin stocktake had nowhere to go — **fixed**

The opening-stock CSV was `sku, quantity, lot_code, expiry_date, barcode`, and every row was received to the warehouse **root**. Counting by bin produced data the app could not accept; you would have placed several hundred lines one at a time through the Putaway UI.

The CSV now takes an optional **`bin_code`**. Rows are grouped by bin *before* chunking, each group is received as its own receipt, and every recommendation that receipt returns is driven onto that group's bin. One destination per receipt is what removes any need to match recommendations back to rows.

- Stock still never reaches a bin through a receipt — `receive-stock`'s `location_id` is the destination *warehouse*.
- `roleOverride` is on deliberately: a count records where stock **physically is**. Refusing pallets on a pick level would not move them, only leave the system wrong about them.
- Rows leave the preview grid once the **receipt** succeeds, even if placement then fails — re-importing would receive the quantities twice. The failure text says so and points at the Putaway queue.
- Leaving `bin_code` blank preserves the old behaviour exactly.

---

## Gaps still open — decide before or during the visit

### High

- **H1 · No cancel or short-ship path.** `OrderStatus.CANCELLED` exists in `types.ts` and *nothing writes it*. There is no way to release a reservation on a cancelled order, and a permanently short line blocks dispatch forever. Open since the July 2026 audit. **This will be hit within the first weeks of real trading** — a customer cancels, and the stock stays allocated. Needs an edge-function path plus a reservation-release RPC.
- **H2 · No stocktake-by-bin UI.** `AdjustStockModal` adjusts one line at a time. After go-live, reconciling drift is manual, bin by bin. The `bin_code` importer partly covers re-counts, but it is *additive* — it cannot correct a count downward.
- **H3 · Replenishment min/max is hand-typed per product.** `ProductHomeBinsSection` only, one product at a time. Full WIE wants min/max on every fast mover. Budget real time for this, or accept that replenishment stays quiet until it is filled in.

### Medium

- **M1 · Grid scale — RESOLVED (mig `00091`).** Designer → **Properties** takes the building's real dimensions and a resolution (m/cell) and derives the grid; the canvas carries a scale bar, a "1 cell = X m" readout and ruler gutters. Changing the resolution rescales existing geometry so it keeps its real size, and refuses — naming the racks — when that wouldn't land on whole cells or would push something off the floor. **Set it before drawing**: it is editable afterwards, but a resolution that doesn't divide evenly into what's already drawn (1.0 → 0.75) is refused, and on a live layout the change is inert until you **publish again** (publishing freezes the travel graph; the designer shows a republish banner). Floor-plan import proposes dimensions read off the drawing for you to confirm. Grid is capped at 200 × 200 cells, so 0.5 m/cell covers a 100 m wall.
- **M2 · Setup order — RESOLVED (mig `00092`).** The Warehouse tab now carries a **setup checklist** for the selected site: it derives where the site actually is in the chain above, says *why* each step sits where it does, and links straight to it. Steps that no table can prove — the three seeded config vocabularies (checked against the real racking), the wifi walk, and the three pre-go-live exercises — are operator sign-offs stored in `warehouse_setup_acknowledgements` and written through `mutate-warehouse-setup-ack`. A bulk site gets the short chain and grows the rest when a layout is published. Once every *derived* step passes the panel collapses to one line, so a live site stays quiet; there is no dismiss button, because dismissal could hide a genuinely missing step and collapsing cannot. Three ordering mistakes now warn at the point of the mistake: importing stock into a racked site whose bin labels are unconfirmed, a layout approaching the putaway-candidate ceiling, and publishing while level roles / zone profiles are unchecked. **Nothing blocks** — a warning that refused would not put stickers on racking, it would only stop the work.
- **M3 · `wie_putaway_candidates` is capped at 2000 locations**, ordered by dock distance. *(Corrected 2026-08-03: this said 200, which mig `00072` raised — "was 200; MAIN alone is 189 bays x 5 levels = 945 locations". `_shared/wie/types.ts` `PUTAWAY_CANDIDATE_LIMIT` is now the single definition, passed by `_shared/putawayTasks.ts` and watched by the designer.)* **Count Amadiya's bays × levels, not bays** — a levelled rack holds no placement row of its own, its SHELF levels do. Past the cap the farthest bays are invisible to the engine and stock is never recommended there, silently. The designer warns from 90%.
- **M4 · Prod does not exist.** Everything built on dev has to be rebuilt or scripted onto the Sydney project later — there is no supported export/import. Decide *now* whether the layout and catalogue work is throwaway or whether a migration script is written alongside it.
- **M5 · Wifi coverage across the racking** is untested and is a hard dependency for phone scanning. Walk the aisles with a phone before committing to scan-enforced picking.

---

## Phase 0 — before you travel

1. **Verify the session fix in a real browser on Windows** (B1 above). This gates everything else; without it, phone picking does not work.
2. **Deploy the branch.** `npm run fn:deploy:dev invite-user`, then `npm run deploy:dev`. Function first, frontend second.
3. **Request the data.** Product list with SKUs *and pack sizes*, customer list, supplier list, current stock-on-hand report. Pack size / `size_factor` is not optional — without it the putaway engine cannot compute capacity and bins over- or under-fill silently.
4. **Request the floor plan** (PDF, fire-evac diagram, or racking supplier drawing).
5. **Confirm the bay count × levels** against the 2000-candidate cap (M3).
6. **Create the two accounts** — one Amadiya admin, one ours. With B2 fixed, `invite-user` now works end to end; confirm the invite email actually lands before you rely on it.
7. **Confirm label stock and printer** are compatible with the `generate-labels` A4 multi-sheet output.

## Phase 1 — visit 1: layout and labels

> **Work the checklist on the Warehouse tab** (M2). It tracks the steps below against the live database and links to each one; the numbered list here is the same chain in prose.

1. **Configure before drawing** — storage forms, level roles, zone profiles, `wie_rules`. This is the order-dependent config from the chain above. All three vocabularies ship **seeded**, so the question is never "do any exist" but "do these match the real racking" — a seeded `PALLET_RACK` is 4 × 24 and Amadiya's bays may not be.
2. **Pre-build the layout** from the PDF via `extract-floorplan`, before arriving if possible.
3. **Walk the site and correct it.** Establish grid scale from **one physically measured reference** (a rack bay you can put a tape on) and keep every other dimension consistent with it (M1).
4. **Draw the bulk areas as named areas** (mig `00090`) — tinted, labelled ground for cold storage, staging, floor stack. Areas are inert for routing, so they cost nothing in publish readiness.
5. **Satisfy the four publish gates** — a dock exists, walkways remain, at least one bin is placed, every bin reaches a dock. The designer shows this live.
6. **Publish.** This creates the bin `locations` and flips the site to `racked`.
7. **Generate and print the label run**, then physically apply a QR to every bay. For a 189-bay site this is a substantial chunk of a day — plan it as work, not as a footnote.
8. **Confirm label print** in the app so `locations.label_printed` reflects the floor.
9. **Walk the aisles with a phone** and check wifi (M5).

**Leave visit 1 with:** a published layout whose bins are physically labelled. Nothing else is needed yet.

## Phase 2 — between visits: catalogue

**Path A — the lists arrived.** Import the catalogue (SKUs, pack sizes, UOMs), suppliers and customers via the CSV importers. Then set `product_wms_attributes` and `product_home_bins` min/max for the fast movers (H3). Reconcile their stock-on-hand report against what you expect to count.

**Path B — nothing arrived.** Stop and say so before visit 2 is booked. Building the catalogue from the shelf is its own visit: you are reading labels, inventing SKUs, and guessing pack sizes. **Do not attempt it in the same visit as the count** — an invented SKU with a wrong pack size corrupts every quantity that follows it, and pack size is the one field that cannot be fixed later without re-counting. Sequence it as: visit 2 = catalogue capture, visit 3 = count and go-live.

## Phase 3 — visit 2 (or 3): count and go-live

1. **Freeze the warehouse.** No receiving, no dispatch during the count.
2. **Count by bin**, recording `sku, quantity, bin_code` — quantities in **base units**, not cartons.
3. **Import** via the opening-stock CSV with the `bin_code` column. Verify the "Placed in bins" figure equals the received figure; anything unplaced is sitting at the root and needs finishing from the Putaway queue.
4. **Reconcile** the imported totals against their stock-on-hand report (if you got one). Investigate every difference before trading.
5. **Exercise one of everything** before declaring go-live: one receipt → putaway (assign, walk, scan, complete); one order → reserve → directed pick → pack → dispatch; one replenishment task driven `suggested → assigned → accepted` with stock actually moving.
6. **Train on the phone flows**, not on the desktop ones. The floor uses `ScanField`, and scanning is where habits form.

## Phase 4 — parallel run

Keep their existing method alive for a few weeks. Bin and count errors surface without halting the business, and H1 (no cancel path) is far less dangerous while a manual fallback exists.

**Exit criteria for retiring the old method:**
- Stock accuracy holds through a full cycle of receipts, picks and replenishments.
- No unexplained variance between `inventory_balances` and a spot re-count.
- H1 resolved, or an agreed manual workaround for cancellations documented with them.

---

## Open questions for Amadiya

1. How many racked bays? (Gates M3.)
2. Will the product list arrive before the visit? (Decides Path A vs Path B, and therefore the number of visits.)
3. Who at Amadiya owns the admin account, and who trains the floor?
4. Does the racked core already carry addresses, or are we introducing addressing for the first time?
5. Is the move to prod expected before or after they start trading on this? (Gates M4.)
