# NX-0050 — "Not this product?": a mislabelled carton is recorded as what it really is, and held

```json brief
{
  "id": "NX-0050-not-this-product",
  "base": "1a3416bb2bba969166d2f61c140a12993c1e486f",
  "approved": "2026-11-27 owner: \"go\"",
  "acceptance": [
    { "id": "A1", "check": "On the receive screen, each staged line offers 'Not this product?'. Choosing the real product from the product search swaps the line to it, ticks 'Hold this line back' and marks the line as a label mismatch, showing 'Label says {SKU} — recorded as {real SKU}, held'. The quantity is re-entered in the real product's units. 'Undo' puts the line back as it was." },
    { "id": "A2", "check": "receive-stock accepts a line's label_mismatch { scanned_code, label_product_id }. The line is received as the real product, held (quarantine: its putaway goes to a hold location), and one label_mismatches row is written with the scanned code, the label product, the real product, the quantity, the user, the receipt and status 'open'. A label_product_id equal to the line's product is refused with INVALID_INPUT.", "manual": "npm run test:integration -- labelMismatch (receive-stock over HTTP, made-up products) on dev" },
    { "id": "A3", "check": "On a putaway Walk stop, 'Not this product?' asks for the real product and how many there are, then report-wrong-product, in ONE transaction: takes the task's quantity of the label product off the warehouse root (on its plate when it has one), adds the counted quantity of the real product there held, closes the task as written_off, plans a held putaway task for the real product to a hold location, and writes one label_mismatches row. The stop leaves the Walk; the held line appears on it. A mixed plate is refused: 'Break this pallet down first.'", "manual": "npm run test:integration -- labelMismatch (wie_report_wrong_product_tx rollback-isolated, and report-wrong-product over HTTP) on dev" },
    { "id": "A4", "check": "report-wrong-product allows Admin, Manager and Warehouse (Warehouse only at their own warehouse), refuses a task that is not open with CONFLICT, the same product with INVALID_INPUT, and a quantity that is not a positive whole number with INVALID_INPUT." },
    { "id": "A5", "check": "Every new mismatch raises a notification to Admin and Manager: 'Label mismatch: {scanned code} scanned as {label SKU}, but the carton was {real SKU}. Check the barcode.' Opening it shows the product to fix. The mismatch can be marked resolved by an Admin or Manager.", "manual": "npm run test:integration -- labelMismatch on dev; the bell in a browser" },
    { "id": "A6", "check": "label_mismatches has RLS: Admin and Manager may read and resolve; Warehouse may read rows they reported; nobody writes except through the functions (service role). check:grants passes.", "manual": "npm run check:grants:dev after migrate:dev" },
    { "id": "A7", "check": "Migration applied and changed functions deployed to dev.", "manual": "npm run migrate:dev; Supabase CLI deploy of report-wrong-product, receive-stock and the functions bundling a changed shared module, with the owner's consent" }
  ],
  "failFirst": [
    { "file": "__tests__/labelMismatch.test.ts", "test": "planWrongProduct > takes the label product off and puts the real product on, at the warehouse root", "proves": ["A3"] },
    { "file": "__tests__/labelMismatch.test.ts", "test": "planWrongProduct > refuses the same product, a non-whole or non-positive quantity, and a mixed plate", "proves": ["A3", "A4"] },
    { "file": "__tests__/labelMismatch.test.ts", "test": "mismatchNotice > names the scanned code, both products and what to do", "proves": ["A5"] },
    { "file": "__tests__/receiveLineWrongProduct.test.tsx", "test": "ReceiveLineCard > Not this product? swaps the line to the chosen product, holds it and says so", "proves": ["A1"] },
    { "file": "__tests__/receiveLineWrongProduct.test.tsx", "test": "ReceiveLineCard > Undo puts the line back as it was", "proves": ["A1"] },
    { "file": "__tests__/putawayStopCardWrongProduct.test.tsx", "test": "PutawayStopCard > Not this product? reports the real product and the counted quantity", "proves": ["A3"] }
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
  - Notifications: a `label_mismatch` item in `NotificationCenter` that links to the product, plus "Mark resolved".
- **Help:** a "The carton isn't what the label says" row on the "Something went wrong" page.

## Out of scope

- No barcode is changed automatically. The desk fixes it in the product form after checking.
- Picking, stocktake and transfers are untouched.
- Mixed plates on the Walk are refused, so they have to be broken down first.
- No new screen listing mismatches beyond the notification.
- The Amadiya release is a separate owner step after merge.

## FINAL
