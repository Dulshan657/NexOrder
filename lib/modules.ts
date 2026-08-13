// Module flags, frontend. Layer A of MULTI-TENANT-ARCHITECTURE.md §3.
//
// A module is a whole surface a tenant may not have bought. The three here are
// deliberately the three group headings the sidebar already draws — "Sales &
// Orders", "Field Ops", "Inventory & Dispatch" — because a gate the operator
// cannot point at on screen is a gate nobody can reason about.
//
// ── THESE ARE CONSTANTS, NOT STATE. THAT IS THE ENTIRE POINT ────────────────
//
// `vite.config.ts` `define`s each `__MODULE_*__` as the literal `true` or
// `false` for the target being built (`NEXORDER_ENV`). So:
//
//     if (!MODULE_INVENTORY_DISPATCH) return null
//
// folds to `if (false) return null` and Rollup deletes the branch — along with
// any `import()` only that branch could reach. A disabled module is therefore
// ABSENT from the tenant's bundle, not hidden inside it.
//
// Do NOT turn these into an array, an object lookup, a hook, or anything read
// at runtime. `MODULES.includes('warehouse')` is a runtime call on a runtime
// value: nothing folds, every byte of every disabled module ships, and anyone
// who opens devtools can see the surface their company did not pay for. The
// difference between *hidden* and *not shipped* is exactly this file.
//
// The server half is `supabase/functions/_shared/modules.ts`, which fails OPEN
// (a missing secret enables everything) because a module gate is a COMMERCIAL
// control — roles and RLS are the security controls, and they apply regardless.
//
// Turning a module off is therefore a REBUILD, not a toggle: edit `modules` in
// `config/environments.mjs`, then deploy. There is no runtime switch by design.

declare const __MODULE_SALES_ORDERS__: boolean
declare const __MODULE_FIELD_OPS__: boolean
declare const __MODULE_INVENTORY_DISPATCH__: boolean

/** Shop, Order Import, PO Inbox, Accounts, Promotions. */
export const MODULE_SALES_ORDERS: boolean = __MODULE_SALES_ORDERS__

/** HoReCa Insights, Scheduled Visits, Walk-in Review. */
export const MODULE_FIELD_OPS: boolean = __MODULE_FIELD_OPS__

/** Stock, Receiving, Putaway, Replenishment, Stocktake, Picking, Dispatch, Warehouse. */
export const MODULE_INVENTORY_DISPATCH: boolean = __MODULE_INVENTORY_DISPATCH__

/**
 * CORE surfaces are not listed and are not gateable: Dashboard, Products,
 * HoReCa (customers), Suppliers, Users, Settings, Audit Log, System Health and
 * auth. An ordering system without them is not the product, and a tenant who
 * bought only one module still needs a catalogue and a customer list.
 */
