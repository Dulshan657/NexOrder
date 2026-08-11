# Runbook — standing up Amadiya's warehouse

**Environment:** dev (`lsgkznyiabqitqfpveey`, Singapore). Prod does not exist yet.
**Companion:** `WAREHOUSE-ONBOARDING-PLAN.md` — this runbook is its Phase 1, in operator order.

Migration `00098` has already seeded the two storage forms this site draws with. Everything below
is done in the app, in this order. The order is the whole point: **config → draw → publish → label
→ count → import**, and each arrow is a hard dependency, not a preference.

---

## The racking, as measured

| | |
|---|---|
| Levels per bay | 5, 1.2 m pitch (top beam ≈ 4.8 m) |
| Bay width | 2.7 m |
| Frame depth | 1.0 m |
| Load per level | 1 tonne, **total** — L4/L5's two pallet positions share it |
| L1–L3 | cartons, hand-picked — the **pick zone** |
| L4–L5 | 2 pallet positions each — reserve and bulk |
| Bays | 3 left wall + 10 top wall + 4 right wall = **17** (85 levels) |
| Middle | bulk / floor-stacked pallets |
| Bottom wall | docks, no racking |

85 levels against `PUTAWAY_CANDIDATE_LIMIT` (2000) — no risk of the engine hiding the far bays.
Count **levels, not bays**: a levelled rack holds no placement row of its own, its SHELF levels do.

## What `00098` gave you

| Form | | |
|---|---|---|
| **Amadiya Rack** (`AMD_RACK`) | 5 levels, 112 slots, 5000 kg | L1–L3 `pick` / carton / 36 · L4 `reserve` / pallet / 2 · L5 `bulk` / pallet / 2 |
| **Amadiya Bulk Floor** (`AMD_BULK`) | flat, `pallet`, **uncounted** | no levels, no weight limit |

No level roles and no zone profiles were created — the seeded `pick` / `reserve` / `bulk` fit this
rack exactly, and the site is ambient-only.

---

## 1. Create the warehouse

**Already done** — `AMADIYA` exists on dev as a `bulk` site with no layout. Publishing a layout
flips it to `racked`. Do not hand-build a location tree; publishing creates the bins.

## 2. Set the grid **before** drawing anything — and read this first

Designer → new layout → **Properties** takes the building's real outside length × width plus a
resolution, and derives the grid. It is a **one-shot decision**: changing the resolution afterwards
is refused unless the new one divides evenly into everything already drawn, and on a published
layout the change stays inert until you publish again.

**The constraint that decides it: a hand-drawn bin is always ONE CELL.** Both the rack tool and
*Generate racks* create 1 × 1 placements — there is no footprint control anywhere in the designer,
and MAIN's 189 bays are one cell each for the same reason. So the cell size is not "how finely can
I draw", it is **how much floor one bay occupies**.

That leaves two coherent choices, and they are genuinely different jobs:

### Option A — import the sketch, then 0.90 m/cell

`extract-floorplan` sets `w`/`h` per placement, so an imported rack row can be several cells wide
even though a hand-drawn one cannot. This is the path `WAREHOUSE-ONBOARDING-PLAN.md` Phase 1
already assumes, and you have a sketch.

- A bay is **3 × 1 cells**, geometrically true.
- Aisles, doors and the bulk floor land within 0.9 m of reality.
- Rack depth reads 0.90 m against a real 1.0 m (−10%). Unavoidable — `cell_size_m` is
  `NUMERIC(6,2)`, so 2.7 and 1.0 both land on whole cells only at 0.10 m/cell, which the 200-cell
  cap limits to a 20 m building.
- A 30 × 15 m building gives a 34 × 17 cell grid. Verified: the dialog reports
  *"1 cell = 0.9 m · drawn area 30.6 × 15.3 m"*.

### Option B — hand-draw, and set the cell to the bay pitch: 2.70 m/cell

One click, one bay, one cell — on both axes, since the side-wall racks run along the depth.

- Run lengths are exact: the 10-bay top wall is 10 cells = 27 m.
- Rack depth reads 2.7 m against a real 1.0 m, so the floor looks far more congested than it is and
  the middle bulk area looks smaller than it is.
- Aisles quantise to 2.7 m. You cannot draw a 1.5 m walkway or a doorway.
- A 30 × 15 m building gives a 12 × 6 cell grid.

**Do not hand-draw adjacent bays at 0.90 m/cell.** A 10-bay run would then draw as 9 m of wall
instead of 27 m, and every travel distance along it — which is what the routing graph is made of —
would be understated threefold.

Whichever you choose, establish the dimensions from **one physically measured reference** (a bay you
can put a tape on) and keep every other dimension consistent with it.

## 3. Draw, in this order

1. **Docks on the bottom wall.** A dock is a publish gate and the anchor every travel distance is
   measured from, so place it before the racks or the layout will not read correctly as you go.
2. **A walkway apron** along the dock wall.
3. **The 17 `AMD_RACK` bays** — 3 on the left wall, 10 along the top, 4 on the right. Each fans out
   at save time into a RACK parent (which holds no capacity of its own) plus five SHELF levels.
   Their size on the grid follows from the option you took in step 2.
4. **The `AMD_BULK` floor area** in the middle.
5. **Walkways** connecting every bin to a dock.

**Staging, returns and quarantine are `label` objects over walkway — never bins.** Anything placed
becomes a putaway target the engine will fill.

## 4. Check one bay before drawing all 17

Select a rack, open the inspector, and confirm the level stack reads:

```
L5  Bulk      Pallet positions   2    1000 kg
L4  Reserve   Pallet positions   2    1000 kg
L3  Pick Zone Cartons           36    1000 kg
L2  Pick Zone Cartons           36    1000 kg
L1  Pick Zone Cartons           36    1000 kg
```

If **Counted in** reads *Cartons* on L4/L5, stop — the mixed template did not come through, and
every pallet put there will be counted as loose units against a limit of 2. Nothing downstream is
recoverable from that without recounting.

This was verified end to end on 2026-08-11: one `AMD_RACK` bay drawn on a scratch layout produced
`AMADIYA-B-6-2` (RACK, no capacity) plus `…-L1`–`L5` carrying `pick`/carton/36 on L1–L3 and
`reserve`,`bulk`/pallet/2 on L4–L5. The scratch layout was deleted afterwards.

## 5. Paint the named areas

Paint the bulk floor and any wayfinding regions as named areas, set each one's zone profile
(`Bulk Storage` for the floor, `Fast Moving` for the racked core). Painting an area is what binds
the bins standing on it to a ZONE — the area wins over any per-bin dropdown.

## 6. Publish

Four gates, shown live in the designer: a dock exists, walkways remain, at least one bin is placed,
every bin reaches a dock. Publishing creates the bin `locations`, builds the routing graph, and
flips the site to `racked`.

## 7. Labels

Generate the label run for the published layout, print, and **physically apply a QR to every bay**.
Then confirm the print in the app so `locations.label_printed` reflects the floor. 17 bays plus
levels is a real chunk of work — plan it as work.

## 8. Walk the aisles with a phone

Scanning happens on staff phones. Check wifi coverage across the racking before committing to
scan-enforced picking (M5 in the onboarding plan).

---

## Before the count — the three figures still to set

Each one is currently a placeholder that is honest but not final.

### `AMD_BULK` capacity — currently NULL (uncounted)

Measure how many pallet positions the middle floor actually holds and set
`default_capacity_slots` in Settings → Warehouse → Storage Forms. While it is NULL the engine will
offer that area forever and never call it full.

### Carton slots per pick level — currently 36

36 = 18 cartons per layer (a 400 × 300 mm reference carton packs 6 × 3 on a 2.7 × 1.0 m level)
× two layers. Load one level for real, count what fits, and correct the form. **Use "Apply to all
units"** so the correction reaches racks already drawn — it now carries `slot_kind` as well as
capacity and weight.

### `products.size_factor` — required at catalogue import

The pick levels are counted in **reference cartons of 400 × 300 mm**. A SKU's `size_factor` says how
many of those one base unit occupies:

| Carton | `size_factor` |
|---|---|
| 400 × 300 mm | 1.0 |
| 600 × 400 mm | 2.0 |
| 300 × 200 mm | 0.5 |

Until it is populated every SKU defaults to 1.0 and every pick level over-reports its remaining
space. This is a required column of the catalogue import, not an optimisation — a wrong
`size_factor` makes putaway fill bins that are physically full.

Pallet levels are unaffected: a plate consumes one position whatever is on it.

---

## Operating rule: nothing enters a rack without a plate

The pallet levels are counted in **positions**, which only works while pallet stock is on a handling
unit. `receive-stock` creates a plate per receipt automatically, so the normal path is safe. The
exception is stock that arrives loose through an adjustment or a count surplus: loose stock consumes
`qty × size_factor` slots, so 130 loose units land in a 2-slot level as 130 slots.

If a count finds loose pallet stock, receive it rather than adjusting it.

---

## Then

Hand off to `WAREHOUSE-ONBOARDING-PLAN.md`:

- **Phase 2** — catalogue (SKUs, pack sizes, UOMs, `size_factor`), suppliers, customers; then
  Replenishment → Min/max setup, left unarmed until after the count.
- **Phase 3** — freeze the warehouse, count by bin, import the opening-stock CSV **with the
  `bin_code` column**, reconcile, and exercise one of everything before declaring go-live.
- **Phase 4** — parallel run.

Two gaps are still open and will be met in the first weeks of trading: there is **no order-cancel or
short-ship path** (H1), and the session-persistence fix has still not been verified across a
full-hour session on a phone.
