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
    { "file": "__tests__/productWmsReceivingFlags.test.tsx", "test": "ProductWmsAttributesSection > saves the receiving requirement flags", "proves": ["A11"] }
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

## Out of scope

- Receiving against a purchase order (expected vs received) — a later brief.
- **Server-side** enforcement of required lot/expiry in `receive-stock` — client-only
  for now so the CSV stock import is not broken.
- Per-UOM barcodes — a scan always counts the line's current unit.
- Amadiya rollout — ships later on a `rel-*` tag.
- Accepted trade-off: auto-rendering the sheet sets `label_printed` even if the
  sheet is never opened, which is what clicking Print already does today.

## FINAL
