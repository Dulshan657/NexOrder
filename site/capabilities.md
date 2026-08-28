# Capabilities

Nex Order is sold in modules. A deployment carries the ones the business bought,
and the rest are not merely hidden — the code for them is not in the build.

## Sales and orders

The order object and its lifecycle: place it, price it, advance it through
processing, picking, packing, dispatch and delivery, or cancel it. Every other
module that produces an order depends on this one.

- Orders keyed in by an office rep, with paste-in line entry from a customer's
  own spreadsheet
- Per-customer tier pricing, pack sizes and unit-of-measure conversion
- Delivery dates, delivery addresses and picking notes carried from the source
  document
- A status ladder that only moves forward, with cancellation as a separate,
  audited act

## Shop

The self-service ordering surface for customers and reps: catalogue browsing,
search, a cart, saved pantry lists for repeat orders, promotions and bundles.

## PO Inbox

Inbound purchase orders, read from email. A mailbox is connected once; from then
on arriving orders are extracted into structured lines, matched to the right
customer and the right products, and queued for an operator to approve or reject.
Sender-to-customer and code-to-product mappings are learned and reused.

Printed details a person would otherwise re-key — requested dates, delivery
instructions, ship-to and job addresses — are carried onto the order.

## Inventory and dispatch

The warehouse half of the product.

- **Receiving** against purchase orders or as opening stock, including mixed
  pallets and per-pallet labelling
- **Putaway** with a routing engine that scores every candidate location against
  the operator's own rules, walks the operator to it, and records the scan
- **Directed picking**, routed bin by bin, scan-enforced at the bin and the item
- **Replenishment** from reserve and bulk locations to pick faces, driven by
  per-product minimum and maximum levels
- **Slotting** rules that say where a product belongs, and an off-home queue
  listing the stock that is not there yet
- **Stocktake by location**, counted on a handheld, one number per product
- **A warehouse map**: racking drawn to scale, published to a routing graph,
  with named areas, floor signs and printable location labels

## Field operations

Customer visits, scheduled routes, visit photos and notes, and per-customer
insight for reps working a territory.

## Promotions

Time-bounded promotional pricing and bundles, resolved alongside tier pricing so
one price answer comes out of the system.

## Invoicing

Invoices raised against delivered orders, payment status, and accounts-aging
reporting.

## Across all of it

- **Every privileged change is audited** — who did it, when, and what changed.
- **Roles decide what exists**, not just what is visible; a role that cannot do
  something is not offered it.
- **Handheld-first where it matters.** The warehouse surfaces are built for a
  rugged Android scanner held in one gloved hand, not a phone browser.
