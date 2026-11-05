# NX-0029 — Ship an imported order short without touching other orders' stock

```json brief
{
  "id": "NX-0029-short-picks",
  "base": "02ee452557d0096d74e1ada44def387a33b0180a",
  "approved": "2026-11-06 owner",
  "acceptance": [
    { "id": "A1", "check": "A migration creates `pick_differences` with client writes revoked and RLS on, keeps every replaced function's signature, restricts `inv_close_line_short` to `service_role`, and gates the new pick and completion behaviour on `orders.qb_invoice_number`." },
    { "id": "A2", "check": "`pick_differences` is in `LOCKED_TABLES`, and `record-short-pick` belongs to the `inventory_dispatch` module." },
    { "id": "A3", "check": "An imported line's unreserved part is offered at bins with stock, and a line already closed short is offered nowhere." },
    { "id": "A4", "check": "An open line on an imported order offers 'None found / finish short' behind a confirm step, and the row shows the found quantity. Any other order never offers it." },
    { "id": "A5", "check": "Packing unlocks when every line is picked or closed short. An open line keeps it locked." },
    { "id": "A6", "check": "When an imported line has no bin with recorded stock, the picker can scan any bin in the warehouse." },
    { "id": "A7", "check": "Cancelling or dispatching any order releases only that order's own remaining reservation. Another order holding the same product keeps every unit, a second release changes nothing, and a release never raises.", "manual": "npm run test:integration on dev, rolled back, including the existing cancellation, reroute and balancing suites" },
    { "id": "A8", "check": "Dispatching from a warehouse with racked bins releases what this order still holds in those bins.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A9", "check": "Closing a line short records one difference, including for zero found and on a retry. On-hand stock stays unchanged, and only that line's open units are released, including when one product is on two lines.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A10", "check": "Closing short is refused for a cancelled order, an order outside `processed` and `picked`, and an order with no invoice number. A pick on a line closed short is refused.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A11", "check": "An imported order's pick beyond its reservation takes only free stock and this order's own stock, and never lowers another order's allocated.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A12", "check": "When an imported pick finds less recorded stock than was physically picked, the pick is recorded, on-hand stops at what is free and never goes negative, and an `unrecorded_stock` difference flags that bin for recount.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A13", "check": "An imported order is not pick-complete at a warehouse while a line is open, unless another warehouse still holds that open part. This includes an order with little or no reservation.", "manual": "npm run test:integration on dev, rolled back" },
    { "id": "A14", "check": "An order without an invoice number picks and completes as before, and still raises INSUFFICIENT_STOCK.", "manual": "npm run test:integration on dev, rolled back, including the existing pick suites" },
    { "id": "A15", "check": "Merged and deployed to dev, with the flow walked on an imported order made up for the test: pick by barcode and by SKU label, short one line, zero another, pack, dispatch.", "manual": "deploy:dev, fn:deploy of the changed functions, and a browser walk" }
  ],
  "failFirst": [
    { "file": "__tests__/shortPick/shortPickSchema.test.ts", "test": "short pick schema > keeps pick_differences and inv_close_line_short away from client roles", "proves": ["A1"] },
    { "file": "__tests__/shortPick/shortPickSchema.test.ts", "test": "short pick schema > replaces the pick, release and completion functions with their existing signatures", "proves": ["A1"] },
    { "file": "__tests__/shortPick/shortPickSchema.test.ts", "test": "short pick schema > applies the new pick and completion rules to imported orders only", "proves": ["A1"] },
    { "file": "__tests__/shortPick/shortPickSchema.test.ts", "test": "short pick schema > locks pick_differences and assigns record-short-pick to inventory_dispatch", "proves": ["A2"] },
    { "file": "__tests__/wie/pickTasks.fallback.test.ts", "test": "buildFallbackTasks > offers bins with stock for the unreserved part of a line", "proves": ["A3"] },
    { "file": "__tests__/wie/pickTasks.fallback.test.ts", "test": "buildFallbackTasks > offers nothing for a line already closed short", "proves": ["A3"] },
    { "file": "__tests__/pickWorkspaceShort.test.tsx", "test": "pick workspace short picks > offers finish short on an open imported line, behind a confirm step", "proves": ["A4"] },
    { "file": "__tests__/pickWorkspaceShort.test.tsx", "test": "pick workspace short picks > never offers finish short on any other order", "proves": ["A4"] },
    { "file": "__tests__/pickWorkspaceShort.test.tsx", "test": "pick workspace short picks > unlocks packing when every line is picked or closed short", "proves": ["A5"] },
    { "file": "__tests__/pickWorkspaceShort.test.tsx", "test": "pick workspace short picks > keeps packing locked while a line is open", "proves": ["A5"] },
    { "file": "__tests__/pickWorkspaceShort.test.tsx", "test": "pick workspace short picks > lets the picker scan any bin when no bin has recorded stock", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

A client will pick from invoices raised elsewhere, so stock can be short, missing or more than the system shows. Today none of that can finish: zero found cannot be recorded, a short line blocks dispatch, and a pick can lower another order's reservation. This lets an imported order ship with what was really found and records every difference for the office. It also fixes the shared release function, which can take other orders' stock. That fix must ship before imported orders go live.

## Approach

**Release, for all orders.** `inv_release_reservation` keeps its signature but releases this order's own remainder per product and bin: allocate minus deallocate minus picks at that bin. It takes no more than the bin's allocated minus what other open orders hold there, and a shortfall is logged, never raised, because dispatch and cancel must still finish. `p_location_id` now covers a warehouse's bins, because dispatch passes the warehouse and today matches no racked bin.

**Closing a line short.** New `pick_differences` table, `inv_close_line_short(p_order_item_id INT, p_location_id INT, p_actor UUID) RETURNS JSONB` and `POST record-short-pick { orderItemId, locationId? }` for Admin, Manager and Warehouse, following `record-pick`'s auth, rate limit and audit event. `p_location_id` may be null, because a product never counted has no bin to flag. A unique index makes a retry add nothing, and short rows with a bin are flagged for recount. No stock is written off: only a count changes on-hand.

**Picking, imported orders only.** `inv_pick_order_line` keeps its signature. For an order with `qb_invoice_number`, each balance row gives up this order's own remainder first, then free stock, and never another order's allocation. Whatever is left is recorded as picked and added to an `unrecorded_stock` difference. Every other order follows today's path unchanged. A line closed short refuses further picks, and `OVER_PICK` stays.

**Completion.** `inv_warehouse_pick_complete` adds a line check for imported orders, because it currently counts only reserved stock and passes an order with none. `NOT_FULLY_PICKED` then needs no change.

**Screens.** `buildFallbackTasks` in `_shared/wie/pickTasks.ts`, `order-pick-tasks`, `PickTaskRow` and `PickWorkspaceModal`, and an extension of the pick scan check if a SKU label is not already accepted. All test data is made up.

## Out of scope

- The office differences screen and the dispatch advice note, which are the next brief. Differences are recorded here but can only be read in the database.
- Undoing a line closed short by mistake. The confirm step guards it.
- Changing `qb_release_own_allocation` from NX-0026, picking beyond the ordered quantity, recount tasks, and demo orders.
- Any release to a client tenant.

## FINAL
