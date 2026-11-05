# NX-0031 — Import PO: upload QuickBooks invoices into the Pick Queue

```json brief
{
  "id": "NX-0031-import-po",
  "base": "02ee452557d0096d74e1ada44def387a33b0180a",
  "approved": "2026-11-06 owner",
  "acceptance": [
    { "id": "A1", "check": "The parser turns a file with the six named columns into invoice lines, handling a byte order mark, quoted commas, `$1,234.50`, `DD/MM/YYYY` and `YYYY-MM-DD`. A missing column is refused by name, and a bad row is reported by row number, never shifted into another column." },
    { "id": "A2", "check": "A bad value on a mapped or own line, or a structural error such as a bad date, rejects the whole invoice. A bad value or blank customer on any other line is skipped and named, because real exports carry freight lines, and no line is silently dropped. A row with no invoice number is reported, not attached to another invoice." },
    { "id": "A3", "check": "An Excel file gives the same lines as the same data in CSV, including a date stored as a true Excel date. A file over 5 MB or over the row limit is refused with a reason." },
    { "id": "A4", "check": "The Order Import header shows an Import PO button to Admin and Manager only. The server refuses any other role." },
    { "id": "A5", "check": "The screen offers a template to download and shows added, unchanged, changed, skipped and rejected counts before confirming, naming each skipped line and each rejection reason. Nothing is written until the person confirms." },
    { "id": "A6", "check": "Commit parses and classifies again on the server rather than trusting the preview." },
    { "id": "A7", "check": "A failure on one invoice leaves the others committed and is reported. Uploading the same file twice adds nothing." },
    { "id": "A8", "check": "A new order reaches `processed` with a fulfilment, so it appears in the Pick Queue. If that step fails after the order is created, the next upload of that invoice finishes it." },
    { "id": "A9", "check": "A changed invoice is updated only when the person selects it and it is still editable. Otherwise its differences are stored in `flagged_change`, and the order is not edited." },
    { "id": "A10", "check": "An unmatched line is rejected only when it matches the tenant's stored own-product rule. With no rule stored, it is skipped and named. The rule and product map live in the database, with no brand or client in code." },
    { "id": "A11", "check": "The function and its settings add no client write path: `app_settings` columns stay locked, and the function belongs to `sales_orders`." },
    { "id": "A12", "check": "An imported order has the file's prices and quantities in cartons per the product map, no invoice row, and sends no customer email.", "manual": "function run against dev with made-up data, then the orders and invoices checked" },
    { "id": "A13", "check": "Merged and deployed to dev, then walked with a made-up file: download template, upload Excel and CSV, preview, confirm, order in the Pick Queue, re-upload adds nothing, changed invoice applied and flagged.", "manual": "deploy:dev, fn:deploy of import-qb-invoices, and a browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/qbImport/parseInvoices.test.ts", "test": "parseInvoices > reads the six columns, a byte order mark, quoted commas and money", "proves": ["A1"] },
    { "file": "__tests__/qbImport/parseInvoices.test.ts", "test": "parseInvoices > reads both date formats and refuses an ambiguous or unreal date", "proves": ["A1"] },
    { "file": "__tests__/qbImport/parseInvoices.test.ts", "test": "parseInvoices > refuses a missing column by name", "proves": ["A1"] },
    { "file": "__tests__/qbImport/parseInvoices.test.ts", "test": "parseInvoices > reports a bad row by number without shifting columns", "proves": ["A1"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > rejects a whole invoice that has a bad row", "proves": ["A2"] },
    { "file": "__tests__/qbImport/parseInvoices.test.ts", "test": "parseInvoices > reports a row with no invoice number", "proves": ["A2"] },
    { "file": "__tests__/qbImport/readImportFile.test.ts", "test": "readImportFile > gives the same text for Excel and CSV, including a true Excel date", "proves": ["A3"] },
    { "file": "__tests__/qbImport/readImportFile.test.ts", "test": "readImportFile > refuses a file over the size or row limit", "proves": ["A3"] },
    { "file": "__tests__/importPoView.test.tsx", "test": "Import PO > shows the button to Admin and Manager only", "proves": ["A4"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > refuses any role but Admin and Manager", "proves": ["A4"] },
    { "file": "__tests__/importPoView.test.tsx", "test": "Import PO > shows every count, skipped line and rejection before confirming", "proves": ["A5"] },
    { "file": "__tests__/importPoView.test.tsx", "test": "Import PO > writes nothing until confirmed and offers the template", "proves": ["A5"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > commit classifies again rather than trusting the preview", "proves": ["A6"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > a failure on one invoice leaves the others committed and reports it", "proves": ["A7"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > uploading the same file twice adds nothing", "proves": ["A7"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > moves a new order to processed with a fulfilment", "proves": ["A8"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > the next upload finishes an order stuck in processing", "proves": ["A8"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > updates a changed invoice only when selected and editable", "proves": ["A9"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > flags a changed invoice it may not update and never edits the order", "proves": ["A9"] },
    { "file": "__tests__/qbImport/runImport.test.ts", "test": "runImport > applies the stored own-product rule, and skips and names a line with no rule", "proves": ["A10"] },
    { "file": "__tests__/qbImport/importPoSchema.test.ts", "test": "import po schema > stores the own-product rule without a new client write path", "proves": ["A11"] },
    { "file": "__tests__/qbImport/importPoSchema.test.ts", "test": "import po schema > assigns import-qb-invoices to sales_orders", "proves": ["A11"] }
  ],
  "allow": []
}
```

## Goal

A client's office raises invoices in QuickBooks and must get one brand's lines into the warehouse without retyping them. An Import PO button on the Order Import screen uploads a file, shows what will happen, and creates pick jobs on confirmation. The button says PO at the owner's request; the file holds customer invoices. The file format is a best guess until a real export arrives, so everything specific to it stays in one parser and in data.

## Approach

**File.** One row per invoice line, with `Invoice Number`, `Invoice Date`, `Customer`, `Product`, `Quantity` and `Unit Price`. Column names live in one constant in `_shared/qbImport/parseInvoices.ts`. The browser turns Excel into the same text a CSV would give, using the small `read-excel-file` package loaded only on this screen, a new dependency. The server only ever parses text, up to 5 MB and 20,000 rows.

**Function.** `POST import-qb-invoices { action: 'preview' | 'commit', csvText, applyChanges?: string[] }`, Admin and Manager, rate limited and audited, module `sales_orders`. Logic sits in `_shared/qbImport/runImport.ts` with its database calls passed in, so it can be tested offline. Commit runs one transaction per invoice using NX-0026's `qb_import_invoice_tx` and `qb_update_invoice_tx`, then advances new orders through `_shared/fulfillment.ts`.

**Data.** A migration adds `app_settings.qb_own_product_prefixes TEXT[]` and `qb_own_product_terms TEXT[]`, both empty by default and read only by the function. `qb_product_map` may hold several names for one product, covering codes and QuickBooks names, and its `pack_size` sets cartons per product. Rows are loaded per tenant outside this repository.

**Screen.** `components/admin/ImportPoView.tsx`, `hooks/queries/useImportPo.ts` and a header button in `components/OrderImportPage.tsx`. Test data is made up.

## Out of scope

- A screen for editing the product map or own-product rule, and a list of flagged invoices. Flags are stored for the office differences screen.
- Column matching on screen, invoice generation, QuickBooks live sync, and matching by anything but an exact name.
- Loading the map or rule onto a client tenant, and any release to one. That waits for the short-pick work and a real export.

## FINAL

The function and migration 00141 ran on dev on 2026-11-06 from this branch, with a made-up file and product map. Stock returned to its starting figures after cancelling, and the test orders, map rows and rule were then removed. Two reviews ran; the first failed A1, A2, A3 and A9's intent, which led to raw cell counts, the line-level preview, canonical invoice numbers and comparing carton size.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `parseInvoices > reads the six columns, a byte order mark, quoted commas and money`, `> reads both date formats and refuses an ambiguous or unreal date`, `> refuses a missing column by name`, `> reports a bad row by number without shifting columns` (check:brief) | See Not claimed for the shift that cannot be told apart, and for month-first dates |
| A2 | claimed | `runImport > rejects a whole invoice that has a bad row`, `parseInvoices > reports a row with no invoice number` (check:brief). Dev run: a blank freight line was skipped and named | Revised during the work: a bad value on a line that would be skipped anyway does not reject the invoice |
| A3 | claimed | `readImportFile > gives the same text for Excel and CSV, including a true Excel date`, `> refuses a file over the size or row limit` (check:brief) | Not run in a browser. Excel error cells read as blank |
| A4 | claimed | `Import PO > shows the button to Admin and Manager only`, `runImport > refuses any role but Admin and Manager` (check:brief) | |
| A5 | claimed | `Import PO > shows every count, skipped line and rejection before confirming`, `> writes nothing until confirmed and offers the template` (check:brief). Dev run: 0 orders after preview | Beyond the check, the preview also lists each invoice's customer and lines |
| A6 | claimed | `runImport > commit classifies again rather than trusting the preview` (check:brief) | |
| A7 | claimed | `runImport > a failure on one invoice leaves the others committed and reports it`, `> uploading the same file twice adds nothing` (check:brief). Dev run: re-upload left 2 orders | |
| A8 | claimed | `runImport > moves a new order to processed with a fulfilment`, `> the next upload finishes an order stuck in processing` (check:brief). Dev run: both orders `processed` with a fulfilment | Appearing in the Pick Queue rests on the query filter until A13. A stuck order with only a flagged change stays put, so stale quantities cannot reach the queue |
| A9 | claimed | `runImport > updates a changed invoice only when selected and editable`, `> flags a changed invoice it may not update and never edits the order` (check:brief). Dev run: one applied, one flagged | |
| A10 | claimed | `runImport > applies the stored own-product rule, and skips and names a line with no rule` (check:brief). Dev run: an unmapped line under the rule was rejected and named | |
| A11 | claimed | `import po schema > stores the own-product rule without a new client write path`, `> assigns import-qb-invoices to sales_orders` (check:brief) | The brief said only the function reads the rule. Any signed-in user can read it through `app_settings`. It holds brand markers, not secrets |
| A12 | claimed | Dev run: quantities and prices as filed, pack size per map (2 cartons of 6 reserved 12), total 3021, 0 invoice rows | No customer email rests on the function not calling `send-email` or `place-order` |
| A13 | not-claimed | | Needs the merge. Walked on dev afterwards; the result is in the PR |

### Not claimed

- The format is a best guess, and no real export has been tried. Nothing here goes to a client tenant.
- `A1,05/03/2026,Cafe,Prod A,1,234` under six columns cannot be told from quantity 1 at $234. The preview shows it for a person to catch.
- A month-first date such as `03/05/2026` reads as 3 May, affecting only the stored invoice date. A date-only change reads as `unchanged`.
- Excel error cells such as `#N/A` read as blank.
- A very large commit could hit the edge time limit. Re-uploading is safe, but that run writes no audit event.
- `update-order-status`'s handler has no direct test after the helper extraction. Only the helpers are tested.
- Imported orders must not go live before NX-0029: cancelling a partly reserved one can take other orders' stock until then.
- Coverage was not measured. The upload was not run through a browser before the merge.
