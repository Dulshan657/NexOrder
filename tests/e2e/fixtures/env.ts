// Central place to read E2E env vars. Never hardcode a credential here or in
// any spec — read it from process.env at runtime, and fail loudly with a
// clear message if a required var is missing so a spec can't silently run
// against `undefined`/`undefined`.
//
// Required (see tests/e2e/README.md):
//   E2E_ADMIN_PASSWORD   — password for the seeded Admin demo account.
// Optional:
//   E2E_BASE_URL          — defaults to http://localhost:3000 (also the
//                           default in playwright.config.ts).
//   E2E_ADMIN_EMAIL       — defaults to alice@nexorder.com.au (the seeded
//                           Admin demo account listed on the login screen —
//                           not a secret, just an identifier).

export interface E2eEnv {
  baseURL: string
  adminEmail: string
  adminPassword: string
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
