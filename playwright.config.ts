// Playwright E2E harness for NexOrder.
//
// WHERE THIS RUNS. The demo was rebuilt on NexGen's own Supabase account and
// Vercel team on 2026-08-13, so there is somewhere to point this again:
// E2E_BASE_URL=https://nexorder.vercel.app, or a local dev server. (This header
// said "there is nowhere to run this" from the cutover until 2026-08-18, which
// is most of why the small-screen gap below went uncovered.) Every tenant
// origin is still asserted out — specs write data, and a client's database is
// not a test fixture — so nexorder.com.au is refused, permanently.
//
// Keep specs read-mostly regardless; anything that must write should be clearly
// named, idempotent, and clean up after itself.
//
// Auth: this harness does NOT use storageState-based auth reuse — see
// tests/e2e/fixtures/auth.ts for the per-test login helper used instead, and
// for why the reason it does not is no longer the one this comment used to
// give. (`persistSession` is ON as of the warehouse-onboarding branch; the
// conclusion is unchanged, the justification is not.)
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
      // The mobile specs are EXCLUDED here, not merely duplicated there. Half
      // of what they assert (a collapsed card tier, a wrapped action bar) is
      // false at desktop width by design, so running them in both projects
      // would fail for the correct behaviour.
      testIgnore: '**/mobile/**',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 360 px, the RS35's width. Registered as O7: until now the only project
      // was Desktop Chrome, so every fix the register lists at 360 px — the
      // Receive Stock card tier, the stocktake action bar, the 44 px touch
      // targets, the ☰ clearance — could regress with nothing to catch it.
      //
      // Pixel 5 is 393×851; `viewport` narrows it to the real device. Keeping
      // the rest of the descriptor (touch, mobile UA, deviceScaleFactor) is the
      // point — `hasTouch` is what makes the pointer-driven surfaces behave as
      // they do on the handheld.
      name: 'mobile',
      testMatch: '**/mobile/**/*.spec.ts',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 } },
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
