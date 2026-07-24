// Playwright E2E harness for NexOrder.
//
// There is no staging database (see CLAUDE.md) — every run, local or CI,
// talks to the same Supabase project the production app uses. Keep specs
// read-mostly; anything that must write data should be clearly named,
// idempotent, and clean up after itself.
//
// Auth: the app runs Supabase with `persistSession: false` (lib/supabase.ts)
// because session persistence hung `getSession()` on Windows. That means
// there is nothing durable in localStorage/sessionStorage/cookies for
// Playwright's `storageState` to capture — a fresh page load always renders
// the login form regardless of what a saved state.json contains. So this
// harness does NOT use storageState-based auth reuse; see
// tests/e2e/fixtures/auth.ts for the per-test login helper used instead.
import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const isCI = !!process.env.CI

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
