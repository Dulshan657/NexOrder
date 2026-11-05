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
    { "id": "A4", "check": "Merged and deployed to dev; the fields save and reload in the customer form.", "manual": "deploy:dev and a browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > maps the new contact fields from a row", "proves": ["A1"] },
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > rejects an ABN that is not 11 digits", "proves": ["A2"] },
    { "file": "__tests__/horecaContactFields.test.ts", "test": "horeca contact fields > allows two customers to share a billing email", "proves": ["A3"] }
  ],
  "allow": []
}
```

## Goal

Amadiya's customers need a phone and ABN on record, many share an email, and a brand's buyers must be identifiable.
Revised 2026-11-05: the client's list also gives a contact person for most customers, and nothing else stores it, so `contact_name` joins the other fields.
`horeca_addresses.recipient_name` is not used for it: that is the recipient on one delivery address, not a contact for the customer.

## Approach

Migration `00138_horeca_contact_fields.sql` adds `phone`, `abn`, `billing_email` (not unique), `buys_brands` and a nullable `contact_name`. Changes to `mutate-horeca`, `types.ts`, `lib/adapters.ts` and `HoReCaForm`. Comment update in `config/environments.mjs`. The column is not named `email`, because `send-email:186` reads `horecas.email`.

## Out of scope

Loading customers, and any deploy to Amadiya.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `horeca contact fields > maps the new contact fields from a row` fails on base by assertion (`toMatchObject` finds no phone, ABN, billingEmail, buysBrands or contactName), passes on tip (check:brief: proven). Form tests in `__tests__/hoReCaFormContactFields.test.tsx` fail without the form change, pass with it | Extended to `contact_name` by the 2026-11-05 revision. Row to type is proved; the write back is covered by `sends the contact fields to the server, and a blank one clears the column` |
| A2 | claimed | `horeca contact fields > rejects an ABN that is not 11 digits` fails on base, passes on tip (check:brief: proven). `ignores spaces in an ABN and stores it without them` and the form test `refuses an ABN that is not 11 digits, says why, and saves nothing` cover the spaces and the client message | Fails on base because `_shared/horecaBody` does not exist there, not by assertion. The assertion-level proof is A1's test. 11 digits only, no checksum |
| A3 | claimed | `horeca contact fields > allows two customers to share a billing email` fails on base, passes on tip (check:brief: proven). It parses two customers with one address and reads migration 00138 to confirm `billing_email` has no unique index and no column named `email` | "No customer email is sent to it" holds by naming: the column is `billing_email`, and `send-email` reads `horecas.email` and `contact_email` is untouched. No test drives `send-email` |
| A4 | not-claimed | | Not merged or deployed to dev, and no browser walk. By instruction: no `migrate:*`, no `deploy:*`, nothing run against a database. 00138 has never run |

### Not claimed

- A4. The migration has not been applied anywhere, the Edge Function and bundle are not deployed, and the fields have not been saved and reloaded in a browser. Nothing in this change was exercised against a database, so the SQL has only been read.
- The schema tests build `horecaBodySchema` with the client's `zod/v3` (zod 4.6.7 package), not the `esm.sh/zod@3.23.8` the function runs. Only `deno check` (`npm run check:edge-types`, clean on 84 functions) sees the function's own zod.
- The ABN is checked for 11 digits only, not the ABN checksum, and the database has no CHECK on it, so a bulk load by the service role is not validated by this change.
- Phone, contact name, ABN, billing email and brands appear in the customer form only. They are not shown in the customer list, profile or insights views.
- Full `npm test` was not green in one clean pass. First run, default workers: 5 failures and 32 worker-start timeouts under load, all in files this change does not touch; each passed when re-run alone. Second run, `--maxWorkers=4`: 6102 passed, 1 failed (`receiveMixedPallet > never names a plate_key it did not declare`, a 5000ms timeout), which passes alone (10/10). No timeout was raised.
