// Playwright E2E harness for NexOrder.
//
// ⚠ AS OF 2026-08-12 THERE IS NOWHERE TO RUN THIS. The project these specs used
// to target became Amadiya's production database in the cutover, and the demo
// has not been rebuilt on its own account yet. Every tenant origin is asserted
// out below — specs write data, and a client's database is not a test fixture —
// so pointing E2E_BASE_URL at nexorder.com.au is refused, and there is no other
// deployment to point it at. Restore this when the demo environment exists.
//
// Keep specs read-mostly regardless; anything that must write should be clearly
// named, idempotent, and clean up after itself.
//
// Auth: the app runs Supabase with `persistSession: false` (lib/supabase.ts)
// because session persistence hung `getSession()` on Windows. That means
// there is nothing durable in localStorage/sessionStorage/cookies for
// Playwright's `storageState` to capture — a fresh page load always renders
// the login form regardless of what a saved state.json contains. So this
// harness does NOT use storageState-based auth reuse; see
// tests/e2e/fixtures/auth.ts for the per-test login helper used instead.
import { defineConfig, devices } from '@playwright/test'

import { tenantTargets } from './config/environments.mjs'

const PORT = 3000
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const isCI = !!process.env.CI

// Fail closed rather than quietly exercising a client's system. Checks EVERY
// tenant, not one named entry — a guard that protects only the first client is
// worse than none, because it reads as though it protects all of them.
for (const tenant of tenantTargets()) {
  if (tenant.appOrigin && BASE_URL.startsWith(tenant.appOrigin)) {
    throw new Error(
      `E2E_BASE_URL points at the ${tenant.label} deployment (${tenant.appOrigin}). ` +
        'The E2E suite creates and mutates data. Point it at the dev deployment ' +
        'or a local dev server.',
    )
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }], ['github']]
    : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Boots the Vite dev server for local runs. In CI, set E2E_BASE_URL to a
  // preview deployment (or start the server as a separate CI step) and this
  // block is skipped by pointing `reuseExistingServer` at it — see
  // `url` below, which Playwright polls before running any test.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
