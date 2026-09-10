# CLAUDE.md

## Project Overview

Nex Order — B2B order management for food and general distribution. Sales reps and restaurant/hotel (HoReCa) customers place orders; admins/managers manage products, customers, suppliers, purchase orders, and AI-triaged inbound-PO email. NexGen Innovations owns the product; each deployment carries its operator's identity in `app_settings`.

**App root:** this directory (`NexOrder/`, the git repo root) — all commands run from here.

> The app directory was renamed `copy-of-curatif-order-system-v1.3/` → `NexOrder/`. The Vercel **project** still carries the old name — don't "fix" it.

## 🗺️ Where the detail lives

**This file is loaded into every session and Claude Code caps it at 150k chars.** It
reached 173k on 2026-09-10 and was split. What stays here is the rule that must hold
*even if nobody opens the doc*; the argued detail behind each rule moved, verbatim, into
`docs/claude/`. **New deep detail goes there, not here** — then run `npm run check:claude-md`.

| Before you touch… | Read first |
|---|---|
| putaway, receiving, stocktake, replenishment min/max, slotting, pallets | [`docs/claude/warehouse-stock-ops.md`](docs/claude/warehouse-stock-ops.md) |
| the warehouse map — areas, floor signs, zone binding, location names, code sweeps | [`docs/claude/warehouse-map.md`](docs/claude/warehouse-map.md) |
| the WIE engine, grid scale, layout publish, level roles, setup checklist, `?tab=` deep links | [`docs/claude/warehouse-engine.md`](docs/claude/warehouse-engine.md) |
| barcodes, scan resolution, handling units, label sheets and calibration | [`docs/claude/warehouse-scanning-labels.md`](docs/claude/warehouse-scanning-labels.md) |
| inbound-PO email triage, mailbox OAuth | [`docs/claude/po-inbox.md`](docs/claude/po-inbox.md) |
| module flags, `NEXORDER_ENV`, what a tenant actually ships | [`docs/claude/environments.md`](docs/claude/environments.md) |
| RLS, storage buckets, `verify_jwt`, cancelling an order | [`docs/claude/server-lockdown.md`](docs/claude/server-lockdown.md) |
| any modal, sheet or dialog | [`docs/claude/overlays.md`](docs/claude/overlays.md) |
| password reset, invites, recovery links | [`docs/claude/auth-links.md`](docs/claude/auth-links.md) |
| a tenant deploy the release gate just refused | [`docs/claude/releasing.md`](docs/claude/releasing.md) |
| contrast, ARIA, robots / `llms.txt`, the demo roster | [`docs/claude/accessibility.md`](docs/claude/accessibility.md) |
| what is outstanding and what just shipped | [`docs/claude/roadmap.md`](docs/claude/roadmap.md) |

**A stub below that names a doc is not a summary you may act on alone** — it is only the
subset that would cause damage if left unread. Open the doc before changing that subsystem.

## 🔴 TWO workspaces. This one is DEVELOPMENT. Tenant ops happen elsewhere.

**Split 2026-08-13.** Same repository, two checkouts, and which one you are in
decides what you are allowed to touch.

| | this checkout | the tenant checkout |
|---|---|---|
| Path | `…/OneDrive/…/OrderSystem/NexOrder` | `C:\Users\dulsh\nexorder-amadiya` |
| Git | `main`, or a `feat/`/`fix/` branch | **detached**, at a release tag |
| Holds | `.env.dev.local` **only** | `.env.amadiya.local` **only** |
| For | **all code editing**, dev deploys, migrations rehearsed on dev | running migrations / deploys / SQL against Amadiya |
| Code edits | yes — this is the only place | **no.** Changes arrive by checking out a newer tag |

- **The wall is the credential file, not the rules.** `.env.amadiya.local` is not
  here, so `--env=amadiya` cannot authenticate from this folder no matter what
  else fails. `scripts/lib/env.mjs` `assertEnvFilePresent` turns that into a
  named refusal rather than a confusing failure five frames later. Everything
  below is defence in depth on top of it.
- **`scripts/claude/guard-workspace.mjs`** is a `PreToolUse` hook
  (`.claude/settings.json`) that refuses tenant-targeting shell commands here.
  It exists because permission rules match by PREFIX and every dangerous command
  is dangerous because of its MIDDLE (`node supabase/migrate.mjs --env=amadiya`).
  It also blocks bare `supabase`/`vercel` CLI calls, which read
  `supabase/.temp/linked-project.json` and `.vercel/project.json` — two files no
  `--env` flag can influence, and both of which pointed at Amadiya until the
  cutover. It derives "am I a tenant workspace" from whether a `kind: 'tenant'`
  env file is present, so the tenant checkout runs the same hook unaffected and
  nothing is hardcoded.
- **Editing a tenant script here is fine and expected.** Only *running* one
  against a tenant is blocked. The refusal message says so.
- The third worktree, `C:\Users\dulsh\nexwt`, holds `main` for merges. It is not
  a workspace; do not work in it.

## 🔴 TWO databases, on TWO separate accounts. One is a client's.

**Cutover done 2026-08-12; demo rebuilt 2026-08-13.**
`lsgkznyiabqitqfpveey` **is Amadiya Agro Products' production database.** It used
to be the demo. It is not one any more: the demo data was exported to
`demo-export/` and **deleted**, the marker says `('prod','amadiya')`, and the
whole project — schema, storage, auth users, cron jobs — belongs to a paying
client.

The demo now lives at `uqvekvavkjjurpqtovbq`, on a **different Supabase account
and organisation**. That separation is the point, and it is verifiable: the
`SUPABASE_ACCESS_TOKEN` in `.env.dev.local` lists exactly one project and cannot
see Amadiya's at all. A personal access token reaches every org you belong to,
so two orgs is the only thing that makes it a boundary rather than a convention.

If you are reading a runbook, an older plan or a migration comment that says
"dev is Singapore", "prod does not exist yet", or "there is no non-production
environment", the file is stale, not the database.

| | `dev` | `amadiya` |
|---|---|---|
| Kind | demo (NexGen's own) | **tenant** (a paying client's) |
| Supabase | `uqvekvavkjjurpqtovbq`, `ap-southeast-2`, **free tier** | `lsgkznyiabqitqfpveey`, `ap-southeast-2`, Pro |
| Account | NexGen's own — **separate login and org** | the account holding the client |
| App | https://nexorder.vercel.app | https://nexorder.com.au |
| Holds | the exported demo (92k rows) | **Amadiya's real business data** |
| `tenant` tag | `ayam` | `amadiya` |
| `environment_marker.name` | `dev` | `prod` |
| Fixtures / seeds | **yes** | **never** |
| Auth email templates | no — free tier refuses them | yes |
| Backups | **none** — free tier. `demo-export/` is the backup | daily, 7-day retention, no PITR |
| Credentials | `.env.dev.local` | `.env.amadiya.local` |

- **There IS a non-production environment again, and it is the same region.**
  Rehearse a migration on `dev` before it touches a client. This is what the
  in-place cutover cost for a day and what the rebuild bought back. Destructive
  SQL still deserves `BEGIN … ROLLBACK` via `scripts/lib/managementApi.mjs`
  `runSqlRolledBack` — but it is no longer the *only* rehearsal available.
- **`npm run dev` is `vite --mode dev`, and the mode flag is load-bearing.**
  Vite only reads `.env.<mode>.local`, so a bare `vite` (mode `development`)
  loads *no* env file here and the app throws `Missing VITE_SUPABASE_URL` —
  which is what it did from the rebuild until 2026-08-13, while this entry
  claimed otherwise. Do NOT "fix" that by recreating `.env.local`: Vite loads
  that one for every mode regardless of target, which is exactly how a
  developer's browser ended up pointed at what is now a client's production
  database. The unit suite needs neither — `vitest.config.ts` pins
  `TEST_PROJECT_REF`.
- **Seed / demo / reset scripts run again, on `dev` only.** `fixtureTargets()`
  derives from `allowFixtures`, and `dev` is the only entry carrying it. Three
  guards (`scripts/lib/fixtureGuard.mjs`): the named target, a
  credential-vs-registry assertion, and `environment_marker` in the database
  itself. Guard #3 compares against the **literal** `'dev'` and reads nothing
  from the registry — that independence is the point of having three.
- **Scripts that must write to the client use `scripts/lib/tenantGuard.mjs`**
  (registry says tenant + marker agrees + `--confirm=<projectRef>` typed out).
  Do not widen `fixtureGuard` to cover them; the two guards are deliberately
  mirror images.
- **`config/environments.mjs` is the only file where a project ref belongs.**
  Import from it; never type a ref. `ENV_NAMES`, `fixtureTargets()` and
  `tenantTargets()` are all derived from it.
- **Every script takes `--env=<dev|amadiya>`, equals-form only, and hard-fails
  without one.** `--env amadiya` (space) is rejected on purpose —
  `apply-sql.mjs` reads the first non-`--` argument as a filename.
- **`environment_marker.name` is `dev`/`prod`, NOT the target name.** Migration
  `00086` constrains it with `CHECK (name IN ('dev','prod'))` and is applied and
  checksummed, so the database's vocabulary is frozen while target names are
  open-ended. The registry carries `markerName` for exactly this;
  `migrate.mjs --stamp` writes that, never `name`.
- **`.mcp.json` may name `dev` and must NEVER name a tenant.** It was emptied in
  the cutover because the only project left was a client's, and an agent session
  with MCP write access to a client's database is the single largest unforced
  risk in this repo. A demo on a separate account is the case it was waiting
  for. If you add a server, pin it to `uqvekvavkjjurpqtovbq` and use that
  account's token — a token from the other account would reach Amadiya.
- **The demo was restored from disk, and the disk copy is still the backup.**
  `demo-export/` (gitignored) and `../backup/demo-export-2026-08-12/` hold 68
  tables, 102k rows and 223 storage objects. `supabase/ops/import-demo.mjs`
  restores it; `mint-demo-users.mjs` re-creates the 11 logins first, because the
  export carries no password hashes but everything references those uuids. On
  the free tier there are **no database backups**, so this folder is not an
  archive of a past state — it is the demo's only recovery path. Do not delete
  it, and re-run `npm run export:demo` after any demo work worth keeping.
- **Tenancy is decided: project-per-tenant, one `main`, module flags.** See
  `MULTI-TENANT-ARCHITECTURE.md` before adding a client or a per-client feature.
  There is never a per-tenant branch.
- **Module flags are BUILT, and there are SEVEN as of 2026-08-20:**
  `sales_orders`, `shop`, `po_inbox`, `promotions`, `invoicing`, `field_ops`,
  `inventory_dispatch`. Two are the sidebar group headings "Field Ops" and
  "Inventory & Dispatch"; the other five subdivide the third heading, which is
  a heading and not a module. **`sales_orders` now means the order OBJECT and
  its status ladder only** — place it, advance it, cancel it.

  The gate mechanics, what still leaks, the server half and the per-role
  consequences are in [`docs/claude/environments.md`](docs/claude/environments.md).
  The rules that must hold without opening it:
  - **The gate is live, not inert. Amadiya carries
    `['sales_orders', 'inventory_dispatch']`; only `dev` has everything.**
  - **Every carved-out slug REQUIRES `sales_orders`** — `MODULE_REQUIRES` states it
    and `assertModuleSet()` throws at import time, so a bad registry edit fails the
    build. `inventory_dispatch` deliberately does NOT declare the dependency.
  - **A disabled module is NOT SHIPPED, not hidden.** Gate the
    `lazyWithRetry(() => import(...))` **declaration**, not just the JSX — and in
    **both** `AdminView.tsx` and `AppShell.tsx`, which declare some of the same views.
    Gating one leaves the chunk alive through the other.
  - **Verify by building and grepping `dist/` for code symbols, never by reading.**
    Tab-name strings like `'Putaway'` legitimately survive — they live in the core
    `AdminTab` union.
  - **`NEXORDER_ENV` decides the set**, lives in the Vercel build environment, and is
    passed by `scripts/deploy.mjs` as a `--build-env`; `vite.config.ts` **throws** on
    a value naming no target rather than falling back to `dev`.
  - Server half: `_shared/modules.ts` `requireModule` **fails OPEN** — a module gate is
    a *commercial* control and roles/RLS are the security ones.
    `config/moduleOwnership.mjs` maps 65 functions; `deploy-functions.mjs` will not
    deploy a disabled module's functions but **never RETIRES** one already deployed.
  - **Products and HoReCa are CORE** despite where the sidebar files them — see
    `TAB_MODULES` in `lib/adminTabUrl.ts`.
  - Without `inventory_dispatch` the **Warehouse role is empty**, and without `shop`
    the **Customer role is**, so `lib/assignableRoles.ts` withholds each from the
    invite form. The Field Sales Rep is withheld by neither.
  - **`New Order` (`components/admin/NewOrderView.tsx`) is how a tenant without `shop`
    creates an order.** Price its preview with `resolvePromotionPrice`, never
    `resolveHoReCaPrice` — the latter misses promotions and the preview then silently
    disagrees with the order.
  - **Money is hidden from the Warehouse role** by `lib/canSeeOrderValue.ts` — a role
    test, not a module test, and a DISPLAY rule only: `orders.total` stays readable by
    anyone RLS lets see the order.

## Commands

```bash
npm install
npm run dev                        # Vite on :3000
npm run build
npm test                           # vitest run
npm run test:watch                 # vitest in watch mode
npx vitest run __tests__/adminTabUrl.test.ts   # one file
npx vitest run -t "some test name"             # one test by name, across the suite
npx vitest run --project=ui                    # only the jsdom half (see below)
npm run test:coverage              # vitest + coverage report
npm run test:integration           # vitest against live pg — dev only, throws on a prod URL
npm run test:e2e                   # Playwright (:ui / :headed variants) — dev only
npx playwright test --project=mobile   # the 360px suite; needs E2E_WAREHOUSE_* too
npm run check:overlays             # no raw `fixed inset-0` outside components/ui
npm run check:csp                  # vercel.ts: per-target CSP + /storage rewrite ordering
npm run check:grants:dev           # no client-role write grant on a locked table (needs creds; not a CI gate)
npm run check:storage:dev          # bucket public flags + policies vs config/storageBuckets.mjs (needs creds)
npm run check:viewport             # no `h-screen`/`100vh` where the handheld needs `h-svh`
npm run check:claude-md            # CLAUDE.md under the 150k session limit (warns from 120k)
npm run lint                       # eslint-plugin-jsx-a11y ONLY; eslint-suppressions.json is a ratchet
npm run lint:fix                   # the autofixable subset
npm run lint:prune                 # after fixing findings, shrink the frozen baseline
npm run check:demo                 # builds EVERY target; demo credentials must ship to the demo host only

# Type-check. CI's `verify` job runs this and fails on red, but `main` does not yet
# REQUIRE the check (branch protection is blocked by plan tier — see Pending Work),
# so a red job cannot stop a merge. Run it before you deploy.
npx tsc --noEmit

# Deploy: builds, aliases, verifies /version.json AND /functions/v1/health
npm run deploy:dev                 # -> nexorder.vercel.app, from whatever is checked out
npm run deploy:amadiya             # -> nexorder.com.au, ONLY from a rel-* tag (see below)

# Migrations — ledgered in public.schema_migrations, checksummed, transactional
node supabase/migrate.mjs --env=amadiya --dry-run   # what would run, in order
npm run migrate:dev                                 # rehearse on the demo FIRST
npm run migrate:amadiya                             # apply everything pending
node supabase/migrate.mjs --env=amadiya --stamp-only

# Edge Functions (never pass --no-verify-jwt; config.toml governs the gate)
npm run fn:deploy:amadiya          # all 79; append a name for one

# Secrets and crons (supabase/ops/)
npm run secrets:check:amadiya      # Gate A assertion; exit 1 if incomplete
npm run secrets:amadiya            # set what is missing (--overwrite to replace)
npm run crons:list:amadiya         # what is scheduled (7 with po_inbox, 6 without)
npm run crons:amadiya              # (re)create health-check; UNSCHEDULES po-poll-inbox
                                   # where po_inbox is off, so the cleanup is idempotent

# Raw SQL (Management API — the direct DB host is unreachable on Windows)
node supabase/apply-sql.mjs --env=amadiya --query "SELECT ..."
node supabase/apply-sql.mjs --env=amadiya <file.sql>

# Supabase Auth config (site URL, redirect allow-list, password rules, disable_signup)
npm run auth:config:amadiya         # diff, then PATCH if it differs
npm run auth:config:check:amadiya   # diff only, exit 1 on drift

# Demo lifecycle — dev only, behind the three fixture guards
npm run export:demo                # snapshot dev to demo-export/ (the ONLY backup on free tier)
npm run demo:users:dev             # re-mint the 11 logins with their ORIGINAL uuids
npm run demo:import:check:dev      # preflight + verify, writes nothing
npm run demo:import:dev            # restore demo-export/ (clears first — idempotent)
# Seed / fixture scripts work again now that `dev` has a project.
# Order matters: users BEFORE import, or every uuid reference dangles.

# Tenant user management — tenant workspace only
npm run bootstrap:admin:amadiya    # first Admin login on a fresh tenant
npm run password:set:amadiya       # --list to enumerate users first

# Maintenance / one-offs
npm run embed:products:dev         # refresh product embeddings via the embed-products fn (mig 00089)
node supabase/ops/rescore-open-putaway.mjs --env=dev --warehouse=2873 --dry-run
                                   # re-score OPEN putaway tasks against the current engine
                                   # (needed after 00122/00123 changed what the planner believes
                                   #  about space). The npm alias omits --warehouse and will fail.
npm run soak:session:dev           # the O6 JWT soak in 12 min, not 90 — it lowers `jwt_exp`
                                   # to 5 min, runs the Playwright `soak` project, puts it back
npm run build:analyze              # rollup-plugin-visualizer treemap
npm run scan:sheet                 # regenerate scan-gun-test-sheet.html
npx playwright test --project=perf # projects: chromium, mobile, a11y, contrast, soak, perf
```

**The unit suite is two vitest projects, split by file extension** (`vitest.config.ts`): `node` runs `**/*.test.ts` (pure logic, no DOM, faster) and `ui` runs `**/*.test.tsx` under jsdom with the React plugin. A component test named `.test.ts` is silently run without a DOM; name it `.test.tsx`. `*.integration.test.ts` is excluded from both — it runs only via `vitest.integration.config.ts`.

**Never run `vercel deploy --prod` directly** — it won't move the alias, and users will report fixes as "not live". Always use `npm run deploy:<target>` (wraps deploy + alias + verification).

**The alias step is NOT the deploy's verdict; `/version.json` is.** `vercel alias set` fails outright when the DOMAIN sits in a different Vercel scope from the project — `nexorder.com.au` is reachable only under `dulshan657s-projects` while the project moved to `nexgen14` on 2026-08-19, so every Amadiya deploy hits `You don't have access to the domain nexorder.com.au under nexgen14`. **It is harmless**: a production deploy serves the project's attached domain regardless, which is why the site was already live at the new sha when the script reported failure. That cost two releases before `scripts/deploy.mjs` stopped treating the exit code as fatal — it now warns and defers to the sha check. Moving the domain into `nexgen14` would remove the warning and is worth doing; until then, **check `/version.json` before believing a deploy failed**.

### Releasing to a tenant

A tenant deploys from a **release tag**, never from whatever is checked out
(`requireReleaseTag` in `scripts/deploy.mjs`; the decision is pure and tested in
`scripts/lib/releaseTag.mjs`). Module flags stop a tenant seeing a surface they did
not buy; this stops them getting one that is theirs and half-finished.

```bash
# 1. merge to main and let dev deploy; verify it on nexorder.vercel.app
# 2. tag the commit you actually verified
git tag -a rel-2026-08-20 -m "what is in this release"
git push origin rel-2026-08-20
# 3. in the TENANT workspace (C:\Users\dulsh\nexorder-amadiya):
git fetch origin --tags && git checkout --detach rel-2026-08-20
npm run migrate:amadiya            # if the release carries migrations
npm run fn:deploy:amadiya
npm run deploy:amadiya
```

Three conditions, each ruling out a different way of shipping something nobody looked
at: a **clean tree**, **HEAD at a `rel-*` tag**, and that tag being an **ancestor of
main**. A missing `main` **warns** rather than refuses (the tenant workspace is a
detached worktree and may legitimately have none). `dev` is exempt — deploying
whatever is checked out is the point of a demo environment. Why each condition exists:
[`docs/claude/releasing.md`](docs/claude/releasing.md).

`supabase/run-migration.mjs` is legacy and cannot reach the DB host from this box. Use `supabase/migrate.mjs`.

## Supabase

| Key | Value |
|-----|-------|
| Amadiya (production) project ref | `lsgkznyiabqitqfpveey` |
| Amadiya URL | `https://lsgkznyiabqitqfpveey.supabase.co` |
| Region / plan | `ap-southeast-2` (Sydney), org on Pro — daily backups, 7-day retention, **no PITR** |
| Dev (demo) project ref | `uqvekvavkjjurpqtovbq` — **a different Supabase account and org.** Free tier, same region. Rebuilt 2026-08-13; this row said "none" until then. |
| Anon / publishable key | _`.env.amadiya.local` → `VITE_SUPABASE_ANON_KEY`_ |
| Service role / secret key | _same file → `SUPABASE_SERVICE_ROLE_KEY`_ |
| DB password | _same file → `SUPABASE_DB_PASSWORD`_ |
| Seeded user password | **gone.** Every seeded account was deleted in the cutover; `Password123!` opens nothing. |

**Note:** Credentials use Supabase's `sb_publishable_*` / `sb_secret_*` API key format (rotated 2026-05-18; legacy JWT-format keys are revoked). Never paste live credentials into this file — it's loaded into every Claude session and ends up in transcripts. Edge Function reads of `SUPABASE_SERVICE_ROLE_KEY` use the platform-injected value.

## Stack

React 19 · TypeScript · Tailwind v4 · Vite 6 · Supabase Postgres + Deno Edge Functions · TanStack Query · Lucide · Leaflet · Resend (email) · OpenAI (PO + floor-plan extraction) · Vitest.

## Architecture

**Data flow:** Supabase → Edge Functions OR `services/supabase/*.ts` → `hooks/queries/*.ts` (TanStack Query) → `lib/adapters.ts` (snake_case ↔ camelCase) → `App.tsx` → `<AppShell>` → role-gated views via contexts.

**Key files:**
- `App.tsx` (~180 lines) — data root: auth, queries, adapters, `placeOrderMutation`, mounts `<AppShell>`. No render tree, no UI state.
- `components/AppShell.tsx` — the big one; owns UI/nav state; mounts `<OrderProvider>` + `<PantryProvider>`; inner component (`AppShellInner`) consumes contexts and renders the entire UI tree.
- `context/OrderContext.tsx` — cart state + order handlers (add/apply-promo/bundle/qty/submit/place/reorder/start/reset).
- `context/PantryContext.tsx` — per-HoReCa pantry state + handlers; mounted inside OrderProvider (it consumes `useOrderContext()`).
- `hooks/useOrderingState.ts` — derived shop memos (filteredProducts, ordering hints, recent products).
- `views/ShopView.tsx` — single shop tree, used by both admin and rep paths.
- `views/OrdersHistoryView.tsx` — dispatches OrderHistory (customer) vs OrdersPage (staff).
- `views/RepDashboardView.tsx` — wraps RepDashboardV2.
- `types.ts` — all frontend types (camelCase) and `UserRole` enum.
- `lib/supabase.ts` — Supabase client singleton (see gotchas below).
- `lib/adapters.ts` — DB row ↔ frontend type converters.
- `lib/queryClient.ts` — TanStack Query config (5min staleTime, 1 retry).
- `pricing.ts` — HoReCa-tier pricing + promotion resolution (client-side).
- `index.tsx` — providers: QueryClient → Auth → Toast → App; also detects the password-recovery hash and routes to `<ResetPasswordView>`.

**Layers:**
- `supabase/functions/` — Deno Edge Functions (the server-side validation gate). All admin, order and inventory mutations route through here.
- `supabase/functions/_shared/` — `auth.ts` (`requireAuth`), `errors.ts` (`EdgeFunctionError`, `errorResponse`), `audit.ts` (`logAuditEvent`), `cors.ts` (`corsHeadersFor` — origin allowlist), `rateLimit.ts` (per-isolate in-memory limiter).
- `services/supabase/` — thin clients that invoke Edge Functions or do read-only queries.
- `hooks/queries/` — TanStack Query wrappers around the services.
- `services/` (top-level) — pure business logic on cached data, no DB calls.
- `components/` — flat top-level + subdirs (`admin/`, `auth/`, `charts/`, `dashboard/`, `pantry/`, `performance/`, `routes/`, `visits/`).
- `components/ui/` — app-wide primitives. **All overlays go through here** (see below).

**Path alias:** `@/*` → project root (in `tsconfig.json` and Vite config).

**Overlays.** Never hand-roll a `fixed inset-0` backdrop — `scripts/check-overlays.mjs` fails CI on one outside `components/ui/` (it runs before `tsc` in the `verify` job). Use `<Modal>` (centered), `<Sheet>` (right slide-in, bottom sheet on mobile), or `<ConfirmDialog>`. The full rules — scroll containment, dirty-guard wiring, the z-index stack and the two TypeScript traps — are in [`docs/claude/overlays.md`](docs/claude/overlays.md).

- The overlay is **never** the scroll container: panel `max-h-[90vh] flex flex-col`, header/footer `shrink-0`, body `flex-1 min-h-0 overflow-y-auto`. **`min-h-0` is load-bearing** — without it a centered panel's header lands at a negative offset it can never be scrolled to.
- Pass `dirty`, and wire footer Cancel to the `({ requestClose })` render-prop, not `onClose`, or it bypasses the discard guard.
- **`components/overlay-baseline.json` is `"files": []` and must stay so** — never add an entry. The single permanent exemption is `components/AppShell.tsx`.
- `useScrollLock` locks **`<main data-scroll-container>`**, not `document.body` (which never scrolls here, so a body lock is a silent no-op).
- **`key` can never be passed to a typed local component** — with no `@types/react` there is no global JSX namespace, so `<Modal key={x}>` errors. Wrap in `<React.Fragment key={x}>`.

**Types gotcha:** there is no `@types/react` and `strict` is off, so every React type (props, hooks, `React.FC`) resolves to `any`. `interface X extends React.ButtonHTMLAttributes<...>` therefore contributes no members — use a type-alias intersection instead. Embedding Leaflet in an overlay needs a `ResizeObserver` → `map.invalidateSize()` (it measures once at mount, while the panel is still animating).

**Styling:** Tailwind v4, stone palette, Plus Jakarta Sans (display) + DM Sans (body) + JetBrains Mono (numerics). `.glass-panel`, `.shadow-card`, `.btn-press` utilities in `index.css`.

**Realtime:** `hooks/useRealtimeSubscriptions.ts` opens one `postgres_changes` channel per authenticated user (orders, order_items, notifications, products); each event invalidates the matching TanStack Query key so consumers refetch automatically. RLS filters per-subscriber on the wire.

**Error handling:** `<ErrorBoundary>` wraps the root and every lazy `<Suspense>` region (admin tabs, modals). Uncaught errors flow to `client_errors` via the public `log-client-error` function; `lib/errorReporter.ts` dedups by stack (60s window) and catches `window.error` + `unhandledrejection`.

## PO Inbox (inbound-PO email triage)

Admin/manager daily-driver surface (`components/admin/POInbox*.tsx`, nav label **"PO Inbox"**) that triages purchase orders the AI extracts from connected mailboxes. **Flow:** connect mailbox via OAuth (Gmail/Outlook) → cron `poll-inbox` → `extract-po` parses each `inbound_messages` row into `pending_pos` → operator reviews the Queue → `approve-po` / `reject-po`. Sender→customer/product mapping lives in `po_customer_aliases` / `po_product_aliases`. Tables: `email_accounts`, `oauth_pending_states`, `inbound_messages`, `pending_pos`, the two alias tables and `po_extraction_audit` (migs `00018`–`00023`). The legacy manual "Purchase Orders" admin view was removed.

**Every function, the shared per-account poll engine, the layer map and the Gmail / Google Cloud OAuth setup are in [`docs/claude/po-inbox.md`](docs/claude/po-inbox.md).** Design docs: `docs/superpowers/specs/2026-05-20-po-inbox-redesign-design.md`.

- **`storage_path_prefix` is percent-encoded but the objects are not.** `download()` works (it decodes too), `list()` compares its prefix literally and matches nothing, and `createSignedUrl()` signs the encoded spelling *successfully* and returns a URL that 400s only when fetched. Resolve the prefix by listing the candidates and signing whichever spelling returns objects — `_shared/poInbox/archivePaths.ts`.
- **`_shared/poInbox/documentNotes.ts` and `deliveryAddress.ts` are imported by BOTH runtimes** — `approve-po` (Deno) and `POInboxDetailModal` (Vite). Dependency-free for that reason; never fork one, or the reviewer reads one thing and the picker is handed another.
- **`job_address` is not `ship_to`.** On a builder PO both are printed and routinely differ — the goods go to the installer's yard while the job is on an estate.
- **What the PO printed is the fallback for what the operator didn't say**, and under `mode:'auto'` nobody opens the review modal, so `approve-po`'s fallbacks are the ONLY path `notes`, `delivery_date` and `delivery_address` have onto the order. The address fallback deliberately writes no `horeca_addresses` row.
- **`supabase/functions` is excluded from `npx tsc --noEmit`** and nothing imports the Edge Functions, so their call sites are type-checked by nothing locally. This bites on the shared helpers, whose parameter types are all-optional ("weak"): `approve-po`'s local `PendingPoRow.extracted_po` must declare **every** field it forwards or it breaks at runtime having looked fine everywhere else.

## Warehouse & inventory (WIE)

The largest subsystem after ordering, and about half the Edge Functions. Migrations `00027`–`00085` and `00090` onward — everything from `00090` to the newest (`00126`) is WIE except `00104`/`00105`/`00111`–`00113`.

**Inventory truth.** `inventory_balances` (product × location × batch **× handling unit**; `on_hand`, `allocated`, `available` generated) is the source of truth; `inventory_movements` is the append-only ledger. `products.inventory` / `products.available` are **caches**, maintained only by `inv_recompute_product_cache()` via `inv_apply_leg()`. All quantities are base units. Every write funnels through `inv_apply_leg` (service_role only): `inv_receive_stock`, `inv_reserve_order`, `inv_pick_order_line`, `inv_transfer_stock`, `inv_adjust_stock`.

**Locations** are one self-referential tree (`kind` ∈ `WAREHOUSE|ZONE|AISLE|RACK|BAY|SHELF|BIN|STAGING`). There is no separate bins table. `locations.code` is **globally unique**. A warehouse is `location_type` `'bulk'` (stock sits at the root) or `'racked'` (bin-level, WIE-driven). Multi-warehouse since `00036`; `inv_default_location()` = lowest-id active warehouse.

**The detail lives in four docs — open the relevant one before changing anything here:**
[`warehouse-engine.md`](docs/claude/warehouse-engine.md) (the pure engine, grid scale, layout publish, level roles, replenishment, the setup checklist, `?tab=` deep links) ·
[`warehouse-map.md`](docs/claude/warehouse-map.md) (named areas, floor signs, zone binding, friendly location names, live area painting, location code sweeps) ·
[`warehouse-stock-ops.md`](docs/claude/warehouse-stock-ops.md) (stocktake by location, replenishment min/max, slotting rules & off-home, receiving, pallet break-down, putaway identity, pallet quantities) ·
[`warehouse-scanning-labels.md`](docs/claude/warehouse-scanning-labels.md) (scan identity, handling units, Code 128 labels, calibration).

**The invariants, each explained in the doc named beside it:**

- **`_shared/wie/*.ts` and its siblings are PURE** (no Deno, no IO), so the Vite frontend imports the very modules the server runs. That is a correctness contract, not a convenience: **the client's preview IS the server's decision, evaluated early**. Never fork one — several (`areaCellsFingerprint`, `normalizeScan`, `binCount`, `replenPolicy`, `palletBreakdown`, `putawayIdentity`) must agree byte-for-byte or a save 409s and a scan the operator was told was valid is rejected server-side. Pinned by `__tests__/wie/purity.test.ts`. → all four
- **Every inventory write funnels through `inv_apply_leg`** (service_role only): receive / reserve / pick / transfer / adjust. `inventory_balances` is the truth, `inventory_movements` the append-only ledger, and `products.inventory` / `products.available` are **caches** maintained only by `inv_recompute_product_cache()`. All quantities are base units. → engine
- **A WAREHOUSE id is not a place stock sits.** Once goods are put away a balance row's `location_id` is the BIN's; the root holds only what has not been placed. Anything scoping stock "to a warehouse" must expand through `inv_warehouse_draw_locations` — never rebuild that expansion as a `materialized_path` prefix in TypeScript. → WIE gotchas below
- **`inv_transfer_stock` moves `available` stock only**, so anything sized from `on_hand` fails at the rack. Replenishment, off-home and pallet break-down are all sized from `available` for that reason. → engine, stock-ops
- **Layouts are drafted, then PUBLISHED.** Publishing builds the routing graph, flips the warehouse to `racked`, **freezes** edge weights / travel distances / access offsets, and **never retires old bins**. One published layout per warehouse. → engine
- **Areas, floor signs, renames and zone re-parenting are legal on a PUBLISHED layout and deliberately do NOT bump `warehouse_layouts.updated_at`** — none contributes a graph node, edge weight or access offset. Staleness for those is therefore a **fingerprint**, never a timestamp, and each layer checks only its own. → map
- **A bin's zone is materialized-path ancestry to a `kind='ZONE'` row.** `locations.zone_profile_id` on a bin is read by nothing and never stamped — binding *moves* the bin, it does not label it. `parent_id` and `materialized_path` are two hand-maintained copies of one edge with nothing in the database enforcing agreement: every move writes both, and a SHELF's path must ride in the same batch as its rack or it is silently orphaned. → map
- **An auto-assigned location number is assigned once and NEVER reassigned**, and the high-water mark comes from the WAREHOUSE, not the layout. Typing a name makes it custom and releases its number. **The barcode payload, the `resolveScan` key, the path segment and the CSV `bin_code` are all the `code`** — never the friendly name. → map
- **Putaway is two-stage** — `suggested → assigned → accepted|overridden` — and **assigning moves no stock**; the transfer fires at `complete-putaway`, when the operator scans the bin. Un-placed goods therefore read as sitting at the warehouse root, which is where they are. → stock-ops
- **Partial putaway splits the TASK, never the PLATE.** Breaking a pallet down is a *container* operation (`break-pallet`, mig `00126`); dev still carries three plates holding stock in two locations from before that existed, and `00126` repairs none of them. → stock-ops
- **The PRODUCT barcode identifies the goods at putaway.** A plate label is for a pallet, for goods carrying no barcode, and for a damaged one (`_shared/putawayIdentity.ts`). What is *asked for* and what is *accepted* differ deliberately. → stock-ops, scanning
- **A handling unit is an inventory DIMENSION** — a nullable 4th column folded into the balance slot key, so a plate's contents *are* its balance rows and there is no `hu_contents` table. Stock on a plate consumes **one position**, not `qty × size_factor`; `v_bin_fill` is the single source of bin fill, so don't re-derive it. → scanning
- **Level roles are operator-managed DATA** (`level_roles`, mig `00081`). Never compare a role to a literal to decide behaviour — read `is_pick_zone` / `hu_types` / `replen_source_rank` off the row. → engine
- **`planPutaway` is greedy per line in input order**, so callers must sort by velocity or fast movers land behind slow ones. Slotting decides **ORDER, never HEADROOM** — `reslot.ts` deliberately passes a falsified `quantity: 1`, so a tier test asking "is there room" would read that 1 and collapse every plan. → engine, stock-ops
- **Blank is not zero** on every count and config sheet: `parseCountedQty` returns `null` for blank and `undefined` for unusable text, and a write-off must be typed as `0`. → stock-ops
- **Warn wherever refusing would not move the pallets** — `allowed_categories` after zone binding, unconfirmed bin labels at import, a wrong SOURCE bin at replenishment. A wrong DESTINATION *is* refused, because placing elsewhere leaves the short slot short while reporting the work done. → stock-ops

**WIE gotchas** (each has cost real debugging time):
- **`wie_putaway_candidates`' cap is `PUTAWAY_CANDIDATE_LIMIT` = 2000, not 200.** It was 200 until mig `00072` raised it ("MAIN alone is 189 bays x 5 levels = 945 locations"); this entry said 200 until 2026-08-03. The constant lives in `_shared/wie/types.ts` — the *pure* module — because `_shared/putawayTasks.ts`, which passes it, imports supabase-js from a URL and so cannot be imported by the frontend; the layout designer warns from 90%. It is ordered by dock distance with the limit as a **hard cutoff**, so a layout with more addressable locations silently hides its farthest bays from the engine. **Count locations, not placements**: a levelled rack holds no placement row of its own — its SHELF levels do. It also returns **every** active placement regardless of `kind` — anything you place is a putaway target, so staging/returns must be `label` objects, not bins.
- `planPutaway` is **greedy per line in input order**. Whichever SKUs are offered first claim the dock-adjacent bays, so callers must sort by velocity or fast movers land behind slow ones.
- `scoring.ts` never reads `temp_min`/`temp_max`. Route a category into a zone via `zone_profiles.allowed_categories` + a warehouse-scoped `wie_rules` row (`wie_rules.warehouse_id`), not SKU temperature.
- `publish-layout` deliberately passes an empty `p_deactivate` — publishing **never retires old bins**.
- **A WAREHOUSE id is not a place stock sits.** Once goods are put away a balance row's `location_id` is the BIN's id; the warehouse root holds only what has not been placed (on dev: 6954 units in bins, 838 at roots). Anything scoping stock "to a warehouse" must expand through `inv_warehouse_draw_locations` (mig `00040`: racked ⇒ root + descendants, bulk ⇒ root), which is what `inv_reserve_order` does. **`place-order`'s availability pre-check did NOT until 2026-08-20** — it filtered on the bare warehouse ids from `loadLocationPref`, answered `0 of "X" available` for a full rack, and so refused essentially every order on a racked site before reservation was ever attempted. Found by placing one order in a browser; no test could see it, because the check and the RPC each looked right alone. Never rebuild that expansion as a `materialized_path` prefix in TypeScript — call the function, or the two drift apart again.
- `inv_transfer_stock` moves **available** stock only. Reserved units cannot leave their balance row.
- For **loose** stock a bin's `capacity_slots` is consumed as `qty × products.size_factor`, so a form's capacity must be expressed in the same base unit as `on_hand`. Structured forms must satisfy `levels × positions_per_level = default_capacity_slots` (`lib/storageFormCapacity.ts`). Stock **on a handling unit** consumes one position per plate instead (`00078`) — see `_shared/wie/capacity.ts` and `v_bin_fill`.
- **`CREATE OR REPLACE FUNCTION` with a changed signature creates a second overload — it does not replace.** `inv_transfer_stock` and `inv_receive_stock` have both been silently duplicated this way, after which Postgres errors on the ambiguous call or picks the stale body. Always `DROP FUNCTION` the old signature first (see `00080`, `00037`).
- **The replenishment audit trio is on the SOURCE**, not the destination (the mirror of `00080`). The destination *is* the task — it is the pick slot that is low; re-deciding it would be a slotting decision. What varies on the floor is which reserve bin was actually pulled from.
- **Replenishment scans the two bins by opposite rules** (`_shared/replenScanCheck.ts`): a wrong SOURCE is allowed and recorded (the bay is often empty), a wrong DESTINATION is refused (placing elsewhere leaves the short slot short while reporting the work done).
- **Replenishment is sized from `available`, never `on_hand`** — `inv_transfer_stock` is available-only, so a task sized otherwise would fail at the rack. Fully-allocated reserve stock therefore raises **no task**; `wie_replen_detect` returns a reason (`source_reserved`, `no_source`, `slot_full`…) and the queue **must** render it.
- **`uq_wie_replen_open` is `WHERE status = 'suggested'` — do not widen it** to include `'assigned'`. The partial-assign split leaves the original `'suggested'` and inserts an `'assigned'` copy with the same triple. The matching `ON CONFLICT` must restate that predicate or Postgres cannot infer the arbiter and errors at runtime.
- **One scan-folding definition, two runtimes.** `normalizeScan`/`barcodeVariants` live in `_shared/scanNormalize.ts` and are imported by *both* the browser resolver (`lib/scan/resolveScan.ts`) and the server pick validator (`_shared/pickScanCheck.ts`). If they diverge, a scan the client told the operator was valid gets rejected server-side. Never fork the folding logic.
- **In zod, `.optional()` is not `.nullable()` — and with `strict` off nothing will tell you.** `.optional()` accepts `undefined` and **rejects `null`**. The client sends `?? null` for every nullable column (`null` is the honest value for "no limit"), and `capacity_slots?: number` happily accepts `number | null` in a non-strict tsconfig, so the mismatch is invisible until an operator hits Save. `mutate-layout`'s `levelSchema` had it on `capacity_slots`/`weight_capacity_kg` while `mutate-warehouse-location` — validating the *same* per-level payload — had always used `.nullable().optional()`: every save of a **Shelving or Cold Room** rack failed with a bare `Invalid request body`, because those two forms are exactly the drawable ones whose `level_template` carries a NULL weight. Use `.nullish()` for anything backed by a nullable column, and note that `error.flatten()` is worthless for a nested payload — it collapses the path to its top-level key, which is why the operator was told only "Invalid request body". Attach `error.issues` paths instead (`validationIssues()`), and render them client-side (`describeValidationIssues`).
- **A levelled rack round-trips as its RACK PARENT, and a full-replace save will eat its levels.** The parent holds **no** `layout_placements` row — its `SHELF` children do — but `ref_map`/`load` both hand the client the *parent's* id, so a save that sends `location_id` alone reads as "this cell is one flat location": `save_geometry` deletes the level rows, writes one row on the parent, and the orphan sweep then deletes the level `locations` outright (they are `is_active=false, created_in_layout_id=<layout>` and referenced by nothing else). `savePayload.ts` re-sends the levels with their own ids, and `mutate-layout` **also** derives them from the database when the client sends none — keep that second path, it is what protects a stale tab and the window between the function deploy and the frontend deploy. A level's `code` is fixed at creation and never renumbered (codes are globally unique, so an in-place renumber would collide mid-swap), so after a middle level is deleted the codes and indexes diverge; both `resolveExistingRackLevels` and the pre-delete duplicate checks exist to fail *before* the destructive replace rather than leave an empty draft.

## Server-side lockdown (Edge Functions + RLS)

All privileged writes route through `supabase/functions/<name>/index.ts`. Direct table writes from the `authenticated` role are RLS-blocked for these tables; mutations go through the listed function. `service_role` (used by Edge Functions) bypasses RLS.

| Table | Edge Function | Allowed roles | Migration |
|---|---|---|---|
| `orders`, `order_items` | `place-order`, `approve-po` | role-gated server-side | `00009`, **`00112`** |
| `orders.status` | `update-order-status` | Admin, Manager | `00010`, `00025` |
| ↳ `orders.status` → `cancelled` (+ `cancelled_at`/`cancelled_by`/`cancel_reason`) | `cancel-order` | **Admin only**, reason mandatory | `00111` |
| `profiles` | `invite-user` (insert) | Admin | `00011` |
| `app_settings` | `mutate-app-settings` | Admin | `00013` |
| `promotions` | `mutate-promotion` | Admin, Manager | `00013` |
| `horecas`, `horeca_pricing`, `horeca_payment_methods` | `mutate-horeca` | Admin, Manager (sensitive fields require reason) | `00013` |
| `products` (excl. inventory), `product_uoms`, `product_suppliers` | `mutate-product` | Admin, Manager | `00013`, `00067`, `00070` |
| `suppliers` | `mutate-supplier` | Admin, Manager | `00013` |
| `purchase_orders`, `purchase_order_items` | `mutate-purchase-order` | Admin, Manager | `00013` |
| `sales_targets` | `mutate-sales-target` | Admin, Manager | `00013` |
| `pantry_items` | `mutate-pantry-item` | Admin, Manager, Sales Rep, Customer (own HoReCa) | `00013` |
| `invoices` | `mutate-invoice-status` | Admin, Manager | `00017` |
| `horeca_addresses` | `mutate-horeca-address` | Admin, Manager | `00018` |
| PO Inbox tables (see above) | PO Inbox functions (see above) | Admin, Manager | `00018`–`00023` |
| `rate_limit_counters` | `rate_limit_hit()` RPC (service_role-only) | service_role only | `00026` |
| `inventory_balances`, `inventory_movements` | `receive-stock`, `adjust-stock`, `transfer-stock`, `record-pick`, `decide-putaway`, `complete-putaway`, `count-bin` | Admin, Manager, Warehouse | `00027`, `00032`, `00080` (`count-bin` needs no migration) |
| `handling_units`, `label_print_log` | `generate-labels`, `receive-stock`, `complete-putaway` | Admin, Manager, Warehouse | `00074`, `00075` |
| `warehouse_label_prefs` | `mutate-warehouse` `set_label_prefs` | Admin, Manager | `00106` |
| `signatures` bucket objects | `upload-signature` (write), `create-signature-url` (audited read) | write: all but Customer; read: whoever `orders` RLS lets see the order | `00113` |
| `visit-photos` bucket objects | `mutate-visit-photo` (write + delete), `create-visit-photo-urls` (audited read) | Admin, Manager, both Reps | `00113` |
| `warehouse_print_calibration` | `mutate-warehouse` `set_print_calibration` | Admin, Manager | `00110` |
| `locations` (warehouses / bins) | `mutate-warehouse`, `mutate-warehouse-location` | Admin, Manager | `00036` |
| `warehouse_layouts`, `layout_*` | `mutate-layout`, `publish-layout` | Admin | `00045`, `00046` |
| ↳ `layout_objects` (AREA rows: geometry + `meta`) | `mutate-warehouse-location` `rename_area` / `paint_areas` | Admin, Manager | `00094`, `00095` |
| ↳ `layout_objects` (LABEL rows: floor signs) | `mutate-warehouse-location` `paint_labels` | Admin, Manager | `00097` |
| `locations.code` (+ `code_block`/`code_seq`/`materialized_path`) | `mutate-warehouse-location` `recode_locations` / `revert_code_sweep` | Admin, Manager | `00107`, `00108` |
| `warehouse_code_patterns` | `mutate-warehouse` `set_code_pattern` | Admin, Manager | `00107`, `00108` |
| `location_code_sweeps` | written as a side effect of `recode_locations` | Admin, Manager | `00108` |
| ↳ `locations.parent_id` + `.materialized_path` (zone binding) | `mutate-warehouse-location` `bind_zones`, and as a side effect of `paint_areas` / `rename_area` / `mutate-layout` `save_geometry` | Admin, Manager | `00096` |
| `wie_rules`, `zone_profiles`, `storage_types`, `wie_scoring_profiles`, `product_wms_attributes` | `mutate-wie-rule`, `mutate-zone-profile`, `mutate-storage-type`, `mutate-scoring-profile`, `mutate-wms-attributes` | Admin | `00045`–`00061` |
| `product_home_bins` (incl. replenishment min/max) | `mutate-product-home-bin` (`set` / `clear` / `bulkSet`) | Admin, Manager | `00045`–`00061`, `00082` |
| `level_roles` | `mutate-level-role` | Admin | `00081` |
| `warehouse_setup_acknowledgements` | `mutate-warehouse-setup-ack` | Admin, Manager | `00092` |
| `wie_replen_tasks` | `detect-`/`assign-`/`complete-`/`unassign-replenishment` | Admin, Manager, Warehouse | `00082` |
| `slotting_blocks`, `slotting_block_members`, `slotting_rules`, `slotting_rule_blocks` | `mutate-slotting-rule` (`set_rule` / `delete_rule` / `set_block` / `delete_block`) | Admin, Manager | `00115`, `00117` |
| `wie_slotting_suggestions` | `plan-reslot`, `commit-reslot-plan`, `decide-slotting-suggestion` | Admin, Manager | `00060`, `00117` |
| `wie_offhome_tasks` | `mutate-offhome-task` (`detect` / `accept` / `dismiss` / `restore`) | Admin, Manager, **Warehouse** | `00119`, `00121` |

- **Audit trail** for every privileged mutation → `audit_events` (mig `00012`). Admin-only SELECT; service_role-only INSERT.
- **A lockdown is a DROP POLICY *and* a REVOKE, and this table lied about that for a year.** `00009`/`00010` dropped some order policies and revoked nothing, so `authenticated` kept `00001:1084`'s full CRUD grant and three `00001` write policies survived — an Admin could `DELETE` an order over PostgREST and a Manager could rewrite an invoiced line, with no `audit_events` row and no ledger correction. Security-audit finding **DB-1**, closed by `00112`. `00013:15-21` skipped both tables *in writing*, on the stated grounds `00009` had covered them. **Never trust a row of this table; run `npm run check:grants:<target>`,** which asserts it against `information_schema` from `config/lockedTables.mjs`.
  - **`anon` was never revoked from, and TRUNCATE never from anyone.** This project carries `ALTER DEFAULT PRIVILEGES` for anon/authenticated/service_role (`00101`, documented in `00102`), and every REVOKE since `00009` names `authenticated` and the three DML verbs. **RLS cannot constrain TRUNCATE** — there is no row to filter — so every "locked down" claim here is narrower than it sounds. `orders`/`order_items` are fixed; the other ~35 tables are audit finding **DB-3**, recorded in `config/grantBaseline.mjs`, which `check:grants` prints every run and fails on any addition to. Never add an entry to make it pass.
- **`cancelled` is TERMINAL and is NOT on the status ladder** (`00111`). `STATUS_ORDER.indexOf('cancelled')` is `-1`, which compares as *before everything*, so every ladder comparison needs an explicit terminal check ahead of the index test — `update-order-status` and `OrderDetailView` both carry one. Cancelling is **one transaction** (`order_cancel_tx`) because **`inv_release_reservation` is not idempotent and is not keyed by order**: it nets (ordered − picked) per line against a counter shared by every open order, so a second call eats somebody else's reservation.
- **`verify_jwt = false` functions must gate themselves in-body** — cron callers via `isAuthorizedCronCall`, server-to-server via `isServiceRoleCall`, OAuth callbacks via state consumption. Never add an entry to `supabase/config.toml` without one; `send-email` was world-callable until 2026-07.
- **`signatures` and `visit-photos` are PRIVATE buckets carrying no client policy at all.** Reads are audited signed URLs, writes are Edge Functions. **Never add a policy back** — the direct-upload capability and the list-and-delete hole were the same policy (`FOR ALL` covers SELECT, which on `storage.objects` is *list*). `company-assets` / `product-images` / `avatars` stay public by design, with per-verb writes gated to the role owning the column that points at them. **A public bucket is served by the CDN with RLS never consulted**, so flipping `buckets.public` alone is not enough. `npm run check:storage:<target>` asserts all of it from `config/storageBuckets.mjs`.
- **A signature is captured in the CART, not at delivery** — anything calling it "proof of delivery" is wrong about when it happens.
- **Client error log** → `client_errors` (mig `00014`), written by `log-client-error`. Admin-only SELECT; service_role-only INSERT. `actor_id` nullable so pre-auth crashes are captured.
- **Read policies are closed as of `00105`.** Eight of the nine `USING (true)` SELECT policies now read `staff OR <own scope>`, via `public.user_is_staff()` — the one definition of "internal", covering Admin/Manager/both Reps/Warehouse. `suppliers` and `product_suppliers` (which carries `cost_price`) are staff-only; `horeca_pricing`, `horeca_payment_methods` and `pantry_items` are own-HoReCa; `products`/`product_uoms` hide inactive lines from customers; `promotions` shows customers only live, in-window rows. **Never compare a role to a literal to decide read access — call `user_is_staff()`.** `00104` pins `search_path` on `user_role()`/`user_horeca_id()` first, since everything now rests on them.
- **`app_settings` is STILL `USING (true)`, deliberately.** It is a singleton, so no row predicate can give a customer the identity and pricing fields the Shop needs while withholding `default_credit_limit` and the `po_auto_approve_*` flags. RLS filters rows; that needs columns. Closing it means splitting the internal thresholds into their own table. Don't "fix" it with a policy that changes nothing.
- **Rate limiting** (`_shared/rateLimit.ts`): every mutation function carries a per-user or per-IP budget, and the destructive or fan-out actions get their **own** bucket rather than sharing one — `:bulk:`, `:area:`, `:paint:`, `:bind:`, `:sign:`, `:block:`, `:detect:`, each 10/min, so a burst of cheap edits cannot lock the operator out of the corrective action. Over budget → 429 `TOO_MANY_REQUESTS`. Cross-isolate global cap via the `rate_limit_hit()` Postgres RPC + `rate_limit_counters` (mig `00026`, fixed-window, hourly `pg_cron` cleanup); **fails open** to a per-isolate in-memory counter if the DB call errors. Per-function budgets, plus the cancellation window, the nine self-gating functions and audit findings STOR-1/STOR-2: [`docs/claude/server-lockdown.md`](docs/claude/server-lockdown.md).

## Role-Based Views

| Role | Views |
|------|-------|
| Admin | Dashboard, Products, HoReCas, Users, Suppliers, PO Inbox, Settings, Promotions, Invoicing, Routes, Stock, Stocktake, Warehouse (designer/putaway/picking), Audit Log |
| Manager | Dashboard, Products, HoReCas |
| Field Sales Rep | Rep Dashboard, Shop, Order History, Routes, Visits |
| Office Sales Rep | Rep Dashboard, Shop, Order History |
| Customer | Shop, Order History (scoped to own HoReCa) |
| Warehouse | Pick Queue, Dispatched, Receive Stock, Putaway, Replenishment, **Off-home**, Stocktake, Stock, Documents, Warehouse (site-scoped via `profiles.home_warehouse_id`) |

**Ten, not nine — this row omitted `Off-home` until 2026-08-26.** The nav block is
`AppShell.tsx` under `{isWarehouse && MODULE_INVENTORY_DISPATCH}`, and
`TABS_BY_ROLE.Warehouse` in `lib/adminTabUrl.ts` is the other half. All ten are
`inventory_dispatch`, so Amadiya's `['sales_orders','inventory_dispatch']` leaves
the role complete; `lib/assignableRoles.ts` withholds the role entirely if that
module is off.

## Gotchas

- **The handheld is a CipherLab RS35 (RS35WO), Android 10, and it is 360×720 CSS
  in ordinary Chrome — of which only ~664 px is visible.** Portrait only, gloves
  sometimes. Chrome's URL bar takes ~56 px and **can never retract here**,
  because the shell is `overflow-hidden` and `document.body` never scrolls, so
  there is no root-scroll gesture to retract it with. Three consequences worth
  knowing before touching layout:
  - **The shell is `h-svh`, never `h-screen`.** `100vh` is the *large* viewport
    and was 56 px taller than the screen, hiding `<ProfileMenu>` — i.e. Sign out
    (register F36). `dvh` is identical here but recomputes; `svh` is static and
    already used by `RecodePanel`/`SlottingPanel`.
  - **Playwright cannot see that class of bug.** Its `viewport` sets the layout
    and visual viewport together, so `100vh` always equals the visible height
    there. A green mobile suite is not evidence the `vh` problem is fixed —
    `npm run scan:diagnostics` prints the real `100vh`/`100svh`/`100dvh` and the
    hidden-pixel count, and that page is the only thing that measures it.
  - **`pointer-coarse:` is a native Tailwind v4.2 variant** (no `@custom-variant`
    needed) and is how the 44 px touch floor is applied without changing desktop
    density. It is **inert if the device reports a fine pointer** — the
    diagnostics page reports which, and that answer gates the whole approach.
  - A width cap is not a clamp. `lib/popoverPosition.ts` is the one pure module
    that places a trigger-anchored panel, clamping **both** axes; anything
    floating off a trigger should use it rather than a `max-w-[calc(100vw-…)]`,
    which caps size and says nothing about where the box starts (register F37).
    Consumers: `NotificationCenter`, `components/ui/Tooltip.tsx`.
  - **`components/MobileTopBar.tsx` is a flow-positioned flex sibling of
    `main[data-scroll-container]`, never `fixed`** (F40). That is what makes
    `sticky top-0` inside the scroller need no offset, and what makes ☰-over-
    content structurally impossible rather than individually avoided. Do NOT
    re-add per-page `pl-16` clearances; `nav-clearance.spec.ts` fails on the
    dead gutter they leave. Screen names come from `ADMIN_TAB_LABELS`
    (`lib/adminTabUrl.ts`) — nearly an identity map, except `'Receiving'`
    renders as **"Receive Stock"**.
  - **`.touch-target` / `.touch-target-y` (`index.css`) are the 44 px floor**
    (F43). Three media arms on purpose: `(pointer: coarse)`, `(hover: none)`
    and `(max-width: 767px)` — a rugged handheld does not always report a
    coarse pointer, and the mechanism is silently inert if it does not.
    `any-pointer: coarse` is deliberately excluded: it would catch a Windows
    touch laptop on a trackpad and inflate every admin table there. When
    raising a control, **remove** its arbitrary `min-h-[36px]` rather than
    layering over it — an arbitrary value sorts after a named utility.
  - **`components/inventory/StickyScanBar.tsx` pins the scan field** on the
    walk/queue surfaces (F42). Not cosmetic: under the RS35's default
    `Input Method` mode `useWedgeScanner` catches nothing, so a scan field
    that has scrolled away means a scan that silently does not happen. Its
    `bleed` prop must match the host page's padding scale — Receive Stock is
    `xl:p-8`, the others `lg:p-8`.
  - **Fonts are self-hosted from `/fonts`** as variable faces (F45). The
    `@import "tailwindcss"` must stay ABOVE the `@font-face` block: CSS
    ignores an `@import` that follows any other rule, and the failure is
    silent — the whole of Tailwind simply does not load.
- **Supabase client must override `global.fetch`** — without it the client hangs on Windows. See `lib/supabase.ts`.
- **Sessions persist, and the lock is why.** Persistence *used* to hang `getSession()` on Windows with either localStorage or sessionStorage — but the storage was never the cause. supabase-js defaults to `navigatorLock` (the Web Locks API) whenever `persistSession` is on, and that acquisition never resolved here. `lib/auth/inProcessLock.ts` replaces it with a promise-chain lock that never touches `navigator.locks`, so `persistSession` and `autoRefreshToken` are both **on** as of the warehouse-onboarding branch. What that bought: a refresh or tab discard no longer logs you out, and the JWT no longer dies about an hour in — which is what made phone-based scan picking unusable. What it costs: no cross-**tab** serialisation (two tabs can refresh at once; refresh tokens rotate and the loser retries). **Verify in a real browser after touching any of it** — the original hang never reproduced in tests or Node. Reverting is two booleans.
- **RLS is enabled** (mig `00008` re-enables; `00009`+ lock down individual table mutations to Edge Functions). Direct INSERT/UPDATE/DELETE from `authenticated` is blocked for the tables in the lockdown table; mutations must go through Edge Functions.
- **Edge Function deploy order matters.** When wiring the client to a new function: deploy the function FIRST (`npx supabase functions deploy <name>`), then push the frontend, then apply any RLS lockdown migration LAST. Reversing the order breaks admin UIs.
- **Migrations are ledgered and checksummed** (`public.schema_migrations`, written by `supabase/migrate.mjs`). An applied file whose bytes change is a hard error, not a re-run — **edit forward with a new migration**. Ordering is (numeric prefix, full filename); `00022` and `00081` are each a duplicated-number pair of mutually independent files, so **do not renumber them** — a rename makes an applied migration look unapplied forever. Each file commits together with its ledger row (the `INSERT` is spliced before the single `COMMIT;`, or the file is wrapped in `BEGIN…COMMIT`).
- **The `tenant` tag is environment-derived, and `ayam` must never appear in prod.** `00087` re-points the eight `00042` column defaults and both derivation triggers at `public.default_tenant()`, which reads `environment_marker.tenant_key` — `ayam` on dev, `amadiya` on prod. It is `SECURITY DEFINER` with a pinned `search_path` because a column DEFAULT evaluates as the *inserting* role and `environment_marker` is service_role-only. On an unstamped database it returns NULL and the `NOT NULL` tenant columns reject the insert — that is intended, not a bug. The column is **read by nothing, and as of 2026-08-11 that is permanent** — under project-per-tenant (`MULTI-TENANT-ARCHITECTURE.md`) a database holds exactly one tenant, so `WHERE tenant = …` could only ever be a tautology. Do not build a read side for it; wanting one means you have taken the shared-database path by accident. It stays as row-level provenance and because `environment_marker.tenant_key` feeds it, and that marker is fixture guard #3.
- **`APP_URL`, `ALLOWED_ORIGINS` and `PO_OAUTH_APP_BASE` have no defaults and fail closed.** Each previously fell back to the demo origin, and each failed *silently and successfully*: `send-email` would send a customer real links to the wrong app while answering `sent: true`, and `health` would probe the demo's `version.json` so prod reported `ok` while prod was down. **Set `ALLOWED_ORIGINS` on a project before deploying `_shared/cors.ts` to it** — `cors.ts` and `callbackCommon.ts` both read it, so the ordering breaks browser calls and OAuth callbacks together.
- **A missing `ALLOWED_ORIGINS` fails the fleet *gradually*, and reads as a client bug.** `cors.ts:53` reads the secret **once per isolate at module load**, so functions whose isolates are still warm keep serving the value they booted with while anything that cold-boots gets nothing. On 2026-07-29 the secret went missing from dev and only the three most recently deployed functions lost CORS — the browser reported `FunctionsFetchError` / **"Failed to send a request to the Edge Function"** (fetch rejected, no response ever reaches JS) on those, and worked everywhere else. Symptoms to recognise: that string; a preflight that returns `200` with `Access-Control-Allow-Headers` but **no `Access-Control-Allow-Origin`**; different functions disagreeing. Check with `npx supabase secrets list --project-ref <ref>` — it prints names, not values, so absence is the signal. After setting it, **redeploy** — a warm isolate does not re-read secrets. `curl -X OPTIONS -H "Origin: …"` across a few functions is the fastest confirmation, and a hostile origin must still get nothing.
- **Type-check** with `npx tsc --noEmit` before deploy (CI runs it but block-on-red isn't enforced on `main` yet).
- **Supabase Auth config lives in `supabase/apply-auth-config.mjs`, not `config.toml`.** That toml is per-function `verify_jwt` only and is never pushed. `buildDesired(config)` in the mjs is the source of truth for `site_url` / `uri_allow_list` / `password_min_length` / `disable_signup`, deriving the origins from `config/environments.mjs`; edit it and run `npm run auth:config:<env>` rather than clicking in Studio, or the next person has no way to know what the values should be. **The preview glob belongs to dev only** — in the prod allow-list it would make any preview build a valid password-reset landing page for a client account. The allow-list entries are **globs** — `*` does not cross a `/`, and `ForgotPasswordDialog` sends `${origin}/` with a trailing slash, so every entry needs a `/**` suffix to match. A `redirectTo` that misses the list is silently replaced with `site_url`, which reads as "the reset link sent me to the wrong place".
- **`mailer_otp_exp` (3600) is no longer duplicated as prose.** `ForgotPasswordDialog`'s "expires in 1 hour" now reads `PASSWORD_SET_WINDOW_LABEL` from `lib/auth/pendingPasswordSet.ts`, which is also what bounds an abandoned reset. `supabase/apply-auth-config.mjs` is still the server-side source of truth — change it and change that constant.
- **Never `await` a supabase call inside an `onAuthStateChange` callback.** supabase-js dispatches it while holding its internal auth lock and awaits whatever you return; any PostgREST query needs `getSession()`, which waits for that same lock, and the lock deadlocks against itself. `signInWithPassword` doesn't take the lock but `setSession`/`getSession` do — so ordinary login looks fine while the password-recovery screen hangs on "Verifying recovery link…" with no error anywhere. `hooks/useAuth.ts` therefore does sync state updates inline and defers the profile fetch to a `setTimeout(…, 0)`; `__tests__/authProviderNoDeadlock.test.tsx` pins that.
- **Auth links have four shapes, and `lib/auth/recoveryLink.ts` is the only place that knows them** — `#access_token=…`, `?token_hash=…`, an `error`/`error_code` pair on **either** hash or query, and PKCE `?code=`, which is deliberately **not** claimed because it is also the PO-Inbox OAuth popup's param. `isAuthLinkUrl()` returns true for failed links on purpose. **`type=invite` is claimed alongside `type=recovery`** and is the whole staff-onboarding path: `inviteUserByEmail` creates the auth row with no password, so the emailed link is the only way an invited user can ever sign in.
- **A recovery session is an ORDINARY session**, so nothing downstream can tell `PASSWORD_RECOVERY` from `SIGNED_IN`, and `ResetPasswordView` strips the token from the URL the moment the session exists. **`lib/auth/pendingPasswordSet.ts` is therefore the only record that a password is still owed** — localStorage (same lifetime as the session it guards), bound to `mailer_otp_exp`, written *before* `history.replaceState`. **Every exit from that screen must end the session first**, and the marker is cleared only once a `getSession()` confirms the sign-out took. Full detail: [`docs/claude/auth-links.md`](docs/claude/auth-links.md).
- `App.tsx` is intentionally thin (~180 lines). Don't add UI logic here — it belongs in `components/AppShell.tsx` or a view file under `views/`.

## Accessibility, and the public surface

Target is **WCAG 2.2 AA, enforced** rather than audited (added 2026-08-28). Three CI tiers plus one local instrument, each blind exactly where the next one sees: `npm run lint` (eslint-plugin-jsx-a11y, static) · `__tests__/a11y/*.test.tsx` (axe in jsdom — **cannot measure colour contrast at all**, it has no layout) · `tests/a11y/*.spec.ts` (axe in Chromium, the only CI tier that measures contrast, but with no router it reaches only the two signed-out screens) · `tests/contrast/` (authenticated crawl of the ten Warehouse surfaces, **never in CI**, needs real credentials — the only thing that can measure colour behind the login, and it found 13 real defects on its first run. Do not delete it to tidy up).

**The tier table, the full measured contrast figures, the two disclosed exceptions, the `components/ui` primitives, the robots/unfurler rules and the derived demo roster are in [`docs/claude/accessibility.md`](docs/claude/accessibility.md).**

- **Measure contrast, do not calculate it.** Tailwind v4 ships an **OKLCH** palette, so the v3 hex table is wrong (`stone-400` renders `#a6a09b`, not `#a8a29e`) and every figure moves the wrong way. The authoritative values are the `--color-*` custom properties in the BUILT css.
- **`stone-500` FAILS on a `bg-stone-100`/`200` tint** (4.41 / 3.83:1). Use `stone-600` wherever an element carries a resting tint — and the tint is usually on a **parent**, which only rendering finds. `hover:bg-stone-100` is not a resting tint. `disabled:text-stone-400` stays (WCAG 1.4.3 exempts inactive components). **Dark surfaces use `stone-300`, never `stone-400`.**
- **The focus ring is `nexgen-blue-dark`, not `nexgen-blue/40`** — that composites to 1.62:1 against the 3:1 SC 1.4.11 requires, and it is a *different* criterion from the disclosed brand-blue exception.
- **`eslint-suppressions.json` is a ratchet** — 273 findings frozen across 96 files; anything new is an **error**, including a second violation in a file that already has some. **Never add an entry by hand**; shrink it with `npm run lint:prune`.
- **ESLint is PINNED TO 9** — `eslint-plugin-jsx-a11y@6.10.2` peers `^9`, so a plain `npm i -D eslint` resolves to 10 and refuses to install. `eslint.config.js` has **no `parserOptions.project`** deliberately, and `no-autofocus` is off because all 30 findings are deliberate scan surfaces or dialogs focusing their first field.
- **Both hosts are UNLISTED** (`robots.txt` denies `*` plus fourteen named AI crawlers; `vercel.ts` sends `X-Robots-Tag: noindex, nofollow`) — but **four unfurlers are allowed by name**, because a blanket deny degrades every shared link to a bare URL. Do not "tidy" them away.
- **`site/` is public by construction; `docs/` is not** — that is why `site/` is its own top-level directory, and why `docs/claude/` belongs under `docs/`. `llms.txt` is GENERATED from `site/manifest.mjs`, and `site/accessibility.md` is a conformance claim — keep it true.
- **`index.html` has NO `<title>`, deliberately** — it is injected per target, and adding one back gives the document two.
- **`VITE_SHOW_DEMO_LOGINS` is GONE.** `__DEMO_HOST__` is folded from the registry's `kind`, and `npm run check:demo` asserts it on the BUILT artifact, for every target, in **both** directions. **Rotating the seven seeded demo passwords is still outstanding** — hiding a credential does not invalidate it.

## Pending Work

Ordered by impact. **Full scope, blockers and the exact unblocking steps for every item — plus the "Recently shipped" notes git history does not carry — are in [`docs/claude/roadmap.md`](docs/claude/roadmap.md).**

**High**

0. **Make Amadiya usable.** The infrastructure is finished: `rel-2026-08-20` is live on nexorder.com.au running `['sales_orders', 'inventory_dispatch']`, 57 functions deployed with the 19 disabled-module ones deleted, `check:grants` and `check:storage` clean, project on the `nexgen14` team. **What is missing is the data** — 0 products, 0 customers, one Admin login and no Warehouse staff. Import the converted catalogue from `Amadiya/`, invite staff, fill `app_settings`, then Gates C and E: `PRODUCTION-LAUNCH-PLAN.md` Phase 3. The demo half is done and needs nothing.
1. **Branch protection** — CI's `verify` job runs on every PR but `main` does not *require* it. **Blocked by plan tier:** GitHub Free disallows branch protection and rulesets on private repos (403). Needs GitHub Pro or a public repo, then require the context **`typecheck · test · build`**.
2. **Email setup (operator)** — `send-email` is live, gated and rate-limited, and dormant only because `RESEND_API_KEY` is unset; that one secret is the whole switch, no redeploy. `docs/runbooks/enable-email.md`. **Trap:** an unset `EMAIL_FROM` falls back to `onboarding@resend.dev`, which Resend delivers *only* to the account owner — customers get nothing while the response still says `sent: true`.

**Medium** — a desktop entry point for a stocktake (`count-bin` already takes any location; no server work) · finish the a11y form-label tail (~242 unlabelled `<input>`/`<textarea>` across ~80 files, frozen in `eslint-suppressions.json`) · wire the `invoice_issued` email template · test-coverage gaps: cart submission, pantry add/remove, the HoReCa reason-prompt gate, role-based routing.

**Lower** — dead-code sweep (**`hooks/useLocalStorage.ts` is LIVE — do not delete it**; `constants.ts` and `components/Header.tsx` are done; the still-unswept candidates are listed in the doc) · inventory automation (PO from low-stock, soft reservations, expiry/FIFO) · CSV/PDF report export · i18n · PWA.

## Recently shipped

git history is the changelog. The entries carrying something the sections above don't — the demo-rebuild traps (new Vercel projects' SSO protection makes a healthy deploy report `TIMEOUT`; the CLI's global login is still Amadiya's, so `deploy:dev` works only via `VERCEL_TOKEN`), migs `00083`/`00085`, the `00109` replenishment ledger refs, and the `warehouse-main/` and `tridon-demo/` fixture packs — are in [`docs/claude/roadmap.md`](docs/claude/roadmap.md).
