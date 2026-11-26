# NX-0048 — New Order revamp: two-pane, keyboard entry, units, stock block, history, shared drafts

```json brief
{
  "id": "NX-0048-new-order-revamp",
  "base": "455cfd74393c109ff36a6610280203b803eec499",
  "approved": "2026-11-26 owner",
  "acceptance": [
    { "id": "A1", "check": "A line can be ordered in any of the product's units; 3 x a 12-each carton is submitted to place-order as quantity 3 with that carton's uomId (so it prices like the Shop), and its stock check uses 36 base units." },
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
    { "file": "__tests__/newOrder/newOrderView.test.tsx", "test": "NewOrderView > submits a carton line with its unit", "proves": ["A1"] },
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
- **Units are sent as units.** `place-order` already accepts `uomId` per line,
  records it on `order_items` and prices it as the Shop does (carton discount
  included), so the screen sends `{ productId, quantity, uomId }` and converts
  to base units only for its own stock check. No schema change.
  *(Revised 2026-11-26: the first draft said the server had no UOM support and
  planned a client-side conversion to base units; it does, and that conversion
  would have skipped the carton discount. Owner chose to send the unit.)*
- **Drafts**: migration `00150_order_drafts.sql` (renumbered from `00148`, which
  NX-0040's accounting export already holds on dev, with `00149`) creates `order_drafts` (RLS on,
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
- No change to how pick slips show a line's unit.
- No backorders; over-stock is blocked on the client and still refused by the server.
- No Amadiya migration or release; this ships to dev only.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `orderLineModel > converts a carton line to base units`, `NewOrderView > submits a carton line with its unit` fail on base, pass on tip (check:brief). Browser on dev: 6 × carton of Thai Panang placed as `ORD-1795665940702`; `order_items` row has `quantity 6, pack_size 6, uom_id 198`; preview $263.97 = order total $263.97 | carton discount priced as the Shop prices it |
| A2 | claimed | `orderLineModel > flags a line whose base quantity exceeds available stock`, `NewOrderView > disables Place order while a line is over stock`. Browser: Copy last order put 26 Coconut Cream against 5 available; line flagged, Place order disabled until set to 5 | |
| A3 | claimed | `NewOrderView > Enter on a SKU adds the line and focuses its quantity`. Browser: `AYM-CUR` + Enter added a line with focus in its quantity; typed 3; Enter back to quick-add | |
| A4 | claimed | `customerHistory > ranks usual products by order frequency with the median quantity`, `customerHistory > returns the most recent order's lines as the last order`, plus unit-resolution tests and `toOrders > keeps the unit a line was ordered in`. Browser: Blue Gum Lodge shows usual products and 5 recent orders; Copy last order loaded 4 lines | the review found copied orders lost their unit (adapter never mapped `uom_id`); fixed in c5a90c9 |
| A5 | claimed | `orderDraftPayload > rejects a line without a productId` (+8 payload tests). `npm run check:grants:dev`: "No new write grants" with `order_drafts` in `lockedTables.mjs`. Unauthenticated POST to `mutate-order-draft` on dev → `UNAUTHORIZED_NO_AUTH_HEADER` | |
| A6 | claimed | `placeOrderCore draftId > deletes the named draft after the order commits` fails on base, passes on tip; `keeps the draft when the order fails`, `refuses a draft someone else has already placed` pass. Dev: `order_drafts` count 0 after the browser placement | |
| A7 | claimed | `NewOrderView > opening a draft restores customer, lines, date and notes`, `auto-saves the order as a draft after a pause…`, plus orphan-delete and fork-on-NOT_FOUND tests. Browser: "Draft saved", Drafts (1), opened on 360px, Clear → Discard → Drafts (0) | |
| A8 | claimed | `NewOrderView > the paste panel opens only from Import from paste` fails on base, passes on tip | |
| A9 | claimed | Chrome at 1366px on nexorder.vercel.app: two panes, sticky summary. Headless Chromium at 360×664 (isMobile): main scrollWidth 360 = clientWidth, Place order bar at 608–652 of 664, history opens as a bottom sheet | the walk found two layout bugs (dropdown under quick-add; Nex Assistant button over Clear at 360px); fixed in cffce82 and re-walked |
| A10 | claimed | `npm run migrate:dev` applied `00150_order_drafts.sql`; `check:grants:dev` clean | renumbered from 00148, which NX-0040 already holds on dev |
| A11 | not-claimed | | not merged. Dev serves `36916e9`, a local merge of this branch with the unmerged NX-0040, so dev keeps the accounting export; `/version.json` verified, health 200. Re-verify after merge |

### Not claimed

- No real handheld or phone: 360px was headless Chromium, which (CLAUDE.md) cannot show the RS35's 56px URL-bar problem.
- Closing the tab within 1.5s of an edit loses that edit: the unmount flush runs on navigating away inside the app, but nothing saves on `pagehide`.
- Two people editing one draft at once was exercised only in unit tests (the 409 → fork path), not by two live sessions.
- No Playwright e2e spec was added; the browser checks were one-off scripts.
- Coverage percentage was not measured.
- Nothing ran against Amadiya.
