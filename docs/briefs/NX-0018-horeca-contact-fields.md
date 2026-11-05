# NX-0018 — Customer phone, ABN, billing email and brand buyers

```json brief
{
  "id": "NX-0018-horeca-contact-fields",
  "base": "137b73915da31b6a56e3343a1e8105b67bdb24f4",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "A customer row's phone, ABN, billing email and brand list reach the HoReCa type." },
    { "id": "A2", "check": "An ABN that is not 11 digits is refused; spaces are ignored." },
    { "id": "A3", "check": "Two customers can share a billing email, and no customer email is sent to it." },
    { "id": "A4", "check": "Merged and deployed to dev; the fields save and reload in the customer form.", "manual": "deploy:dev and a browser walk" },
    { "id": "A5", "check": "The customer form refuses a billing email, phone or contact name the server would refuse (`a@b`, a phone over 40 characters, a contact name over 100), using the rules in `_shared/horecaBody.ts`, with a message on the field and no request sent." },
    { "id": "A6", "check": "When saving a customer fails, the add and edit dialogs (customer list and customer profile) stay open with what was typed and show the reason; a failed save is never reported as a success." },
    { "id": "A7", "check": "A refused save carries the server's reason to the person, not the generic 'non-2xx status code' text." }
  ],
  "failFirst": [
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > maps the new contact fields from a row", "proves": ["A1"] },
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > rejects an ABN that is not 11 digits", "proves": ["A2"] },
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > allows two customers to share a billing email", "proves": ["A3"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer form validation > refuses a billing email of a@b on the field and sends nothing", "proves": ["A5"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer form validation > refuses a phone or contact name over its limit on its own field", "proves": ["A5"] },
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > has the form check and the server schema agree on the same values", "proves": ["A5"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer save failure > keeps the form open with what was typed and says why when the save fails", "proves": ["A6"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer save failure > keeps the edit dialog in the customer list open, then closes it once a save works", "proves": ["A6"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer save failure > keeps the add dialog in the customer list open when the save fails", "proves": ["A6"] },
    { "file": "__tests__/hoReCaCustomerSave.test.tsx", "test": "customer save failure > keeps the edit dialog on the customer profile open when the save fails", "proves": ["A6"] },
    { "file": "__tests__/horecaSaveMessage.test.ts", "test": "customer save errors > reports a failed save as a value and a good one as ok, and never rejects", "proves": ["A6"] },
    { "file": "__tests__/horecaSaveMessage.test.ts", "test": "customer save errors > carries the server's reason for a refused save, not the generic status text", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

Amadiya's customers need a phone and ABN on record, many share an email, and a brand's buyers must be identifiable.
Revised 2026-11-05: the client's list also gives a contact person for most customers, and nothing else stores it, so `contact_name` joins the other fields.
Revised again 2026-11-05, after the end-to-end run on dev (scenario S6): a billing email of `a@b` passes the browser's check, the server refuses it, and the customer dialog has already closed, so the person sees only "Edge Function returned a non-2xx status code" and loses what they typed. The form now checks email, phone and contact name itself with the shared rules (A5), a failed save keeps the dialog open (A6), and the reason reaches the person (A7).
`horeca_addresses.recipient_name` is not used for it: that is the recipient on one delivery address, not a contact for the customer.

## Approach

Migration `00138_horeca_contact_fields.sql` adds `phone`, `abn`, `billing_email` (not unique), `buys_brands` and a nullable `contact_name`. Changes to `mutate-horeca`, `types.ts`, `lib/adapters.ts` and `HoReCaForm`. Comment update in `config/environments.mjs`. Revision 2: `_shared/horecaBody.ts` also exports the pure rules the form uses, `HoReCaForm` validates with them and waits for the save, and every place the form is mounted (customer list add and edit, customer profile, the customer table) keeps its dialog open on a failed save. A save reports its outcome as a value (`lib/horecaSave.ts`), so the settings screens that also call `onUpdateHoReCa` cannot raise an unhandled rejection. The service throws the server's reason instead of the generic status text. The column is not named `email`, because `send-email:186` reads `horecas.email`.

## Out of scope

Loading customers, and any deploy to Amadiya.

## FINAL

The end-to-end run on dev on 2026-11-05 (a local build of `ffdf949` against dev, `mutate-horeca` v17, migration 00138 applied; report `e2e-today-report.md`) passed 11 scenarios and failed 1. The failure, S6, is a billing email of `a@b`: the browser accepted it, the server refused it, and the dialog had already closed, leaving "Edge Function returned a non-2xx status code" and no typing. A5, A6 and A7 cover that defect. The run's other findings concern the customer import script and the deploy tooling, not this change.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `horeca contact fields > maps the new contact fields from a row` fails on base by assertion (`toMatchObject` finds no phone, ABN, billingEmail, buysBrands or contactName), passes on tip (check:brief: proven). Form tests in `__tests__/hoReCaFormContactFields.test.tsx` fail without the form change, pass with it. Dev run: S1, S2, S3 and S10 save and reload every field | Extended to `contact_name` by the first revision. The write back is covered by `sends the contact fields to the server, and a blank one clears the column` |
| A2 | claimed | `horeca contact fields > rejects an ABN that is not 11 digits` fails on base, passes on tip (check:brief: proven). `ignores spaces in an ABN and stores it without them` and the form test `refuses an ABN that is not 11 digits, says why, and saves nothing` cover the spaces and the client message. Dev run S4: the form refused `123` and sent nothing; a direct post got 400 | Fails on base because `_shared/horecaBody` does not exist there, not by assertion. The assertion-level proof is A1's test. 11 digits only, no checksum |
| A3 | claimed | `horeca contact fields > allows two customers to share a billing email` fails on base, passes on tip (check:brief: proven). It parses two customers with one address and reads migration 00138 to confirm `billing_email` has no unique index and no column named `email`. Dev run S5: two customers saved with one address | "No customer email is sent to it" holds by naming: the column is `billing_email`, and `send-email` reads `horecas.email` and `contact_email` is untouched. No test drives `send-email` |
| A4 | not-claimed | Dev run: migration 00138 applied, `mutate-horeca` v17 deployed by the controller, and S1, S2, S3, S5, S8 to S10 and S12 passed in Chromium against dev (fields save and reload; a customer cannot read another's) | The check says merged and deployed. Not merged, and the browser walk used a local Vite on port 3003, not a `deploy:dev` bundle, at `ffdf949`, before the S6 fix. The fix has not been walked on dev |
| A5 | claimed | `customer form validation > refuses a billing email of a@b on the field and sends nothing`, `> refuses a phone or contact name over its limit on its own field` and `horeca contact fields > has the form check and the server schema agree on the same values` fail on base, pass on tip (check:brief: proven) | The form and the schema use one set of limits, messages and email and ABN predicates in `_shared/horecaBody.ts`; the parity test holds them to the same answer on 18 values. The billing email box is now `type="text"` so the browser's looser check and wording do not compete |
| A6 | claimed | `customer save failure > keeps the form open with what was typed and says why when the save fails`, `> keeps the edit dialog in the customer list open, then closes it once a save works`, `> keeps the add dialog in the customer list open when the save fails`, `> keeps the edit dialog on the customer profile open when the save fails` and `customer save errors > reports a failed save as a value and a good one as ok, and never rejects` fail on base, pass on tip (check:brief: proven) | Every place the form is mounted: list add and edit, profile edit, and the customer table (`HoReCaAdmin`, which nothing mounts today). The three AppShell handlers now return the outcome; that wiring is covered by the type-check and `settleHoReCaSave`, not by a test of AppShell |
| A7 | claimed | `customer save errors > carries the server's reason for a refused save, not the generic status text` fails on base, passes on tip (check:brief: proven) | A refused body reads "Invalid request body: Invalid email"; it still names no field, because the function is unchanged |

### Not claimed

- A4. The fix and the earlier work are not merged, and no `deploy:dev` bundle has been walked. S6 has not been re-run against the fixed form, so the fix is proven by unit and component tests only. Nothing was deployed by this change.
- AppShell's `reportHoReCaSave` and the `mutateAsync` wiring have no test of their own. A failed save gives two signals, the toast the app shell always raised and the message in the dialog; the Settings screens still get only the toast.
- A refused save from the server still does not say which field. The form catches the common cases first; a server-only rule would still read "Invalid request body: <reason>".
- The schema tests build `horecaBodySchema` with the client's `zod/v3` (zod 4.6.7 package), not the `esm.sh/zod@3.23.8` the function runs. Only `deno check` (`npm run check:edge-types`, clean on 84 functions) sees the function's own zod. The email pattern is a copy of zod 3.23's, held in one place; the server's refusal of `a@b` was observed on dev (S6).
- The ABN is checked for 11 digits only, not the ABN checksum, and the database has no CHECK on it, so a bulk load by the service role is not validated by this change.
- Phone, contact name, ABN, billing email and brands appear in the customer form only. They are not shown in the customer list, profile or insights views.
- The customer import script's findings from the same run (D2 the guard false-tripping on padded values, and F2 to F6) are in another repository and are not touched here.
- `npm test` at this tip: 377 files, 6115 passed, on `--maxWorkers=4`. Runs at the default worker count on this machine hit load timeouts in files this change does not touch, which pass alone. No timeout was raised.
