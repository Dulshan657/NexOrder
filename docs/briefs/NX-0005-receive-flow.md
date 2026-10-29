# NX-0005 — Receive Stock: scan-to-count, top scan bar on desktop, fewer clicks

```json brief
{
  "id": "NX-0005-receive-flow",
  "base": "b356a7dab4cff9308e0937fdaaaf87d75b689cf7",
  "approved": "2026-10-27 owner",
  "acceptance": [
    { "id": "A1", "check": "Scanning (or picking) a product already staged as a loose line adds 1 to that line's quantity instead of adding a new line." },
    { "id": "A2", "check": "The first scan of a product stages a line at quantity 1 in the product's carton unit (base unit when it has none), on a plate whose type is Carton." },
    { "id": "A3", "check": "After 'New pallet' is pressed, the next scanned product starts a separate Pallet plate, and repeat scans of that product count up on that new line." },
    { "id": "A4", "check": "While a mixed pallet is open, scans land on it, and a repeat scan of a product already on it adds 1 to that line." },
    { "id": "A5", "check": "A product flagged 'requires expiry' / 'requires lot' shows that field inline and Receive stays disabled until it is filled; unflagged lines can still enter lot and expiry optionally." },
    { "id": "A6", "check": "In the search box, ArrowDown then Enter adds the highlighted search result to the receipt." },
    { "id": "A7", "check": "The scan bar shows the staged totals (lines, units, plates, missing required fields) and the Receive button, so submitting needs no scroll to a footer." },
    { "id": "A8", "check": "The scan bar is pinned to the TOP of the scrollport at desktop width (>=1024px) and stays pinned to the BOTTOM at 360x664.", "manual": "Playwright scan-dock.spec.ts (mobile, bottom) plus a new desktop assertion, and a browser walk at 1280px and 360x664" },
    { "id": "A9", "check": "Once a supplier is chosen, the delivery details collapse to a one-line summary at every width (quarantine badge still visible); the separate 'Received by' field is gone.", "manual": "browser walk at 1280px and 360px" },
    { "id": "A10", "check": "After a receipt is recorded, the label sheet for the plates that need a label is rendered with no extra click, and the success card offers Print labels and Go to putaway." },
    { "id": "A11", "check": "Product WMS attributes can set 'Lot code required at receiving' and 'Expiry required at receiving'; migration 00134 adds both as NOT NULL DEFAULT false and mutate-wms-attributes saves them." },
    { "id": "A13", "check": "An unfinished receipt (delivery details, lines, plates) survives leaving Receive Stock and coming back — and a page reload — for the same user; it is cleared once recorded, expires after 24h, and is never shown to a different user." },
    { "id": "A12", "check": "Migration 00134 applied on dev and mutate-wms-attributes deployed to dev before the frontend; merged and deployed to dev; /version.json shows the merge sha.", "manual": "migrate:dev, fn deploy, deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/receiveStaging.test.ts", "test": "stageProduct > a repeat scan of the same product adds one to its line", "proves": ["A1"] },
    { "file": "__tests__/receiveStaging.test.ts", "test": "stageProduct > a first scan stages one carton on a carton plate", "proves": ["A2"] },
    { "file": "__tests__/receiveStaging.test.ts", "test": "stageProduct > after New pallet the next scan starts its own pallet and repeats count on it", "proves": ["A3"] },
    { "file": "__tests__/receiveStaging.test.ts", "test": "stageProduct > an open mixed pallet captures scans and counts repeats", "proves": ["A4"] },
    { "file": "__tests__/receiveDraft.test.ts", "test": "plate identity > defaults an ordinary plate to a carton, and honours an explicit pallet", "proves": ["A2"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > scanning the same barcode twice leaves one line at quantity 2", "proves": ["A1"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > a product that requires an expiry blocks Receive until one is entered", "proves": ["A5"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > ArrowDown then Enter adds the highlighted search result", "proves": ["A6"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > the scan bar shows the staged totals beside Receive", "proves": ["A7"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > a recorded receipt renders its labels without a click and offers Go to putaway", "proves": ["A10"] },
    { "file": "__tests__/productWmsReceivingFlags.test.tsx", "test": "ProductWmsAttributesSection > saves the receiving requirement flags", "proves": ["A11"] },
    { "file": "__tests__/receiveStockFlow.test.tsx", "test": "Receive Stock flow > keeps the staged receipt when the screen is left and reopened", "proves": ["A13"] },
    { "file": "__tests__/receiveDraftStore.test.ts", "test": "receive draft store > keeps one user's draft away from another", "proves": ["A13"] },
    { "file": "__tests__/receiveDraftStore.test.ts", "test": "receive draft store > drops a draft older than a day", "proves": ["A13"] }
  ],
  "allow": []
}
```

## Goal

Dock staff — on a desktop with a USB gun or on the RS35 — receive a delivery mostly
by scanning: repeat scans count cartons, the scan bar is where the eye is (top on
desktop, thumb-reach bottom on the handheld), totals and Receive are always visible,
lot/expiry are asked for only where the product needs them, and labels then putaway
follow in one or two taps. Interview with the owner, 2026-10-27.

## Approach

- Pure `components/inventory/receive/stageProduct.ts` (immutable) holds the
  merge/new-plate rules; the view updates lines and plates atomically via a reducer.
- `StickyScanBar` gains an `adaptive` position (bottom below `lg`, top from `lg`);
  the bar carries New pallet, Mixed pallet, totals and Receive.
- `ReceiveStockView` split into `DeliveryStrip`, `ReceiveWorkBar`,
  `ReceiveSuccessCard`, `RecentReceiptsPanel` (collapsed by default).
- `ReceiveLineCard`: −/+ on qty, inline required lot/expiry, optional fields kept
  behind the disclosure.
- Migration `00134`: `product_wms_attributes.requires_lot` / `requires_expiry`;
  `mutate-wms-attributes`, adapters/types, `ProductWmsAttributesSection`, plus a
  `useReceivingRequirements` read.
- `ReceiptPlateLabels` auto-render mode with a tap-to-print link; keyboard listbox
  for search results.

**Revision 2026-10-27 (owner, after trying it on dev):** an accidental click on another
sidebar tab threw the staged receipt away. A13 adds draft persistence in the browser's
own storage, keyed by user. That is a per-viewer convenience, so browser storage is the
right home; nothing here is shared or sent anywhere. Plate and line keys also become
unique per page load, so a restored draft can't collide with keys minted after a reload.

## Out of scope

- Receiving against a purchase order (expected vs received) — a later brief.
- **Server-side** enforcement of required lot/expiry in `receive-stock` — client-only
  for now so the CSV stock import is not broken.
- Per-UOM barcodes — a scan always counts the line's current unit.
- Amadiya rollout — ships later on a `rel-*` tag.
- Accepted trade-off: auto-rendering the sheet sets `label_printed` even if the
  sheet is never opened, which is what clicking Print already does today.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `stageProduct > a repeat scan of the same product adds one to its line`; `Receive Stock flow > scanning the same barcode twice leaves one line at quantity 2`. Browser (dev, Warehouse demo user): 3 scans of AYM-NOO-001 → one line, qty 3 | |
| A2 | claimed | `stageProduct > a first scan stages one carton on a carton plate`; `plate identity > defaults an ordinary plate to a carton, and honours an explicit pallet`. Browser: line in `carton (×12)`, Arrived on = Carton | Only real `product_uoms` rows count as a carton; a product with none counts its base unit |
| A3 | claimed | `stageProduct > after New pallet the next scan starts its own pallet and repeats count on it`. Browser: New pallet + 2 scans → second line, Pallet plate, qty 2; first line untouched at 3 | The new pallet line still counts in cartons (+1 per scan in the line's unit) |
| A4 | claimed | `stageProduct > an open mixed pallet captures scans and counts repeats` | |
| A5 | claimed | `Receive Stock flow > a product that requires an expiry blocks Receive until one is entered`; review regression `…keeps Receive disabled while ANY line lacks a required field…`. Browser: AYM-NOO-002 flagged on dev → "1 missing expiry", Receive disabled until a date was entered (flag reverted afterwards) | Client-side only, by design |
| A6 | claimed | `Receive Stock flow > ArrowDown then Enter adds the highlighted search result`. Browser: "rice flake", ArrowDown highlighted the row, Enter added it | |
| A7 | claimed | `Receive Stock flow > the scan bar shows the staged totals beside Receive`. Browser: "2 lines · 5 carton · 2 plates" beside "Receive 2 lines" in the bar | |
| A8 | claimed | Playwright `--project=mobile` on localhost: `scan-dock.spec.ts › Receive Stock: the dock holds while the page scrolls` passed (it FAILED before the helper fix, as the gate found), along with `receive-stock.spec.ts` (F25) and the Putaway dock test, 5/5. Full mobile project: 24 passed, 2 skipped, 3 failed — all three in `products-handheld.spec.ts` on a missing `E2E_ADMIN_EMAIL`, before any page loads. Also browser: at 1920px the dock computes `position: sticky; top: 0`, directly under the delivery strip. In a 356×660 same-origin frame it computes `bottom: 0`, and its bottom equals the scrollport's bottom (660) at both ends of a 2010px scroll; no horizontal overflow | Measured by script, not Playwright — see Not claimed |
| A9 | claimed | Browser (1920px): picking a supplier collapsed the strip to "AYAM Australia Distribution · Main Warehouse · 2026-10-27 · by Wendy Okafor" and focused the scan field; `Receive Stock flow > does not collapse the delivery details while a supplier name is still being typed` | Collapse at 360px follows the same code path; not separately walked |
| A10 | claimed | `Receive Stock flow > a recorded receipt renders its labels without a click and offers Go to putaway` | Unit test with mocked receive/print; no live receipt was submitted (see Not claimed) |
| A11 | claimed | `ProductWmsAttributesSection > saves the receiving requirement flags`; `migrate:dev` applied 00134 (both columns `boolean NOT NULL DEFAULT false`, read back from information_schema) | |
| A13 | claimed | `Receive Stock flow > keeps the staged receipt when the screen is left and reopened`; `receive draft store > keeps one user's draft away from another`; `receive draft store > drops a draft older than a day` (plus discard, forget-on-record, corrupt and throwing-storage cases). Browser on localhost: 2 lines / 3 cartons / supplier survived Receive Stock → Pick Queue → Receive Stock (the screen unmounted in between) and a full reload; Discard emptied the screen and removed the stored key. Deployed to dev in the combined build `02ef0a8` | Browser storage only: the draft does not follow the user to another device or browser |
| A12 | not-claimed | 00134 applied on dev; `mutate-wms-attributes` deployed to dev (uqvekvavkjjurpqtovbq) before any frontend | Not merged and not deployed to dev yet, so no merge sha on /version.json |

Also: an independent code review found two HIGH defects (an incomplete required line was silently dropped and wiped on Receive; the strip collapsed on the first keystroke). Both were fixed with regression tests, along with scans during save, reveal-behind-dock and hover hijacking Enter. Full suite 5212/5212, `tsc`, `check:edge-types` (83 clean), `lint` (baseline pruned by 5), `check:overlays`, `check:viewport`, and `build` all pass.

Owner feedback on dev, fixed in `f225491`: (1) the supplier list was painted under the scan bar and the lines. The card's backdrop-blur is a stacking context, so the card is now lifted while the list is open. (2) "Add a line by hand" gave a line with no way to choose its product; it now carries a product search. Regression tests: `Receive Stock flow > lifts the delivery details above the scan bar only while the supplier list is open` and `Receive Stock flow > lets a line added by hand be given its product`. Confirmed in a browser with `elementFromPoint`: every supplier row is top-most over the scan bar, and the hand-line options are top-most over Recent receipts. The combined voice + NX-0005 build was deployed to dev as `125e993` for owner review (not a merge sha).

### Not claimed

- No live receipt was submitted on dev, to keep the demo's stock and putaway queue clean. Auto-rendering labels and the success card are proven only against mocks.
- The planned desktop "dock at top" Playwright assertion was not added. The desktop half of A8 rests on a scripted measurement in a real browser.
- `products-handheld.spec.ts` (mobile) was not run green here: it needs `E2E_ADMIN_EMAIL`, which `.env.dev.local` does not set.
- If loading the receiving requirements FAILS, Receive is NOT blocked: the bar warns "check those by hand", deliberately, so a network blip cannot stop the dock. While they are still loading, Receive IS held (`Receive Stock flow > holds Receive until it is known which products need a lot or expiry`).
- After a receipt, staged lines that were not sent (no product, or quantity 0) are cleared along with the rest. That was already true on the base; incomplete REQUIRED lines can no longer reach this path, because they block Receive.
- Not tried on the RS35 itself: the IME scan path, gloves, and whether a three-row bottom dock (about 137px of 664) is comfortable.
- Required lot/expiry is not enforced server-side. A direct call to `receive-stock` (or the CSV import) can still omit them.
- A repeat scan counts onto the newest loose line even if that line already has a lot or expiry typed. A second batch of a flagged product needs New pallet or a line by hand.
- Auto-render marks plates `label_printed` even if the sheet is never opened (accepted in the brief).
- The hand-line product search's autofocus was not observed in the automated browser (the window was not focused); it is set, but not verified.

