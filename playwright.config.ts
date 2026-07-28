// Playwright E2E harness for NexOrder.
//
// E2E runs against the DEV/demo environment (nexorder.vercel.app, the Singapore
// Supabase project). Production is a separate project serving nexorder.com.au
// and is asserted out below — specs write data, and a client's database is not
// a test fixture. Keep specs read-mostly regardless; anything that must write
// should be clearly named, idempotent, and clean up after itself.
//
// Auth: the app runs Supabase with `persistSession: false` (lib/supabase.ts)
// because session persistence hung `getSession()` on Windows. That means
// there is nothing durable in localStorage/sessionStorage/cookies for
// Playwright's `storageState` to capture — a fresh page load always renders
// the login form regardless of what a saved state.json contains. So this
// harness does NOT use storageState-based auth reuse; see
// tests/e2e/fixtures/auth.ts for the per-test login helper used instead.
import { defineConfig, devices } from '@playwright/test'

import { ENVIRONMENTS } from './config/environments.mjs'

const PORT = 3000
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const isCI = !!process.env.CI

// Fail closed rather than quietly exercising the client's system.
const PROD_ORIGIN = ENVIRONMENTS.prod.appOrigin
if (PROD_ORIGIN && BASE_URL.startsWith(PROD_ORIGIN)) {
  throw new Error(
    `E2E_BASE_URL points at production (${PROD_ORIGIN}). The E2E suite creates and ` +
      'mutates data. Point it at the dev deployment or a local dev server.',
  )
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
