# NX-0006 — Putaway engine: home bin first, complete without Assign (server half)

```json brief
{
  "id": "NX-0006-putaway-home-first",
  "base": "94f61ca2885a090a5f24f013fa06db977615e97e",
  "approved": "2026-10-27 owner",
  "acceptance": [
    { "id": "A1", "check": "A loose line whose product has a home bin in the warehouse is suggested to that home bin first, up to min(max_qty, capacity) minus on-hand and pending; source = 'home'." },
    { "id": "A2", "check": "When the home bin cannot take the whole line, the remainder is suggested to overflow bins ordered same rack first, then travel distance from the home bin; source = 'overflow'." },
    { "id": "A3", "check": "A plated single-product pallet (unit load) is never suggested to its home bin; it goes to the reserve bin closest to home." },
    { "id": "A4", "check": "A product with no home bin gets the engine suggestion with source = 'engine' and suggestMakeHome = true." },
    { "id": "A5", "check": "Each product line of a mixed pallet gets its own home/overflow suggestion instead of following the first line's bin, and keeps its hu_id. This deliberately reverses the current one-bin-per-mixed-pallet rule and its test." },
    { "id": "A6", "check": "generatePutawayTasks sets ref on every non-mixed allocation, so the break-down dry run can match its results." },
    { "id": "A7", "check": "A 'suggested' task can be completed directly (no assign); scanning its suggested bin resolves to 'accepted', any other bin to 'overridden'. 'assigned' tasks still complete as before." },
    { "id": "A8", "check": "Completing at a bin other than the suggested one is refused without an override_reason from Blocked, Damaged, Full, Closer, Other." },
    { "id": "A9", "check": "Completing fewer than the task quantity with short = true leaves the remainder as a 'short' task at the warehouse root; without short it stays open as today." },
    { "id": "A10", "check": "make_home sets the product's home bin only when it has none in that warehouse; for the Warehouse role an existing home is refused, Admin/Manager are told to use the home-bin editor." },
    { "id": "A11", "check": "Several task ids of the same product with no plate complete in one call, quantity allocated oldest task first; mixed products or plated tasks are refused. (Revision: putaway rows carry no batch and the transfer draws loose dock stock earliest-expiry first, so a batch choice cannot be offered or needed.)" },
    { "id": "A12", "check": "decide-putaway 'redirect' (Admin/Manager) changes the bin of a 'suggested' task; 'resolve_short' found reopens it, write_off adjusts stock with a mandatory reason." },
    { "id": "A13", "check": "Migration 00135 applied on dev; A7, A9, A10 and A12 verified against live pg.", "manual": "npm run migrate:dev + npm run test:integration (putawayHomeFirst.integration.test.ts)" },
    { "id": "A14", "check": "Existing Assign/Walk screen still works end to end on dev after the function deploy.", "manual": "browser walk on nexorder.vercel.app" },
    { "id": "A15", "check": "Merged and deployed to dev (functions then frontend); /version.json shows the merge sha.", "manual": "deploy:dev verification" },
    { "id": "A16", "check": "A putaway (complete or Place now) that would leave stock on its plate takes its units OFF the plate, landing loose; the move that empties a plate carries it. No plate ever holds stock in two places. (Revision after the gate's NO-GO on e423710: A5 split mixed pallets without this.)", "manual": "npm run test:integration (putawayHomeFirst: mixed pallet, split plate, Place now)" }
  ],
  "failFirst": [
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "planHomeFirst > puts the whole line in the home bin when it has room", "proves": ["A1"] },
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "planHomeFirst > fills the home bin only up to max_qty", "proves": ["A1"] },
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "planHomeFirst > sends the remainder to overflow, same rack first then nearest", "proves": ["A2"] },
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "planHomeFirst > never puts a unit load in the home bin", "proves": ["A3"] },
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "planHomeFirst > suggests making a home when the product has none", "proves": ["A4"] },
    { "file": "__tests__/wie/putawayTasks.test.ts", "test": "generatePutawayTasks — home bin > suggests the home bin before the engine's pick", "proves": ["A1"] },
    { "file": "__tests__/wie/putawayTasks.test.ts", "test": "generatePutawayTasks — home bin > sends a unit load to the reserve bin closest to home", "proves": ["A3"] },
    { "file": "__tests__/wie/putawayTasks.test.ts", "test": "generatePutawayTasks — unit loads > plans each product of a MIXED pallet on its own, keeping the plate", "proves": ["A5"] },
    { "file": "__tests__/wie/putawayTasks.test.ts", "test": "generatePutawayTasks — persistence > sets ref on a non-mixed allocation", "proves": ["A6"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "decidePutawayCompletion > completes a suggested task without assign", "proves": ["A7"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "decidePutawayCompletion > requires a reason for a different bin", "proves": ["A8"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "decidePutawayCompletion > marks the remainder short when flagged", "proves": ["A9"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "decidePutawayCompletion > make_home only when the product has no home", "proves": ["A10"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "allocateAcrossTasks > fills oldest first and refuses mixed products or plates", "proves": ["A11"] },
    { "file": "__tests__/putawayCompletion.test.ts", "test": "decideDeskAction > redirect and resolve_short are Admin/Manager only; write_off needs a reason", "proves": ["A12"] }
  ],
  "allow": []
}
```

## Goal

First half of the putaway simplification agreed with the owner on 2026-10-27
(interview; screen half is NX-0007). Putaway ignores `product_home_bins` today,
and every task must be assigned before it can be completed. This change makes
the engine send goods to the product's home bin first, overflow close to it,
and lets a `suggested` task be completed directly, with the reason, shortage,
make-home and combine rules the new screen needs. The current Assign/Walk
screen keeps working unchanged.

## Approach

- Pure `supabase/functions/_shared/wie/homeFirst.ts` (added to the purity test),
  wired into `_shared/putawayTasks.ts` ahead of `planPutaway`; home headroom from
  `capacity.ts` + `v_bin_fill` + `v_bin_pending_putaway`. Mixed pallets plan per
  product. `ref` fixed on the non-mixed path.
- Pure `supabase/functions/_shared/putawayCompletion.ts`: the status, reason,
  short, make-home, multi-task allocation and desk-action rules, imported by
  `complete-putaway` and `decide-putaway` (same pattern as `putawayScanCheck.ts`).
- Migration `00135_putaway_home_first.sql`:
  - `wie_putaway_candidates` takes an anchor and returns `same_rack` and
    `anchor_distance` (old signature DROPped first, 2000 cap kept);
  - `wie_putaway_recommendations` gains `suggestion_source`, `override_reason`,
    `short_qty` and the `'short'` status;
  - `wie_complete_putaway_tx` accepts `suggested` and `INT[]` task ids;
  - new `wie_redirect_putaway_tx` and `wie_resolve_short_putaway_tx`.
- `complete-putaway`: `task_ids[]`, `override_reason`, `short`, `make_home`.
  `decide-putaway`: `redirect`, `resolve_short`. `assign_only` stays.
- Service/types: `services/supabase/putaway*.ts` and `types.ts` gain the new
  fields, so NX-0007 can use them. No screen changes.

## Out of scope

- The new screen, the Scan/Guide toggle, Back, the Short list UI and "Put away
  now": all NX-0007.
- Undo after Confirm (owner declined).
- Replenishment changes.
- Removing the `assigned` status or `assign_only`.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `planHomeFirst > puts the whole line in the home bin when it has room`, `planHomeFirst > fills the home bin only up to max_qty`, `generatePutawayTasks — home bin > suggests the home bin before the engine's pick` (fails on base by assertion) | Live: receipt of AYM-COC-003 on dev suggested MAIN-F01-R09, source `home` |
| A2 | claimed | `planHomeFirst > sends the remainder to overflow, same rack first then nearest`; `generatePutawayTasks — home bin > spills what the home bin cannot take to the bin nearest it` | Distance falls back to grid distance: `layout_travel_distances` holds distances from docks only (1 source node on layout 6, 12 on layout 25) |
| A3 | claimed | `planHomeFirst > never puts a unit load in the home bin`, `generatePutawayTasks — home bin > sends a unit load to the reserve bin closest to home` | A unit load = a `pallet` plate; a `carton` plate may go home |
| A4 | claimed | `planHomeFirst > suggests making a home when the product has none`, `decidePutawayCompletion > make_home only when the product has no home`; integration `pools tasks oldest first and sets a home only when there is none` | |
| A5 | claimed | `generatePutawayTasks — unit loads > plans each product of a MIXED pallet on its own, keeping the plate` (fails on base by assertion) | Replaces the old one-bin-per-mixed-pallet test, as the brief states |
| A6 | claimed | `generatePutawayTasks — persistence > sets ref on a non-mixed allocation` (fails on base by assertion) | |
| A7 | claimed | `decidePutawayCompletion > completes a suggested task without assign`; integration `completes a suggested task with no assign step and moves the stock`; dev: direct complete → `accepted at MAIN-F01-R09` | |
| A8 | claimed | `decidePutawayCompletion > requires a reason for a different bin`; integration `refuses a different bin without a reason, and records one when given`; dev: wrong bin without reason refused | Applies to SUGGESTED tasks only; an ASSIGNED task keeps the old no-reason walk |
| A9 | claimed | `decidePutawayCompletion > marks the remainder short when flagged`; integration `a short count leaves the remainder at the dock as a shortage; write-off clears it` | |
| A10 | claimed | `decidePutawayCompletion > make_home only when the product has no home` | Warehouse gets FORBIDDEN, Admin/Manager INVALID_INPUT pointing at the home-bin editor |
| A11 | claimed | `allocateAcrossTasks > fills oldest first and refuses mixed products or plates`; integration pooled test | Revised (59be04a): by product, not batch |
| A12 | claimed | `decideDeskAction > redirect and resolve_short are Admin/Manager only; write_off needs a reason`; integration `redirect changes a suggested bin…`, `found puts a shortage back…`, write-off test | |
| A13 | claimed | `npm run migrate:dev` applied 00135 and 00136; `npm run test:integration -- putawayHomeFirst` 8/8 on dev; one overload per function verified in `pg_proc` | Rehearsed under BEGIN…ROLLBACK first, on a racked and a flat layout |
| A14 | claimed | All functions deployed to dev; as the Warehouse test user, receive → decide-putaway `assign_only` → complete-putaway with bin + product scans → `accepted at MAIN-F01-R09` | Driven through the deployed functions by script, the same calls the screen makes — not clicked through in a browser |
| A15 | not-claimed | | Needs the merge; deploy:dev and /version.json after it |

### Not claimed

- No click-through of the current Assign/Walk screen in a browser: signing in on the hosted dev site was not done from this session. A14 rests on the identical API calls.
- Two migrations, not one: 00136 fixes 00135's `ON CONFLICT`, which named a key `product_home_bins` lost in 00082 (homes are keyed by `purpose`). Found by the integration test before any client called it. The home putaway fills is the `primary` slot.
- No `short_qty` column (named in Approach): a shortage is its own row, status `short`, carrying the missing quantity; `written_off` is its closing status.
- Short dock stock is still `available` at the warehouse root until resolved, so an order reservation can draw on it, exactly as an open remainder already could.
- Home-bin reads fail OPEN (no home known → plain engine suggestion), and a failed on-hand read can overfill past `max_qty` (never past capacity).
- `stockAdjust.integration.test.ts > rejects a blank reason…` fails against dev's live `inv_adjust_stock`; unrelated to this branch (no change to that function), not fixed here.
- Two small receipts (2 × 5 Coconut Milk 400ml) were put away into MAIN-F01-R09 on the dev demo for the A14 check.
- Nothing on the RS35, and no screen changes: the new screen is NX-0007.
