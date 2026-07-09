# NexOrder — Onboarding Readiness Audit

**Env:** nexorder.vercel.app (prod) · **Date:** 8 Jul 2026 · **Method:** UI-driven, 3 personas, ledger-checked in SQL · **Test data:** namespaced `ONBRD`, torn down.
(Visual version: `ONBOARDING-AUDIT.html`.)

A dry run of the full customer journey — stand up a warehouse, load a stock list, take an order, pick it, dispatch it — driven through the live app to find where the flow breaks before a real customer does.

## Bottom line

Once an order is placed, **fulfilment works and is ledger-correct**. The problems are all upstream, in **setup and onboarding**.

## Verified working (ledger-checked)

**Order lifecycle (bulk warehouse):** receive → reserve-on-placement → closest-warehouse routing → process (per-warehouse fulfilment) → pick (stock decrements, pack-aware) → pack → dispatch (gated on fully-picked, PDFs generated) → deliver.

- Carton math: 1 carton × pack-size 12 → 12 base units reserved/decremented.
- Reserve model: placement raises `allocated`, leaves `on_hand`; pick drops both.
- Routing: Sydney HoReCa drew from the nearest site, not the default.
- Caches: `products.available` stayed consistent with the balance ledger.
- Oversell: 500 against 105 on hand hard-blocked (`INSUFFICIENT_STOCK`).

**Racked + WIE track:** create racked warehouse → floor-plan AI import (gpt-4o, 0.95 confidence, read 8 racks/dock/zone/grid, no review needed) → designer render → publish-readiness gate correctly **blocked** unreachable bins → manual walkway touch-up → publish (47-node routing graph, site flips to racked) → receive → putaway recommendation → accept → stock moved root→bin (ledger-verified).

**Stress (B3):**
- Inter-warehouse transfer: **PASS** — moved 30 units W1→W2, clean `transfer_out`/`transfer_in` ledger.
- Partial-pick → dispatch gate: **PASS** — dispatch disabled at 50% picked; picks decremented correctly from the fulfilling warehouse.
- Re-route during processing: **allocation moves correctly, but see the P1 finding below** — a phantom fulfillment is orphaned at the origin and permanently blocks the order.
- Stock adjustments (new feature): shrinkage, stocktake variance, clean 4xx guards — all verified.

## Fixed & deployed this session

1. **Product creation was 100% broken.** Form never collected SKU/carton size, sent an empty image field the server rejects, and closed before showing the error. A second blocker sat behind it: the form's default category `Plant-Based` wasn't in the server allow-list. Fixed both; verified live. Commits `ccf1e71`, `8548a49`.
2. **No stock-adjustment path.** Ledger supported adjustment/stocktake types but nothing wrote them. Added `inv_adjust_stock` RPC + `adjust-stock` function + Stock-screen UI. Migration `00062`, commit `a497df1`.
3. **Auth redirect** (`site_url`/allow-list) pointed at localhost — fixed live via the Management API.

## Open findings — high (blocks a real rollout)

- **P1 · Inviting a teammate is a dead end.** Even with the redirect fixed, the invite link carries a sign-up token the app doesn't handle, so invited staff/customers can't set a password. Personas had to be created directly in the DB.



## Open findings — medium & polish

- **P2 · "Add user" dialog can't be submitted on a short screen** — no internal scroll, no Escape/click-away; traps the UI until reload.
- **P2 · No cancel / return / short-ship path** — orders only move forward; no way to release a reservation on cancel; a permanently short line blocks dispatch.
