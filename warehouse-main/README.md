# `warehouse-main/` — realistic floor plan + engine slotting for MAIN

Gives the **MAIN** warehouse a floor plan that reads like a real distribution centre,
then lets the shipped WIE putaway engine slot every SKU into it.

```bash
npm run warehouse:main:seed     # build + publish the layout, slot all stock
npm run warehouse:main:reset    # pull stock back to the root, restore the old layout
```

Both run against whatever `.env.local` points at — **there is no staging project**, so
this writes to production. `reset` undoes `seed`.

## Why this exists

`MAIN` was flagged `racked` but its published layout was placeholder data: 15 single-cell
bins in one straight row on a 60x40 grid. Every real unit of stock (130 SKUs, ~7,000 units)
sat unbinned at the warehouse root, so putaway, directed picking and the WIE heat map had
nothing to work with in the one warehouse that actually holds stock.

## What it builds

A 60x40, single-floor DC at 1 m/cell:

| Zone | Bays | Storage form | Slots/bay |
|---|---|---|---|
| Fast Moving | 104 | `MAIN_PALLET_BAY` | 120 carton |
| Slow Moving | 52 | `MAIN_SHELF_BAY` | 60 carton |
| Overflow | 13 | `MAIN_PALLET_BAY` | 120 carton |
| Bulk Floor | 8 | `MAIN_BULK_FLOOR` | 1000 carton |
| Cold Room | 12 | `MAIN_COLD_BAY` | 90 carton |

Inbound and outbound docks on the north wall, a full-width walkway apron, three E-W
cross-aisles, a central N-S aisle splitting two rack blocks, and a walled cold room with a
two-cell doorway. Staging, Returns and Quarantine are `label` objects over walkway, **not**
bins — anything placed becomes a putaway target.

## Design constraints worth knowing

- **Capacity is expressed in cartons**, the same base unit as `inventory_balances.on_hand`.
  The stock SKUs all have `size_factor = 1.0`, so a 10-slot `PALLET_RACK` bin would have
  needed ~700 bays to hold 7,000 units. The four `MAIN_*` forms are new so the five
  pre-existing forms and every `products.size_factor` stay untouched — `WIE-DEMO` and the
  test suite are unaffected.
- **<= 200 bays.** `putawayTasks.ts` asks `wie_putaway_candidates` for only the 200 nearest
  bins. Overshoot and the farthest bays are never offered to the engine — and the farthest
  bays are the cold room, the only legal home for Plant-Based stock. Enforced by
  `CANDIDATE_LIMIT` in `layout.mjs` and asserted in the test.
- **Fast movers are slotted first.** `planPutaway` is greedy per line in input order, so
  whichever SKUs are offered first claim the dock-adjacent bays. Without the A/B/C sort,
  C-class stock ends up closer to the dock than A-class.
- **A new `Main Cold Storage` zone profile** rather than the shared `Cold Storage` one,
  which `WIE-DEMO`'s chilled zone already points at. Mutating the shared profile's
  `allowed_categories` would gate WIE-DEMO's putaway.
- **`scoring.ts` never reads `temp_min`/`temp_max`.** The cold room is enforced by a
  warehouse-scoped hard `wie_rule` plus `allowed_categories` on the profile.
- **Reserved stock cannot move.** `inv_transfer_stock` only moves *available* stock, so the
  seed slots `available`, not `on_hand`. Units already allocated to an order stay at the
  root.

## Rounds, not one big call

The seed recommends and accepts putaway in rounds of 40 SKUs. Accepting a round before
recommending the next means the engine reads real `used_slots` / `has_same_product` from
`inventory_balances` instead of leaning on the in-call fill overlay, and it keeps us under
`decide-putaway`'s 120/min rate limit.

## What reset does and does not undo

It refuses to start unless MAIN's `active_layout_id` points at the layout the seed published,
so it can never demote a layout an operator published later. It also aborts up-front if any
seeded bin holds stock reserved against an open order, since `inv_transfer_stock` cannot move
reserved units and a half-drained teardown is worse than none.

Restores: stock back to the root, the previous published layout, and only the bins that layout
actually places.
Removes: the seed's own putaway recommendations (scoped by `layout_id`), its home bins (scoped
by `bin_id`), and the two seeded rules.
Deactivates: the seeded bins, storage forms, and the cold zone profile.

It archives the seeded layout **before** draining, so the `transfer-stock` legs don't each fire
`generatePutawayTasks` and persist a recommendation for the stock being pulled out.

It does **not** delete the seeded bins — `inventory_movements.location_id` is
`ON DELETE NO ACTION` and the ledger is append-only. Those transfer legs really happened.
Retired bins are deactivated and their codes suffixed (`MAIN-F01-L05-X342`) so the next
seed can reuse the canonical names.

It does **not** restore `wie_product_velocity`: the seed overwrote rows that cannot be
recovered. Stale ABC classes are harmless; recompute with `SELECT wie_refresh_velocity();`.

## Files

| File | |
|---|---|
| `layout.mjs` | Pure geometry generator. No I/O. |
| `velocity.mjs` | Pure ABC classification from order demand. |
| `lib.mjs` | Clients, storage forms, zone profile, rules, constants. |
| `seed.mjs` | Orchestrates catalogue -> layout -> publish -> velocity -> rules -> putaway. |
| `reset.mjs` | Teardown. |

Tests for the two pure modules — including the real `evaluatePublishReadiness` and
`autoConnectLayout` gates — live in `__tests__/warehouseMainLayout.test.ts`.
