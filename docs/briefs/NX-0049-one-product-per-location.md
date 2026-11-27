# NX-0049 — One product per location at putaway, and a switch to ignore capacity

```json brief
{
  "id": "NX-0049-one-product-per-location",
  "base": "455cfd74393c109ff36a6610280203b803eec499",
  "approved": "2026-11-27 owner: \"go\"",
  "acceptance": [
    {
      "id": "A1",
      "check": "locationMixRefusal(product, bin, occupants) allows a putaway when the bin holds nothing, holds only this product, or is this product's home and every other product in it is homed there and has the same non-blank brand; otherwise it refuses with '{BIN} already holds {SKU} ({name}). Put this in an empty location or its home {HOME}.' (or '...in an empty location.' when the product has no home, or the bin is its home). A blank brand never matches. Earlier open putaway lines of other products headed for the bin count as occupants, so two open lines never refuse each other; two products of one mixed pallet are two products and go to separate locations."
    },
    {
      "id": "A2",
      "check": "wie_home_block refuses a putaway that the location rule refuses, with the same words, in every putaway transaction that already calls it (complete, complete many, assign, redirect, decide, confirm overflow), and break-down-putaway refuses a portion into such a location. A hold-zone bin is never refused by the location rule. When the home rule also refuses, the home rule's words are shown (it is checked first). A home holding another product's stock does not hold the line to it.",
      "manual": "npm run test:integration -- locationMix on dev (migration 00151 live RPCs, made-up warehouse and products)"
    },
    {
      "id": "A3",
      "check": "The planner never offers a bin the location rule would refuse: generatePutawayTasks reads what is in every location of the warehouse once (wie_location_occupants, one JSONB value, before the first insert, failing closed) and leaves such bins out of the candidates, so recommend-putaway and the receive card never send a line to a bin the walker cannot use. A home left out this way sends its line straight to the Walk, not as a 'Home full' stop.",
      "manual": "npm run test:integration -- locationMix (recommend-putaway over HTTP with a no-home product and a bin holding another product) on dev"
    },
    {
      "id": "A4",
      "check": "On the Walk, scanning a location the server would refuse (location rule or home rule) shows the refusal at the location scan, before the count step, and the stop stays on 'Scan the location'."
    },
    {
      "id": "A5",
      "check": "With app_settings.putaway_ignore_capacity on: the home rule never treats a home as full (capacity or max_qty), the home-first planner sends the whole line home, the planner does not refuse or split a bin for slots or pallet positions, home-bin health never reports a home as full, and no 'Home full — put in {BIN}?' stop is created for capacity. Weight limits still apply: a line the planner sends to overflow because the home failed weight or another safety rule (or that predates the switch) can still be confirmed where it was sent."
    },
    {
      "id": "A6",
      "check": "putaway_ignore_capacity defaults to off; with it off every existing capacity and overflow behaviour (NX-0032/NX-0033 tests) is unchanged. An Admin can switch it on or off in Replenishment setup; other roles cannot (mutate-app-settings refuses).",
      "manual": "existing homeBinEnforced, putawayStraightToWalk and putawayHomeFirst integration suites green on dev with the flag off; the toggle in a browser on dev as Admin and as Manager"
    },
    {
      "id": "A7",
      "check": "End to end on dev in a browser with made-up products only: a no-home product's stop scanned at a bin holding another brand's stock is refused at the scan; scanning an empty bin completes; two same-brand products homed in one bin both complete into it; with the flag on, a line larger than its home's capacity goes home in full with no confirm stop.",
      "manual": "npx playwright test tests/e2e/rack-levels/location-mix.spec.ts --project=mobile against dev"
    },
    {
      "id": "A8",
      "check": "Migration applied and changed functions deployed to dev; /version.json on dev shows the merge sha.",
      "manual": "npm run migrate:dev; Supabase CLI deploy of the functions that bundle a changed shared module, with the owner's consent; deploy:dev verification"
    }
  ],
  "failFirst": [
    {
      "file": "__tests__/wie/locationMix.test.ts",
      "test": "locationMixRefusal > refuses a bin holding another product",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/wie/locationMix.test.ts",
      "test": "locationMixRefusal > allows an empty bin and a bin holding only this product",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/wie/locationMix.test.ts",
      "test": "locationMixRefusal > allows a shared home of same-brand homed products",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/wie/locationMix.test.ts",
      "test": "locationMixRefusal > a blank brand never matches",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/wie/locationMix.test.ts",
      "test": "locationMixRefusal > an open line of another product counts, also one on the same mixed plate",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/wie/homeFirst.test.ts",
      "test": "homeHeadroom > ignoring capacity, a home is never full",
      "proves": [
        "A5"
      ]
    },
    {
      "file": "__tests__/wie/putawayTasks.test.ts",
      "test": "generatePutawayTasks — capacity ignored (NX-0049) > ignoring capacity, a line bigger than its home goes home in full with no overflow",
      "proves": [
        "A5"
      ]
    },
    {
      "file": "__tests__/wie/homeBinHealth.test.ts",
      "test": "isFull > ignoring capacity, nothing is full",
      "proves": [
        "A5"
      ]
    },
    {
      "file": "__tests__/putawayStopCardLocationRefusal.test.tsx",
      "test": "PutawayStopCard > a refused location is shown at the scan and the count step is not reached",
      "proves": [
        "A4"
      ]
    },
    {
      "file": "__tests__/mutateAppSettings.test.ts",
      "test": "mutate-app-settings schema > accepts putaway_ignore_capacity as a boolean",
      "proves": [
        "A6"
      ]
    },
    {
      "file": "__tests__/putawayStopCardLocationRefusal.test.tsx",
      "test": "PutawayStopCard > a slow refusal for an earlier scan never lands after a later scan moved on",
      "proves": [
        "A4"
      ]
    }
  ],
  "allow": []
}
```

## Goal

Amadiya's owner wants a simple floor rule for now: **one product per location**. The only exception is a shared home, where all the products are the same brand and homed there. They also want **space treated as unlimited**, so a homed product always goes home and nothing overflows.

Today:
- Nothing checks what is already in a bin.
- Home capacity can push a line to overflow.
- The home rule's refusal only appears after "Confirm" on the Walk.

## Approach

- **Pure rule:** `supabase/functions/_shared/wie/locationMix.ts` holds `locationMixRefusal` and `brandKey`, tested over the full matrix.
- **SQL, migration `00151_location_mix_and_ignore_capacity.sql`:**
  - `app_settings.putaway_ignore_capacity BOOLEAN NOT NULL DEFAULT false`.
  - `wie_location_occupants(warehouse)` returns one JSONB array of stock and open lines for the planner.
  - `wie_location_mix_block(rec, bin)` is the SQL copy of the rule. Only earlier open lines count. `wie_brand_key` is the shared brand normalisation.
  - `wie_home_rule` is the live home rule (00146 body, 00147 wording) with two changes:
    - step 5b: a home holding another product's stock is unusable;
    - step 6: when the switch is on there is always room, except for a planner overflow line.
  - `wie_home_block` = `wie_home_rule`, then `wie_location_mix_block`. Its signature is unchanged, so every caller picks it up.
- **Planner (TS):** `putawayTasks.ts` reads the switch (`_shared/putawaySettings.ts`, failing closed) and the occupants (`_shared/locationContents.ts`) once per call.
  - Refused bins are left out of the candidates.
  - With the switch on, capacity slots are null and `homeHeadroom` / `planHomeFirst` get `ignoreCapacity`.
  - Home-bin health takes `ignoreCapacity` from its callers.
- **Walk card:**
  - New edge function `check-putaway-location` (GET `recommendationId` + `locationCode`). It only judges an active location in the line's warehouse.
  - `PutawayStopCard` takes an optional `checkLocation` and asks before the count step. A stale answer is dropped.
- **Break-down:** `break-down-putaway` asks `wie_location_mix_block` for each portion's location.
- **Settings:**
  - The `mutate-app-settings` schema moves to `_shared/appSettingsBody.ts` (testable) and gains the switch, which stays Admin only.
  - Replenishment setup gets a toggle: "Ignore location capacity (treat space as unlimited)".
- **Help:** the putaway quick guide and the "Something went wrong" page now cover the new refusal.

## Out of scope

- **Stock moves outside putaway are not checked.** Transfers, quarantine release, stocktake/count, adjustments, replenishment, off-home tasks and reslotting still go through. Putaway is where the floor places received stock.
- **Weight limits are not lifted.**
- **No per-level slots, and no re-homing.**
- **"Not this product?"** (wrong label/barcode) is NX-0050, a separate brief.
- **The live Amadiya release and switching the flag on there** happen after merge, as owner actions.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `locationMixRefusal > …` (5 named tests) proven by absence (new module); dev SQL copy agrees in `npm run test:integration -- locationMix` (13/13) | Revised after review: no same-plate exemption; only earlier open lines claim a location |
| A2 | claimed | `npm run test:integration -- locationMix` on dev, 00151 applied: complete, decide accept and assign refused with the same words; home rule first; hold bin exempt; stray-stock home not binding. break-down-putaway asks `wie_location_mix_block` per portion | break-down is covered in code, but no integration test drives it over HTTP |
| A3 | claimed | `generatePutawayTasks — one product per location (NX-0049) > …` (5 tests, incl. one read before the first insert and failing closed); `wie_location_occupants` returns one JSONB value (integration) | |
| A4 | claimed | `PutawayStopCard > a refused location is shown at the scan and the count step is not reached` and `… a slow refusal for an earlier scan never lands …` proven; `check-putaway-location` deployed to dev | |
| A5 | claimed | `homeHeadroom > ignoring capacity, a home is never full`, `isFull > ignoring capacity, nothing is full`, `generatePutawayTasks — capacity ignored (NX-0049) > …` proven; integration: full home with the switch on gives "Put this in its home location …", and an overflow line is still confirmable | |
| A6 | claimed | `mutate-app-settings schema > accepts putaway_ignore_capacity as a boolean` proven; integration: column default false; NX-0032/0033 suites green on dev with the switch off (homeBinEnforced 44/44, putawayStraightToWalk 42/42, putawayHomeFirst 11/11) | The toggle's Admin-only save was not exercised in a browser |
| A7 | not-claimed | `tests/e2e/rack-levels/location-mix.spec.ts` written; not run | No dev Admin E2E login on this machine. The owner chose to verify on Amadiya after release instead, with real products, as part of the scenario screenshots |
| A8 | claimed | `npm run migrate:dev` applied 00151; 12 functions deployed to dev (adjust-stock, break-down-putaway, check-putaway-location, complete-putaway, count-bin, explain-product-location, home-bin-choices, home-bin-health, mutate-app-settings, receive-stock, recommend-putaway, transfer-stock) | /version.json on dev is not claimed: the dev frontend was not redeployed from this branch |

### Not claimed

- The browser story (A7) and the Admin toggle in a browser: these move to the Amadiya walk after release.
- Stock moves outside putaway (transfer, quarantine release, stocktake, adjustment, replenishment, off-home, reslot) are not checked by the location rule, as scoped.
- With the switch on, operator rules that test `capacitySlots` see it as null (it reads as 0 in `rules.ts`), so a `capacitySlots lt N` rule matches every location. Amadiya has no wie_rules rows at all (read-only check, 2026-11-27); the behaviour with such a rule was not tested.
- `stockAdjust.integration` has one failure on dev ("rejects a blank reason …"). It is in `inv_adjust_stock`, which this change does not touch, so it was already failing on dev.
- Running the NX-0032 and NX-0033 integration files in parallel against one dev database can flip a few rollback-isolated cases, because their HTTP parts commit data. Run one at a time, they all pass.
