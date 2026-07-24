# E2E tests (Playwright)

There is no staging database for NexOrder — every run, local or CI, talks to
the same Supabase project the production app uses (see root `CLAUDE.md`).
Keep specs read-mostly. Anything that must write data should be clearly
named, idempotent, and clean up after itself (see `tests/e2e/rack-levels/`
for examples: an ephemeral, permanently-named fixture warehouse; `finally`
blocks that restore edited product attributes / delete draft layouts).

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download
```

## Running

```bash
# Boots the Vite dev server automatically (see playwright.config.ts webServer)
E2E_ADMIN_PASSWORD=... npm run test:e2e

npm run test:e2e:ui       # interactive UI mode
npm run test:e2e:headed   # see the browser
npx playwright test tests/e2e/smoke.spec.ts   # a single file
npx playwright show-report
```

## Required env vars

| Var | Required? | Default | Notes |
|---|---|---|---|
| `E2E_ADMIN_PASSWORD` | **Yes** | — | Password for the seeded Admin demo account. Never hardcode this — read it from `NexOrder/.env.local` / your password manager and export it in the shell that runs Playwright. |
| `E2E_ADMIN_EMAIL` | No | `alice@nexorder.com.au` | The seeded Admin demo account listed on the login screen. Not a secret. |
| `E2E_BASE_URL` | No | `http://localhost:3000` | Point at a preview deployment for CI if you don't want Playwright to boot `npm run dev` itself. |
| `CI` | No | unset | Set by CI runners; toggles retries, worker count, and JUnit/GitHub reporters. |

## Auth: why there's no `storageState` reuse

The app runs its Supabase client with `persistSession: false`
(`lib/supabase.ts`) — enabling persistence (localStorage or sessionStorage)
made `getSession()` hang indefinitely on Windows, so the team turned it off.
That means a successful sign-in leaves nothing durable in
localStorage/sessionStorage/cookies: a fresh page load always renders
`<LoginPage>` no matter what a saved `storageState.json` contains. Rather
than ship a `storageState` fixture that silently degrades to "always shows
the login form," `tests/e2e/fixtures/auth.ts` drives the real login form once
per test via an `adminPage` fixture. It costs a few seconds per test, which
is an acceptable tradeoff for a suite this size.

## Suites

- `smoke.spec.ts` — harness health check (login, app loads, Warehouse tab
  navigates). Independent of any in-flight feature; should always be green.
- `rack-levels/*.spec.ts` — specs for the "rack levels" feature described in
  `~/.claude/plans/warehouse-tab-after-clicking-floofy-bumblebee.md`. As of
  writing the feature is mid-flight (some pieces shipped, migration `00072`
  not yet applied to prod) — every file's `describe` title says exactly what
  it depends on and is expected to fail until that lands.
