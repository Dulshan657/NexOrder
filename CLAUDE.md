# CLAUDE.md

## Project Overview

Nex Order — B2B order management for food and general distribution. Sales reps and restaurant/hotel (HoReCa) customers place orders; admins/managers manage products, customers, suppliers, purchase orders, and AI-triaged inbound-PO email. NexGen Innovations owns the product; each deployment carries its operator's identity in `app_settings`.

**App root:** this directory (`NexOrder/`, the git repo root) — all commands run from here.

> The app directory was renamed `copy-of-curatif-order-system-v1.3/` → `NexOrder/`. The Vercel **project** still carries the old name — don't "fix" it.

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
- **`npm run dev` works again, against `.env.dev.local`.** Do NOT recreate
  `.env.local`: Vite loads it for every mode regardless of target, which is
  exactly how a developer's browser ended up pointed at what is now a client's
  production database. The unit suite needs neither — `vitest.config.ts` pins
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
  There is never a per-tenant branch. `ALL_MODULES` in the registry is the
  module vocabulary and is **read by nothing yet** — deliberate, not an
  oversight.

## Commands

```bash
npm install
npm run dev                        # Vite on :3000
npm run build
npm test                           # vitest run
npm run test:watch                 # vitest in watch mode
npm run test:coverage              # vitest + coverage report
npm run test:integration           # vitest against live pg — dev only, throws on a prod URL
npm run test:e2e                   # Playwright (:ui / :headed variants) — dev only
npm run check:overlays             # no raw `fixed inset-0` outside components/ui
npm run check:csp                  # vercel.ts: per-target CSP + /storage rewrite ordering

# Type-check before deploy (no CI block-on-red yet)
npx tsc --noEmit

# Deploy: builds, aliases, verifies /version.json AND /functions/v1/health
npm run deploy:amadiya             # -> nexorder.com.au
# `deploy:dev` exists but refuses — dev has no project.

# Migrations — ledgered in public.schema_migrations, checksummed, transactional
node supabase/migrate.mjs --env=amadiya --dry-run   # what would run, in order
npm run migrate:amadiya                             # apply everything pending
node supabase/migrate.mjs --env=amadiya --stamp-only

# Edge Functions (never pass --no-verify-jwt; config.toml governs the gate)
npm run fn:deploy:amadiya          # all 71; append a name for one

# Secrets and crons (supabase/ops/)
npm run secrets:check:amadiya      # Gate A assertion; exit 1 if incomplete
npm run secrets:amadiya            # set what is missing (--overwrite to replace)
npm run crons:list:amadiya         # what is scheduled (expect 7)
npm run crons:amadiya              # (re)create po-poll-inbox + health-check

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
```

**Never run `vercel deploy --prod` directly** — it won't move the alias, and users will report fixes as "not live". Always use `npm run deploy:<target>` (wraps deploy + alias + verification).

`supabase/run-migration.mjs` is legacy and cannot reach the DB host from this box. Use `supabase/migrate.mjs`.

## Supabase

| Key | Value |
|-----|-------|
| Amadiya (production) project ref | `lsgkznyiabqitqfpveey` |
| Amadiya URL | `https://lsgkznyiabqitqfpveey.supabase.co` |
| Region / plan | `ap-southeast-2` (Sydney), org on Pro — daily backups, 7-day retention, **no PITR** |
| Dev project ref | _none. `config/environments.mjs` → `TARGETS.dev.projectRef` is null._ |
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
- `App.tsx` (~170 lines) — data root: auth, queries, adapters, `placeOrderMutation`, mounts `<AppShell>`. No render tree, no UI state.
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

**Overlays.** Never hand-roll a `fixed inset-0` backdrop — `scripts/check-overlays.mjs` fails CI on one outside `components/ui/` (it runs before `tsc` in the `verify` job). Use `<Modal>` (centered), `<Sheet>` (right slide-in, bottom sheet on mobile), or `<ConfirmDialog>`.

- The overlay is **never** the scroll container. The panel caps at `max-h-[90vh] flex flex-col`, header/footer are `shrink-0`, and only the body scrolls (`flex-1 min-h-0 overflow-y-auto`). `min-h-0` is load-bearing: without it flexbox's `min-height:auto` refuses to shrink the body, the panel outgrows the viewport, and a centered panel's header lands at a negative offset where it can never be scrolled to. That was the Add Warehouse bug.
- Pass `dirty` and every dismiss path (Esc, backdrop, X, footer `requestClose`) raises a discard confirm first. Wire footer Cancel to the `({ requestClose })` render-prop, not `onClose`, or it bypasses the guard.
- Overlays portal to `document.body` and take their z-index from `overlayStack.ts` (`BASE_Z = 1000`). Escape only ever closes the topmost. Don't reach for `z-[60]`.
- `useScrollLock` locks **`<main data-scroll-container>`**, not `document.body` — the AppShell root is `h-screen overflow-hidden` so the body never scrolls and a body lock is a silent no-op. Ref-counted, so a nested confirm can't unfreeze the page behind its parent.
- **The migration is finished and the guard is now absolute.** `components/overlay-baseline.json` is `"files": []` — every overlay in `components/`, `views/` and `context/` goes through `components/ui`. Keep the file (its `_comment` documents the ban); **never add an entry to it**. A new `fixed inset-0` fails CI outright, with the single permanent exemption of `components/AppShell.tsx` (mobile sidebar + order summary — app chrome, not dialogs).
- Two constraints the migration surfaced, both easy to trip over:
  - **`key` can never be passed to a typed local component.** With no `@types/react` there is no global JSX namespace, so `key` is checked against the component's own props and `<Modal key={x}>` errors. Wrap in `<React.Fragment key={x}>` instead.
  - **`max-h-[90vh]` is not a *definite* height.** A percentage-height child (`h-full` iframe/canvas) inside the `flex-1` body collapses to 0px. Give the body an explicit height via `bodyClassName` — see `context/DocumentViewerContext.tsx`.
- `components/admin/settings/primitives.tsx` re-exports `Field`/`Input`/`Select`/`Toggle` from `components/ui` for back-compat. New code should import from `components/ui` directly.

**Types gotcha:** there is no `@types/react` and `strict` is off, so every React type (props, hooks, `React.FC`) resolves to `any`. `interface X extends React.ButtonHTMLAttributes<...>` therefore contributes no members — use a type-alias intersection instead. Embedding Leaflet in an overlay needs a `ResizeObserver` → `map.invalidateSize()` (it measures once at mount, while the panel is still animating).

**Styling:** Tailwind v4, stone palette, Plus Jakarta Sans (display) + DM Sans (body) + JetBrains Mono (numerics). `.glass-panel`, `.shadow-card`, `.btn-press` utilities in `index.css`.

**Realtime:** `hooks/useRealtimeSubscriptions.ts` opens one `postgres_changes` channel per authenticated user (orders, order_items, notifications, products); each event invalidates the matching TanStack Query key so consumers refetch automatically. RLS filters per-subscriber on the wire.

**Error handling:** `<ErrorBoundary>` wraps the root and every lazy `<Suspense>` region (admin tabs, modals). Uncaught errors flow to `client_errors` via the public `log-client-error` function; `lib/errorReporter.ts` dedups by stack (60s window) and catches `window.error` + `unhandledrejection`.

## PO Inbox (inbound-PO email triage)

Admin/manager daily-driver surface (`components/admin/POInbox*.tsx`, nav label **"PO Inbox"**) that triages purchase orders the AI extracts from connected mailboxes. The legacy manual "Purchase Orders" admin view was removed.

**Flow:** connect mailbox via OAuth (Gmail/Outlook) → cron polls inbox (`poll-inbox`) → `extract-po` parses a PO from each `inbound_messages` row into `pending_pos` → operator reviews in the Queue → `approve-po` (creates the real purchase order) / `reject-po`. Sender→customer/product mapping lives in `po_customer_aliases` / `po_product_aliases` (Aliases sub-tab). Sub-tabs: `queue`, `aliases` (mailboxes moved to a header popover; `?subtab=` persists).

- **Layer:** services `poInboxService.ts`, `poInboxStatsService.ts`, `emailAccountsService.ts`, `poAliasMutationService.ts`; hooks `usePendingPos`, `usePoInboxStats`, `useEmailAccounts`, `usePoAliasMutations`.
- **Edge functions:** `start-po-oauth`, `gmail-oauth-callback`, `outlook-oauth-callback`, `poll-inbox`, `extract-po`, `approve-po`, `reject-po`, `create-po-document-url`, `mutate-po-alias`, `pause-email-account`, `disconnect-email-account`, `retry-email-account`. The per-account poll engine is shared at `_shared/poInbox/pollAccount.ts` (`processAccount`), used by both the cron `poll-inbox` and the on-demand `retry-email-account` ("Retry now" for a transiently-failing mailbox).
- **`storage_path_prefix` is percent-encoded but the objects are not.** `storagePrefixFor()` encodes the provider message id (Graph ids carry `/` and `=`), and that encoded string is what `inbound_messages.storage_path_prefix` holds — but a Storage key may not contain `%` at all (the API answers 400 `InvalidKey`), so `upload()`, whose path rides in the request URL and is decoded server-side, wrote every object under the **decoded** prefix. Three consequences, each of which failed silently in a different way: `download()` works (it decodes too — which is why `extract-po` was fine); `list()` sends its prefix in the **request body** where it is compared literally, so it matches nothing; and `createSignedUrl()` signs the encoded spelling *successfully* and returns a URL that 400s only when fetched. Resolve the prefix by listing the candidates and using whichever one returns objects — that is the spelling to sign. `_shared/poInbox/archivePaths.ts` holds the helpers (`archivePrefixCandidates`, `isSafeStoredName`, `pickAttachmentName`); `create-po-document-url` does it once for both the envelope and the attachments. This is what made every Outlook-sourced PO's document viewer say "no attachment named …".
- **`_shared/poInbox/documentNotes.ts` and `deliveryAddress.ts` are imported by both runtimes** — `approve-po` (Deno) and `POInboxDetailModal` (Vite). Dependency-free for that reason; never fork one, or the reviewer reads one thing and the picker is handed another. `composeOrderNotes` folds the printed "Notes" / "Delivery Instructions" / "Job Address" blocks into `orders.notes`: `notes` is the only one printed bare, everything else gets a heading, because a naked street address in a picking note reads as the delivery address and is not one. The document-level `notes` and the per-line `lines[].notes` share a key name and are different fields.
- **What the PO printed is the fallback for what the operator didn't say.** `approve-po` fills `orders.notes` from `composeOrderNotes`, `delivery_date` from `requested_date`, and `delivery_address` from `ship_to` (`resolveDeliveryAddress`) whenever no override is supplied. That is the ONLY path any of it has onto the order under `mode:'auto'`, where nobody opens the review modal — every order created before the `ship_to` fallback existed has `delivery_address` NULL. The address fallback writes **no** `horeca_addresses` row: an address lifted off a document was chosen by nobody, and auto-approval would otherwise grow the customer's address book on every PO. NULL still means "fall back to `horecas.address`" (mig `00021`); `lib/orderDeliveryAddress.ts` is the single place that applies that fallback for display.
- **`job_address` is not `ship_to`.** On a builder PO both are printed and they are routinely different — the goods go to the installer's yard while the job is on an estate. Each needs its own prompt bullet; the label-binding rule alone is not enough once two address-shaped blocks sit on one page.
- **`supabase/functions` is excluded from `npx tsc --noEmit`** (`tsconfig.json`), and nothing imports the Edge Functions, so their call sites are type-checked by **nothing** locally — and `supabase functions deploy` without Docker only uploads, so it will not catch it either. This bites with the shared `_shared/poInbox` helpers: their parameter types are all-optional ("weak"), and TypeScript rejects an argument sharing no property with a weak type (`TS2559`). `approve-po`'s local `PendingPoRow.extracted_po` must declare every field it forwards — `ship_to`, `notes`, `delivery_instructions`, `job_address` — or it breaks at runtime having looked fine everywhere else.
- **Tables:** `email_accounts`, `oauth_pending_states`, `inbound_messages`, `pending_pos`, `po_customer_aliases`, `po_product_aliases`, `po_extraction_audit` (migrations `00018`–`00023`).
- **Design docs:** `docs/superpowers/specs/2026-05-20-po-inbox-redesign-design.md` (+ plan alongside).

### Gmail OAuth / Google Cloud setup

The Gmail connect flow (`start-po-oauth` → `_shared/poInbox/oauthUrls.ts` → `gmail-oauth-callback`) uses a Google Cloud OAuth client; client id/secret live in Edge Function secrets `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` (Outlook: `OUTLOOK_OAUTH_CLIENT_*`).

- **Registered redirect URI:** `https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/gmail-oauth-callback` (built by `buildCallbackUri()` from `SUPABASE_URL`). Outlook: `…/outlook-oauth-callback`.
- **Scopes:** `gmail.readonly` (a Google **restricted** scope), `userinfo.email`, `openid`; `access_type=offline`, `prompt=consent`.
- **OAuth consent screen** (Google Cloud Console → APIs & Services → OAuth consent screen): **App name = `NexOrder`**, publishing status **Testing**. The App name is what shows on the consent dialog ("NexOrder wants access…"); if blank, Google falls back to displaying the redirect host (`…supabase.co`). Manage who can connect via **Test users**. Don't add a logo / Homepage / Privacy / ToS URLs unless intentionally going through brand verification.
- **Known limitation:** removing the "Google hasn't verified this app" interstitial requires full verification + (for the restricted scope) a CASA assessment, which needs an **Authorized Domain you own and can verify in Search Console**. `supabase.co` / `vercel.app` don't qualify, so verification is blocked until a custom owned domain fronts the callback. Until then, Testing-mode users click through the interstitial.

## Warehouse & inventory (WIE)

The largest subsystem after ordering, and about half the Edge Functions. Migrations `00027`–`00085`, plus `00090`–`00091`.

**Inventory truth.** `inventory_balances` (product × location × batch **× handling unit**; `on_hand`, `allocated`, `available` generated) is the source of truth; `inventory_movements` is the append-only ledger. `products.inventory` / `products.available` are **caches**, maintained only by `inv_recompute_product_cache()` via `inv_apply_leg()`. All quantities are base units. Every write funnels through `inv_apply_leg` (service_role only): `inv_receive_stock`, `inv_reserve_order`, `inv_pick_order_line`, `inv_transfer_stock`, `inv_adjust_stock`.

**Locations** are one self-referential tree (`kind` ∈ `WAREHOUSE|ZONE|AISLE|RACK|BAY|SHELF|BIN|STAGING`). There is no separate bins table. `locations.code` is **globally unique**. A warehouse is `location_type` `'bulk'` (stock sits at the root) or `'racked'` (bin-level, WIE-driven). Multi-warehouse since `00036`; `inv_default_location()` = lowest-id active warehouse.

**Warehouse Intelligence Engine** — `supabase/functions/_shared/wie/*.ts` is **pure** (no Deno/IO), so the Vite frontend imports the same modules the server runs.
- `graph.ts` walk graph + Dijkstra · `publishReadiness.ts` the 4 publish gates · `autoConnect.ts` walkway repair · `scoring.ts` + `putawayPlan.ts` the putaway optimiser · `pickTasks.ts` / `picking.ts` directed picking.
- Layouts are drafted (`mutate-layout` `save_geometry`), then **published** (`publish-layout` → `wie_publish_layout_tx`), which builds the routing graph and flips the warehouse to `racked`. Only one published layout per warehouse.
- Putaway: receipt/adjust/transfer → `_shared/putawayTasks.ts` `generatePutawayTasks` → `wie_putaway_recommendations` (advisory) → `decide-putaway` / `complete-putaway` → `inv_transfer_stock(root → bin)`. Stock only reaches a bin through those two functions.
- **Putaway is two-stage since mig `00080`** — `suggested --assign--> assigned --complete--> accepted|overridden`. Assigning moves **no stock** (`wie_assign_putaway_tx`); the transfer fires only at `complete-putaway` (`wie_complete_putaway_tx`), when the operator scans the bin and the plate on the floor. Un-placed goods therefore read as sitting at the warehouse root, which is where they actually are. `wie_unassign_putaway_tx` returns an abandoned run to `'suggested'`; `wie_putaway_stops` turns assigned rows into routable walk stops (`recommend-putaway-route`). Scanning the *wrong* bin warns but still records.
- `wie_decide_putaway_tx` (mig `00071`) is deliberately untouched by `00080` and remains the **one-step "place it now"** desk/bulk path (also used by the CSV opening-stock importer). Both transactions claim the row `FOR UPDATE` and optionally **split** it: a partial putaway leaves the ORIGINAL row `'suggested'` holding the remainder and inserts a decided copy as the audit record. Re-scoring a queued line is `recommend-putaway` + `replaces_recommendation_id`, which expires the row it supersedes.
- Frontend: `components/inventory/PutawayWalkView.tsx` + `inventory/putaway/{PutawayScanFinder,PutawayStopCard}.tsx`, `hooks/queries/usePutawayWalk.ts`, `services/supabase/putawayRouteService.ts`.
- **The opening-stock CSV takes an optional `bin_code`, which is what makes a counted-by-bin stocktake importable in one pass.** Stock still never reaches a bin through a receipt — `receive-stock`'s `location_id` is the destination *warehouse*, and passing a bin id would also stamp `handling_units.warehouse_id` with it. So `StockImportModal` groups rows **by bin before chunking**, receives each group as its own receipt, and drives every recommendation that receipt returns onto that group's bin via `decidePutaway({decision:'override', roleOverride:true})`. Grouping first is the point: one destination per receipt means no matching of recommendations back to CSV rows. `roleOverride` is deliberate — a count records where stock *physically is*, and refusing pallets on a pick level would not move them, only leave the system wrong. Rows leave the preview grid the moment the **receipt** succeeds, even if placement then fails, because re-importing them would receive the quantities twice; the failure text says so and points at the Putaway queue. A warehouse with no published layout returns `mode: 'legacy'` and no recommendations — the rows are received and reported as unplaced rather than silently dropped.

**Grid scale** (mig `00091`) — `warehouse_layouts.cell_size_m` is what makes every reported metre mean anything, and it was 1.0 everywhere until now because nothing ever sent it. The operator states the building's real size and a resolution; **the grid is derived**. `_shared/wie/gridScale.ts` is pure and imported by both runtimes — the designer previews a rescale with the same `planRescale` the server performs.
- **Exact rational arithmetic, never floats.** `cell_size_m` is `NUMERIC(6,2)`, so the factor between two resolutions is an exact fraction in hundredths (1.0 → 0.75 is 4/3). "Does a 3-cell rack land on whole cells" is therefore an integer test. Anything indivisible, out of bounds, or past the 200-cell cap is **refused with the offenders named** — never rounded, never relocated, because a bin is a real `locations` row that may hold stock.
- **`update_layout` is the one `mutate-layout` action that does not `requireDraft`.** A mis-measured building is only discovered after go-live and the alternative was redrawing the floor plan. Geometry rows carry no inventory, so moving them on a published layout is safe — but publishing **freezes** `layout_graph_edges.weight_m` / `layout_travel_distances.distance_m` / `layout_placements.access_offset_m`, so the change is inert until republish. `publish-layout` therefore accepts a re-publish (`wie_publish_layout_tx` always handled it; its archive step is scoped `id <> p_layout_id`).
- `needsRepublish` is **derived** in `lib/adapters.ts` from `updated_at > published_at`, not stored — nothing else can move `updated_at` on a published layout.
- `wie_update_layout_tx` is deliberately dumb: the maths is not restated in PL/pgSQL, the caller sends computed coordinates and the RPC applies them atomically with a bounds backstop. A half-rescaled layout is a corrupt layout, which is why this can't be a sequence of supabase-js updates.
- **`ACCESS_OFFSET_STEP_M` (0.5) stays absolute** — vertical reach up a rack level is real metres and has nothing to do with floor scale. `wie-batch-reoptimize`'s gain floor is now `max(1.0 m, cellSizeM)`: at 3 m/cell a bare 1 m threshold admitted a third-of-a-cell move.
- Floor-plan import is the mirror case: the **grid is fixed** by the extraction, so **cell size** is derived. The model reads printed dimensions/scale bars and *proposes* them (null when the drawing says nothing); the operator confirms before they become the scale.

**Setup checklist** (mig `00092`) — standing a warehouse up is strictly order-dependent (config → publish → label → count → import) and nothing in the UI said so. `WarehouseSetupPanel` renders above the map on the Warehouse tab for Admin/Manager, derives where the site actually is, and deep-links each step.
- **`lib/warehouseSetup/evaluate.ts` is pure and takes already-fetched data**; `hooks/queries/useWarehouseSetup.ts` does the gathering. Same split as `publishReadiness.ts` vs `PublishChecklist`. Only two queries are new — the acknowledgement rows and a `product_home_bins` head-count; everything else is already cached by the Warehouse tab.
- **The three config vocabularies ship SEEDED** (`storage_types` 6, `level_roles` 3, `zone_profiles` 8 — and `useLevelRoles` carries `placeholderData`, so it can never return empty). "A row exists" is permanently true and proves nothing, so those steps are **sign-offs**: has anyone checked the defaults against the real racking. Same for the wifi walk and the three go-live exercises, whose rows exist but where a seeded/demo row would false-positive.
- **`_shared/warehouseSetupSteps.ts` is the one vocabulary, both runtimes.** The edge function validates `step_key` against it; `lib/warehouseSetup/steps.ts` builds titles/prose/nav on top and **throws at module load** if the two disagree on a key or its kind. Acknowledging a *derived* step is refused, not ignored — the panel would keep showing the derived truth while the row claimed otherwise.
- **No dismissal and no backfill.** All derived steps passing collapses the panel to one line; a dismiss button could hide a genuinely missing step and collapsing cannot. Step keys are STORED — renaming one orphans its sign-offs.
- Three guardrails warn (never block): stock import into a racked site with unconfirmed bin labels, a layout at ≥90% of `PUTAWAY_CANDIDATE_LIMIT`, and publishing with level roles / zone profiles unchecked. Refusing wouldn't put stickers on racking; it would only stop the work.

**Stocktake by location** (`count-bin`, **no migration**) — one number per SKU per location, posted as `stocktake_variance`. Closes onboarding gap H2: `AdjustStockModal` corrects one (product, location, batch) slot at a time and the opening-stock CSV is *additive*, so a re-count finding LESS than the system believed had nowhere to go. Nav item **Stocktake** (Admin/Manager/Warehouse), `components/inventory/StocktakePage.tsx` + `inventory/stocktake/*`.
- **`inv_adjust_stock` fans out over PLATES but only within ONE batch** (`COALESCE(batch_id,0) = COALESCE(v_batch_id,0)`, mig `00075` §7). `p_batch_id => NULL` names the **untracked slot**, not "every lot". A one-number-per-SKU count therefore cannot be one RPC call, and that — not the rate limit — is why `count-bin` exists rather than a client loop over `adjust-stock`. It does the **batch** fan-out; the RPC does the **plate** fan-out inside each batch. (The rate limit is the second reason: `adjust-stock` is 30/min/user and a 12-line bin would burn 12.)
- **`_shared/binCount.ts` is pure and imported by both runtimes**, re-exported by `lib/binCount.ts` — the sheet's live prediction *is* the server's decision, evaluated early, not a second copy of it. Same split as `_shared/wie/levelRoles.ts` ↔ `lib/levelRoles.ts`.
- **A surplus goes to the only lot present, or to untracked.** One lot holding stock → that lot. Zero or several → `batch NULL`, and the sheet **says so** — stamping one of two lots asserts an expiry nobody stated, while always-untracked would give a single-lot bin a second expiry-less row that FEFO has nothing to order by.
- **A shortfall deeper than `Σ available` is refused for the WHOLE line and writes nothing**, while every other line still posts. Half-applying leaves the SKU matching neither the count nor the prior belief, and the operator cannot re-count without double-applying. Shortfalls consume FEFO across lots (undated last). The sheet predicts the refusal from `allocated` before anything is sent.
- **Blank ≠ zero.** A line nobody typed into is untouched; a write-off must be typed as `0`. `parseCountedQty` returns `null` for blank and `undefined` for unusable text — never 0.
- **Any stock-holding location is countable, including a warehouse ROOT** — that is how a bulk / floor-stacked area is counted at all, and a root has no QR to scan, so the picker list is not a convenience. `getWarehouseLocations` matches `LIKE '<wh>/%'` and **excludes the root**, so `StocktakePage` prepends it. ZONE/AISLE/RACK are excluded: a levelled rack's stock is on its SHELF rows.
- Upward counts route through `generatePutawayTasks` exactly as `adjust-stock` does — it self-skips for a specific bin, so counting a bin raises nothing and counting a racked root raises real tasks. **One** audit event per location (`resource: 'inventory_count'`), not one per line.
- No line ever throws: an unexpected RPC error is reported as a failed line so the response still says which of the other lines landed.

**Deep linking** — `?tab=` was added with this (`lib/adminTabUrl.ts`, which now **owns the `AdminTab` union**; `AdminView` re-exports it). `AppShell` wraps `setAdminView` once to write it, so no sidebar edits; the read branch sits **after** the Warehouse-role and demo-persona early returns and is **role-validated**, because `AdminView` renders nothing when a role gate fails and an unchecked `?tab=` is a blank page. This also retires the orphan-param class of bug — `?subtab=`/`?wh=` used to survive a reload with no owning tab.
- `AdminView.openWith(tab, params)` is the one URL writer (`openDesigner`/`openPutaway` are now wrappers). `hooks/useFlagDeepLink.ts` consumes a one-shot flag and **strips it unconditionally** — a param left behind re-fires on every later visit to that tab, which is the bug `?designer=` had (fixed here: it stripped only on match).
- **The param namespace is flat and crowded.** `?import=` already means *floor-plan import* globally, so the CSV importers are `?stockimport=` / `?prodimport=`; `?subtab=` is shared between PO Inbox and Settings. `settingsSubtabFromSearch` now carries a param→subtab **table** — a deep link must force the sub-tab that HOSTS its target, or the consuming effect fires while its host is `hidden` and pops a modal over the wrong tab.
- **`?section=` scrolling is not an anchor.** Native `#hash` is dead here (`document.body` never scrolls; the scroller is `main[data-scroll-container]`). `useSectionDeepLink` polls until the target's `offsetParent` is non-null — `scrollIntoView` in a `display:none` sub-tab is a **silent no-op** — then re-scrolls after the queries swap their skeletons and change the height.
- `WarehousePage` gained `PutawayQueuePage`'s ref-guarded `?wh=` scope-adoption effect; without it an in-session `?tab=Warehouse&wh=3` silently shows a different site (the scope provider only reads the URL at its own init).

**Named areas** (mig `00090`) — an operator-drawn, tinted, labelled region ("Cold Storage", "Bulk"). A `layout_objects` row of `object_type='area'` whose `meta` is `{ name, zoneProfileId? }`, painted **cell-by-cell like a wall** (the data model stays 1×1, so erase/select keep working per cell).
- **An area's identity is its NAME, per floor.** `objectRegions.regionGroupKey` subdivides the flood fill by it, which is what lets a 50-cell area merge into one labelled region while a touching "Bulk" stays separate — merging on type alone would fuse them under one of the two names, the same failure that keeps `obstacle` out of `MERGED_OBJECT_TYPES`. Renaming therefore goes through `rename_area` (moves every cell); renaming the one selected cell would split the region.
- Areas **co-occupy with everything** in `ALLOWED_COOCCUPANTS` (like `label`): an area names the ground the racks stand on, so it must lie over them. It is **inert in `buildWalkableCells`** — neither walkable nor subtracted — so routing and publish readiness are untouched.
- Both canvases render it identically: wash under the grid, name above the bins, tinted via `zoneTint(zoneProfileId → zone_type)` so an area, its zone and the COLD_ROOM storage form agree on what "cold" looks like. `OBJECT_FILL.area` is only the no-profile fallback.
- **`meta.zoneProfileId` IS the binding, as of `00096`** — it was inert from `00090` until then, and the entry that used to sit here said so. What has not changed is HOW a bin's zone is read: **materialized-path ancestry to a `kind='ZONE'` location** (`00047`'s header; `wie_putaway_candidates`' LATERAL join). `locations.zone_profile_id` *on a bin* is still read by nothing and is still never stamped — binding moves the bin, it does not label it. See "Zone binding" below.
- **`meta.name` IS read, as of `00094`** — it is where a bin's friendly name comes from. That is display text, not zone semantics; the note above is unchanged.

**Floor signs** (mig `00097`) — plain wayfinding text on the map ("Inbound Staging"), placeable on a **published** layout. Backed by `object_type='label'`, legal since `00045` but until now authorable only on a draft, because `save_geometry` was its only writer and it `requireDraft`s. MAIN carries five from its seed.
- **A SIGN IS NOT AN AREA, and every difference follows.** An area is warehouse vocabulary with consequences: it renames the bins standing on it (`00094`) and re-parents them under a ZONE (`00096`). A sign is text. `paint_labels` therefore has **no `cascade_names`, no `include_custom`, and runs no binding pass** — do not add them "for symmetry" with `paint_areas`. The asymmetry is the feature.
- Safe on a live layout for exactly `00095`'s reason, if anything more strongly: `buildWalkableCells` whitelists `walkway|dock|lift|staging` and subtracts `wall|conveyor`, `publish-layout` reads `object_type` only for `staging_location_id`, and `resolveOverlaps` exempts labels outright. No graph node, no edge weight, no `access_offset_m`. **`warehouse_layouts.updated_at` is NOT bumped** — same rule as areas and `rename_area`.
- **`_shared/wie/signPaint.ts` is pure and imported by both runtimes** (re-exported by `lib/signPaint.ts`). It **delegates** to `areaPaint.ts` rather than forking it: `areaSpecsFromObjects` / `areaObjectsFromSpecs` / `areaCellsFingerprint` / `diffAreas` now take an `objectType` (defaulted to `'area'`, so every existing call site is unchanged). Forking would duplicate `fnv1a` and the cell comparator, and the fingerprint must agree byte-for-byte across the two runtimes or every save 409s. `planAreaCascade` stays area-only.
- **Signs get their OWN fingerprint and their own baseline ref.** Sharing the area one would make an area paint 409 a sign save and vice versa — the two pictures move independently and each action checks only its own.
- **`label` is now in `MERGED_OBJECT_TYPES`, keyed by name** like `area`. It was excluded on the argument that "merging two adjacent labels would swallow both names" — true of a merge on *type*, which is precisely what `regionGroupKey` exists to stop doing. Leaving it out had a cost only visible once signs became paintable: a painted sign is N separate 1×1 objects and both canvases gate name text at ~48px, so it could **never draw its own text at any zoom**. MAIN's seeded signs only showed because the seed wrote them as single `w: 10` rows. `obstacle` stays out (discrete named rooms).
- Consequently `'label'` is **removed from `NAMED_OBJECT_TYPES`** on both canvases (that pass iterates every object and would stamp the text on every cell), and the text is drawn **once per region, centred on its bounding box, in the top text layer above the bins** — signs co-occupy with everything, so one over a rack row is the normal case and text under the bins would vanish. Centring (vs an area name's top-left anchor) is what keeps the seeded signs looking identical.
- **The first save on a site rewrites its seeded wide labels as 1×1 rows** (MAIN's five become ~42). Lossless: the fold expands `w`/`h` and merging redraws them in place. `__tests__/signPaint.test.ts` pins the fingerprint across that round trip — without it every sign save on MAIN would 409 forever.
- Live map: one **Annotate** button (not a third one beside "Paint areas") opening `AreaPaintToolbar` with an **Areas | Signs** toggle. One working set, **one undo stack spanning both layers**, one Save. Clicking a sign's text enters annotate mode on the sign layer and opens `EditSignModal`, which **edits the working set rather than calling the server** — `paint_labels` is a full replace, so a self-saving dialog would be a second implementation of the same write with its own fingerprint to get wrong. Designer: `label` joins `AREA_SCOPE_TOOLS`; Save issues `paint_labels` **then** `paint_areas`, each only if its own fingerprint moved (signs first — they cannot fail on a cascade, so an area failure leaves only the risky half to retry).
- **The scoped eraser reads `annotationBrush`, not stacking order.** Signs and areas overlap freely and there is no ordering that is right in both directions; the operator already said which layer they are on.
- **A blank brush is now REFUSED, out loud** (`blockedAt.reason = 'unnamed'`). This was the reported bug: the Area tool armed on click, so painting before typing wrote cells with no `meta.name` — merging into no region, drawing no text, and rejected by the server. For an area the only trace was a `#a8a29e` wash at 12% opacity *under* the grid, invisible on stone. "I painted and nothing showed" was exactly this. The designer's area input also gained the `sanitizeAreaName` / `maxLength` / inline-issue treatment the live map has had since `00095`.

**Zone binding** (mig `00096`) — what finally reads an area's `meta.zoneProfileId`. A bin's zone is not a column: it is derived by prefix-matching `materialized_path` against `kind='ZONE'` rows, and every drawn bin was parented at the warehouse ROOT, so that LATERAL returned NULL for every bin on every site and the whole zone subsystem (`allowed_categories`, `priority_weight`, `max_utilization_pct`, the `zoneTag` rule field) had never once fired. Binding means **re-parenting**: a new `parent_id` AND a new `materialized_path`, plus a rewritten path on every SHELF child.
- **The rule, for a unit** (a flat bin, or a levelled rack's RACK PARENT): its area's `zoneProfileId` → that profile's ZONE; else the placement's own `zone_profile_id` → that ZONE; else the warehouse root. **The AREA wins over the per-bin dropdown** (`PlacementInspector`/`RackWizard`), which predates areas and is invisible on the map.
- **Erase, shrink or un-profile is NOT a special case** — it is the third branch, reached by evaluating the same rule again. That is what makes the reverse free, and it is the half most likely to be missing.
- **One ZONE per (warehouse, profile), never per area.** Two areas tagged Cold share `<WH>-Z4`. A zone's `code` is a `materialized_path` segment, so per-area zones would make renaming an area rewrite the zone's path and every descendant's — a second, harder path rewrite on top of this one. The cost: `zone_tag` (= `lower(zone.name)`) is the PROFILE name, so a `wie_rules` row matching on it matches the profile, not the area.
- **`_shared/wie/zoneBinding.ts` is pure and imported by both runtimes** (re-exported by `lib/zoneBinding.ts`); I/O beside it in **`_shared/zoneResolve.ts`**, which now owns `resolveZone` — lifted verbatim out of `mutate-layout`, because two find-or-create implementations racing on one (warehouse, profile) pair leave two ZONE rows and a LATERAL that picks the longer path. **Containment is not redefined**: `areaForRect` (the majority-of-cells vote) is imported from `locationNaming.ts`, so naming and binding can never disagree about which area a rack is in.
- **`parent_id` and `materialized_path` are two independent hand-maintained copies of one edge** and nothing in the database enforces agreement. Every move writes both. A SHELF's path is composed from string parts at creation and never read back from its rack, so **re-parenting a rack silently invalidates every child path unless the children are in the same batch** — verified live: a level left out of the batch keeps its stale path. `planZoneBinding` always emits them, and checks them independently of the unit so a drifted level is repaired even when its rack is settled.
- `wie_reparent_locations_tx` mirrors `wie_rename_locations_tx` (one statement, count-mismatch → `serialization_failure`, service_role only) but carries **three** scope guards, not one: the row's current path, its NEW path, and its NEW PARENT must all be under the warehouse. The third is not implied by the second — a well-formed path string can point `parent_id` at another site.
- **Automatic on `paint_areas` and `save_geometry`; `bind_zones` is for the site painted before this existed.** New bins are inserted under the right parent first time (`resolveZone` at creation), so the binding pass only ever touches rows that already existed. Scope is `layout_placements`, so a hand-built `WarehouseTreeEditor` node is never re-parented. `bind_zones` has its own `:bind:` 10/min bucket and a `dry_run` that returns before any write — **the only surface that previews a re-parent**. Re-running it must report zero moves; that idempotence is the proof the rule is total.
- **`allowed_categories` WARNS, never blocks.** Binding turns a hard allow-list on for the first time, so a bin can become an illegal putaway target while still holding the stock the zone excludes. Refusing would not move the pallets.
- Emptied ZONE rows are left in place (`zoneRegions` derives a zone's shape from its bins, so an empty one draws nothing). `warehouse_layouts.updated_at` is **not** bumped — parentage contributes no graph node, edge weight or `access_offset_m`. `00096` also adds the first-ever index on `materialized_path` (`text_pattern_ops`, load-bearing: a default btree cannot serve `LIKE 'prefix%'`).
- **Three places answered "what zone is this bin in" and two were wrong.** `plan-reslot` read `bin.zone_profile_id` (never written on a bin) and sent `zone_type` as `zoneTag`; both fixed to ancestry + `lower(zone.name)`. `putawayGuards.resolveZoneProfileId` walks `parent_id` while SQL walks the path — they agree only because binding keeps both in step; the comment there says so.

**Friendly location names** (mig `00094`) — `L4 · NEXG-B-9-4-L4` is a grid COORDINATE (`${wh}-B-${x}-${y}[-L${n}]`), and a drawn layout has no AISLE or BAY to name either (its tree is Warehouse → [Zone] → Rack → Shelf). So the grouping comes from the painted **named area**, and a rack reads `Chiller · Rack 7`, its levels `Chiller · Rack 7 · L4`.
- **`locations.name` already existed, NOT NULL, written at draw time — with `Bin 9,4`.** The column was never the problem; the value and the display were. **The code is untouched and must stay so**: QR payload, `resolveScan` key, `materialized_path` segment, CSV `bin_code`.
- **`_shared/wie/locationNaming.ts` is pure and imported by both runtimes** (re-exported by `lib/locationNaming.ts`); the I/O sits beside it in `_shared/locationNamingWrite.ts`, because `wie/` is under the purity contract (`__tests__/wie/purity.test.ts`). The designer's preview IS the server's decision. Display helpers: `lib/locationDisplay.ts` + `components/inventory/LocationLabel.tsx`; id→name lookups: `lib/locationLookup.ts` (warehouse-scoped) and `hooks/queries/useLocationNames.ts` (order-scoped pick surfaces only).
- **A number is assigned once and NEVER reassigned.** Delete rack 3 and the next is 6. A sign already on the racking cannot be un-printed, and re-minting 3 puts two racks under one name. Assignment fires only where `name_seq IS NULL`, which makes the pass monotonic — which is what lets the server recompute the client's answer rather than trust it.
- **Three columns, not one flag.** `name_is_auto` alone cannot say which pool a number came from: paint "Bulk" over `Chiller · Rack 1..5` and a geometry-derived pool finds Chiller empty, so the next Chiller rack duplicates a live name. **`name_area` is the pool key and is stored, never derived.** `name_seq` likewise cannot be derived from position (renumbers on delete) nor parsed back out of `name` (an area name is free text and may contain ` · Rack `).
- **The high-water mark comes from the WAREHOUSE, not the layout** (`loadAreaHighWater`, and `seqFloor` client-side). Deleting a rack drops its placement row but not its `locations` row — publishing never retires a bin. A rack drawn and deleted *before any save* leaves no claim, which is correct.
- **Pools are per area NAME, across floors**, so `rename_area` drops its floor predicate. `00090`'s "identity is its name, per floor" is about region MERGING — a flood fill cannot cross floors. A region is a per-floor blob; an area is every blob sharing a name.
- **`area_renames` rides on `save_geometry`; it cannot be inferred.** A full replace sends byte-identical geometry for "renamed Chiller" and "erased Chiller, painted Cold Room". Coalesced client-side (A→B→C ⇒ A→C).
- **The live rename is on `mutate-warehouse-location`, not `mutate-layout`** — see the lockdown table. `mutate-layout` is Admin-only and gates *before* body parse; this one is already Admin+Manager and already writes `layout_placements`. The area↔bin join is purely geometric (`layout_objects` cells ∩ `layout_placements` cells on the same layout); the intersection is done in TS, not SQL, for the same reason `proposeHomeBins` is. `dry_run` on the real action, never a separate preview endpoint. Own 10/min bucket; one audit event; **`warehouse_layouts.updated_at` is deliberately NOT bumped** or `needsRepublish` would demand a routing-graph rebuild for a spelling fix.
- **Typing a name makes it custom and releases its number** — forced server-side in both `update` and the reducer, since a caller could otherwise leave a typed name marked auto and have the next cascade eat it. A cascade skips custom rows and *reports* how many; "also rename these" is the opt-in.
- **Scan prompts keep the CODE** ("expecting NEXG-B-9-4-L4"): the sticker prints the code large and the name only as small context, so the prompt must quote what is big on it. Toasts take `locationOneLine` (both). **CSV keeps `bin_code`; there is no `bin_name`** — a non-unique name cannot be an identity contract.
- On the canvases a bin draws the name's **tail** only (the area is its own wayfinding layer), falling back to the code when it will not fit; `fitName` is head-preserving where `fitCode` keeps the tail, and names are proportional (`SANS_ADVANCE`).
- **`claimedInTarget` (added `00095`) is what stops a moved BOUNDARY duplicating a name.** `assignAutoNames` keeps a unit's number when it came from either side of a rename, and the high-water fold protects only *fresh* mints — so sweeping `Bulk · Rack 3` into a Chiller that already holds `Chiller · Rack 3` produced two racks under one name. Harmless while an area could only be renamed (a rename moves the whole pool at once, so nothing can collide, and `rename_area` deliberately still passes nothing); reachable on day one of painting. `planAreaCascade` supplies it per group.

**Live area painting** (mig `00095`) — an area's shape, name, tint and existence are editable on a **published** layout, from the live map *and* from the designer opened on it. Everything else about a published layout stays read-only.
- **Why this is safe, precisely: an `area` is INERT in routing.** `buildWalkableCells` whitelists `walkway|dock|lift|staging` and subtracts `wall|conveyor`; `publish-layout` reads `object_type` only to collect `staging_location_id`. An area contributes no graph node, no edge weight and no `access_offset_m`, so it cannot invalidate anything `wie_publish_layout_tx` froze. **Therefore `warehouse_layouts.updated_at` is NOT bumped** — same rule as `rename_area`.
- **FULL REPLACE, not a diff, and that is the design.** The server reads the before-picture from the database, so "renamed Chiller to Cold Room" and "erased Chiller, painted Cold Room over the same cells" are *derived* as the same plan rather than told apart — correct, because both mean the same thing. This is exactly the ambiguity `save_geometry` needs `area_renames` for; **`paint_areas` has no such field and must never grow one.**
- **Storage stays 1×1 rows, enforced by the RPC.** The designer's `paint_cell` removes *the whole object covering a cell*, so a stored multi-cell run would vanish wholesale the first time one cell of it was repainted. Run-length packing is a **wire format only** (a blobby area compresses 10–40×).
- **`wie_replace_layout_areas_tx` exists because two supabase-js statements are not a transaction.** There is no ordering of a separate DELETE and INSERT that is correct — delete-first leaves a live warehouse with every area gone if the insert fails. Deliberately dumb: bounds backstop, 1×1 and non-blank-name checks, nothing else.
- **`_shared/wie/areaPaint.ts` is pure and imported by both runtimes** (re-exported by `lib/areaPaint.ts`). Two things depend on it being literally the same code: `areaCellsFingerprint` (a byte of drift and every save 409s on a picture nobody changed) and the summary panel's counts, which ARE the server's `dry_run`. `planAreaCascade` is the only new decision logic — it buckets moved units by `(beforeArea → afterArea)` and feeds each direction through `assignAutoNames` as a rename, so adopt / strip / boundary-move all fall out with no special case. **Groups are threaded, not independent**: separate calls lose the shared high-water mark and the record of which numbers have landed, without which `Bulk · Rack 3` and `Cold · Rack 3` both moving into Chiller would both keep 3.
- **The cascade is OPT-IN**, previewed by `dry_run` (which returns before any write and before the audit). A unit whose carried pool already disagreed with where it sat is reported as `skippedForeign` and **left alone** — this paint did not make it inconsistent. Own `:paint:` bucket at 10/min, deliberately not shared with `:area:` so a burst of paints cannot lock the operator out of fixing a spelling.
- **Concurrency is a fingerprint, not a timestamp** — see the `updated_at` rule above: *nothing* moves when areas change. `base_fingerprint` is captured once at paint-mode entry and held in a ref, never recomputed from live query data, or a background refetch would leave the check comparing the server's picture against itself. The designer's stale-draft banner compares fingerprints for the same reason.
- **`EditorState.editScope`** (`'all' | 'areas'`) is the designer's guard, and it lives in the **reducer**, not the toolbar: a keyboard shortcut, a stale render or a canvas drag must be refused by the same thing that refuses a bad co-occupancy. In `'areas'`, Save routes to `paint_areas` — **never** to `save_geometry`, which is a full replace plus an orphan sweep that hard-deletes `locations` rows. Note the eraser must look for an `area` *specifically* rather than take `objectAt`'s topmost hit: areas co-occupy with everything, so over a wall the topmost object is the wall.
- On the live map the cell is derived in **`MapStage`**, not the canvas (`WarehouseCanvas`'s scene memo excludes `viewport.tx/ty` so a pan is one `<g transform>` update). Paint mode takes pointer capture **eagerly** — correct there and only there, because the lazy capture in `useMapViewport` exists to preserve a trailing child `click` and paint mode has none; `Alt` falls through to the pan path. The ✎ rename pencil is suppressed while painting: both rewrite the same rows.

**Level roles are operator-managed data** (mig `00081`). A rack level's role lives in `level_roles`; `locations.level_role` FKs it (the CHECK is gone). The **stored key never changes** — `'pick'` is still `'pick'`; its `display_name` is "Pick Zone". `NULL` still means an unconstrained legacy bin, which the FK preserves for free.
- The row carries what used to be code: `hu_types` (replaced `ROLES_BY_HU_TYPE`), `is_pick_zone` (replenishment destination + `inv_reserve_order` preference), `replen_source_rank` (which roles feed a pick zone, in order).
- **One definition, both runtimes:** `_shared/wie/levelRoles.ts` (pure — every helper takes the role array as its first arg, no cache, no fetch), re-exported by `lib/levelRoles.ts`. Load it via `useLevelRoles()` client-side or `_shared/levelRoleLookup.ts` server-side. **Never** compare a role to a literal to decide behaviour — read the flags.
- Admin CRUD: `mutate-level-role` + `components/admin/LevelRolesSection.tsx` (Settings → Warehouse). Deleting needs `wie_level_role_usage` all-zero — it counts the two references no FK can guard, `product_wms_attributes.allowed_level_roles` (array element) and `storage_types.level_template` (JSONB).

**Replenishment** (mig `00082`) — reserve/bulk → pick zone, same two-stage shape as putaway: `suggested --assign--> assigned --complete--> accepted|overridden`, stock moving only at `complete-replenishment`.
- Config is `product_home_bins.{min_qty,max_qty,replen_enabled}` (base units), guarded by a trigger to pick-zone levels. Its unique key is now `(product_id, warehouse_id, purpose)`.
- Detector `wie_replen_detect` runs advisorily after **every pick and every putaway**, plus on demand. The putaway hook is not redundant: "short but nothing to pull" is a state entered by a putaway, not a pick.
- Functions: `detect-`/`assign-`/`complete-`/`unassign-replenishment`, `recommend-replen-route` — all Admin/Manager/**Warehouse** (`transfer-stock` is Admin/Manager only, so it could never serve this).
- Frontend: `components/inventory/{ReplenQueuePage,ReplenQueueView,ReplenWalkView}.tsx` + `inventory/replen/ReplenStopCard.tsx`, `hooks/queries/useReplenishment.ts`.

**Bulk min/max** (mig `00093`, closes onboarding H3) — `ReplenQueuePage`'s third sub-view, `?subtab=setup`, **Admin/Manager only** (`mutate-product-home-bin`'s roles; Warehouse staff walk the queue, they do not set thresholds). One grid per site: every active product ranked by demand, its home bin, its two figures, CSV export/import.
- **Read is `wie_replen_config_rows(warehouse)`**, one STABLE `SECURITY DEFINER` RPC granted to `authenticated` — same pattern and calling convention as `wie_warehouse_report` (including `supabase.rpc.bind`). It reports **facts only**: policy maths and free-bin assignment are deliberately not in SQL.
- **`_shared/wie/replenPolicy.ts` is pure and imported by both runtimes**, re-exported by `lib/replenPolicy.ts` — the grid's suggested figures and inline refusals ARE the server's decision, evaluated early. Same split as `_shared/binCount.ts`.
- **The suggestion is capacity, never demand.** A site being stood up has no picks, and days-of-cover from three days of history is a fiction. `capacityBaseUnits` inverts `capacity.ts`: a carton bay holds `capacity_slots / size_factor`; a **pallet** bay holds `capacity_slots × units-per-pallet`, which exists nowhere but the product's largest UOM — without one there is **no suggestion**, because an invented figure becomes a real transfer to a real rack.
- **`proposeHomeBins` is greedy in demand order and cannot double-claim** — that is precisely why it is JS and not a SQL subquery, which would hand one nearest bin to every SKU. Stock-held bin first (a person put it there), else nearest free pick bin. An *untouched* proposal is not a change: counting them made Save offer to commit 118 assignments nobody had looked at.
- **`bulkSet` takes `replenEnabled` at CALL level, not per row.** It maps onto the two acts (save figures / arm), and PostgREST needs a uniform key set across an upsert batch — omitting it leaves the column untouched on existing rows and `false` on new ones. Every row is validated in JS **before** the single upsert, because the table's CHECKs and its pick-zone trigger abort the whole statement on one bad row. A refused row is reported, never fatal; **one** audit event per batch (`product_home_bins_bulk`). Own rate bucket, 10/min.
- **A row already armed still has to satisfy the pick-zone rule when merely edited** — `willBeArmed(row, 'leave')` is the row's own `replen_enabled`, not `false`.
- Blank ≠ zero on both the grid and the CSV (`min_packs`/`max_packs` are authoritative; the exported `*_base` columns are read-only arithmetic).
- **Never render a per-row `<select>` of bins.** 158 rows × ~400 locations froze the tab hard enough that Chrome could not be scripted; the grid renders ONE `<datalist>` and every row's bin input points at it.
- The setup checklist's `replen_min_max` step counts **armed** rows only (`countReplenConfigured`), so saving figures does not tick it — which is the honest test of whether replenishment is on.

**QR tracking & handling units** (migs `00074`–`00078`).
- **Scan identity.** The QR payload is **bare text** — a `locations.code`, a product SKU, or a handling-unit code — with no URL wrapper and no namespace prefix, so third-party scanner apps read something meaningful. The cost is that one string could name two things: `lib/scan/resolveScan.ts` returns `ambiguous` with every candidate and the UI asks the operator. **It never guesses.** Labels are rendered by `generate-labels` (`_shared/labelSheet.ts`) and logged to `label_print_log`; print UI is `components/admin/LabelPrintingSection.tsx`, input primitive is `components/ui/ScanField.tsx` (+ `lib/scan/useBarcodeScanner.ts`).
- **Handling units are an inventory dimension, not a sidecar.** There is no `hu_contents` table — `handling_unit_id` is a nullable 4th column on `inventory_balances`, folded into the unique slot index exactly as `batch_id` is: `UNIQUE (product_id, location_id, COALESCE(batch_id,0), COALESCE(handling_unit_id,0))`. A plate's contents **are** its balance rows, so mixed-SKU plates fall out for free and there is no second copy of the quantity to drift. `NULL` = loose/untracked stock and stays valid forever.
- **Per-plate capacity** (`00078`): a pallet consumes **one position**, not `qty × size_factor`. `v_bin_fill` is the single source of bin fill — don't re-derive it.
- Picking is scan-enforced: `_shared/pickScanCheck.ts` validates at `record-pick`.

**WIE gotchas** (each has cost real debugging time):
- **`wie_putaway_candidates`' cap is `PUTAWAY_CANDIDATE_LIMIT` = 2000, not 200.** It was 200 until mig `00072` raised it ("MAIN alone is 189 bays x 5 levels = 945 locations"); this entry said 200 until 2026-08-03. The constant lives in `_shared/wie/types.ts` — the *pure* module — because `_shared/putawayTasks.ts`, which passes it, imports supabase-js from a URL and so cannot be imported by the frontend; the layout designer warns from 90%. It is ordered by dock distance with the limit as a **hard cutoff**, so a layout with more addressable locations silently hides its farthest bays from the engine. **Count locations, not placements**: a levelled rack holds no placement row of its own — its SHELF levels do. It also returns **every** active placement regardless of `kind` — anything you place is a putaway target, so staging/returns must be `label` objects, not bins.
- `planPutaway` is **greedy per line in input order**. Whichever SKUs are offered first claim the dock-adjacent bays, so callers must sort by velocity or fast movers land behind slow ones.
- `scoring.ts` never reads `temp_min`/`temp_max`. Route a category into a zone via `zone_profiles.allowed_categories` + a warehouse-scoped `wie_rules` row (`wie_rules.warehouse_id`), not SKU temperature.
- `publish-layout` deliberately passes an empty `p_deactivate` — publishing **never retires old bins**.
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
| `orders`, `order_items` | `place-order` | role-gated server-side | `00009` |
| `orders.status` | `update-order-status` | Admin, Manager | `00010`, `00025` |
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
| `locations` (warehouses / bins) | `mutate-warehouse`, `mutate-warehouse-location` | Admin, Manager | `00036` |
| `warehouse_layouts`, `layout_*` | `mutate-layout`, `publish-layout` | Admin | `00045`, `00046` |
| ↳ `layout_objects` (AREA rows: geometry + `meta`) | `mutate-warehouse-location` `rename_area` / `paint_areas` | Admin, Manager | `00094`, `00095` |
| ↳ `layout_objects` (LABEL rows: floor signs) | `mutate-warehouse-location` `paint_labels` | Admin, Manager | `00097` |
| ↳ `locations.parent_id` + `.materialized_path` (zone binding) | `mutate-warehouse-location` `bind_zones`, and as a side effect of `paint_areas` / `rename_area` / `mutate-layout` `save_geometry` | Admin, Manager | `00096` |
| `wie_rules`, `zone_profiles`, `storage_types`, `wie_scoring_profiles`, `product_wms_attributes` | `mutate-wie-rule`, `mutate-zone-profile`, `mutate-storage-type`, `mutate-scoring-profile`, `mutate-wms-attributes` | Admin | `00045`–`00061` |
| `product_home_bins` (incl. replenishment min/max) | `mutate-product-home-bin` (`set` / `clear` / `bulkSet`) | Admin, Manager | `00045`–`00061`, `00082` |
| `level_roles` | `mutate-level-role` | Admin | `00081` |
| `warehouse_setup_acknowledgements` | `mutate-warehouse-setup-ack` | Admin, Manager | `00092` |
| `wie_replen_tasks` | `detect-`/`assign-`/`complete-`/`unassign-replenishment` | Admin, Manager, Warehouse | `00082` |

- **Audit trail** for every privileged mutation → `audit_events` (mig `00012`). Admin-only SELECT; service_role-only INSERT.
- **Client error log** → `client_errors` (mig `00014`), written by `log-client-error`. Admin-only SELECT; service_role-only INSERT. `actor_id` nullable so pre-auth crashes are captured.
- **`verify_jwt = false` functions must gate themselves.** The eight functions listed in `supabase/config.toml` bypass the platform JWT check, so each re-implements auth in-body: cron callers via `isAuthorizedCronCall` (`_shared/cronToken.ts`), server-to-server callers via `isServiceRoleCall`, OAuth callbacks via state consumption. `send-email` had no gate at all until mig-era 2026-07 — it was world-callable and leaked order-ID existence through its `sent` vs `recipient_unresolved` response. Never add a `verify_jwt = false` entry without an in-body gate.
- **Storage buckets:** public read, `authenticated` write. The dev-only `anon_write_*` policies from `00004`/`00024` were dropped in `00081` — do not reintroduce anonymous writes; `FOR ALL TO anon` includes DELETE.
- **Read policies are closed as of `00105`.** Eight of the nine `USING (true)` SELECT policies now read `staff OR <own scope>`, via `public.user_is_staff()` — the one definition of "internal", covering Admin/Manager/both Reps/Warehouse. `suppliers` and `product_suppliers` (which carries `cost_price`) are staff-only; `horeca_pricing`, `horeca_payment_methods` and `pantry_items` are own-HoReCa; `products`/`product_uoms` hide inactive lines from customers; `promotions` shows customers only live, in-window rows. **Never compare a role to a literal to decide read access — call `user_is_staff()`.** `00104` pins `search_path` on `user_role()`/`user_horeca_id()` first, since everything now rests on them.
- **`app_settings` is STILL `USING (true)`, deliberately.** It is a singleton, so no row predicate can give a customer the identity and pricing fields the Shop needs while withholding `default_credit_limit` and the `po_auto_approve_*` flags. RLS filters rows; that needs columns. Closing it means splitting the internal thresholds into their own table. Don't "fix" it with a policy that changes nothing.
- **Rate limiting** (`_shared/rateLimit.ts`): `place-order` 10/min/user, `invite-user` 5/min/admin, `mutate-pantry-item` 60/min/user, `log-client-error` 30/min/IP, `send-email` 20/min/IP, `count-bin` 20/min/user (a whole location per call), `mutate-product-home-bin` 30/min/user but **10/min on its own `:bulk` bucket** (up to 200 slots per call), `mutate-warehouse-location` 30/min/user with **four separate 10/min buckets, `:area:`, `:paint:`, `:bind:` and `:sign:`** (the first three can each touch 1100+ rows; keeping them apart is what stops a burst of paints locking the operator out of fixing a spelling — or out of the one action that repairs a site's parentage wholesale. `:sign:` is separate for the inverse reason: signage is the cheap, safe edit made repeatedly while walking the floor, and it must not spend the budget the corrective actions need) → 429 `TOO_MANY_REQUESTS`. Cross-isolate global cap via the `rate_limit_hit()` Postgres RPC + `rate_limit_counters` table (mig `00026`, fixed-window, hourly `pg_cron` cleanup); fails open to a per-isolate in-memory counter if the DB call errors.

## Role-Based Views

| Role | Views |
|------|-------|
| Admin | Dashboard, Products, HoReCas, Users, Suppliers, PO Inbox, Settings, Promotions, Invoicing, Routes, Stock, Stocktake, Warehouse (designer/putaway/picking), Audit Log |
| Manager | Dashboard, Products, HoReCas |
| Field Sales Rep | Rep Dashboard, Shop, Order History, Routes, Visits |
| Office Sales Rep | Rep Dashboard, Shop, Order History |
| Customer | Shop, Order History (scoped to own HoReCa) |
| Warehouse | Pick Queue, Dispatched, Receive Stock, Putaway, Replenishment, Stocktake, Stock, Documents, Warehouse (site-scoped via `profiles.home_warehouse_id`) |

## Gotchas

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
- **`mailer_otp_exp` (3600) is duplicated as prose** in `ForgotPasswordDialog` ("expires in 1 hour"). Change one, change the other.
- **Never `await` a supabase call inside an `onAuthStateChange` callback.** supabase-js dispatches it while holding its internal auth lock and awaits whatever you return; any PostgREST query needs `getSession()`, which waits for that same lock, and the lock deadlocks against itself. `signInWithPassword` doesn't take the lock but `setSession`/`getSession` do — so ordinary login looks fine while the password-recovery screen hangs on "Verifying recovery link…" with no error anywhere. `hooks/useAuth.ts` therefore does sync state updates inline and defers the profile fetch to a `setTimeout(…, 0)`; `__tests__/authProviderNoDeadlock.test.tsx` pins that.
- **Auth links have four shapes, and `lib/auth/recoveryLink.ts` is the only place that knows them.** `#access_token=…` (default template), `?token_hash=…`, an `error`/`error_code` pair on **either** the hash or the query, and PKCE `?code=` — which is deliberately *not* claimed, because `?code=` is also the PO-Inbox OAuth popup's param and claiming it would hijack a mailbox connection. `isAuthLinkUrl()` returns true for failed links on purpose: that is what routes them to a screen that can explain itself.
- **`type=invite` is claimed alongside `type=recovery`, and that is the whole staff-onboarding path.** `invite-user` calls `inviteUserByEmail`, which creates the auth row with **no password** — so the emailed link is the only way an invited user can ever sign in. Until it was claimed, the invite landed on a bare login page and the only way to onboard anyone was a direct database write. The parsed link carries `flow`, because `verifyOtp`'s `type` must match the token that was issued (sending `'recovery'` for an invite token is refused server-side) and because "reset your password" is a lie to someone who never had one. `invite-user` passes **no** `redirectTo` on purpose — the link then lands on `site_url`, which needs no allow-list entry.
- `App.tsx` is intentionally thin (~170 lines). Don't add UI logic here — it belongs in `components/AppShell.tsx` or a view file under `views/`.

## Pending Work

Ordered by impact; one-line scope each so future agents don't drift.

**High**
0. **Finish the cutover.** The database is Amadiya's; the front end is not there
   yet. Outstanding, in order: create the Amadiya **Vercel project**
   (`NEXORDER_ENV=amadiya`, Sydney creds, `VITE_SHOW_DEMO_LOGINS=false`), fill
   `vercel.projectId` in the registry, attach `nexorder.com.au` + `www`,
   `npm run deploy:amadiya`. ~~then remove the `nexorder.vercel.app` alias from
   the old project and stop its deploys~~ — **done in the cutover**: the old
   project is retired, its alias removed and its Supabase env vars stripped, so
   `https://nexorder.vercel.app` currently answers `DEPLOYMENT_NOT_FOUND` and
   the hostname is **unclaimed**. It is reserved for the rebuilt demo (0b) and
   a `*.vercel.app` name is globally first-come, so do not leave it long. Then
   `bootstrap:admin:amadiya` for
   `info@amadiya.com.au` (deferred until the domain resolves, because the reset
   link points at it), Amadiya's phone/email/logo into `app_settings`, and
   Gates B–E. Full sequence: `PRODUCTION-LAUNCH-PLAN.md` Phase 3.
0b. ~~**Rebuild the demo on its own account.**~~ **Database done 2026-08-13** —
   `uqvekvavkjjurpqtovbq`, separate account, schema + secrets + 71 functions +
   7 crons + 11 users + the full `demo-export/` restored. **The Vercel side is
   NOT done**, and until it is there is no demo *site*: create the project on
   the new Vercel account (`NEXORDER_ENV=dev`, `VITE_SHOW_DEMO_LOGINS=true`,
   `VITE_SUPABASE_IMAGE_TRANSFORMS=false` — transforms are a paid feature) and
   claim `nexorder.vercel.app`, which is already free (see item 0) but is a
   globally first-come name. Then fill `vercel.{teamSlug,projectId,orgId}` +
   the preview glob in the registry, put a `VERCEL_TOKEN` in `.env.dev.local`,
   re-run
   `npm run auth:config:dev` (the allow-list changed) and `npm run deploy:dev`.
   All four registry fields are deliberately `null` until then so a stray
   `deploy:dev` cannot push a demo build to the account holding the client.
1. **Branch protection** — CI's `verify` job runs on every PR but `main` doesn't yet *require* it. **Blocked by plan tier (2026-05-21):** GitHub's Free plan disallows branch protection *and* rulesets on **private** repos — both `PUT …/branches/main/protection` and `POST …/rulesets` return `403 "Upgrade to GitHub Pro or make this repository public"`. To unblock, either upgrade to **GitHub Pro** (~$4/mo) or make the repo public, then require the status-check context **`typecheck · test · build`** (= the `verify` job's `name:` in `ci.yml`) via Settings → Branches or the API. Ready-to-run payload + commands saved in `~/.claude/plans/add-branch-protection-generic-zebra.md`.
2. **Email setup (operator)** — `send-email` is live, gated and rate-limited; it is dormant only because `RESEND_API_KEY` is unset, and setting that one secret is the entire switch (no redeploy). Full procedure, test call, response table and rollback: **`docs/runbooks/enable-email.md`**. The trap worth knowing up front: leaving `EMAIL_FROM` unset falls back to `onboarding@resend.dev`, which Resend delivers *only* to the account owner — so customers get nothing while the response still says `sent: true`.

**Medium**
3. **Desktop entry point for a stocktake** — `count-bin` and the Stocktake page ship phone-first (scan a bin, count it). The office-side case — reconciling against a paper count, or correcting one bin noticed while looking at the map — still has only `AdjustStockModal`. Scope it as a "Count this bin" action on `BinDetailPanel` (`components/inventory/warehouse/BinDetailPanel.tsx`) and on the Stock page, opening the same `CountSheet` in a `<Modal>`. No server work: `count-bin` already takes any location.
4. **Accessibility pass** — minimal ARIA. Add labels to icon-only buttons (`AccountsAgingTable`, sort headers, modal close), focus traps in `BundleSelectModal` / `OrderVerificationModal`, ARIA-live region for the toast container.
5. **Email expansion** — wire `invoice_issued` template on invoice → `issued`; decide whether to use the custom `user_invitation` template vs Supabase's built-in invite email.
6. **Test coverage expansion** — strong PO-inbox, pricing, scan, auth-link and WIE-engine coverage; PO-inbox matching resolvers use the `__tests__/support/fakeSupabase.ts` harness. Gaps: cart submission flow, pantry add/remove, HoReCa reason-prompt gate, role-based routing.

**Lower**
7. **Dead code sweep** — the original three-item list was two-thirds wrong; this is what's actually left. `components/SalesDashboard.tsx` and the root `CustomerForm.tsx` stub were deleted 2026-07-31 after a one-off `npx knip` run confirmed both (knip is *not* a dependency — write a throwaway `knip.json` at the repo root, run it, delete it). **`hooks/useLocalStorage.ts` is LIVE — do not delete it.** It is imported by `components/ActionItemsBoard.tsx:4,423`, which is mounted on both `AdminDashboard` and `RepDashboardV2`; the "zero imports" claim predates that board and has already survived one correction attempt (`PRODUCTION-READINESS-AUDIT.md:318`). **`constants.ts` is done** — commit `f631198` moved the demo seed data to `supabase/seedData/`; the file is 85 lines and all 9 exports are live, and "move to `supabase/seed.ts`" would *duplicate*, not move, since `supabase/seed.ts:16` already imports `USERS`/`DEFAULT_SETTINGS` **from** it. ~~The one real residue is bundle hygiene: `USERS` reaches the browser via `App.tsx:8`.~~ **Fixed in the cutover** — `USERS` moved to `supabase/seedData/users.ts` (beside the seed data that needs it; the launch plan suggested `tests/fixtures/`, but `supabase/seedData/orders.ts` consumes it and a `supabase/ → tests/` import is the wrong direction). Verified by building and grepping: `alice@nexorder.com.au`, `Password123!` and the demo customer domains are all absent — **but only with `VITE_SHOW_DEMO_LOGINS=false` as well**, because `LoginPage.tsx` carries its own `DEMO_ACCOUNTS` copy. The move and the flag each remove a different one; neither is sufficient alone. Still-unswept candidates knip flagged, each needing its own check: `components/{Header,HoReCaAdmin,InvoiceAdmin,RoleSelector,UserSelector}.tsx`, `components/dashboard/AlertBanner.tsx`, `components/performance/{ProductMovementSection,TargetProjectionCard,VelocityBar}.tsx`, `hooks/{usePromotionStatus,useScheduledVisitLifecycle}.ts`, `hooks/queries/usePurchaseOrders.ts`, `services/supabase/purchaseOrderService.ts` (the last two are likely fallout from removing the manual Purchase Orders view).
8. **Inventory automation** — restock alerts are read-only. Add "generate PO from low-stock alerts", soft stock reservations on order confirmation, expiry/FIFO for perishables.
9. **Reports export** — add CSV/PDF download on accounts-aging, sales-by-rep, stock-status, promotion-ROI panels (CSV helper exists at `lib/csvExport.ts`).
10. **i18n** — UI is English-only; currency hardcoded `AUD`. Wire `react-i18next` before strings calcify if non-English markets are in scope.
11. **PWA** — no manifest/service worker. Low priority for B2B (reps online); install-to-home-screen would help field reps.

## Recently shipped

git history is the changelog. Only the items below carry something the sections above don't.

- **`00083` (order allocation prefers the pick zone) is APPLIED as of 2026-07-27.** Its gate — one replenishment task driven `suggested → assigned → accepted` with the stock actually moving — was satisfied on WIE-DEMO first; `supabase/exercise-replen-gate.mjs` reproduces it and re-runs idempotently. All four of the header's verify steps were run against prod (one overload; pick zone wins on an expiry tie; **FEFO still beats the preference**; a bulk warehouse's ordering is provably unchanged — 0 of its 7 candidate locations carry a `level_role`, so the new CASE has exactly 1 distinct value). Rollback is `00075`'s body.
- **`00085` fixes a real bug that gate exercise uncovered.** `wie_convert_rack_to_levels_tx` (mig `00072`) moves a flat bin's stock onto L1 when it is first levelled, but it predates handling units (`00075`) and never passed `p_handling_unit_id`. It therefore read the plate's balance row and wrote the delta to the **loose (`NULL`-HU) slot**, driving it negative until `inventory_balances_alloc_bound` rejected the whole transaction. Since `receive-stock` creates a plate per receipt, that is the normal case — converting essentially any stocked bin failed. The CHECK constraint is what prevented silent duplication; treat it as load-bearing, not decorative.
- **Replenishment ledger legs are not attributable to their task.** `complete-replenishment` moves stock via `inv_transfer_stock`, which writes generic legs (`ref_type = 'transfer'`, `ref_id = NULL`). "Which task moved this stock?" cannot be answered from `inventory_movements` alone — you must correlate on (product, from, to, qty, time). Worth stamping the task id if traceability ever matters.
- **Order statuses are 6, grouped into 3 Order Import tabs** — Received (`processing`/`processed`), In Progress (`picked`/`packed`), Completed (`dispatched`/`delivered`). Mig `00025`.
- **Image columns store public Storage URLs, never base64.** Uploads compress to WebP via `browser-image-compression` (mig `00024`) — don't reintroduce data URLs.
- **`warehouse-main/`** — replaces MAIN's placeholder 15-bin layout with the real 189-bay DC and drives `recommend-putaway` → `decide-putaway` to slot every SKU (`warehouse:main:{seed,reset}`). See its README.
- **`tridon-demo/`** — self-contained real-email hardware demo: one auto-approving PO, one that lands in review (an uncatalogued Milwaukee line). `demo:tridon:{seed,reset,pdfs}`. It **steals** the `dulshanb@…` sender from the V2food demo, so re-run `seed:v2food-demo` afterwards. See its README.

Everything else — the warehouse/WIE programme, QR tracking, two-stage putaway, Pick Zone + replenishment, rack levels, multi-supplier & multi-UOM, PO Inbox, the admin-mutation lockdown, realtime, error boundaries, the audit-log viewer, CI, perf splitting, the pantry redesign, the settings revamp, health monitoring and the password-reset round trip — is described in the sections above.
