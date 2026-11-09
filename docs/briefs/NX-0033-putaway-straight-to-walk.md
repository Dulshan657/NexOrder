# NX-0033 — Putaway goes straight onto the walk

```json brief
{
  "id": "NX-0033-putaway-straight-to-walk",
  "base": "abc4337b2ae1bd3de5ffc9956151acdf0dea05d4",
  "approved": "2026-11-09 owner, by standing go-ahead on the design; text not yet read, owner to confirm before the PR",
  "acceptance": [
    { "id": "A1", "check": "A line whose product's home has room is created assigned to the home bin with no assigner (assigned_by NULL) and is on the Walk; it never appears in the Assign queue.", "manual": "unit tests in __tests__/wie/putawayTasks.test.ts, named in failFirst by a brief-only revision once they exist; npm run test:integration -- putawayStraightToWalk (recommend-putaway over HTTP) on dev" },
    { "id": "A2", "check": "A loose line sent to overflow (home full) is created suggested; it is listed in the Assign queue and as a confirm stop on the Walk ('Home full — put in {bin}?'). Assign or Choose bin at the desk, or scanning the suggested bin on the walk, confirms it; the first wins, the other is refused with CONFLICT, and the line leaves the other list. A scan of any other bin on a confirm stop is refused.", "manual": "unit and component tests named in failFirst by revision; npm run test:integration -- putawayStraightToWalk (wie_confirm_overflow_tx, wie_putaway_stops) on dev" },
    { "id": "A3", "check": "A line for a product with no home, and a single-product pallet (unit load) of any product, is created assigned to the engine's bin and is on the Walk.", "manual": "unit tests named in failFirst by revision; integration over HTTP on dev" },
    { "id": "A4", "check": "On a walk stop for a product with no home, a Manager or Admin is offered 'This product has no home bin. Give it one?' and can choose a bin by scanning, typing or a dropdown that lists only bins that pass the home-bin health rules and are no other product's home; the putaway then goes to that bin and the bin becomes the product's primary home in the same transaction. 'Not now' keeps the engine's bin. complete-putaway refuses make_home into a bin that fails those rules with '{code} can't be a home bin: ...'.", "manual": "component tests named in failFirst by revision; integration over HTTP on dev; the Playwright run (A9)" },
    { "id": "A5", "check": "complete-putaway refuses make_home from any role other than Admin or Manager with FORBIDDEN 'Only a Manager or Admin can give a product a home bin.', before reading the task; a Warehouse user is not offered the choice on the walk.", "manual": "unit tests named in failFirst by revision; npm run test:integration -- putawayStraightToWalk (Warehouse user over HTTP) on dev" },
    { "id": "A6", "check": "The same overflow line confirmed at the desk and on the walk at once ends with exactly one assignment and no stock moved; a walk completion and a desk Place now at once move the stock exactly once.", "manual": "npm run test:integration -- putawayStraightToWalk, race describe (two connections) on dev" },
    { "id": "A7", "check": "A line the system assigned and nobody has touched can still be placed from the receive card (Accept, Choose another) and by the opening-stock import (decide override); a line a person assigned cannot be placed that way.", "manual": "npm run test:integration -- putawayStraightToWalk on dev" },
    { "id": "A8", "check": "The Bin detail panel (and the Locations panel) on Warehouse setup scrolls with the mouse wheel.", "manual": "component test named in failFirst by revision; npx playwright test tests/e2e/rack-levels/bin-detail-wheel.spec.ts against dev" },
    { "id": "A9", "check": "End to end on dev in a browser with made-up products only: a homed product's line is on the Walk and not the Assign queue and completes at the home; with the home full the overflow line shows in both lists and confirming on the walk removes it from the Assign queue, and confirming at the desk turns the walk stop into a plain stop; a product with no home is on the walk and an Admin gives it a home by scan, by typing and by dropdown; a Warehouse user is offered nothing and a forged make_home is refused.", "manual": "npx playwright test tests/e2e/rack-levels/putaway-straight-to-walk.spec.ts --project=chromium against dev, trace and screenshots kept outside git" },
    { "id": "A10", "check": "Migration 00143 applied to dev and the changed functions deployed to dev.", "manual": "npm run migrate:dev; npm run fn:deploy:dev -- <list in Task 11>" }
  ],
  "failFirst": [],
  "allow": []
}
```

## Goal

After NX-0032, every received putaway line still lands in the Assign queue as `suggested`, and someone has to press Assign before it reaches the Walk. The owner's words: "the location assignment must be automatic, and the only time it should require human intervention is if the home location is full and you want to confirm the suggested overflow location."

This change makes that so, for every product and every warehouse:
- A line whose home has room, a line for a product with no home, and a single-product pallet are created already assigned and go straight onto the Walk. Nobody presses Assign.
- A loose line sent to overflow because the home is full waits for one confirmation. The desk (Assign, or Choose bin) or the walker (scanning the suggested bin on the Walk) can give it. The first one wins and the line leaves the other list.
- On a walk stop for a product with no home, a Manager or Admin can give the product a home by scanning, typing or picking from a list of bins that pass the home-bin health rules. The server refuses anyone else.
- The Bin detail panel on Warehouse setup scrolls with the mouse wheel.

## Approach

**Files.**

| File | Change |
|---|---|
| `supabase/functions/_shared/wie/homeFirst.ts`, `_shared/putawayTasks.ts` | `goesStraightToWalk` (pure routing rule). Tasks are written with `status` and `assigned_*` per that rule, and report `assignedLocationId`. |
| `supabase/migrations/00143_putaway_straight_to_walk.sql` | New `wie_confirm_overflow_tx` and `wie_home_bin_candidate_facts`. Redefined `wie_decide_putaway_tx` and `wie_putaway_stops`. |
| `_shared/wie/homeBinHealth.ts`, `_shared/homeBinHealthLoad.ts`, new `home-bin-choices` function, `config/moduleOwnership.mjs` | The pure rule for which bins can be a home, its loaders, and a read-only function that feeds the chooser. |
| `_shared/putawayCompletion.ts`, `complete-putaway`, `decide-putaway` | The role gate and fitness check on `make_home`. `confirm_overflow`. Place now on system-assigned rows. |
| `services/supabase/*`, `hooks/queries/*` | `getWalkPutaways`, `confirmOverflowPutaway`, `getHomeBinChoices` and their hooks. |
| `components/inventory/putaway/walkStops.ts`, `GiveHomeSheet.tsx`, `PutawayStopCard.tsx`, `PutawayWalkView.tsx`, `PutawayQueuePage.tsx`, `PutawayRow.tsx` | Confirm stops on the Walk, the `Home full` badge in the queue, the give-home offer and chooser. |
| `components/inventory/warehouse/FloatingPanel.tsx` | The scroll fix. |
| `__tests__/**`, `tests/e2e/rack-levels/*` | Unit, component, integration (dev) and Playwright (dev) proof. |
| `docs/claude/warehouse-stock-ops.md` | An NX-0033 paragraph. |

**Rulings, one line each.**
- **R2.** "Needs confirmation" is the row predicate `status='suggested' AND suggestion_source='overflow' AND recommended_location_id IS NOT NULL`, so overflow lines already in the Assign queue also appear on the Walk as confirm stops, and no other existing row changes lists.
- **R3.** A loose overflow line always waits for confirmation, including one sent to overflow because its home is unusable. A unit-load pallet goes straight to the Walk whatever its source.
- **R4.** `wie_decide_putaway_tx` (accept and override, not assign-only) also acts on a row that is `assigned` with `assigned_by IS NULL`, so the receive card and the opening-stock import still work. A redirect still needs `suggested`.
- **R5.** The home is set at completion, in the same transaction as the move, through the existing `make_home` path. It is not set when the manager picks the bin, so "Not now" or an abandoned stop leaves nothing behind.
- **R6.** The walk confirmation is the new compare-and-set function `wie_confirm_overflow_tx`, reached through `decide-putaway` `decision:'confirm_overflow'`. It takes the row lock the desk's Assign takes, accepts only the suggested bin, and refuses a stale scan.
- **R7.** The reason rule follows the status: an auto-assigned line placed in another bay is recorded without a reason, like any assigned walk line. The NX-0032 home rule still refuses an off-home bin while the home has room.
- **R8.** The wheel cause is `FloatingPanel`'s unbounded scroll body inside an `overflow-hidden` wrapper, to be confirmed in a browser before the fix. The fix goes in `FloatingPanel`, so the Locations tree is fixed too.

**Proof.** Unit tests cover the routing rule, the role gate and the walk stops. Integration tests on dev cover the SQL rules (A1 to A3, A6, A7), the functions over HTTP, and a two-connection race. One Playwright spec on dev covers A9 and a second covers the wheel. `failFirst` is empty in this commit because check:brief cannot run a test that is not written yet. Brief-only revisions add the tests that fail on the base once they exist, and each is listed in the report as a revision.

## Out of scope

- Measuring cartons or setting real capacities, and home-bin maximum editing (it exists).
- Loose-carton tracking: a barcode per unit of measure, open cartons, "cartons + packets" wording and open-first reservation. That is its own brief.
- Changing which bin the engine picks.
- Changing an existing home from the Walk. That stays in the home-bin editor.
- Any client tenant, and any data step on any tenant. This branch is migrated and deployed to dev only, and nothing is pushed or released without the owner.

## FINAL

<!--
Written LAST, by the author, before asking for the gate. One row per acceptance id.
Status is `claimed` (evidence required: a test name, a command and its result, a sha)
or `not-claimed` (say why in Note). Then at least one "Not claimed" item.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `<describe> > <it>` fails on base, passes on tip (check:brief) | |
| A2 | claimed | /version.json = <sha>, health 200 | |

### Not claimed

- <anything a reader might assume was verified but was not>
-->
