# NX-0030 — a promotion's minimum order value is honoured

```json brief
{
  "id": "NX-0030-promotion-minimum-order",
  "base": "02ee452557d0096d74e1ada44def387a33b0180a",
  "approved": "2026-11-06 owner",
  "acceptance": [
    { "id": "A1", "check": "A promotion with a minimum order value applies only when the whole order, at the customer's own prices before any promotion, reaches that minimum. Exactly the minimum qualifies. This holds for all five types, and a promotion that did not apply is not recorded on the order." },
    { "id": "A2", "check": "A promotion's own discount cannot switch it off: an order that reaches the minimum before promotions keeps the promotion even when its total ends up below the minimum." },
    { "id": "A3", "check": "The cart matches the server. Below the minimum a line shows no discount from that promotion; when the cart reaches the minimum the lines already in it are repriced, and they go back if it falls under again." },
    { "id": "A4", "check": "New Order and the kitchen's 'Order same again' preview apply the same rule, measured on their own lines." },
    { "id": "A5", "check": "The promotions banner shows a promotion that has a minimum with 'On orders of $X or more', whether or not the cart has reached it." },
    { "id": "A6", "check": "When no live promotion has a minimum, cart lines are not repriced and keep the price they were added at." },
    { "id": "A7", "check": "The whole cycle works on dev.", "manual": "With a clearly named test promotion removed afterwards: a script calling the deployed place-order as demo users below and at the minimum, confirmed by SELECT. The Shop screens are for the owner to check, since this session may not enter a password in a browser on that host. Results named in FINAL." },
    { "id": "A8", "check": "Merged, with place-order and qr-order-request deployed to dev before the app; /version.json shows the sha serving it.", "manual": "Function deploy with the owner's consent, then deploy:dev verification, keeping any unmerged work dev is serving." }
  ],
  "failFirst": [
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > a promotion below its minimum does not apply and is not recorded", "proves": ["A1"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > an order at exactly the minimum qualifies, measured at the customer's own prices", "proves": ["A1"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > a bundle and a buy-one-get-one below their minimum do not apply", "proves": ["A1"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > a discount that takes the total under the minimum does not switch the promotion off", "proves": ["A2"] },
    { "file": "__tests__/promotionMinimum.test.ts", "test": "eligibleForOrderValue > keeps a promotion with no minimum and one that is met, and drops one that is not", "proves": ["A1"] },
    { "file": "__tests__/orderContextPromotionMinimum.test.tsx", "test": "OrderContext promotion minimum > lines already in the cart reprice when it reaches the minimum, and go back when it falls under", "proves": ["A3"] },
    { "file": "__tests__/orderContextPromotionMinimum.test.tsx", "test": "OrderContext promotion minimum > with no minimum on any live promotion a line keeps the price it was added at", "proves": ["A6"] },
    { "file": "__tests__/promotionMinimumPreview.test.tsx", "test": "New Order preview > a promotion below its minimum gives no discount until the lines reach it", "proves": ["A4"] },
    { "file": "__tests__/promotionMinimumPreview.test.tsx", "test": "reorder plan > a promotion below its minimum gives no discount on the plan", "proves": ["A4"] },
    { "file": "__tests__/promotionMinimumPreview.test.tsx", "test": "PromotionsBanner > names the minimum", "proves": ["A5"] }
  ],
  "allow": []
}
```

## Goal

A promotion's minimum order value can be saved, but no pricing code reads it, so a "$200 minimum"
promotion applies to a $20 order. This makes the server, the cart and the other previews honour it.

## Approach

- `_shared/promotionMinimum.ts` (new, pure): `eligibleForOrderValue(promotions, value)`, imported by
  both runtimes so there is one rule.
- `_shared/placeOrderCore.ts`: `loadActivePromotions` maps `min_order_value`. The core prices the
  lines with no promotions to get the order's value, filters the promotions, and uses that list for
  line prices, cart promotions and recording. A dry run gets this too, so QR previews agree.
- `lib/promotionMinimumCart.ts` (new, pure): the cart's value and its repriced lines, both through
  `priceReorderLine`, which already prices a line in its own unit. A line it cannot price keeps its
  price.
- `context/OrderContext.tsx`: derives the eligible promotions and the repriced lines. Nothing is
  repriced unless a live promotion has a minimum. `AppShell` passes the eligible list to the Shop.
- `components/admin/newOrder/OrderLinesGrid.tsx`, `lib/kitchen/reorderPlan.ts`: the same filter on
  their own lines.
- `components/PromotionsBanner.tsx`: keeps showing a promotion that has not been reached, with its
  minimum, so a buyer can see how to qualify.

## Out of scope

- The tenant-wide minimum order in Settings: it is a different rule, measured on the total, and
  stays as it is.
- "Quantities are per" (NX-0031).
- A message saying how far a cart is from a minimum. The banner states the figure only.
- Free goods as real order lines, still a follow-up brief.
- Amadiya: it does not have the promotions module, so nothing is deployed there. `place-order` and
  `qr-order-request` reach it at its next release, where no promotion exists to be affected.

## FINAL
