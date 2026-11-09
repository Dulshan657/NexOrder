# NX-0032 — Putaway goes to the home bin, or is refused while the home has room

```json brief
{
  "id": "NX-0032-home-bin-enforced",
  "base": "81f03c956a02b1e2ece5f0c0b3073cf87f641370",
  "approved": "2026-11-09 owner, by standing go-ahead; text not yet read, owner to confirm before the PR",
  "acceptance": [
    { "id": "A1", "check": "While a product's home bin has room, putaway to any other bin is refused with code CONFLICT and the text `Put this in its home bin {code}; it still has room for {n}. If it is full, ask a manager to set its maximum.` ({n} is whole base units, rounded down). This holds at every entry: complete, complete-many, Place now, accept, override, assign and redirect. No role, reason or flag lifts it, and it comes before any prompt for a reason.", "manual": "npm run test:integration -- homeBinEnforced on dev, made-up data, with a case per entry including complete-many, plus the same refusal through complete-putaway and through decide-putaway over HTTP" },
    { "id": "A2", "check": "Putaway to another bin is allowed once the home is full, whether by capacity (a blank capacity means unlimited) or by `max_qty`. Room is counted in base units: with room for 5, a line of 12 sent elsewhere is refused naming 5, while 5 to the home and then 7 elsewhere is allowed.", "manual": "npm run test:integration -- homeBinEnforced on dev" },
    { "id": "A3", "check": "A task's own pending quantity does not count against its home's room: a task suggested to an empty home, completed into another bin, is refused and names the whole room.", "manual": "npm run test:integration -- homeBinEnforced on dev" },
    { "id": "A4", "check": "A plate that is a single-product pallet may go to another bin, and a line of a mixed pallet may not while the home has room.", "manual": "npm run test:integration -- homeBinEnforced on dev" },
    { "id": "A5", "check": "A home that putaway could not use does not block: it is inactive, in a hold zone, or on a level role outside the product's allowed roles. A product with no home is not held to a home.", "manual": "npm run test:integration -- homeBinEnforced on dev, with an inactive-home case, a hold-zone case and a level-role case" },
    { "id": "A6", "check": "When the home bin cannot be read, `generatePutawayTasks` creates no tasks and fails with `Home bin unavailable, try again.` (code INTERNAL), for the home lookup and for the home slot-usage read. A receipt stays booked with no tasks, and the receive screen shows the message with a Retry that re-runs `recommend-putaway`.", "manual": "unit tests in __tests__/wie/putawayTasks.test.ts (a failed home read and a failed slot-usage read create no tasks) and a receive-stock test that a failed home read keeps the receipt booked and returns putaway_error, named in failFirst by a brief-only revision once they exist (check:brief cannot run a test that is not written yet); the Retry is covered by the receive-stock test only and is not walked in the A8 browser run" },
    { "id": "A7", "check": "The home-bin health check reports each problem on a made-up home: inactive, hold_zone, not_pick_level, carton_not_allowed, level_role_not_allowed, not_on_layout, no_dock_route, zone_category, slotting_refused, full, other_warehouse. It reports none for a healthy home, and no `full` for a blank capacity. Admin and Manager see the problems in a panel on Replenishment setup, and `npm run check:home-bins -- --target <t>` prints one line per problem, exits 1 if there are any and 0 if none, and changes nothing.", "manual": "unit tests in __tests__/wie/homeBinHealth.test.ts, named in failFirst by a brief-only revision once they exist; npm run test:integration -- homeBinEnforced for the facts function; npm run check:home-bins -- --target dev run by hand" },
    { "id": "A8", "check": "End to end on dev in a browser, with made-up data the spec creates and removes: set a home and the health panel shows no problems; receive and the task suggests the home with source `home`; scanning another bin shows the home refusal with no override control; scanning the home completes; with the home full, the next receipt goes to overflow and another bin is accepted with a reason; deactivating the home makes the panel list it.", "manual": "npx playwright test tests/e2e/rack-levels/putaway-home-block.spec.ts against dev, trace and screenshots kept" },
    { "id": "A9", "check": "A bin that is another product's primary home is never offered to a product not homed there (including one with no home of its own), and completing into it is refused with `{code} is the home bin of {sku}; choose another bin.` Two products may share one home bin, and neither is refused it.", "manual": "npm run test:integration -- homeBinEnforced on dev, including a shared home and wie_putaway_candidates" }
  ],
  "failFirst": [],
  "allow": []
}
```

## Goal

Putaway can already suggest a product's home bin first (NX-0006), but nothing stops a worker putting it somewhere else. A wrong-bin putaway of a product with a known home is hard to find again and breaks the picking and replenishment that assume it is at home. For every product with a home bin, this makes putaway land at the home or be refused while the home still has room. Nobody can override it: no role, reason or flag lifts the block. When the home is physically full but its maximum is blank, the way out is data, and a manager sets that home's `max_qty` or capacity in Replenishment setup, after which overflow opens straight away. A failed read of the home bin now stops putaway instead of quietly treating the product as having no home. An admin can see every home that putaway cannot use.

## Approach

**The rule, once, in SQL.** Migration `00142_home_bin_enforced.sql` adds `wie_home_block(p_rec_id BIGINT, p_to_location_id INT) RETURNS TEXT`, `SECURITY DEFINER`, `search_path = public`, with `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE TO service_role`. It returns NULL when the target is allowed, and otherwise the refusal text. `wie_complete_putaway_tx`, `wie_complete_putaway_many_tx`, `wie_decide_putaway_tx`, `wie_assign_putaway_tx` and `wie_redirect_putaway_tx` call it before they move or record anything and raise `CONFLICT: <text>`. Signatures stay identical, so each function keeps one overload.

It decides in this order:
- a target that is the product's own home is allowed;
- a target that is another product's primary home is refused (A9);
- a single-product pallet is exempt, and a mixed pallet's lines are not (A4);
- a home that is inactive, in a hold zone, or on a level role the product cannot use does not block (A5);
- otherwise the room at the home is counted in base units, from capacity, `v_bin_fill`, `v_bin_pending_putaway` and `max_qty`, with the task's own pending added back when its target is the home (A3), and rounded down (A2);
- room above zero refuses with the text in A1.

A product with no home is not held to one. It is only refused another product's home, which is the one case where the rule bites a product without a home.

**Another product's home is not a candidate.** `wie_putaway_candidates` is redefined in the same migration, with the same signature, to leave out a bin that is another product's primary home, unless the product is also homed there.

**The edge functions refuse first.** `complete-putaway` and `decide-putaway` call `wie_home_block` through the service client before the role, level-role and reason checks, and throw `CONFLICT` with the text, so the floor sees the home message and not "say why". `_shared/putawayCompletion.ts` keeps its logic and gets a header comment saying so. The screens show the server text verbatim, with no override control, and the opening-stock import shows it per line. That import calls `decide-putaway` with decision `override` and `roleOverride: true`. `role_override` does not lift the home block, so the import is refused for a homed product while the home has room, like every other path, as intended.

**Home reads fail closed.** `_shared/putawayHome.ts` throws `INTERNAL` with `Home bin unavailable, try again.` on a failed read, and logs the warehouse, product and database error. `_shared/putawayTasks.ts` lets it propagate, so no tasks are created. `receive-stock` keeps the receipt booked and returns `putaway_error`. The receive screen shows it with a Retry that calls `recommend-putaway` for the receipt's lines.

**Health check.** The same migration adds `wie_home_bin_facts(p_warehouse_id INT)`, one row per primary home, with `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE TO service_role`. A pure `_shared/wie/homeBinHealth.ts` (added to the purity test) judges those rows and uses `homeHeadroom` for `full`, so the room maths is not copied. The `home-bin-health` function (GET, Admin and Manager, module-gated like `mutate-product-home-bin`) adds the slotting refusal per row and returns the rows with problems. `ReplenSetupView` shows them in a panel, and `scripts/check-home-bins.mjs` with a `check:home-bins` script prints them, read-only, for a target from `config/environments.mjs`. The release runbook's pre-release checklist gains that command.

**Proof.** Unit tests cover A6 and A7. Integration tests on dev cover the SQL rules (A1 to A5, A9) and the functions over HTTP. One Playwright spec on dev covers A8. `failFirst` is empty in this commit because check:brief cannot run a test that is not written yet. A brief-only revision adds the unit tests that fail on the base for A6 and A7 once they exist, and is listed in the report as a revision.

## Out of scope

- Loose-carton tracking: a barcode per unit of measure, open cartons, "cartons + packets" wording, open-first reservation, dockets and two-box counting. Each is its own brief.
- Setting any product's home bin, a bin's capacity or a home's maximum on any tenant. Those are admin data steps in the app, not code.
- An override or manager unlock for the block. There is none, by decision.
- Moving stock that is already in a wrong bin. The health check lists homes, not stock.
- Changing how the engine picks overflow bins, or the `short` and `make_home` rules from NX-0006.
- Any release to a client tenant. This branch is migrated and deployed to dev only, and nothing is pushed or released without the owner.

## FINAL

Written with the brief, before any code. Every acceptance id is not claimed yet and this is rewritten last.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | not-claimed | | No proving test yet |
| A2 | not-claimed | | No proving test yet |
| A3 | not-claimed | | No proving test yet |
| A4 | not-claimed | | No proving test yet |
| A5 | not-claimed | | No proving test yet |
| A6 | not-claimed | | No proving test yet |
| A7 | not-claimed | | No proving test yet |
| A8 | not-claimed | | No proving test yet |
| A9 | not-claimed | | No proving test yet |

### Not claimed

- Nothing is proven: no code or test exists on this branch yet, and every row above is a placeholder to be replaced when the work is done.
- `failFirst` is empty by necessity. Until a brief-only revision names the A6 and A7 unit tests, check:brief will refuse any commit that adds code.
