// Module flags, frontend. Layer A of MULTI-TENANT-ARCHITECTURE.md §3.
//
// A module is a whole surface a tenant may not have bought. Two of the seven
// here are the sidebar group headings "Field Ops" and "Inventory & Dispatch",
// because a gate the operator cannot point at on screen is a gate nobody can
// reason about. The other five subdivide the third heading, "Sales & Orders",
// which turned out to hold five separately-sellable things: the ORDER ITSELF
// (`sales_orders` — place it, advance it, cancel it), and the Shop, the PO
// Inbox, Promotions and Accounts, which all merely travel with it. Amadiya
// keys in orders and runs a warehouse and bought none of the other four.
//
// Each of those four REQUIRES `sales_orders`; `config/environments.mjs`
// `assertModuleSet()` refuses a registry that says otherwise.
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
declare const __MODULE_SHOP__: boolean
declare const __MODULE_PO_INBOX__: boolean
declare const __MODULE_PROMOTIONS__: boolean
declare const __MODULE_INVOICING__: boolean
declare const __MODULE_FIELD_OPS__: boolean
declare const __MODULE_INVENTORY_DISPATCH__: boolean

/**
 * The order object and its status ladder: New Order, Order Import, and the
 * pick → pack → dispatch transitions the warehouse drives. NOT the Shop — an
 * operator can key an order in without customers ever seeing a catalogue.
 */
export const MODULE_SALES_ORDERS: boolean = __MODULE_SALES_ORDERS__

/**
 * Self-service ordering: the Shop, the cart, the pantry, and the signature
 * captured at placement. Gates the Customer role, whose whole purpose it is.
 */
export const MODULE_SHOP: boolean = __MODULE_SHOP__

/** Inbound-PO email triage: the PO Inbox tab, its mailboxes and its aliases. */
export const MODULE_PO_INBOX: boolean = __MODULE_PO_INBOX__

/** The Promotions tab and promotional pricing. Off means list price, always. */
export const MODULE_PROMOTIONS: boolean = __MODULE_PROMOTIONS__

/** Invoices, invoice status and the Accounts (aging) tab. */
export const MODULE_INVOICING: boolean = __MODULE_INVOICING__

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
