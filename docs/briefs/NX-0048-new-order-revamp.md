# NX-0048 — New Order revamp: two-pane, keyboard entry, units, stock block, history, shared drafts

```json brief
{
  "id": "NX-0048-new-order-revamp",
  "base": "455cfd74393c109ff36a6610280203b803eec499",
  "approved": "2026-11-26 owner",
  "acceptance": [
    { "id": "A1", "check": "A line can be ordered in any of the product's units; 3 x a 12-each carton is submitted to place-order as quantity 36 of that product." },
    { "id": "A2", "check": "When a line's base quantity exceeds the product's available stock, the line is flagged and Place order is disabled until it is fixed." },
    { "id": "A3", "check": "Keyboard entry: typing a SKU in the quick-add box and pressing Enter adds the line and focuses its quantity; Enter in that quantity returns focus to quick-add." },
    { "id": "A4", "check": "Customer history: 'Copy last order' loads that customer's most recent order's lines; 'Usual products' ranks products by how many of the customer's orders contain them, with the median quantity; any of the recent orders can be copied." },
    { "id": "A5", "check": "Drafts are a server table (order_drafts) that authenticated/anon cannot write; mutate-order-draft upserts and deletes them for Admin/Manager only and rejects a malformed payload." },
    { "id": "A6", "check": "place-order given a draftId deletes that draft after the order commits, and leaves it in place when the order fails." },
    { "id": "A7", "check": "Editing an order auto-saves it as a draft (debounced); the Drafts list shows every draft with customer, author and last update, and opening one restores its customer, lines, date and notes." },
    { "id": "A8", "check": "The CSV paste panel is no longer always on screen; it opens from an 'Import from paste' button and still adds its lines." },
    { "id": "A9", "check": "Desktop shows a two-pane layout with a sticky summary (history, total, Place order); at 360px a sticky bottom bar carries total and Place order and history opens in a bottom sheet.", "manual": "browser walk on nexorder.vercel.app at 1280px and 360px, screenshots in FINAL" },
    { "id": "A10", "check": "Migration rehearsed on dev; check:grants:dev clean with order_drafts in lockedTables.", "manual": "npm run migrate:dev + npm run check:grants:dev output in FINAL" },
    { "id": "A11", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/newOrder/orderLineModel.test.ts", "test": "orderLineModel > converts a carton line to base units", "proves": ["A1"] },
    { "file": "__tests__/newOrder/orderLineModel.test.ts", "test": "orderLineModel > flags a line whose base quantity exceeds available stock", "proves": ["A2"] },
    { "file": "__tests__/newOrder/customerHistory.test.ts", "test": "customerHistory > ranks usual products by order frequency with the median quantity", "proves": ["A4"] },
    { "file": "__tests__/newOrder/customerHistory.test.ts", "test": "customerHistory > returns the most recent order's lines as the last order", "proves": ["A4"] },
    { "file": "__tests__/newOrder/orderDraftPayload.test.ts", "test": "orderDraftPayload > rejects a line without a productId", "proves": ["A5"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore draftId > deletes the named draft after the order commits", "proves": ["A6"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore draftId > keeps the draft when the order fails", "proves": ["A6"] },
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > submits a carton line as base units", "proves": ["A1"] },
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > disables Place order while a line is over stock", "proves": ["A2"] },
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > Enter on a SKU adds the line and focuses its quantity", "proves": ["A3"] },
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > the paste panel opens only from Import from paste", "proves": ["A8"] },
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > opening a draft restores customer, lines, date and notes", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

The New Order screen (`components/admin/NewOrderView.tsx`) is how a tenant without
`shop` (Amadiya) keys phone and email orders. The owner's verdict (interview,
2026-11-26): it looks dated, is slow to key in, and is missing what office staff
need. It must work equally well at a desk and on a phone. This revamp keeps the
server as the authority on pricing and placement and adds units, a stock block,
customer history and shared drafts.

## Approach

- **Pure logic** in `lib/newOrder/`: `orderLineModel.ts` (line = product + UOM +
  UOM qty → base qty via `ProductUom.factorToBase`, merge, int ≥ 1, over-stock
  against `product.available`) and `customerHistory.ts` (last order, recent N,
  usual products). Pricing stays `resolvePromotionPrice`; CSV stays
  `resolveOrderLines`.
- **Units are converted on the client.** `place-order` keeps receiving base
  quantities; there is no `order_items` schema change.
- **Drafts**: migration `00148_order_drafts.sql` creates `order_drafts` (RLS on,
  SELECT for Admin/Manager, INSERT/UPDATE/DELETE/TRUNCATE revoked from
  authenticated and anon), registered in `config/lockedTables.mjs`. A new Edge
  Function `mutate-order-draft` (`upsert`/`delete`) validates through a pure
  `_shared/orderDraftPayload.ts`, is rate-limited and audited, and is owned by
  `sales_orders` in `config/moduleOwnership.mjs`. `placeOrderCore` takes an
  optional `draftId` and deletes the draft only after the order commits.
  Lockdown table rows go in CLAUDE.md and `docs/claude/server-lockdown.md`.
- **UI** split into small files under `components/admin/newOrder/`: header
  (customer/date/notes), `QuickAddRow` (keyboard), `OrderLinesGrid` (gains Unit
  and Stock columns), `OrderSummaryPane` (desktop sticky), `MobileOrderBar` plus
  history `<Sheet>`, `CustomerHistoryPanel`, `DraftsList` (`<Modal>`), and
  `CsvPastePanel` inside a `<Modal>`. A `useNewOrderDraft` hook auto-saves
  through `services/supabase/orderDrafts.ts` and `hooks/queries/useOrderDrafts.ts`.
  Overlays go through `components/ui`; `h-svh`, 44px touch floor, `stone-600`
  on tints, `'en-AU'` dates.
- **Deploy order**: migration on dev, then the function (owner consent), then
  the frontend.
- The existing `__tests__/promotionMinimumPreview.test.tsx` New Order assertions
  are kept (adapted to the grid's new props, none removed).

## Out of scope

- The Shop and its cart are unchanged.
- No new rep access to New Order; the screen stays Admin/Manager.
- No UOM stored on `order_items`; pick slips keep showing base units.
- No backorders; over-stock is blocked on the client and still refused by the server.
- No Amadiya migration or release; this ships to dev only.

## FINAL
