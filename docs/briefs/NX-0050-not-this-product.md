# NX-0050 — "Not this product?": a mislabelled carton is recorded as what it really is, and held

```json brief
{
  "id": "NX-0050-not-this-product",
  "base": "1a3416bb2bba969166d2f61c140a12993c1e486f",
  "approved": "2026-11-27 owner: \"go\"",
  "acceptance": [
    {
      "id": "A1",
      "check": "On the receive screen, each staged line offers 'Not this product?'. Choosing the real product from the product search swaps the line to it, ticks 'Hold this line back' and marks the line as a label mismatch, showing 'Label says {SKU} — recorded as {real SKU}, held'. The quantity is re-entered in the real product's units. 'Undo' puts the line back as it was."
    },
    {
      "id": "A2",
      "check": "receive-stock accepts a line's label_mismatch { scanned_code, label_product_id }. The line is received as the real product, held (quarantine: its putaway goes to a hold location), and one label_mismatches row is written with the scanned code, the label product, the real product, the quantity, the user, the receipt and status 'open'. A label_product_id equal to the line's product is refused with INVALID_INPUT.",
      "manual": "npm run test:integration -- labelMismatch (receive-stock over HTTP, made-up products) on dev"
    },
    {
      "id": "A3",
      "check": "On a putaway Walk stop, 'Not this product?' asks for the real product and how many there are. report-wrong-product first checks, as a dry run, that a hold location can take the real product (else CONFLICT 'No hold location can take this. Ask the desk.' and nothing is written), then in ONE transaction closes every open task of the label product on that plate as written_off, takes their total of the label product off the warehouse root batch by batch (CONFLICT 'That stock has been moved or reserved. Ask the desk.' if it is not all there), adds the counted quantity of the real product there, and writes one label_mismatches row; then plans a held putaway task for the real product. If that last plan fails, the answer, the toast and the notice all say it is NOT yet held. A mixed plate is refused: 'Break this pallet down first.'",
      "manual": "npm run test:integration -- labelMismatch (wie_report_wrong_product_tx rollback-isolated, and report-wrong-product over HTTP) on dev"
    },
    {
      "id": "A4",
      "check": "report-wrong-product allows Admin, Manager and Warehouse (Warehouse only at their own warehouse), refuses a task that is not open with CONFLICT, the same product with INVALID_INPUT, and a quantity that is not a positive whole number with INVALID_INPUT."
    },
    {
      "id": "A5",
      "check": "Every new mismatch raises a notification to Admin and Manager: 'Label mismatch: {scanned code} scanned as {label SKU}, but the carton was {real SKU}. Check the barcode.' Reading it does not resolve it; a separate 'Mark resolved' (Admin or Manager) does, and stays offered until the resolve succeeds.",
      "manual": "npm run test:integration -- labelMismatch on dev; the bell in a browser"
    },
    {
      "id": "A6",
      "check": "label_mismatches has RLS: Admin and Manager may read every row; any user may read the rows they reported; nobody writes except through the functions (service role). It is listed in config/lockedTables.mjs and check:grants passes.",
      "manual": "npm run check:grants:dev after migrate:dev"
    },
    {
      "id": "A7",
      "check": "Migration applied and changed functions deployed to dev.",
      "manual": "npm run migrate:dev; Supabase CLI deploy of report-wrong-product, receive-stock and the functions bundling a changed shared module, with the owner's consent"
    }
  ],
  "failFirst": [
    {
      "file": "__tests__/labelMismatch.test.ts",
      "test": "planWrongProduct > takes the label product off and puts the real product on, at the warehouse root",
      "proves": [
        "A3"
      ]
    },
    {
      "file": "__tests__/labelMismatch.test.ts",
      "test": "planWrongProduct > refuses the same product, a non-whole or non-positive quantity, and a mixed plate",
      "proves": [
        "A3",
        "A4"
      ]
    },
    {
      "file": "__tests__/labelMismatch.test.ts",
      "test": "mismatchNotice > names the scanned code, both products and what to do",
      "proves": [
        "A5"
      ]
    },
    {
      "file": "__tests__/receiveLineWrongProduct.test.tsx",
      "test": "ReceiveLineCard > Not this product? swaps the line to the chosen product, holds it and says so",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/receiveLineWrongProduct.test.tsx",
      "test": "ReceiveLineCard > Undo puts the line back as it was",
      "proves": [
        "A1"
      ]
    },
    {
      "file": "__tests__/putawayStopCardWrongProduct.test.tsx",
      "test": "PutawayStopCard > Not this product? reports the real product and the counted quantity",
      "proves": [
        "A3"
      ]
    }
  ],
  "allow": []
}
```

## Goal

A carton whose label (barcode) says one product but holds another — say a chilli powder label on a Goraka pack — is accepted today as the label product. The owner (2026-11-27) wants the worker to be able to say so where they stand: record the stock as what it really is, hold it, and tell the desk to fix the barcode.

## Approach

- **Migration `00152_label_mismatches.sql`:**
  - table `label_mismatches`: id, scanned_code, label_product_id, real_product_id, quantity, warehouse_id, goods_receipt_id, putaway_rec_id, reported_by, status ('open' | 'resolved'), resolved_by, resolved_at, created_at, with RLS;
  - `wie_report_wrong_product_tx(rec, real_product, qty, scanned_code, actor)` does the Walk side in one transaction, using `inv_adjust_stock` the way `wie_resolve_short_putaway_tx` (00135) does;
  - service-role grants only.
- **Pure plan:** `_shared/labelMismatch.ts` holds `planWrongProduct` (checks and the two adjustment legs) and `mismatchNotice` (the words).
- **New edge function `report-wrong-product`.** It runs the transaction, then plans the held task with `generatePutawayTasks` (`quarantine: true`), then raises the notification.
- **receive-stock:** a line's optional `label_mismatch` makes the line held and writes the row plus the notification after the receipt.
- **UI:**
  - `ReceiveLineCard`: "Not this product?" opens the existing product search; the line is swapped and held, with "Undo".
  - `PutawayStopCard`: "Not this product?" opens a sheet with product search and quantity, then sends `report-wrong-product`.
  - Notifications: a `label_mismatch` notice in `NotificationCenter` naming both SKUs, with a separate "Mark resolved" button.
- **Help:** a "The carton isn't what the label says" row on the "Something went wrong" page.

## Out of scope

- No barcode is changed automatically. The desk fixes it in the product form after checking.
- Picking, stocktake and transfers are untouched.
- Mixed plates on the Walk are refused, so they have to be broken down first.
- No new screen listing mismatches beyond the notification.
- The Amadiya release is a separate owner step after merge.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `ReceiveLineCard > Not this product? swaps the line …` and `… Undo puts the line back as it was` proven; `stageProduct and a label-mismatch line (NX-0050) > a rescan of the real product starts a new line …` | Offered on loose lines and on mixed-pallet lines, searching the whole catalogue. The hold box is locked on a swapped line |
| A2 | not-claimed | receive-stock deployed to dev; refusal of a same, blank or unknown label product is in code | No over-HTTP receive test was run. To be shown on Amadiya in the scenario walk |
| A3 | claimed | `planWrongProduct > …` (2 tests) proven; `npm run test:integration -- labelMismatch` on dev 8/8: re-record at the root, the label barcode used when no code is sent, lot-received stock, split tasks on one plate closed together, stock gone gives CONFLICT and writes nothing, refusals | The dry-run hold check and the 'NOT yet held' path are in code, but no HTTP test drives them |
| A4 | claimed | Role list and Warehouse scoping in report-wrong-product (same check as complete-putaway); the refusals are in the integration suite | No HTTP test with a Warehouse user from another site |
| A5 | claimed | `mismatchNotice > names the scanned code, both products and what to do` proven; NotificationCenter shows Mark resolved as its own button | Not exercised in a browser |
| A6 | claimed | Integration: RLS on, only `authenticated:SELECT`, function service_role only; `npm run check:grants:dev`: "No new write grants. Every locked table is locked, or baselined." with label_mismatches in lockedTables | The per-row policies (own rows for Warehouse) are not exercised by a test |
| A7 | claimed | `npm run migrate:dev` applied 00152; report-wrong-product, resolve-label-mismatch and receive-stock deployed to dev | Dev frontend not redeployed |

### Not claimed

- Over-HTTP runs of report-wrong-product, resolve-label-mismatch and receive-stock with a label_mismatch: they move to the Amadiya scenario walk after release.
- A label's lot is not carried to the real product: the real product is recorded with no batch.
- The Walk sends no scanned code, so its record names the label product's own barcode (or SKU).
- A Warehouse user can record any real product and count. This is the same trust adjust-stock already gives, and it is audited.
