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
    { "file": "__tests__/promotionMinimumCart.test.ts", "test": "applyPromotionMinimums > a carton line with no unit id costs what the server charges, on both sides of a minimum", "proves": ["A3"] },
    { "file": "__tests__/promotionMinimumCart.test.ts", "test": "applyPromotionMinimums > a line in an explicit unit costs what the server charges", "proves": ["A3"] },
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
- `lib/promotionMinimumCart.ts` (new, pure): the cart's value and its repriced lines, priced by the
  same choice the server makes: an explicit non-base unit by its own price, anything else by the unit
  price and the carton formula. Not through `priceReorderLine`, as first written here: it matches a
  line with no unit id by pack factor, which the server does not do, so the gate found the two
  disagreeing by up to the whole promotion. A line whose product is gone keeps its price.
- `context/OrderContext.tsx`: derives the eligible promotions and the repriced lines. Nothing is
  repriced unless a live promotion has a minimum. `AppShell` passes the eligible list to the Shop.
- `components/admin/newOrder/OrderLinesGrid.tsx`, `lib/kitchen/reorderPlan.ts`: the same filter on
  their own lines.
- `components/PromotionsBanner.tsx`: keeps showing a promotion that has not been reached, with its
  minimum, so a buyer can see how to qualify. `components/BundleSelectModal.tsx` states it too.
- `components/ReorderTab.tsx`: measures a minimum on its own lines. Added after review.
- `context/OrderContext.tsx`: a free-goods offer with a minimum says so when added, rather than
  "Promo applied". Added after review.

## Out of scope

- The tenant-wide minimum order in Settings: it is a different rule, measured on the total, and
  stays as it is.
- "Quantities are per" (NX-0031).
- A message saying how far a cart is from a minimum. The banner states the figure only.
- Free goods as real order lines, still a follow-up brief.
- Amadiya: it does not have the promotions module, so nothing is deployed there. `place-order` and
  `qr-order-request` reach it at its next release, where no promotion exists to be affected.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `placeOrderCore > live mode > a promotion below its minimum does not apply and is not recorded`, `placeOrderCore > live mode > an order at exactly the minimum qualifies, measured at the customer's own prices`, `placeOrderCore > live mode > a bundle and a buy-one-get-one below their minimum do not apply` and `eligibleForOrderValue > keeps a promotion with no minimum and one that is met, and drops one that is not` fail on base, pass on tip. On dev through `place-order`: an order worth exactly 7.80 got the 7.80 promotion and not the 7.81 one, an order worth 11.70 got the 7.81 one, an order worth 3.90 got neither, and a buy-one-get-one with a $100 minimum gave no free goods and was not recorded | On dev these were percentage and buy-one-get-one. Bundle is in the test above, and fixed price and clearance share the same filter |
| A2 | claimed | `placeOrderCore > live mode > a discount that takes the total under the minimum does not switch the promotion off` fails on base, passes on tip. On dev, the order worth 7.80 kept its promotion at a total of 3.90 | |
| A3 | claimed | `OrderContext promotion minimum > lines already in the cart reprice when it reaches the minimum, and go back when it falls under`, `applyPromotionMinimums > a carton line with no unit id costs what the server charges, on both sides of a minimum` and `applyPromotionMinimums > a line in an explicit unit costs what the server charges` fail on base, pass on tip. The last two run the cart and the server's own pricing side by side, on the shape of dev's product 250 | Added after the gate returned NO-GO: the cart matched a line with no unit id by pack factor, and showed 132.84 where the server charged 140.22. In the test and jsdom only. Not seen on screen, see A7 |
| A4 | claimed | `New Order preview > a promotion below its minimum gives no discount until the lines reach it` and `reorder plan > a promotion below its minimum gives no discount on the plan` fail on base, pass on tip. Added after review: `Shop reorder tab > measures a minimum on the lines being reordered, not on the cart` passes on tip | jsdom only. The Shop's reorder tab was not named in the brief. Review found it measured on the cart, so it was brought under the same rule |
| A5 | claimed | `PromotionsBanner > names the minimum` fails on base, passes on tip. `BundleSelectModal > names the minimum` passes on tip | Not seen on screen. The bundle dialog was added after the gate |
| A6 | claimed | `OrderContext promotion minimum > with no minimum on any live promotion a line keeps the price it was added at` fails on base, passes on tip. A minimum on an expired promotion does not trigger repricing either. Removing the guard turned it red by assertion (expected 50 to be 77), run by hand after the gate questioned the test | |
| A7 | claimed | Script calling the deployed `place-order` as the demo Admin and Customer on dev: 17 of 17 checks, confirmed by SELECT, with the test promotions deleted and the stock of both products back as it was | The script half only. No screen was opened, because this session may not enter a password in a browser on that host. The Shop screens are for the owner |
| A8 | not-claimed | | Written before the merge. `place-order` and `qr-order-request` are on dev from 9054df7, with the owner's consent for `--yes`. No file under `supabase/` has changed since that commit. `mutate-promotion` did not change. Dev serves f33bd2b, a throwaway merge of this branch at 5dd7746 with main and the unmerged NX-0012 to NX-0015 work |

### Not claimed

- No screen was opened on any width, or on the RS35: not the cart repricing, the banner line, New Order or either reorder surface.
- No QR order was requested or approved on dev. The dry run uses the same core.
- No carton or UOM line was placed on dev. The cart and the server were compared on those lines in a test, not on a real order.
- With no minimum live, a carton line with no unit id still shows its stored price while the server applies any ordinary promotion to it, so the cart can read high until the order is placed. That is older behaviour, deliberately not repriced by A6.
- The kitchen's "Order same again" toast about a promotion no longer being available reads the cart's list, not its own lines. No price depends on it.
- Fixed price and clearance have no minimum test of their own. They pass through the same filter.
- The Deals filter and its "has deals" flag still read every live promotion, so Deals can list a product whose card shows no discount until the cart reaches the minimum. Left as it is.
- A cart line whose product is gone keeps its stored price and counts at it towards the minimum. The server refuses such a line.
- A buy-one-get-one added from the banner with a minimum says the free items apply at that figure, and the bundle dialog states it. Nothing says how far off the cart is.
- The walk left three cancelled orders on dev (ORD-1793885697584, ORD-1793885698623, ORD-1793885699375) and their audit rows, plus audit rows for three test promotions. Dev's 6 promotions are unchanged.
- The walk's logins used the demo accounts the dev login page publishes.
