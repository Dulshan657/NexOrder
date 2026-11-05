# NX-0028 — every promotion is recorded on the order, rep promotions apply, and ROI counts them

```json brief
{
  "id": "NX-0028-record-promotions-rep-roi",
  "base": "3a75041fbce594938562f03f706724f5f9e8fdb5",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "A new order records every promotion it used, of all five types, each with its id, name, type and discount. A line discount is the price without promotions less the price paid, times the quantity, and is right on carton and UOM lines. A buy-one-get-one also records the free product and quantity, and its discount is the value of the free goods, which is not taken off the order total." },
    { "id": "A2", "check": "A new order that used no promotion records an empty list, so it can be told apart from an older order, which records nothing." },
    { "id": "A3", "check": "A promotion recorded on a non-cancelled order, of any type, can be switched on or off but not otherwise edited or deleted. The check asks the database about that promotion rather than reading every order and filtering, so a row cap cannot hide a use." },
    { "id": "A4", "check": "A rep-targeted promotion applies when the targeted rep places the order, and not when another rep or a customer does, on both the server and the preview." },
    { "id": "A5", "check": "On a kitchen QR order, the person approving is the one who counts for a rep-targeted promotion, in both the approval preview and the placed order." },
    { "id": "A6", "check": "The promotion form stores the rep's profile id, not the in-memory hash, and an edit shows the same rep selected. A rep target without a valid profile id is refused." },
    { "id": "A7", "check": "ROI counts a promotion's orders and discount from what orders record, including the older promoId key, and leaves out cancelled orders." },
    { "id": "A8", "check": "ROI's no-promotion baseline uses only orders recorded as having none. Uplift shows a dash, not -100%, when a promotion has no orders or there is no baseline." },
    { "id": "A9", "check": "The whole cycle works in a browser.", "manual": "On dev, using clearly named test promotions removed afterwards: an order with each type, confirmed by SELECT on applied_promotions and on the ROI table; the targeted rep's preview equals the stored total and another rep gets no discount; a cancelled order leaves ROI; a used percentage promotion refuses an edit and still toggles. Results named in FINAL." },
    { "id": "A10", "check": "Merged, with mutate-promotion, place-order and qr-order-request deployed to dev before the app; /version.json shows the sha serving it.", "manual": "Function deploy with the owner's consent, then deploy:dev verification, keeping any unmerged work dev is serving." }
  ],
  "failFirst": [
    { "file": "__tests__/orderPricing.test.ts", "test": "buildAppliedPromotions > records a percentage, fixed price and clearance promotion with its discount", "proves": ["A1"] },
    { "file": "__tests__/orderPricing.test.ts", "test": "buildAppliedPromotions > works out the discount on carton and UOM lines from their own prices", "proves": ["A1"] },
    { "file": "__tests__/orderPricing.test.ts", "test": "buildAppliedPromotions > records a bundle with its products and a buy-one-get-one with its free goods", "proves": ["A1"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > writes every promotion the order used", "proves": ["A1"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > writes an empty list when the order used no promotion", "proves": ["A2"] },
    { "file": "__tests__/promotionSaveWiring.test.ts", "test": "promotion saving > the used-on-orders check asks the database about this promotion", "proves": ["A3"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > live mode > a rep promotion applies to the rep placing the order and no one else", "proves": ["A4"] },
    { "file": "__tests__/pricing.test.ts", "test": "rep-targeted promotions > the preview matches on the profile id", "proves": ["A4"] },
    { "file": "__tests__/placeOrderCore.test.ts", "test": "placeOrderCore > dry run > the approver counts for a rep promotion, not the requester", "proves": ["A5"] },
    { "file": "__tests__/promotionForm.test.tsx", "test": "PromotionForm > a rep target saves the rep's profile id and shows it again on an edit", "proves": ["A6"] },
    { "file": "__tests__/promotionBody.test.ts", "test": "promotion rules > a rep target must be a profile id", "proves": ["A6"] },
    { "file": "__tests__/promotionROI.test.ts", "test": "getPromotionROI > counts orders and discount, including the older promoId key", "proves": ["A7"] },
    { "file": "__tests__/promotionROI.test.ts", "test": "getPromotionROI > leaves out cancelled orders", "proves": ["A7"] },
    { "file": "__tests__/promotionROI.test.ts", "test": "getPromotionROI > the baseline uses only orders recorded as having no promotion", "proves": ["A8"] },
    { "file": "__tests__/promotionROI.test.ts", "test": "getPromotionROI > uplift is null with no promotion orders or no baseline", "proves": ["A8"] }
  ],
  "allow": []
}
```

## Goal

Admins and Managers can now create promotions, but only bundles leave a record on the order, a
rep-targeted promotion is shown in the preview and never charged, and the ROI table counts no real
order. This makes the order record what it used, makes rep promotions real, and makes ROI read
that record.

## Approach

- `_shared/orderPricing.ts`: new pure `buildAppliedPromotions`. It takes line discounts from a
  second `priceOrderLines` run with no promotions, so carton and UOM lines stay correct.
- `_shared/placeOrderCore.ts`: writes that list to `applied_promotions`, `[]` when there is none.
  `UserContext.id` becomes the acting profile id, `input.actorId ?? input.submittedBy`, in place
  of the hardcoded `0`.
- `_shared/pricing.ts`, `pricing.ts`, `types.ts`, `lib/profileToUser.ts`: `repUserId` becomes the
  profile id string, and `User` gains `profileId`. `id` stays the in-memory number for everything else.
- `components/PromotionForm.tsx`, `_shared/promotionBody.ts`: the form lists and sends the profile
  id, and the rule requires one.
- `mutate-promotion`: the used-on-orders check becomes two `.contains` queries, on `promotionId`
  and the older `promoId`. Comments saying only bundles freeze are corrected, along with
  `promotionBody.ts` and `docs/claude/server-lockdown.md`.
- `lib/adapters.ts`: maps the older `promoId`/`promoName` keys to the current ones.
- `services/promotionROIService.ts`, `components/AdminDashboard.tsx`: leaves out cancelled orders,
  narrows the baseline, and `estimatedUplift` becomes `number | null`, shown as a dash.

## Out of scope

- Free goods as real order lines: a buy-one-get-one is recorded, but still not reserved or picked.
  By owner decision this is a follow-up brief, so until then ROI shows value promised, not shipped.
- A promotion's minimum order value (NX-0029) and "Quantities are per" (NX-0030).
- Backfilling older orders: what they used cannot be known reliably, so ROI starts from this release.
- `approve-po`, which applies no promotions and keeps writing nothing, so its orders stay out of
  the baseline.
- Rep promotions on customers assigned to a rep: by owner decision they follow the person placing
  or approving the order.
- Dev's PROMO-006 `hoReCas` kind, reported in NX-0024.
- "Revenue" staying the whole order total, so an order using two promotions counts under both.
- Amadiya: it does not have the promotions module, so nothing is deployed there.

## FINAL
