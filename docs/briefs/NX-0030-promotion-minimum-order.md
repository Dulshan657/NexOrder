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
    { "file": "__tests__/pricing.test.ts", "test": "resolvePromotionPrice in cents > a venue discount gives the unit price the server charges", "proves": ["A3", "A4"] },
    { "file": "__tests__/promotionMinimumCart.test.ts", "test": "applyPromotionMinimums > a venue with a percent discount is measured the same on both sides", "proves": ["A3"] },
    { "file": "__tests__/promotionMinimumPreview.test.tsx", "test": "Shop reorder tab > a carton line with no unit id is sent in the unit it was priced in", "proves": ["A4"] },
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
- `components/ReorderTab.tsx`: measures a minimum on its own lines, added after review. It also sends
  a line in the unit it priced it in, as the kitchen's reorder plan already does, added after the
  second gate: it showed a unit's price and sent no unit, so the server charged something else.
- `pricing.ts`: `resolvePromotionPrice` returns its `finalPrice` in cents, as the server's
  `resolveUnitPrice` does. Added after the second gate: for a venue with a percent discount the two
  measured a different order value, which can flip a promotion. Every screen reading it moves by up
  to a cent, towards what the server charges.
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
| A1 | claimed | `placeOrderCore > live mode > a promotion below its minimum does not apply and is not recorded`, `placeOrderCore > live mode > an order at exactly the minimum qualifies, measured at the customer's own prices`, `placeOrderCore > live mode > a bundle and a buy-one-get-one below their minimum do not apply` fail on base by assertion, pass on tip. `eligibleForOrderValue > keeps a promotion with no minimum and one that is met, and drops one that is not` is proven by absence. On dev through `place-order`: an order worth exactly 7.80 got the 7.80 promotion and not the 7.81 one, one worth 11.70 got the 7.81 one, one worth 3.90 got neither, and a buy-one-get-one with a $100 minimum gave no free goods and was not recorded | On dev these were percentage and buy-one-get-one. Bundle is in the test above. Fixed price and clearance share the filter and have no test of their own |
| A2 | claimed | `placeOrderCore > live mode > a discount that takes the total under the minimum does not switch the promotion off` fails on base, passes on tip. On dev, the order worth 7.80 kept its promotion at a total of 3.90 | |
| A3 | claimed | `OrderContext promotion minimum > lines already in the cart reprice when it reaches the minimum, and go back when it falls under` and `resolvePromotionPrice in cents > a venue discount gives the unit price the server charges` fail on base by assertion, pass on tip. `applyPromotionMinimums > a carton line with no unit id costs what the server charges, on both sides of a minimum`, `applyPromotionMinimums > a line in an explicit unit costs what the server charges` and `applyPromotionMinimums > a venue with a percent discount is measured the same on both sides` are proven by absence, and run the cart and the server's own pricing side by side, the last across a sweep of prices, discounts, quantities and minimums. On dev in a real browser at d296330: 5 of a line read $17.55, 6 repriced to $1.95 and read $11.70, 5 again read $17.55, and the order placed from that cart stored $11.70. At Bunnings (5%), 27 of a line read $94.77 and `place-order` charged $94.77. A carton line with no unit id from Order History read $126.20 and `place-order` charged $126.20 | Two gate NO-GOs led here: the cart matched a line with no unit id by pack factor, and measured a percent-discount venue unrounded. `resolvePromotionPrice` now returns cents, so other screens can move by up to a cent, towards what the server charges |
| A4 | claimed | `New Order preview > a promotion below its minimum gives no discount until the lines reach it`, `reorder plan > a promotion below its minimum gives no discount on the plan` and `Shop reorder tab > a carton line with no unit id is sent in the unit it was priced in` fail on base, pass on tip. On dev in a real browser: New Order read $17.55 at 5 and $11.70 at 6. With an empty cart, the Shop's Reorder tab priced the placed order at $1.95 for $11.70. For a carton line with no unit id it showed $110.88, the cart showed $110.88, and the order placed through the screen stored $110.88 with the unit on its line | The kitchen's reorder plan was tested in code only. The Shop's Reorder tab was not named when this was approved, and is in the Approach by revision |
| A5 | claimed | `PromotionsBanner > names the minimum` fails on base, passes on tip. `BundleSelectModal > names the minimum` passes on tip. On dev in a real browser, the banner states it as Admin and as a Customer, and at 360px wide with no sideways page scroll | The bundle dialog was not opened on dev |
| A6 | claimed | `OrderContext promotion minimum > with no minimum on any live promotion a line keeps the price it was added at` fails on base, passes on tip. On base that failure is the missing field, not the price. Removing the guard turned it red on the price, by assertion (expected 50 to be 77), run by hand | |
| A7 | claimed | Headless Chromium against dev at d296330, 39 of 40 checks in the main walk and 8 of 8 in a separate run of the one that failed, confirmed by SELECT. Also, for NX-0028 which had no browser walk: the rep dropdown shows the saved rep, saves another and holds across a reload; the targeted rep's card read $1.65 and their order stored $1.65; another rep's read $3.30; the ROI table counted the order at $11.70 discount and $11.70 revenue, with a dash for uplift, and dropped it after a cancel. Separately, a script through `place-order`, 17 of 17 | The failed check was the walk's own: its earlier orders had reserved all the stock, and the tab said so. The scripts are not in the repo. Signed in by script with the published demo accounts and the session placed in a separate browser, so the login form itself was not used |
| A8 | not-claimed | | Written before the merge. `place-order` and `qr-order-request` are on dev from 9054df7, with the owner's consent for `--yes`. No file under `supabase/` has changed since that commit. `mutate-promotion` did not change. Dev serves d296330, a throwaway merge of this branch at 3aa7145 with main and the unmerged NX-0012 to NX-0015 work |

### Not claimed

- Both demo customers are blocked by invoices over 90 days overdue, so the screen orders were placed by the Admin, for Seaside Bistro, with a phone reference. No Customer placed an order through a screen, and no signature was captured.
- Screens were seen at 1280px, and the banner at 360px. Nothing on the RS35.
- No QR order was requested or approved on dev. The dry run uses the same core.
- New Order's estimate and the Shop's Reorder tab leave out bundle discounts, so either can read high when a bundle is reached. That is older behaviour.
- The Reorder tab measures its own lines, so merging into a non-empty cart can cross a minimum the tab did not show, and "Add" on one line shows a price measured across all of them. The cart corrects both.
- A product card measures against the current cart, so a pick that would itself reach a minimum shows no discount until it is added.
- With no minimum live, a carton line with no unit id still shows its stored price while the server applies any ordinary promotion to it, so the cart can read high until the order is placed. That is older behaviour, deliberately not repriced by A6.
- The kitchen's "Order same again" toast about a promotion no longer being available reads the cart's list, not its own lines. No price depends on it.
- The Deals filter and its "has deals" flag still read every live promotion, so Deals can list a product whose card shows no discount until the cart reaches the minimum.
- A cart line whose product is gone keeps its stored price and counts at it towards the minimum. The server refuses such a line.
- Nothing says how far off a cart is from a minimum.
- The walks left 19 cancelled orders on dev, 16 from the screens (ORD-1793887291421 to ORD-1793888274394) and 3 from the script (ORD-1793885697584, ORD-1793885698623, ORD-1793885699375), with their audit rows, plus audit rows for the test promotions. They can show in dev's order history and cancelled counts. Dev's promotions are PROMO-001 to 006 again.
- ROI's type column shows raw values such as "Fixed_price". Not changed here.
