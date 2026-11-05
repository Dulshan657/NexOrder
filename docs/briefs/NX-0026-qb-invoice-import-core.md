# NX-0026 — Rules and tables for importing QuickBooks invoices

```json brief
{
  "id": "NX-0026-qb-invoice-import-core",
  "base": "9b47990b2269018bd2f964298f068c1b4ad40bff",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "An invoice with mapped and other lines becomes an `add` holding only the mapped lines, and names every other line as skipped." },
    { "id": "A2", "check": "An unmapped line the tenant's rule marks as one of its own is a rejection naming that line, never a skip." },
    { "id": "A3", "check": "A customer matches only by exact name after trimming, collapsing spaces and folding case. No match is a rejection, two matches is a rejection, and nothing is fuzzy-matched." },
    { "id": "A4", "check": "An invoice with no mapped lines is `no_mapped_lines` and names its lines, even when its customer is unknown." },
    { "id": "A5", "check": "A product appearing twice at one price has its quantities added; at two prices the invoice is rejected rather than averaged." },
    { "id": "A6", "check": "An invoice is rejected, with reasons, for mixed customers or dates, a quantity that is not a positive whole number, a negative price, or an invoice number outside letters, digits and hyphens." },
    { "id": "A7", "check": "An identical re-upload is `unchanged` whatever the line order. A different one is `changed`, listing added, removed and altered lines and any change of customer." },
    { "id": "A8", "check": "A `changed` invoice is not editable once picking has started or the order is outside `processing` and `processed`." },
    { "id": "A9", "check": "Every line given to the classifier appears in exactly one verdict: none dropped, none counted twice." },
    { "id": "A10", "check": "`qb_product_map` and `qb_invoice_imports` are in `LOCKED_TABLES`, so `check:grants` fails if a client role can write to them." },
    { "id": "A11", "check": "Migration 00139 revokes client writes on both tables, enables RLS on them, restricts both transactions to `service_role`, adds a partial unique index on `orders.qb_invoice_number`, and neither writes to `invoices` nor calls `inv_release_reservation`." },
    { "id": "A12", "check": "`qb_import_invoice_tx` creates an order with the file's prices and no invoice row, and reserves what is available in base units when stock is short.", "manual": "npm run test:integration -- qbImportTx on dev, inside a rolled-back transaction" },
    { "id": "A13", "check": "Importing the same invoice number twice returns `already_imported` and adds nothing.", "manual": "npm run test:integration -- qbImportTx on dev" },
    { "id": "A14", "check": "`qb_update_invoice_tx` refuses an order with picks or one outside `processing` and `processed`, and changes nothing.", "manual": "npm run test:integration -- qbImportTx on dev" },
    { "id": "A15", "check": "`qb_update_invoice_tx` gives back only this order's reservation and re-reserves it: another order holding the same product keeps every unit, including when the updated order was only partly reserved.", "manual": "npm run test:integration -- qbImportTx on dev" },
    { "id": "A16", "check": "00139 is applied on dev and `npm run check:grants:dev` passes with no new baseline entries.", "manual": "npm run migrate:dev, then check:grants:dev" }
  ],
  "failFirst": [
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > keeps mapped lines and names the skipped ones", "proves": ["A1"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > rejects an unmapped line the tenant rule marks as its own", "proves": ["A2"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > matches a customer despite spacing and case", "proves": ["A3"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > rejects an unknown customer and a name close to a real one", "proves": ["A3"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > rejects when two customers match", "proves": ["A3"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > skips an invoice with no mapped lines even for an unknown customer", "proves": ["A4"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > adds quantities for one product at one price", "proves": ["A5"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > rejects one product at two prices", "proves": ["A5"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > rejects mixed customers, mixed dates, bad quantities, negative prices and bad invoice numbers", "proves": ["A6"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > marks an identical re-upload unchanged in any line order", "proves": ["A7"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > reports added, removed and altered lines and a changed customer", "proves": ["A7"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > makes a changed invoice uneditable once picked or closed", "proves": ["A8"] },
    { "file": "__tests__/qbImport/classifyInvoices.test.ts", "test": "classifyInvoices > accounts for every line exactly once", "proves": ["A9"] },
    { "file": "__tests__/qbImport/qbImportSchema.test.ts", "test": "qb import schema > locks both import tables in the grant check", "proves": ["A10"] },
    { "file": "__tests__/qbImport/qbImportSchema.test.ts", "test": "qb import schema > keeps the migration's tables and transactions away from client roles", "proves": ["A11"] },
    { "file": "__tests__/qbImport/qbImportSchema.test.ts", "test": "qb import schema > writes no invoice and uses no product-wide release", "proves": ["A11"] }
  ],
  "allow": []
}
```

## Goal

A client keeps invoicing in QuickBooks and will pick, pack and dispatch from those invoices in Nex Order. This change builds the two parts that do not depend on the export file's format: the rules that decide what happens to each invoice, and the tables and transactions that record it. Nothing calls them yet, so no screen or existing order behaves differently.

## Approach

**Rules.** New pure module `supabase/functions/_shared/qbImport/classifyInvoices.ts`, with `QbLine` in `_shared/qbImport/types.ts` so the later parser can produce it:

```ts
interface QbLine { invoiceNumber: string; invoiceDate: string; customerName: string; qbProductName: string; quantity: number; unitPrice: number; rowNumber: number }
interface MappedLine { productId: number; quantity: number; packSize: number | null; unitPrice: number; qbProductName: string }
type InvoiceVerdict =
  | { kind: 'add'; invoiceNumber: string; invoiceDate: string; horecaId: number; lines: MappedLine[]; skippedLines: string[] }
  | { kind: 'unchanged'; invoiceNumber: string; skippedLines: string[] }
  | { kind: 'changed'; invoiceNumber: string; orderId: string; horecaId: number; lines: MappedLine[]; differences: InvoiceDifference[]; editable: boolean; skippedLines: string[] }
  | { kind: 'no_mapped_lines'; invoiceNumber: string; skippedLines: string[] }
  | { kind: 'rejected'; invoiceNumber: string; reasons: string[] }
function classifyInvoices(lines: QbLine[], ctx: ClassifyContext): InvoiceVerdict[]
```

`ClassifyContext` holds customers, product map rows, stored imports with their pick and status facts, and `isOwnProductName: (name: string) => boolean`. The caller supplies that rule, so no brand name or tenant check lives in shared code.

**Tables and transactions.** Migration `00139_qb_invoice_import.sql` adds:
- `orders.qb_invoice_number TEXT`, with a partial unique index;
- `qb_product_map(qb_name TEXT PRIMARY KEY, product_id INT NOT NULL REFERENCES products, pack_size INT)`. `pack_size` is set per QuickBooks product name, so the map records whether that name's quantity means cartons or units, using the existing rule that base units are quantity × `COALESCE(pack_size, 1)`;
- `qb_invoice_imports(invoice_number TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders, invoice_date DATE NOT NULL, lines JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now(), flagged_change JSONB, flag_resolved_at TIMESTAMPTZ)`;
- `qb_import_invoice_tx` and `qb_update_invoice_tx(p_invoice_number TEXT, p_horeca_id INT, p_invoice_date DATE, p_lines JSONB, p_actor UUID, p_location_pref INT[]) RETURNS JSONB`.

The order id is `QB-<invoice number>`, and the order starts in `processing`. Stock is reserved with `inv_reserve_order(..., p_allow_partial => true)`, in base units.

**Giving a reservation back.** `qb_update_invoice_tx` nets this order's own `allocate` and `deallocate` ledger rows per product, bin, batch and plate, and reverses that amount through `inv_apply_leg`. It does not use `inv_release_reservation`, which works out the amount from the order's lines and takes it from any allocated row of the product. On a partly reserved order, that would take units from other orders. The later short-pick brief rewrites that function, which also fixes cancellation.

**Tests.** `config/lockedTables.mjs` gains both tables. SQL behaviour is proven in `__tests__/qbImportTx.integration.test.ts`. The gate cannot run those tests fail-first, because the default suite excludes `*.integration.test.ts`, so A12 to A15 are manual, as in NX-0006. All test data is made up.

## Out of scope

- The export parser and the upload function and screen, which wait for a real sample file.
- Loading `qb_product_map`, and the source of `isOwnProductName`.
- Moving imported orders to `processed`, and writing `flagged_change`.
- Changing `inv_release_reservation` or `order_cancel_tx`.
- Any deploy to a client tenant.

## FINAL

Migration 00139 was applied to dev on 2026-11-05 from this branch, before it was renumbered from NX-0025; only the header comment has changed since, and the checksum on dev was updated to match. Nothing calls these functions yet, and dev's import tables and imported orders are empty. Three database reviews ran on the way. The first failed A15: after a pick from another bin, an update could silently take another order's stock. That led to the product-and-bin guard and release that are now in the migration.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `classifyInvoices > keeps mapped lines and names the skipped ones` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `classifyInvoices > rejects an unmapped line the tenant rule marks as its own` (check:brief) | The caller supplies the rule. Where it comes from is out of scope |
| A3 | claimed | `classifyInvoices > matches a customer despite spacing and case`, `> rejects an unknown customer and a name close to a real one`, `> rejects when two customers match` (check:brief) | Punctuation is not removed |
| A4 | claimed | `classifyInvoices > skips an invoice with no mapped lines even for an unknown customer` (check:brief) | A stored invoice whose mapped lines have all gone is `changed` and not editable, so that change is not ignored |
| A5 | claimed | `classifyInvoices > adds quantities for one product at one price`, `> rejects one product at two prices` (check:brief) | May catch free-goods lines; check against a real sample |
| A6 | claimed | `classifyInvoices > rejects mixed customers, mixed dates, bad quantities, negative prices and bad invoice numbers` (check:brief) | Stricter than written: hyphens only between characters, and dates must be real `YYYY-MM-DD` |
| A7 | claimed | `classifyInvoices > marks an identical re-upload unchanged in any line order`, `> reports added, removed and altered lines and a changed customer` (check:brief) | Prices compare in cents, as the column stores them |
| A8 | claimed | `classifyInvoices > makes a changed invoice uneditable once picked or closed` (check:brief) | |
| A9 | claimed | `classifyInvoices > accounts for every line exactly once` (check:brief) | Every verdict gained `rowNumbers` beyond the brief's types, so this can be tested |
| A10 | claimed | `qb import schema > locks both import tables in the grant check` fails on base by assertion, passes on tip (check:brief) | |
| A11 | claimed | `qb import schema > keeps the migration's tables and transactions away from client roles`, `> writes no invoice and uses no product-wide release` (check:brief) | Text checks. Client roles were also refused live inside a rolled-back transaction |
| A12 | claimed | `npx vitest run -c vitest.integration.config.ts qbImportTx` on dev after applying: 42 of 42 | A price above 2dp is rounded per line for `unit_price` and `total`, and `qb_invoice_imports.lines` keeps the file's value |
| A13 | claimed | Same run | Only one session was shown blocked by the advisory lock; two imports racing were not run |
| A14 | claimed | Same run | |
| A15 | claimed | Same run. With `inv_release_reservation` swapped in, 9 tests failed, including the headline test. A review ran 115 randomised bin states: rows stayed in bounds and other orders' ledgers were untouched | Fails closed with `QB_ALLOCATION_MISMATCH` where the ledger cannot show the units are free |
| A16 | claimed | `migrate.mjs --env=dev` applied only 00139. check:grants:dev exits 0: "No new write grants. Every locked table is locked, or baselined." | |

### Not claimed

- Real concurrency. The pick-and-update and reserve-and-update lock orders were reasoned from code, not run in two sessions. A deadlock rolls back with balances intact, but `record-pick` would report INTERNAL. The update locks every row of a product in a bin, so it can conflict with more picks there.
- `QB_ALLOCATION_MISMATCH` has no way forward in this change. On dev, 10 of 67 bins with open holdings already show more ledger holdings than allocated stock, so an update there refuses. An open order that picked from another bin, or a residual release on a flat warehouse taking this order's units, has the same effect. The upload function must show this to the office.
- Cancelling a partly reserved imported order still uses the product-wide `inv_release_reservation` and can take other orders' stock. Imported orders must not go live until the short-pick brief rewrites that function. Nothing creates them yet.
- A reversal can leave this order's own batch or plate ledger key negative while the bin total stays right. A review found no reader that nets per row, but not every report reading `inventory_movements` was audited.
- When an order is fully out of stock, fulfilments follow `update-order-status`: a row is kept at the first active warehouse, so the rollup can stay at `processed`. The fulfilment tests set `processed` and insert the row by hand; the real status flow was not run.
- `check:grants` exits 1 on a target until 00139 is applied there, because a missing locked table is fatal. The runbook runs it after migrating.
- The schema tests read migration text, so behaviour rests on the integration suite, which the gate does not run.
- The classifier was built without a real export file, so `QbLine`, the two-price rule and the invoice-number pattern could change.
- `lib/database.types.ts` was not regenerated, `flag_resolved_at` is not set by an update, stored order documents may go stale after one, and the CLAUDE.md lockdown table has no row for the two new tables.
- Coverage was not measured. Nothing was deployed to a client tenant, and no function or frontend changed on dev.
