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

## Approach

Migration `00138_horeca_contact_fields.sql` adds `phone`, `abn`, `billing_email` (not unique) and `buys_brands`. Changes to `mutate-horeca`, `types.ts`, `lib/adapters.ts` and `HoReCaForm`. Comment update in `config/environments.mjs`. The column is not named `email`, because `send-email:186` reads `horecas.email`.

## Out of scope

Loading customers, and any deploy to Amadiya.

## FINAL
