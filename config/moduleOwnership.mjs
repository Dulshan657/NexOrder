// Which module owns which Edge Function.
//
// Read by `supabase/ops/deploy-functions.mjs`, which will not deploy a
// disabled module's functions to a target, and asserted against the functions
// themselves by `__tests__/moduleOwnership.test.ts` — every function listed
// here must call `requireModule` with the same slug, and every function that
// calls `requireModule` must be listed here. Two representations of one fact,
// kept honest by a test, exactly as `_shared/warehouseSetupSteps.ts` and
// `lib/warehouseSetup/steps.ts` are.
//
// ── WHY THE MAP IS HERE AND THE CALL IS THERE ───────────────────────────────
//
// `_shared/*` cannot import from outside `supabase/functions` (Deno resolves
// those paths at deploy time and the directory is uploaded on its own), and
// `deploy-functions.mjs` is Node and cannot import Deno TypeScript. Neither
// side can own the map alone. The test is what stops that costing anything.
//
// ── UNLISTED MEANS CORE, AND CORE IS THE DEFAULT ────────────────────────────
//
// A function absent from this map is never gated: auth, products, customers,
// suppliers, users, settings, audit, health and error logging are the product
// rather than an upsell. `create-order-document-url` and the two OAuth
// callbacks are deliberately here too:
//
//   - `create-order-document-url` serves an order's paperwork, which both a
//     sales user and a warehouse user reach by different routes. Gating it to
//     either module breaks the other.
//   - `gmail-oauth-callback` / `outlook-oauth-callback` are browser redirects,
//     not JSON APIs, so a thrown error envelope would land a human on a blank
//     page. They are unreachable anyway when `start-po-oauth` is gated — you
//     cannot arrive at a callback for a flow you could not begin.

import { ALL_MODULES } from './environments.mjs'

/** @type {Record<string, typeof ALL_MODULES[number]>} */
export const FUNCTION_MODULES = {
  // ── sales_orders ──────────────────────────────────────────────────────────
  // The ORDER ITSELF and nothing else: create it, advance it along the status
  // ladder, cancel it. This module used to hold all nineteen functions below;
  // it was split on 2026-08-20 when Amadiya turned out to want orders and a
  // warehouse without a Shop, a PO Inbox, Promotions or Accounts.
  //
  // `update-order-status` sits here even though pick → pack → dispatch is
  // warehouse work driven by a Warehouse login. It is one function with one
  // gate, and its other half (processing → processed) is what CREATES the
  // fulfilment rows a pick needs. A tenant running a warehouse is a tenant
  // with orders, so `sales_orders` is on wherever `inventory_dispatch` does
  // anything — see MODULE_REQUIRES' note in config/environments.mjs on why the
  // dependency is not encoded in the other direction.
  'place-order': 'sales_orders',
  'update-order-status': 'sales_orders',
  'cancel-order': 'sales_orders',

  // ── shop ──────────────────────────────────────────────────────────────────
  // Self-service ordering: the catalogue browse, the cart, the pantry, and the
  // signature captured at placement. The signature's BOTH halves live here —
  // the canvas is in the cart, so with the Shop off there is nothing to sign
  // and nothing signed to read back.
  'mutate-pantry-item': 'shop',
  'upload-signature': 'shop',
  'create-signature-url': 'shop',

  // ── po_inbox ──────────────────────────────────────────────────────────────
  // Inbound-PO email triage end to end: the mailbox connections, the poll, the
  // extraction, and the approve/reject that turns a parsed PO into a real
  // order. Requires `sales_orders` — an approved PO has nowhere to land
  // without it, which is the dependency `assertModuleSet()` enforces.
  //
  // `mutate-purchase-order` is here and not in inventory: "PO" in this
  // codebase means an INBOUND CUSTOMER purchase order, never procurement.
  // Receiving stock needs a supplier, not a PO.
  'mutate-purchase-order': 'po_inbox',
  'approve-po': 'po_inbox',
  'reject-po': 'po_inbox',
  'extract-po': 'po_inbox',
  'poll-inbox': 'po_inbox',
  'mutate-po-alias': 'po_inbox',
  'start-po-oauth': 'po_inbox',
  'create-po-document-url': 'po_inbox',
  'pause-email-account': 'po_inbox',
  'disconnect-email-account': 'po_inbox',
  'retry-email-account': 'po_inbox',

  // ── promotions ────────────────────────────────────────────────────────────
  // With this off, `pricing.ts` resolves every line at the product's list
  // price, which is what a tenant on a single flat price list wants.
  'mutate-promotion': 'promotions',

  // ── invoicing ─────────────────────────────────────────────────────────────
  // Invoices and the Accounts (aging) tab. Off for a tenant that bills
  // somewhere else entirely.
  'mutate-invoice-status': 'invoicing',

  // ── field_ops ─────────────────────────────────────────────────────────────
  // Still thin. Scheduled visits, walk-in review and HoReCa insights are mostly
  // RLS-scoped table reads and writes with no Edge Function of their own, so
  // this module's gate is largely the frontend one. That is a fact about where
  // the code happens to live, not a weaker guarantee: the surface is compiled
  // out of the bundle either way.
  'mutate-sales-target': 'field_ops',
  // Visit photographs, private since mig 00113. `visits` is the only table
  // that references this bucket and every surface reading it — VisitTimeline,
  // the visit modal, and Routes' scheduled-visit tracking — is a Field Ops
  // surface, including the Admin-facing one.
  'mutate-visit-photo': 'field_ops',
  'create-visit-photo-urls': 'field_ops',

  // ── inventory_dispatch ────────────────────────────────────────────────────
  // The warehouse programme end to end: stock, putaway, replenishment,
  // picking, dispatch, labels, layouts and the WIE.
  'adjust-stock': 'inventory_dispatch',
  'assign-replenishment': 'inventory_dispatch',
  'commit-reslot-plan': 'inventory_dispatch',
  'complete-putaway': 'inventory_dispatch',
  'complete-replenishment': 'inventory_dispatch',
  'confirm-label-print': 'inventory_dispatch',
  'count-bin': 'inventory_dispatch',
  'create-floorplan-upload-url': 'inventory_dispatch',
  'decide-putaway': 'inventory_dispatch',
  'decide-slotting-suggestion': 'inventory_dispatch',
  'detect-replenishment': 'inventory_dispatch',
  'extract-floorplan': 'inventory_dispatch',
  'generate-dispatch-advice': 'inventory_dispatch',
  'generate-labels': 'inventory_dispatch',
  'generate-pick-slip': 'inventory_dispatch',
  'mutate-layout': 'inventory_dispatch',
  'mutate-level-role': 'inventory_dispatch',
  'mutate-slotting-rule': 'inventory_dispatch',
  'mutate-product-home-bin': 'inventory_dispatch',
  'mutate-scoring-profile': 'inventory_dispatch',
  'mutate-storage-type': 'inventory_dispatch',
  'mutate-warehouse': 'inventory_dispatch',
  'mutate-warehouse-location': 'inventory_dispatch',
  'mutate-warehouse-setup-ack': 'inventory_dispatch',
  'mutate-wie-rule': 'inventory_dispatch',
  'mutate-wms-attributes': 'inventory_dispatch',
  'mutate-zone-profile': 'inventory_dispatch',
  'order-pick-tasks': 'inventory_dispatch',
  'plan-reslot': 'inventory_dispatch',
  'publish-layout': 'inventory_dispatch',
  'receive-stock': 'inventory_dispatch',
  'recommend-pick-route': 'inventory_dispatch',
  'recommend-putaway': 'inventory_dispatch',
  'recommend-putaway-route': 'inventory_dispatch',
  'recommend-replen-route': 'inventory_dispatch',
  'record-pick': 'inventory_dispatch',
  'release-quarantine': 'inventory_dispatch',
  'transfer-stock': 'inventory_dispatch',
  'unassign-replenishment': 'inventory_dispatch',
  'wie-batch-reoptimize': 'inventory_dispatch',
  'wie-simulate': 'inventory_dispatch',
}

/**
 * Function names that must NOT be deployed to a target, given its modules.
 *
 * Note what this does not do: it cannot retire a function already deployed to
 * a project whose module was later switched off. `deploy-functions.mjs` reports
 * that case rather than deleting anything, because deleting a live function is
 * not a thing a deploy script should decide to do on its own.
 *
 * @param {{ modules: readonly string[] }} config a TARGETS entry
 * @returns {string[]}
 */
export function disabledFunctionsFor(config) {
  const enabled = new Set(config.modules)
  return Object.entries(FUNCTION_MODULES)
    .filter(([, slug]) => !enabled.has(slug))
    .map(([fn]) => fn)
    .sort()
}

/** Sanity: every slug used above is a real module. Throws at import time. */
for (const [fn, slug] of Object.entries(FUNCTION_MODULES)) {
  if (!ALL_MODULES.includes(slug)) {
    throw new Error(
      `config/moduleOwnership.mjs: "${fn}" is assigned to unknown module "${slug}". ` +
        `Known modules: ${ALL_MODULES.join(', ')}.`,
    )
  }
}
