# E2E tests (Playwright)

**Run this against the demo, never against a tenant.** Since the 2026-08-12
cutover there are two databases on two separate Supabase accounts: the demo
(`nexorder.vercel.app`) and Amadiya's production system (`nexorder.com.au`).
`playwright.config.ts` refuses to start if `E2E_BASE_URL` names *any* tenant
origin — it checks every entry in the registry, not one named client.

Keep specs read-mostly regardless. Anything that must write data should be
clearly named, idempotent, and clean up after itself (see
`tests/e2e/rack-levels/` for examples: an ephemeral, permanently-named fixture
warehouse; `finally` blocks that restore edited product attributes / delete
draft layouts).

## Two projects that are instruments, not regression tests

Both are excluded from `npm run test:e2e`. Neither guards anything; each
exists to produce a reading that a register row was missing.

### `soak` — does a session survive a shift? (`tests/soak/`)

```bash
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run soak:session:dev
```

**Run it through that script, not `--project=soak` directly.** supabase-js
renews a token when it expires within 90 seconds, so how long the soak takes is
set entirely by the project's `jwt_exp`. `scripts/session-soak.mjs` lowers
dev's to 300s, runs the spec, and restores it — in a `finally`, on SIGINT, and
by re-reading. Invoked by hand against a one-hour token the spec fails
immediately and tells you so, rather than sitting there for an hour.

It **mutates dev auth config** for the duration, and is guarded by
`requireDevTarget` — the same three guards the fixture scripts use — because a
shortened token lifetime on a client's system would be a real security-posture
change made by a test. If a run is killed outright,
`npm run auth:config:check:dev` reports the leftover.

What it proves: the lock, the refresh, rotation and persistence, over repeated
cycles. What it does not: the handheld. It is Chromium on a desktop, not an
RS35, and not Android's tab-discard behaviour.

### `perf` — what does `backdrop-blur` cost? (`tests/perf/`)

```bash
E2E_BASE_URL=https://nexorder.vercel.app \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e:perf
```

Opens a **visible window** and scrolls it for about five minutes. Leave it in
the foreground: the spec measures an idle second first and refuses to report
numbers if it finds itself throttled, which is the failure that left this
question unanswered for months.

Full procedure, the pre-registered decision rule and the 2026-08-19 results:
`docs/runbooks/measure-backdrop-blur.md`.

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download
```

## Running

```bash
# Boots the Vite dev server automatically (see playwright.config.ts webServer)
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e

npm run test:e2e:ui       # interactive UI mode
npm run test:e2e:headed   # see the browser
npx playwright test tests/e2e/smoke.spec.ts   # a single file
npx playwright show-report
```

Against the deployed demo instead of a local dev server:

```bash
E2E_BASE_URL=https://nexorder.vercel.app \
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
npx playwright test --project=chromium
```

`webServer` still points at `E2E_BASE_URL`, and `reuseExistingServer` is true
outside CI — so with the URL pointed at the demo, Playwright polls the deployed
site, finds it up, and never boots Vite. It is not hanging; it is checking.

### The 360 px project

```bash
E2E_BASE_URL=https://nexorder.vercel.app \
E2E_WAREHOUSE_EMAIL=... E2E_WAREHOUSE_PASSWORD=... \
npx playwright test --project=mobile
```

`--project=chromium` never runs these (`testIgnore: '**/mobile/**'`) and the
mobile project never runs anything else. That separation is deliberate: half of
what the mobile specs assert — a collapsed card tier, a wrapped action bar — is
false at desktop width *by design*, so running them in both projects would fail
for the correct behaviour.

## Required env vars

| Var | Required? | Default | Notes |
|---|---|---|---|
| `E2E_ADMIN_EMAIL` | **Yes** | — | The Admin demo account. Required rather than defaulted: the old default named an account that exists on exactly one database, and anywhere else the suite logged in as nobody and failed like a UI bug. |
| `E2E_ADMIN_PASSWORD` | **Yes** | — | Never hardcode this — read it from your password manager and export it in the shell that runs Playwright. |
| `E2E_WAREHOUSE_EMAIL` | `mobile` only | — | A Warehouse-role account. Read lazily by the `warehousePage` fixture, so the desktop suite runs without it. |
| `E2E_WAREHOUSE_PASSWORD` | `mobile` only | — | As above. |
| `E2E_BASE_URL` | No | `http://localhost:3000` | The demo deployment, or a local dev server. A tenant origin is refused outright. |
| `CI` | No | unset | Set by CI runners; toggles retries, worker count, and JUnit/GitHub reporters. |

The mobile specs sign in as **Warehouse**, not Admin, and the role is as much
the subject as the width: several of the surfaces they cover are gated on
`profiles.home_warehouse_id` matching the selected site. An account with that
column NULL renders the same layout and can post nothing — which is what
register row E1 recorded, and why the demo accounts were homed at MAIN before
these specs were written.

## Auth: why there's no `storageState` reuse

This section used to say the app ran with `persistSession: false`, so there was
nothing durable for Playwright to snapshot. **That reason has expired.**
`lib/auth/inProcessLock.ts` replaced supabase-js's `navigatorLock` — which was
the actual cause of the Windows `getSession()` hang, not the storage — and both
`persistSession` and `autoRefreshToken` have been on since the
warehouse-onboarding branch.

The conclusion survives for a better reason: a `storageState` snapshot pins one
captured access token, and this app now rotates refresh tokens. A replayed state
may already have been rotated out from under it, and that fails as an
unexplained mid-spec sign-out rather than as a login error.
`tests/e2e/fixtures/auth.ts` therefore drives the real login form once per test,
via an `adminPage` or `warehousePage` fixture. It costs a few seconds per test
and cannot go stale.

## Suites

- `smoke.spec.ts` — harness health check (login, app loads, Warehouse tab
  navigates). Independent of any in-flight feature; should always be green.
- `mobile/*.spec.ts` — the 360 px suite, run only by the `mobile` project.
  Registered as **O7**: until 2026-08-18 the only Playwright project was Desktop
  Chrome, so every fix the known-errors register lists at phone width could
  regress unnoticed. Each spec names the row it guards (F8, F15/F16/F17, F24,
  F25, E1) so a failure says what it was for. Two of them skip with a stated
  reason when a queue has no work — a skip that explains itself beats a green
  run that measured nothing.
- `rack-levels/*.spec.ts` — specs for the "rack levels" feature described in
  `~/.claude/plans/warehouse-tab-after-clicking-floofy-bumblebee.md`. This note
  used to say migration `00072` was unapplied; it has since shipped and is live
  on dev (verified 2026-07-28 against `pg_proc` / `information_schema`). Every
  file's `describe` title still states what it depends on.
