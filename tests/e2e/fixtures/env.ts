// Central place to read E2E env vars. Never hardcode a credential here or in
// any spec — read it from process.env at runtime, and fail loudly with a
// clear message if a required var is missing so a spec can't silently run
// against `undefined`/`undefined`.
//
// Required (see tests/e2e/README.md):
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  — the seeded Admin demo account.
// Required only by the `mobile` project:
//   E2E_WAREHOUSE_EMAIL / E2E_WAREHOUSE_PASSWORD — a Warehouse-role account.
// Optional:
//   E2E_BASE_URL          — defaults to http://localhost:3000 (also the
//                           default in playwright.config.ts).

export interface E2eEnv {
  baseURL: string
  adminEmail: string
  adminPassword: string
}

export interface E2eWarehouseEnv {
  warehouseEmail: string
  warehousePassword: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Set it before running Playwright, e.g.\n` +
        `  E2E_ADMIN_PASSWORD=... npm run test:e2e\n` +
        'See tests/e2e/README.md for the full list of vars this suite needs.',
    )
  }
  return value
}

export function getE2eEnv(): E2eEnv {
  return {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // Required, not defaulted. The old default named a seeded demo admin that
    // exists on exactly one database; anywhere else the suite would log in as
    // nobody and fail with something that looks like a UI bug.
    adminEmail: requireEnv('E2E_ADMIN_EMAIL'),
    adminPassword: requireEnv('E2E_ADMIN_PASSWORD'),
  }
}

/**
 * The Warehouse-role account the mobile specs sign in as.
 *
 * Read separately from `getE2eEnv` on purpose: the desktop suite must not start
 * demanding two more variables because a phone-width suite exists beside it.
 *
 * The role matters as much as the width. Several of the surfaces these specs
 * cover are gated on `profiles.home_warehouse_id` matching the selected site —
 * Stocktake's Post button is the one the register logged as E1 — so signing in
 * as Admin would render the same layout while proving nothing about the person
 * who actually walks the floor with the handheld.
 */
export function getE2eWarehouseEnv(): E2eWarehouseEnv {
  return {
    warehouseEmail: requireEnv('E2E_WAREHOUSE_EMAIL'),
    warehousePassword: requireEnv('E2E_WAREHOUSE_PASSWORD'),
  }
}
