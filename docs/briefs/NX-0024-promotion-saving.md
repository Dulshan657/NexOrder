# NX-0024 — promotions can be saved again

```json brief
{
  "id": "NX-0024-promotion-saving",
  "base": "fa9c14652a52f8cc2a245e04c57eb167d59707d8",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "Admin and Manager can create a promotion: the server sets its id and created_by itself, and ignores any sent by the client." },
    { "id": "A2", "check": "Admin and Manager can edit, switch on or off, and delete a promotion with a text id such as PROMO-001." },
    { "id": "A3", "check": "A refused promotion save shows the server's reason, not 'Edge Function returned a non-2xx status code'." },
    { "id": "A4", "check": "The form and the server apply the same rules: a promotion with no real discount, a bundle or free offer with no products, or a scope or audience with nothing chosen is refused, and the form stays open with its reason." },
    { "id": "A5", "check": "Deleting a promotion asks for confirmation first." },
    { "id": "A6", "check": "A promotion an order records as used can still be switched on or off, but cannot be otherwise edited or deleted. Orders record bundle promotions only, so this protects bundles only, by owner decision; the other four types can be edited or deleted after use, until a follow-up records them." },
    { "id": "A9", "check": "Clearing a promotion's start date, end date or minimum order during an edit really clears it." },
    { "id": "A10", "check": "While a save is in flight the form cannot be cancelled, and a refusal is scrolled into view." },
    { "id": "A7", "check": "The whole cycle works in a browser.", "manual": "As Admin and as Manager on dev: create, edit, toggle and delete clearly named test promotions set to start in 2099, each confirmed after a reload and removed afterwards. Results named in FINAL." },
    { "id": "A8", "check": "Merged, with mutate-promotion and the app deployed to dev in that order; /version.json shows the sha serving it.", "manual": "deploy-functions and deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > the server sets id and created_by itself", "proves": ["A1"] },
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > the function no longer requires a UUID id", "proves": ["A2"] },
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > a refused save reports the server's reason", "proves": ["A3"] },
    { "file": "__tests__/promotionBody.test.ts", "test": "promotion rules > the form and the server agree on what is a valid promotion", "proves": ["A4"] },
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > the form stays open when a save is refused", "proves": ["A4"] },
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > delete asks first", "proves": ["A5"] },
    { "file": "__tests__/promotionBody.test.ts", "test": "promotion rules > only an on or off change is allowed on a promotion used on orders", "proves": ["A6"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionForm > clearing an end date on an edit sends null", "proves": ["A9"] },
    { "file": "__tests__/promotionBody.test.ts", "test": "promotion rules > a scope or audience with nothing chosen is refused", "proves": ["A4"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionForm > cannot be cancelled while a save is in flight", "proves": ["A10"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionForm > a bundle takes its scope from its products, whatever a hidden control was left on", "proves": ["A4"] },
    { "file": "__tests__/promotionBody.test.ts", "test": "promotion rules > a stored offer must hold real ids and whole quantities", "proves": ["A4"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionAdmin > delete does nothing until confirmed", "proves": ["A5"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionAdmin > the toggle sends only is_active", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

Since the lockdown of 2026-04-29, nobody can create, edit, switch or delete a promotion from
the app. This makes the page work for Admins and Managers.

## Approach

- `supabase/functions/_shared/promotionBody.ts` (new): the request schema and rules, built the
  way `horecaBody.ts` is, so the function and the form share them and they can be unit-tested.
- `mutate-promotion`:
  - create takes `id` from `crypto.randomUUID()` and `created_by` from the logged-in user
  - `created_by` is dropped from what clients may send
  - edit and delete accept the existing text ids
  - a change to `is_active` alone skips the used-on-orders check
  - the start and end date refusal is reworded in plain language
- `services/supabase/promotionDbService.ts`: uses `extractFunctionErrorMessage`.
- `PromotionForm` and `PromotionAdmin`:
  - the form checks the shared rules before sending, including percentage and clearance
    limits that match the form's own (1 to 100, and 1 to 90), a whole-number priority, and a
    scope or audience with nothing chosen (added after the gate)
  - it closes only after the save succeeds, cannot be cancelled while saving, and scrolls a
    refusal into view (added after the gate)
  - delete goes through a confirmation
  - the toggle sends only `is_active`
  - a bundle or buy-one-get-one always takes its scope from its own products, because the scope
    control is hidden for those types (added after the second gate: a valid one could be refused
    over the hidden control, and a hidden category could change what it applied to)
  - an emptied date or minimum order is sent as `null` on an edit (added during the work: it
    was sent as nothing, so the old value silently stayed, which working saves would expose)
- `hooks/queries/usePromotions.ts`: corrects a comment that is no longer true.
- `docs/claude/server-lockdown.md`: records the rules.

## Out of scope

- No migration: `promotions.id` stays text with no default, and existing ids do not change.
- The form's "Quantities are per" (unit or carton) setting: it is not stored and its check never
  runs. Reported separately.
- Supplier's Phone looking optional when the server requires it.
- Recording every applied promotion on new orders, and so freezing the other four types and
  correcting ROI: by owner decision a separate brief. The gate found `place-order` records
  bundles only, and that ROI reads a key `place-order` does not write.
- A promotion's minimum order value: stored and cleared here, but no pricing code reads it.
- Dev's PROMO-006 has `targeting.kind` 'hoReCas' where the code expects 'horecas', so an edit of
  it resets its audience to all customers. It already prices for everyone. Reported separately.
- Amadiya: it does not have the promotions module, so nothing is deployed there.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `promotion saving > the server sets id and created_by itself` fails on base by assertion, passes on tip. `promotion rules > a create needs no id or created_by, and drops any a client sends` passes on tip. On dev as Admin and Manager: create returned 201 and the row survived a reload. In the audit log each create has `created_by` equal to the acting user, one Admin and one Manager | |
| A2 | claimed | `promotion saving > the function no longer requires a UUID id` fails on base by assertion, passes on tip. On dev as Admin and Manager, on a row seeded with a text id (`PROMO-NX0024-A`, `-M`): toggle, edit and delete each returned 200, confirmed after a reload | The six real promotions were not changed |
| A3 | claimed | `promotion saving > a refused save reports the server's reason` fails on base by assertion, passes on tip. On dev at c71763f as Manager, a start date after the end date: server 400, and the form showed "The start date must be on or before the end date." with the typed name kept | A request the schema itself refuses still reads "Invalid request body", but the form's rules now stop the known route to one |
| A4 | claimed | `promotion rules > the form and the server agree on what is a valid promotion`, `promotion rules > a scope or audience with nothing chosen is refused` and `promotion saving > the form stays open when a save is refused` fail on base, and pass on tip. `PromotionForm > stays open and shows the reason when the server refuses` passes on tip. On dev at c71763f as Admin and Manager, an empty discount showed "Enter a discount between 1% and 100%.", sent nothing, and left the form open. The six real dev promotions all pass the rule | The scope and audience refusals were tested in code, not clicked in a browser. A fixed price on the default storewide scope is allowed, and applies to every product |
| A5 | claimed | `promotion saving > delete asks first` and `PromotionAdmin > delete does nothing until confirmed` fail on base, pass on tip. On dev at c71763f as Admin and Manager: the dialog offers Cancel and Delete, Cancel kept the row, Delete removed it | |
| A6 | claimed | `promotion rules > only an on or off change is allowed on a promotion used on orders` and `PromotionAdmin > the toggle sends only is_active` fail on base, pass on tip. `promotion saving > the used-on-orders check is skipped only for an on or off change, and never for a delete` passes on tip | Bundles only, by owner decision: `place-order` records nothing else, so the other four types can be edited or deleted after use. Tests only: no dev order records a bundle, so a frozen promotion was never toggled or refused on a real server |
| A7 | claimed | On dev at c71763f, with the same code in `mutate-promotion` deployed, as Admin and as Manager: create 201, edit 200, toggle off and on 200 each, delete 200, each confirmed after a reload, on promotions set to start in 2099. Clearing an end date on the edit took the row from "1 Jan – 1 Feb" to "1 Jan" | Percentage type only. Dev is back to its original 6 promotions, and 0 test rows are left |
| A8 | not-claimed | | `mutate-promotion` is deployed to dev, and dev serves c71763fbfe17908827e39816e2294325f2e39874, but that is a throwaway merge so the unmerged demo work stays on dev, and this is before the merge. Not pushed. The deploy-functions script could not do it: the Supabase CLI refuses a hosted change in agent mode without `--yes`. The owner approved `--yes` for this function on dev for this PR, and a small script resolving the target the same way ran it |
| A9 | claimed | `PromotionForm > clearing an end date on an edit sends null` fails on base, passes on tip, and follows the value through `fromPromotion`. Seen on dev in A7 | Clearing a start date or minimum order uses the same code but was not tried in a browser |
| A10 | claimed | `PromotionForm > cannot be cancelled while a save is in flight` fails on base by assertion, passes on tip | The scroll into view could not be tested: jsdom has no layout, and it was not measured in a browser |

Changed after the first gate returned NO-GO: A6 and the docs were narrowed to bundles by owner decision, and A4 and A10 were added or widened. Added during the work: `eslint-suppressions.json` loses PromotionAdmin's one entry through `npm run lint:prune`, because the delete button now has a label.

### Not claimed

- New promotions go live on save, as the form has always defaulted. This restores that for Admins and Managers. Every test promotion here started in 2099, so no real price changed.
- Only the percentage type was saved in a browser. Fixed price, clearance, buy-one-get-one and bundle were covered by the rules test, not by a save.
- Scope and targeting other than storewide and all customers were not tried.
- No customer order was priced against a promotion created this way.
- The form's "Quantities are per" setting is still not stored, and its carton check never runs.
- Promotion ids created now are UUIDs, while the older ones stay `PROMO-001` style. Both work, and nothing reads their shape.
- Only 1280px was walked. No phone or tablet width, and no RS35.
- Test rows `PROMO-NX0024-A` and `-M` were inserted by SQL on dev, then deleted through the screen. Their saves, and those of the two created promotions, remain in dev's audit log. The first attempt, before the function was deployed, sent one refused create.
- A form-side date check was not added, so a start date after the end date is caught by the server only.
- A promotion's minimum order is stored but no pricing code reads it. ROI reads a key `place-order` does not write, so it counts no real order. Neither is changed here.
- Editing dev's PROMO-006 resets its audience to all customers, because it carries an older 'hoReCas' kind. It already prices for everyone. The six real promotions were not edited.
- If the page is left and a save is still running, its outcome is not shown. Only the form's own Cancel and close are blocked.
- `--project=mobile` and `--project=contrast` were not run: the only new layout is a message inside the form and a confirmation dialog from `components/ui`.
- One full-suite run failed `receiveMixedPallet`, a listed flake, which passed alone (10 passed). The final run passed all 6,169.
- The logins used the demo accounts the dev login page publishes.
