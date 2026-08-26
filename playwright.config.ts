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
      //
      // `soak` and `perf` are excluded for a blunter reason: one waits twelve
      // minutes and the other opens a visible window and asks for the machine's
      // full attention. Neither belongs in the suite somebody runs before a
      // commit, and neither is a regression test — they are instruments.
      testIgnore: ['**/mobile/**', '**/soak/**', '**/perf/**'],
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
      // HEIGHT IS 664, NOT 780 — and not 720 either. The RS35's CSS layout
      // viewport is 360x720, but Chrome's URL bar takes ~56px of it and cannot
      // retract here (the shell is `overflow-hidden` and `document.body` never
      // scrolls, so there is no root-scroll gesture to retract it with). 664 is
      // what the operator can actually see, which is the number that decides
      // whether a control is reachable. At 780 nothing vertical was under test
      // at all.
      //
      // Stated limitation, so a green run is not over-read: Playwright's
      // `viewport` sets the layout AND visual viewport together, so it can never
      // model "layout viewport taller than the visual one". This makes vertical
      // CONTENT pressure testable; it cannot catch the `h-screen` vs `h-svh`
      // defect itself (F36). Only `npm run scan:diagnostics`, read on the
      // device, measures that.
      name: 'mobile',
      testMatch: '**/mobile/**/*.spec.ts',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 664 } },
    },
    {
      // O6 — the shift-long session soak. NOT a regression test: it runs for
      // twelve minutes, and it only means anything once the project it points
      // at has been put on a short-lived JWT. `scripts/session-soak.mjs` is
      // what does that, and `npm run soak:session:dev` is how to run this.
      // Invoking `--project=soak` by hand against a one-hour token makes the
      // spec fail immediately and say so, rather than sit there for an hour.
      name: 'soak',
      testDir: './tests/soak',
      testMatch: '**/*.spec.ts',
      // The subject IS elapsed time, so the suite-wide 30s is nowhere near
      // enough; the spec raises it again for its own run.
      timeout: 25 * 60_000,
      // A retry would silently double a twelve-minute run and, worse, hide an
      // intermittent refresh failure — which is the defect being measured.
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // O14 — the backdrop-blur measurement harness. HEADED, deliberately.
      // The previous attempt ran in a browser-automation tab that is always
      // `document.hidden`, where requestAnimationFrame is throttled to about
      // 1fps and every frame time is scheduler noise rather than paint cost.
      // A foregrounded window with backgrounding disabled is the only way
      // this measures anything; the spec re-checks that at runtime and
      // refuses to report numbers if it finds itself throttled regardless.
      name: 'perf',
      testDir: './tests/perf',
      testMatch: '**/*.spec.ts',
      timeout: 15 * 60_000,
      retries: 0,
      // One at a time. Two browsers competing for the CPU would be measuring
      // each other rather than the thing under test.
      workers: 1,
      fullyParallel: false,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 780 },
        headless: false,
        launchOptions: {
          args: [
            // Chromium throttles timers and rAF in a window it believes is
            // hidden or occluded. All three are needed, because the window
            // can lose focus to whatever else is on the desktop mid-run.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--window-position=0,0',
            // Software compositing, and this is the closest thing here to an
            // RS35. A desktop's discrete GPU rasterises an 8px backdrop-filter
            // for nothing, so on hardware the shipped condition reads as free
            // no matter how much CPU throttling is applied — the cost is simply
            // not on the thread being throttled. It also made the first run
            // useless in a second way: with the GPU in the loop the baseline
            // wandered by 4x between trials, from causes that had nothing to do
            // with blur. Software raster puts the work on the CPU, where the
            // throttle can reach it and where it is stable enough to compare.
            // Toggled off with PERF_GPU=1, which is worth doing at least once:
            // an RS35 does have a GPU, so software raster is a HARSHER proxy
            // than the device, not a neutral one. Reporting only the software
            // figure would overstate the case.
            ...(process.env.PERF_GPU ? [] : ['--disable-gpu']),
          ],
        },
      },
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
