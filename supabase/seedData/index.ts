// Demo seed data, kept out of the browser bundle.
//
// constants.ts used to hold all of this. It is imported by 15 browser-reachable
// modules that only ever wanted the small lookup tables (CATEGORIES, UOM_CODES,
// ORDER_STATUS_*, DELIVERY_*, DEFAULT_SETTINGS, USERS) — but a top-level
// `PRODUCTS.forEach(p => { p.cubicMetersUnit = ... })` made the module
// side-effectful, so Rollup could not drop any of it and ~70 kB of demo orders,
// venues and base64 signatures shipped to every user.
//
// Nothing here has a consumer outside supabase/seed.ts.
export { SUPPLIERS, PRODUCTS } from './products';
export { HORECAS, ALL_ORDERS, ALL_PURCHASE_ORDERS, INITIAL_PANTRY_LISTS, INITIAL_INVOICES } from './orders';
export { INITIAL_SALES_TARGETS, INITIAL_PROMOTIONS, INITIAL_ROUTES, INITIAL_VISITS } from './schedules';
