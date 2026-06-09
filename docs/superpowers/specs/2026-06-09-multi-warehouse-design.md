# Multi-Warehouse (2 regional DCs) — Design Spec

**Date:** 2026-06-09
**Branch context:** `redesign/po-inbox` (current) → new feature branch `feat/multi-warehouse`
**Status:** Approved design, pending implementation plan

---

## 1. Summary

Move the order system from a single hardcoded warehouse to **two regional
distribution centres**. Orders auto-allocate stock from the customer's
**closest** warehouse and split per-line to the other DC when the closest is
short. Each warehouse **picks and dispatches its own portion** independently;
Admin/Manager can see that one DC has shipped its part while the other has not.
Warehouse staff are scoped to a single DC. Receiving is warehouse-aware, and
operators can transfer stock between the two DCs.

This is **not** an extension of the dead `lib/mockWarehouses.ts` /
`lib/stockAllocator.ts` mock layer — that frontend-only 50/30/20 mock is
**deleted**. The real foundation is the DB-backed `locations` /
`inventory_balances` / `inventory_movements` tables from migration `00027`,
which were already product×location keyed and carry `transfer_in`/`transfer_out`
movement types. What we un-hardcode is the **RPC layer** (`inv_default_location()`
is replaced by explicit location arguments) and the **UI**.

---

## 2. Decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | **Two regional warehouses.** Rename `Main Warehouse` → WH1 (keeps all current stock). Add WH2 empty. Real names/coords supplied by operator (see §9). |
| 2 | **Routing = closest warehouse.** Haversine distance from `HoReCa.lat/lng` to each `locations.lat/lng`; nearest is the order's home DC. Operator can override at processing. |
| 3 | **Short stock = per-line split.** Take what the closest DC has; draw the remainder from the other DC. A single order line may be sourced from both. |
| 4 | **Split fulfilment.** Each warehouse picks AND dispatches its own portion (separate pick slip + dispatch advice). Order reaches `dispatched`/`delivered` only when **all** its fulfilments do. |
| 5 | **Staff scoped to one DC.** `profiles.home_warehouse_id`. Pickers/receivers see only their DC's work; Admin/Manager see all. |
| 6 | **Inter-warehouse transfers in scope.** Operator moves stock DC→DC (uses existing `transfer_out`/`transfer_in` ledger types). |
| 7 | **Receiving is warehouse-aware.** Receive into a chosen DC; inbound POs target a DC. |
| 8 | **Reservation stays at placement.** Auto closest-first split at order placement; operator override at processing = release + re-reserve. |
| 9 | **Customers see combined availability** (sum across both DCs). Per-warehouse stock is staff-only. |

---

## 3. Architecture: the `order_fulfillments` sub-entity (Approach A)

The core change. Today `orders.status` is a single value over
`processing → processed → picked → packed → dispatched → delivered`. With split
fulfilment, one order can be "WH1 dispatched, WH2 still picking", which a single
status cannot express.

**New entity: `order_fulfillments`** — one row per `(order_id, location_id)`
that the order draws stock from. Each carries its own back-half lifecycle.

```
order_fulfillments
  id                SERIAL PK
  order_id          TEXT  FK -> orders(id) ON DELETE CASCADE
  location_id       INT   FK -> locations(id)
  status            TEXT  CHECK in ('processed','picked','packed','dispatched','delivered')
  status_history    JSONB NOT NULL DEFAULT '[]'   -- [{status, timestamp, actor, note}]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (order_id, location_id)
```

- `order_fulfillments.status` is the **per-warehouse** status. It begins at
  `processed` when the order is processed/allocated and a fulfilment exists for
  that DC.
- `orders.status` is **derived** = the *minimum* (least-advanced) status across
  the order's fulfilments, on the existing
  `processing → processed → picked → packed → dispatched → delivered` ladder.
  The pre-fulfilment stages `processing`/`processed` remain order-level (an order
  is still `processing` until the operator processes it; fulfilments are created
  at processing). After that, the order rollup follows the slowest DC.
- The order keeps its `status` column (don't drop it) — it is **written** as the
  derived rollup by the same server code that advances a fulfilment, so all
  existing reads of `orders.status` keep working unchanged.

**Allocation granularity.** Reservations and picks are already location-aware at
the row level: `inventory_balances` is per-location, `pick_progress.location_id`
already exists, and `inventory_movements` records `location_id`. So a per-line
split needs **no new allocation table** — the split is represented by multiple
`pick_progress` rows (one per DC) and multiple balance reservations. The
`order_fulfillments` row is the per-DC *status & document* anchor; the physical
split lives in the existing ledger.

**Which DCs get a fulfilment row?** At processing, after (re)reservation, we
compute the distinct set of `location_id`s that hold a reservation
(`allocated > 0` from this order, via `inventory_movements` where
`ref_type='order' AND ref_id=order_id AND movement_type='allocate'`). One
`order_fulfillments` row per distinct DC.

---

## 4. Allocation algorithm (closest-first per-line split)

Replaces single-warehouse `inv_reserve_order`. New signature carries an ordered
list of preferred locations:

```sql
inv_reserve_order(
  p_order_id      TEXT,
  p_items         JSONB,                  -- [{product_id, quantity}]
  p_location_pref INT[],                  -- ordered: [closest_id, other_id]
  p_actor         UUID DEFAULT NULL,
  p_allow_partial BOOLEAN DEFAULT false
)
```

Per line, walk `p_location_pref` in order; within each location, FIFO across
batch rows (existing `ORDER BY expiry NULLS LAST, received_at, id`). Take
`LEAST(remaining, available)` at each, `allocate` leg via `inv_apply_leg`, move
to the next preferred location for any remainder. After exhausting all preferred
locations:
- `p_allow_partial = false` (web orders) → `RAISE INSUFFICIENT_STOCK`, whole txn
  rolls back (unchanged contract, now across both DCs).
- `p_allow_partial = true` (inbound-PO approval) → reserve what's available,
  backorder the rest (unchanged contract, now across both DCs).

**Closest-first ordering is computed in the Edge Function**, not SQL, so the
geo/business logic stays in TypeScript and testable:
`_shared/warehouseRouting.ts` → `orderedLocationsFor(horeca, locations)` returns
`[closestId, ...rest]` by haversine; falls back to a configured default DC when
the HoReCa has no `lat/lng`.

`inv_pick_order_line` and `inv_release_reservation` gain a `p_location_id` arg so
picks/releases target a specific DC (the picker is at one site). Their
FIFO-within-location and pack-aware scaling (mig `00035`) logic is otherwise
unchanged. `line_fully_picked` / `order_fully_picked` semantics stay in LINE
units; `order_fully_picked` now means *all lines across all DCs* fully picked.

---

## 5. Database migrations

A single forward migration `00036_multi_warehouse.sql` (idempotent, `BEGIN/COMMIT`):

1. **`profiles.home_warehouse_id`** `INT NULL REFERENCES locations(id)`. NULL for
   Admin/Manager (see all); set for `Warehouse` users.
2. **`order_fulfillments`** table (§3) + indexes on `order_id`, `location_id`.
   RLS: SELECT for `Admin/Manager/Warehouse`; writes service_role only. Add to
   `supabase_realtime` publication.
3. **`inv_reserve_order`** replaced with the `p_location_pref INT[]` signature (§4).
4. **`inv_pick_order_line`** / **`inv_release_reservation`** gain `p_location_id`.
5. **`inv_transfer_stock(p_product_id, p_from_loc, p_to_loc, p_qty, p_actor, p_reason)`**
   new RPC: FIFO `transfer_out` leg at source + `transfer_in` leg at destination
   in one txn (two `inv_apply_leg` calls, batch-preserving). service_role EXECUTE
   only. Raises `INSUFFICIENT_STOCK` if source `available` < qty.
6. **Rename** the seeded `MAIN` location `name` → operator-supplied WH1 name; set
   its `lat/lng`. **Insert WH2** (`code`, `name`, `lat/lng`), empty balances.
   (Coords from §9; if not yet known at migration time, seed placeholder coords
   and expose editing via the Warehouses admin screen — see §7.)
7. Keep `inv_default_location()` as a **fallback only** (used when a HoReCa has no
   coords and no explicit pref) — do not delete; several callers and tests use it.

**Rollout order (per CLAUDE.md gotcha):** deploy Edge Functions FIRST → push
frontend → apply migration `00036` (RLS + RPC signature swap) LAST. Reversing
breaks the admin UIs mid-deploy.

---

## 6. Edge Function changes

| Function | Change |
|---|---|
| `place-order` | Load all `locations`; compute `orderedLocationsFor(horeca)`; pass `p_location_pref` to `inv_reserve_order`. No fulfilment rows yet (created at processing). |
| `approve-po` | Same: pass closest-first pref (still `p_allow_partial=true`). Keep `order_items.pack_size=NULL` invariant from the carton-unit memo. |
| `update-order-status` — **`→ processed` transition** | This is the "process" action (driven from `OrderImportPage.tsx`; there is **no** dedicated `process-order` function today). On the `processing → processed` transition, the function now: optionally (re)reserves stock if the operator overrode the home DC (release via `inv_release_reservation` then re-reserve with the chosen `p_location_pref`), then creates one `order_fulfillments` row per DC holding a reservation, each `status='processed'`. Input gains an optional `locationPref?: int[]` for the override. The client-side `buildSingleWarehouseLines` note in `OrderImportPage` is replaced by a real per-DC allocation summary derived from the reservation ledger. |
| `record-pick` | Add `locationId` to input; pass `p_location_id` to `inv_pick_order_line`. On line/fulfilment completion, advance **that DC's** `order_fulfillments.status` to `picked`; recompute and write derived `orders.status`. |
| `update-order-status` — **back-half transitions** (`picked`+) | Operates on a **fulfilment** now: input gains `locationId`. Forward-only per fulfilment. `dispatched` gate checks only **that DC's** lines are fully picked. On dispatch, generate **that DC's** dispatch advice. After any fulfilment advance, recompute derived `orders.status`. Warehouse role still limited to `picked/packed/dispatched/delivered`, and additionally limited to **their** `home_warehouse_id`. |
| `receive-stock` | Add `locationId` to input (defaults to actor's `home_warehouse_id`, else explicit). Pass to `inv_receive_stock` (RPC gains `p_location_id`, replacing its internal `inv_default_location()`). |
| **`transfer-stock`** (new) | Admin/Manager only. `{productId, fromLocationId, toLocationId, qty, reason}` → `inv_transfer_stock`. Audit-logged. |
| `generate-pick-slip` / `generate-dispatch-advice` / `_shared/orderDocuments.ts` | Scope to a fulfilment: a pick slip / dispatch advice covers **one DC's** lines. `order_documents` gains nullable `location_id` to attribute each doc to its DC. |

A shared `_shared/orderStatusRollup.ts` computes the derived order status from the
set of fulfilment statuses; called wherever a fulfilment advances.

`_shared/warehouseRouting.ts` (haversine + ordering + default fallback) is the
TS twin of any client-side routing display; **KEEP IN SYNC** with a client
`lib/warehouseRouting.ts` the way `pricing.ts` is mirrored.

---

## 7. Frontend changes

**New types** (`types.ts`): `Warehouse` (id, code, name, lat, lng), and
`OrderFulfillment` (locationId, warehouseName, status, statusHistory, lineCount,
pickedUnits, totalUnits). `Order` gains `fulfillments: OrderFulfillment[]` and an
`overallStatus` (derived) distinct from any single DC. `HoReCa` unchanged
(lat/lng already present). `User`/profile gains `homeWarehouseId?`.

**Services / hooks:**
- `services/supabase/warehousesService.ts` + `useWarehouses()` — list DCs.
- `pickService.ts` / `usePickQueue` — filter by `home_warehouse_id` for Warehouse
  role; return per-fulfilment rows; queries key off fulfilment status.
- `receivingService.ts` — `locationId` param.
- new `transferService.ts` + `useTransferStock`.
- `orderDocumentService.ts` — doc list carries `locationId`.

**UI surfaces:**
- **Order Import / order detail** — render per-DC fulfilment rows with their own
  status chip + documents (the §3 tree view). Overall status = derived rollup,
  labelled "Partially dispatched" etc. when fulfilments diverge.
- **Pick Queue** (`PickQueueView` / `PickWorkspaceModal`) — one card per
  *fulfilment*; warehouse users see only their DC; Admin/Manager get a DC filter.
  Pick action sends `locationId`.
- **Receiving** (`ReceiveStockView`) — DC selector (locked to `home_warehouse_id`
  for Warehouse role; free choice for Admin/Manager).
- **Stock** (`StockView`) — per-warehouse on-hand/available columns (read
  `inventory_balances` grouped by `location_id`) + a combined total; new
  **Transfer** action (modal: product, from/to DC, qty) for Admin/Manager.
- **Warehouses admin screen** (new, Admin) — list/edit the two DCs (name, code,
  lat/lng). This is how operator supplies §9 coords post-deploy and how WH2 gets
  its real location.
- **Users admin** — assign `home_warehouse_id` when role is `Warehouse`.
- **Dashboard** inventory/dispatch section — split metrics by DC.
- **Delete** `lib/mockWarehouses.ts`, `lib/stockAllocator.ts`,
  `lib/singleWarehouse.ts`, `components/StockAssignmentModal.tsx`, and their tests
  (`__tests__/singleWarehouse.test.ts`, `__tests__/stockAllocator.test.ts`) — the
  dead mock layer. Verify with `knip`/`ts-prune` first.

Customer-facing Shop is **unchanged**: it reads `products.inventory` (the SUM
cache across both DCs) — combined availability, decision #9.

---

## 8. Permissions & RLS

- `order_fulfillments`: SELECT `Admin/Manager/Warehouse`; writes service_role only.
- Warehouse role: existing `update-order-status` / `record-pick` / `receive-stock`
  gates additionally constrained to the actor's `home_warehouse_id`. Enforced
  **server-side** in the Edge Function (the picker may only act on fulfilments at
  their DC), not just UI filtering.
- `transfer-stock`: Admin/Manager only.
- All mutations audit-logged (`audit_events`) as today.

---

## 9. Warehouse setup data (operator input needed)

Before/at migration the operator supplies, for **WH1** (the renamed Main) and
**WH2**:
- `code` (short unique, e.g. `SYD`, `MEL`), `name`, `lat`, `lng`.

If coords aren't ready at migration time, seed WH2 with placeholder coords and
edit via the Warehouses admin screen (§7) — routing falls back to the default DC
for any HoReCa until coords exist, so nothing breaks.

---

## 10. Testing

- **Unit** — `warehouseRouting`: closest-DC selection, tie-breaks, no-coords
  fallback. `orderStatusRollup`: derived status across mixed fulfilment states.
- **Integration** (extend `inventoryBalancing.integration.test.ts` via the
  `fakeSupabase` harness) — closest-first split reserve; per-DC pick decrement;
  per-DC release; transfer out/in conserves total on_hand; partial-dispatch
  rollup; `p_allow_partial` backorder across two DCs.
- **Server pricing/units** — carton pack-aware scaling still correct per DC
  (guard the mig `00035` invariant).
- **Migration test** (`inventoryMigration.test.ts` pattern) — `00036` renames
  MAIN, adds WH2, backfills no stock at WH2, preserves WH1 balances.
- Target ≥ existing coverage bar; keep the 80% rule.

---

## 11. Out of scope (this iteration)

- More than two warehouses (algorithm generalises via `p_location_pref` array,
  but UI/setup assume two).
- Multi-leg / in-transit transfer tracking beyond a single atomic out+in.
- Per-warehouse pricing or currency.
- Customer choice of fulfilment DC.

---

## 12. Risks

- **Derived-status drift.** `orders.status` is written by server rollup; a missed
  call site leaves it stale. Mitigation: single `orderStatusRollup` helper called
  from every fulfilment-advancing path + a nightly reconcile (mirror the existing
  `inventory-cache-reconcile` cron pattern in `00027`).
- **RPC signature swap** breaks in-flight callers if deploy order is wrong.
  Mitigation: §5 rollout order; keep old `inv_default_location()` as fallback.
- **Pack-aware units** (mig `00035`) must stay correct per DC — reserves/picks are
  base units, pick UI sends LINE units. Don't regress when adding `location_id`.
- **Keep-in-sync** drift between `lib/warehouseRouting.ts` and
  `_shared/warehouseRouting.ts` (same hazard as `pricing.ts`).
