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

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `buildAppliedPromotions > records a percentage, fixed price and clearance promotion with its discount`, `buildAppliedPromotions > works out the discount on carton and UOM lines from their own prices`, `buildAppliedPromotions > records a bundle with its products and a buy-one-get-one with its free goods` and `placeOrderCore > live mode > writes every promotion the order used` fail on base and pass on tip. On dev, one real order through `place-order` recorded all five types, read back by SELECT: 3.90, 5.00, 4.80, 6.40 and 4.00 free goods value, total 11.55 | Carton and UOM discounts were tested in code, not on a real order |
| A2 | claimed | `placeOrderCore > live mode > writes an empty list when the order used no promotion` fails on base, passes on tip | Not seen on dev: PROMO-006's `hoReCas` kind applies 10% to every order there, so no dev order can use none |
| A3 | claimed | `promotion saving > the used-on-orders check asks the database about this promotion` fails on base, passes on tip. On dev through the real filter: a used percentage promotion refused an edit (409, count 3), a used fixed price promotion refused a delete (409), a used rep promotion refused an edit (409), toggles returned 200, and after the orders were cancelled the edit returned 200 | |
| A4 | claimed | `placeOrderCore > live mode > a rep promotion applies to the rep placing the order and no one else` and `rep-targeted promotions > the preview matches on the profile id` fail on base, pass on tip. On dev: the targeted rep got it (recorded, total 11.55), and another rep and a customer did not (total 13.20 each) | The preview was tested in code. Nobody compared a preview on screen with a stored total |
| A5 | claimed | `placeOrderCore > dry run > the approver counts for a rep promotion, not the requester` fails on base, passes on tip | Tests only: no QR order was approved on dev |
| A6 | claimed | `PromotionForm > a rep target saves the rep's profile id and shows it again on an edit` and `promotion rules > a rep target must be a profile id` fail on base, pass on tip. On dev, a numeric rep target returned 400 and a profile id saved 201 | The form was tested in jsdom, not opened on dev |
| A7 | claimed | `getPromotionROI > counts orders and discount, including the older promoId key` and `getPromotionROI > leaves out cancelled orders` fail on base, pass on tip | The ROI table was not opened on dev |
| A8 | claimed | `getPromotionROI > the baseline uses only orders recorded as having no promotion` and `getPromotionROI > uplift is null with no promotion orders or no baseline` fail on base, pass on tip | The dash was not seen on screen. On dev every uplift will read as a dash for now, because of PROMO-006 (see A2) and because all earlier orders record nothing |
| A9 | not-claimed | | No browser walk. Dev's login takes a password, and this session may not enter one in a browser on that host. The server half ran instead, 33 of 33 checks, with a script calling the deployed functions as the demo Admin, two reps and a customer. Left for the owner on dev: the rep dropdown, the Shop preview against a stored total, and the ROI table |
| A10 | not-claimed | | Written before the merge. `mutate-promotion`, `place-order` and `qr-order-request` are on dev from 17f6b11, with the owner's consent for `--yes`. That commit differs from the tip only in comments and this brief's number. Dev serves d30d443, a throwaway merge of this branch into 22e3d61, which keeps the unmerged NX-0012 to NX-0015 work there |

### Not claimed

- No browser walk, and no screen was opened on any width, or on the RS35. See A9.
- Free goods are recorded but still not on the order: nothing reserves or picks them, while the cart promises them. ROI's Discount column includes their value. By owner decision that is a follow-up brief.
- Older orders are not backfilled, and `approve-po` orders still record nothing, so neither counts in ROI.
- Revenue stays the whole order total, so an order using two promotions counts under both.
- No QR order was approved on dev, and no carton or UOM line was placed there.
- The walk left three cancelled orders on dev (ORD-1793882237960, ORD-1793882239216, ORD-1793882240161) and their audit rows, plus audit rows for the six test promotions. Dev's 6 promotions and the stock of the five products used are as they were.
- The walk's logins used the demo accounts the dev login page publishes.
- No confirmation email was checked. `send-email` selects `horecas.email`, a column dev's table does not have (`00138` notes the name), which reads as confirmations not being sent. Not changed here, and not confirmed by a run.
- Numbered NX-0028 after approval as NX-0027: another session took that number. The approved text changed only in its number, its base and the two follow-up numbers.
