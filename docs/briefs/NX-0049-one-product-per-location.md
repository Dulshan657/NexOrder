# NX-0049 — One product per location at putaway, and a switch to ignore capacity

```json brief
{
  "id": "NX-0049-one-product-per-location",
  "base": "455cfd74393c109ff36a6610280203b803eec499",
  "approved": "2026-11-27 owner: \"go\"",
  "acceptance": [
    { "id": "A1", "check": "locationMixRefusal(product, bin, occupants) allows a putaway when the bin holds nothing, holds only this product, or is this product's home and every other product in it is homed there and has the same non-blank brand; otherwise it refuses with '{BIN} already holds {SKU} ({name}). Put this in an empty location or its home {HOME}.' (or '...in an empty location.' when the product has no home). A blank brand never matches. Stock on the same plate as the line being placed, and open putaway lines of other products already assigned to the bin, count as occupants (the plate's own lines do not)." },
    { "id": "A2", "check": "wie_home_block refuses a putaway that the location rule refuses, with the same words, in every putaway transaction that already calls it (complete, complete many, assign, redirect, decide, confirm overflow). A hold-zone bin is never refused by the location rule. When the home rule also refuses, the home rule's words are shown (it is checked first).", "manual": "npm run test:integration -- locationMix on dev (migration 00151 live RPCs, made-up warehouse and products)" },
    { "id": "A3", "check": "The planner never offers a bin the location rule would refuse: wie_putaway_candidates leaves out bins holding, or assigned to, another product unless the shared-home exception applies, so recommend-putaway and the receive card never send a line to a bin the walker cannot use.", "manual": "npm run test:integration -- locationMix (recommend-putaway over HTTP with a no-home product and a bin holding another product) on dev" },
    { "id": "A4", "check": "On the Walk, scanning a location the server would refuse (location rule or home rule) shows the refusal at the location scan, before the count step, and the stop stays on 'Scan the location'." },
    { "id": "A5", "check": "With app_settings.putaway_ignore_capacity on: the home rule never treats a home as full (capacity or max_qty), the home-first planner sends the whole line home, the planner does not refuse or split a bin for slots or pallet positions, home-bin health never reports a home as full, and no 'Home full — put in {BIN}?' overflow stop is created. Weight limits still apply." },
    { "id": "A6", "check": "putaway_ignore_capacity defaults to off; with it off every existing capacity and overflow behaviour (NX-0032/NX-0033 tests) is unchanged. An Admin can switch it on or off in Replenishment setup; other roles cannot (mutate-app-settings refuses).", "manual": "existing homeBinEnforced, putawayStraightToWalk and putawayHomeFirst integration suites green on dev with the flag off; the toggle in a browser on dev as Admin and as Manager" },
    { "id": "A7", "check": "End to end on dev in a browser with made-up products only: a no-home product's stop scanned at a bin holding another brand's stock is refused at the scan; scanning an empty bin completes; two same-brand products homed in one bin both complete into it; with the flag on, a line larger than its home's capacity goes home in full with no confirm stop.", "manual": "npx playwright test tests/e2e/rack-levels/location-mix.spec.ts --project=mobile against dev" },
    { "id": "A8", "check": "Migration applied and changed functions deployed to dev; /version.json on dev shows the merge sha.", "manual": "npm run migrate:dev; Supabase CLI deploy of the functions that bundle a changed shared module, with the owner's consent; deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/wie/locationMix.test.ts", "test": "locationMixRefusal > refuses a bin holding another product", "proves": ["A1"] },
    { "file": "__tests__/wie/locationMix.test.ts", "test": "locationMixRefusal > allows an empty bin and a bin holding only this product", "proves": ["A1"] },
    { "file": "__tests__/wie/locationMix.test.ts", "test": "locationMixRefusal > allows a shared home of same-brand homed products", "proves": ["A1"] },
    { "file": "__tests__/wie/locationMix.test.ts", "test": "locationMixRefusal > a blank brand never matches", "proves": ["A1"] },
    { "file": "__tests__/wie/locationMix.test.ts", "test": "locationMixRefusal > another product's open line assigned to the bin counts, the plate's own lines do not", "proves": ["A1"] },
    { "file": "__tests__/wie/homeFirst.test.ts", "test": "homeHeadroom > ignoring capacity, a home is never full", "proves": ["A5"] },
    { "file": "__tests__/wie/putawayTasks.test.ts", "test": "generatePutawayTasks > ignoring capacity, a line bigger than its home goes home in full with no overflow", "proves": ["A5"] },
    { "file": "__tests__/wie/homeBinHealth.test.ts", "test": "isFull > ignoring capacity, nothing is full", "proves": ["A5"] },
    { "file": "__tests__/putawayStopCardLocationRefusal.test.tsx", "test": "PutawayStopCard > a refused location is shown at the scan and the count step is not reached", "proves": ["A4"] },
    { "file": "__tests__/mutateAppSettings.test.ts", "test": "mutate-app-settings schema > accepts putaway_ignore_capacity as a boolean", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

Amadiya's owner wants a simple floor rule for now: **one product per location**. The only exception is a shared McCurrie home, where all the products are the same brand and homed there. They also want **space treated as unlimited**, so a homed product always goes home and nothing overflows.

Today:
- Nothing checks what is already in a bin.
- Home capacity can push a line to overflow.
- The home rule's refusal only appears after "Confirm" on the Walk.

## Approach

- **Pure rule:** `supabase/functions/_shared/wie/locationMix.ts`, with `locationMixRefusal`. The tests cover the full matrix.
- **SQL:** migration `00151_location_mix_and_ignore_capacity.sql`.
  - Adds `app_settings.putaway_ignore_capacity BOOLEAN NOT NULL DEFAULT false`.
  - Adds `wie_location_mix_block(p_rec_id, p_to_location_id)`, which reads `inventory_balances` and open `wie_putaway_recommendations` for the bin.
  - Re-creates `wie_home_block` from the live definition (keeping the 00147 wording):
    - hold-zone exempt first, then the existing home steps;
    - step 6 is skipped when the flag is on;
    - when the home rule allows, the location rule is checked.
  - `wie_putaway_candidates` gains the same exclusion.
- **Planner (TS):** the flag is read once in `putawayTasks.ts` (`app_settings`). It is threaded into:
  - `homeHeadroom` / `planHomeFirst` (`homeFirst.ts`),
  - the home-only `planPutaway` re-plan,
  - scoring `capacityMode`, where slot and pallet limits are off and weight is kept,
  - `isFull` (`homeBinHealth.ts`).
- **Walk card:**
  - New edge function `check-putaway-location` (GET, `rec_id` + `location_id`). It runs `wie_home_block` read-only and returns `{ refusal }`.
  - `PutawayStopCard.onBinScan` calls it before moving to the count step. The client-side home check stays as the fast path.
- **Settings:** `mutate-app-settings` zod schema gains the flag (Admin only). A toggle goes in Replenishment setup: "Ignore location capacity (treat space as unlimited)".
- **Help:** update the putaway quick guide text for the new refusal.

## Out of scope

- **Stock moves outside putaway are not checked.** Transfers, quarantine release, stocktake/count, adjustments, replenishment, off-home tasks and reslotting still go through. Putaway is where the floor places received stock.
- **Weight limits are not lifted.**
- **No per-level slots, and no re-homing.**
- **"Not this product?"** (wrong label/barcode) is NX-0050, a separate brief.
- **The live Amadiya release and switching the flag on there** happen after merge, as owner actions.

## FINAL
