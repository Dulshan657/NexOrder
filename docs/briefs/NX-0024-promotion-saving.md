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
    { "id": "A4", "check": "The form and the server apply the same rules: a promotion with no real discount or missing products is refused, and the form stays open with its reason." },
    { "id": "A5", "check": "Deleting a promotion asks for confirmation first." },
    { "id": "A6", "check": "A promotion already used on orders can still be switched on or off, but cannot be otherwise edited or deleted." },
    { "id": "A9", "check": "Clearing a promotion's start date, end date or minimum order during an edit really clears it." },
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
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionForm > clearing an end date on an edit sends null", "proves": ["A9"] }
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
- `services/supabase/promotionDbService.ts`: uses `extractFunctionErrorMessage`.
- `PromotionForm` and `PromotionAdmin`:
  - the form checks the shared rules before sending
  - it closes only after the save succeeds
  - delete goes through a confirmation
  - the toggle sends only `is_active`
  - an emptied date or minimum order is sent as `null` on an edit (added during the work: it
    was sent as nothing, so the old value silently stayed, which working saves would expose)
- `hooks/queries/usePromotions.ts`: corrects a comment that is no longer true.
- `docs/claude/server-lockdown.md`: records the rules.

## Out of scope

- No migration: `promotions.id` stays text with no default, and existing ids do not change.
- The form's "Quantities are per" (unit or carton) setting: it is not stored and its check never
  runs. Reported separately.
- Supplier's Phone looking optional when the server requires it.
- Amadiya: it does not have the promotions module, so nothing is deployed there.

## FINAL
