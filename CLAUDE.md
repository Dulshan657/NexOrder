# CLAUDE.md

## Project Overview

Nex Order — B2B order management for food and general distribution. Sales reps and restaurant/hotel (HoReCa) customers place orders; admins/managers manage products, customers, suppliers, purchase orders, and AI-triaged inbound-PO email. NexGen Innovations owns the product; each deployment carries its operator's identity in `app_settings`.

**App root:** this directory (`NexOrder/`, the git repo root) — all commands run from here.

> The app directory was renamed `copy-of-curatif-order-system-v1.3/` → `NexOrder/`. The Vercel **project** still carries the old name — don't "fix" it.

## ⚠️ Two environments. Nothing defaults.

There are **two** Supabase projects. Read this before running anything that writes.

| | dev / sales demo | production |
|---|---|---|
| Supabase | `lsgkznyiabqitqfpveey` (Singapore) | Sydney (`ap-southeast-2`) — **see `config/environments.mjs`** |
| App | https://nexorder.vercel.app | https://nexorder.com.au |
| Holds | AYAM seed data, Tridon + V2food demo tenants, WIE-DEMO, MAIN | **Amadiya Agro Products' real business data** |
| `tenant` tag | `ayam` | `amadiya` |
| Fixtures / seeds | yes | **never** |
| Credentials | `.env.dev.local` | `.env.prod.local` |

- **`config/environments.mjs` is the only file where a project ref belongs.** Import from it; never type a ref.
- **Every script takes `--env=<dev|prod>`, equals-form only, and hard-fails without one.** `--env prod` (space) is rejected on purpose — `apply-sql.mjs` reads the first non-`--` argument as a filename.
- **Seed / demo / reset scripts are dev-only and there is no `--force`.** Three guards (`scripts/lib/fixtureGuard.mjs`): the named target, a credential-vs-registry assertion, and `environment_marker` in the database itself.
- **`.mcp.json` is pinned to dev, permanently.** Never add a prod entry — an agent session with MCP write access to the client's database is the single largest unforced risk in this repo.
- Prod is not provisioned yet (`projectRef: null`), so every `--env=prod` command refuses until `PRODUCTION-LAUNCH-PLAN.md` §A0.3 is done. That refusal is the feature.

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
npm run check:csp                  # vercel.json CSP covers every provisioned environment

# Type-check before deploy (no CI block-on-red yet)
npx tsc --noEmit

# Deploy: builds, aliases, verifies /version.json AND /functions/v1/health
npm run deploy:dev                 # -> nexorder.vercel.app
npm run deploy:prod                # -> nexorder.com.au

# Migrations — ledgered in public.schema_migrations, checksummed, transactional
node supabase/migrate.mjs --env=dev --dry-run    # what would run, in order
npm run migrate:dev                              # apply everything pending
npm run migrate:prod

# Edge Functions (never pass --no-verify-jwt; config.toml governs the gate)
npm run fn:deploy:dev              # all; append a name for one
npm run fn:deploy:prod

# Raw SQL (Management API — the direct DB host is unreachable on Windows)
node supabase/apply-sql.mjs --env=dev --query "SELECT ..."
node supabase/apply-sql.mjs --env=dev <file.sql>

# Supabase Auth config (site URL, redirect allow-list, password rules, disable_signup)
npm run auth:config:dev / :prod          # diff, then PATCH if it differs
npm run auth:config:check:dev / :prod    # diff only, exit 1 on drift

# Seed / fixtures — DEV ONLY, guarded three ways, no override
npx tsx supabase/seed.ts --env=dev
npm run warehouse:main:seed / :reset     # MAIN floor plan + engine slotting of all stock
npm run demo:wie:seed / :reset           # standalone WIE-DEMO racked warehouse
```

**Never run `vercel deploy --prod` directly** — it won't move the alias, and users will report fixes as "not live". Always use `npm run deploy:<env>` (wraps deploy + alias + verification).

`supabase/run-migration.mjs` is legacy and cannot reach the DB host from this box. Use `supabase/migrate.mjs`.

## Supabase

| Key | Value |
|-----|-------|
| Dev project ref | `lsgkznyiabqitqfpveey` |
| Dev URL | `https://lsgkznyiabqitqfpveey.supabase.co` |
| Prod project ref | _not yet created — `config/environments.mjs` → `ENVIRONMENTS.prod`_ |
| Anon / publishable key | _see `.env.dev.local` / `.env.prod.local` → `VITE_SUPABASE_ANON_KEY`_ |
| Service role / secret key | _same files → `SUPABASE_SERVICE_ROLE_KEY`_ |
| DB password | _same files → `SUPABASE_DB_PASSWORD`_ |
| Seeded user password (dev only) | `Password123!` (all seeded users) |

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

The largest subsystem after ordering, and about half the Edge Functions. Migrations `00027`–`00084`.

**Inventory truth.** `inventory_balances` (product × location × batch **× handling unit**; `on_hand`, `allocated`, `available` generated) is the source of truth; `inventory_movements` is the append-only ledger. `products.inventory` / `products.available` are **caches**, maintained only by `inv_recompute_product_cache()` via `inv_apply_leg()`. All quantities are base units. Every write funnels through `inv_apply_leg` (service_role only): `inv_receive_stock`, `inv_reserve_order`, `inv_pick_order_line`, `inv_transfer_stock`, `inv_adjust_stock`.

**Locations** are one self-referential tree (`kind` ∈ `WAREHOUSE|ZONE|AISLE|RACK|BAY|SHELF|BIN|STAGING`). There is no separate bins table. `locations.code` is **globally unique**. A warehouse is `location_type` `'bulk'` (stock sits at the root) or `'racked'` (bin-level, WIE-driven). Multi-warehouse since `00036`; `inv_default_location()` = lowest-id active warehouse.

**Warehouse Intelligence Engine** — `supabase/functions/_shared/wie/*.ts` is **pure** (no Deno/IO), so the Vite frontend imports the same modules the server runs.
- `graph.ts` walk graph + Dijkstra · `publishReadiness.ts` the 4 publish gates · `autoConnect.ts` walkway repair · `scoring.ts` + `putawayPlan.ts` the putaway optimiser · `pickTasks.ts` / `picking.ts` directed picking.
- Layouts are drafted (`mutate-layout` `save_geometry`), then **published** (`publish-layout` → `wie_publish_layout_tx`), which builds the routing graph and flips the warehouse to `racked`. Only one published layout per warehouse.
- Putaway: receipt/adjust/transfer → `_shared/putawayTasks.ts` `generatePutawayTasks` → `wie_putaway_recommendations` (advisory) → `decide-putaway` / `complete-putaway` → `inv_transfer_stock(root → bin)`. Stock only reaches a bin through those two functions.
- **Putaway is two-stage since mig `00080`** — `suggested --assign--> assigned --complete--> accepted|overridden`. Assigning moves **no stock** (`wie_assign_putaway_tx`); the transfer fires only at `complete-putaway` (`wie_complete_putaway_tx`), when the operator scans the bin and the plate on the floor. Un-placed goods therefore read as sitting at the warehouse root, which is where they actually are. `wie_unassign_putaway_tx` returns an abandoned run to `'suggested'`; `wie_putaway_stops` turns assigned rows into routable walk stops (`recommend-putaway-route`). Scanning the *wrong* bin warns but still records.
- `wie_decide_putaway_tx` (mig `00071`) is deliberately untouched by `00080` and remains the **one-step "place it now"** desk/bulk path (also used by the CSV opening-stock importer). Both transactions claim the row `FOR UPDATE` and optionally **split** it: a partial putaway leaves the ORIGINAL row `'suggested'` holding the remainder and inserts a decided copy as the audit record. Re-scoring a queued line is `recommend-putaway` + `replaces_recommendation_id`, which expires the row it supersedes.
- Frontend: `components/inventory/PutawayWalkView.tsx` + `inventory/putaway/{PutawayScanFinder,PutawayStopCard}.tsx`, `hooks/queries/usePutawayWalk.ts`, `services/supabase/putawayRouteService.ts`.

**Level roles are operator-managed data** (mig `00081`). A rack level's role lives in `level_roles`; `locations.level_role` FKs it (the CHECK is gone). The **stored key never changes** — `'pick'` is still `'pick'`; its `display_name` is "Pick Zone". `NULL` still means an unconstrained legacy bin, which the FK preserves for free.
- The row carries what used to be code: `hu_types` (replaced `ROLES_BY_HU_TYPE`), `is_pick_zone` (replenishment destination + `inv_reserve_order` preference), `replen_source_rank` (which roles feed a pick zone, in order).
- **One definition, both runtimes:** `_shared/wie/levelRoles.ts` (pure — every helper takes the role array as its first arg, no cache, no fetch), re-exported by `lib/levelRoles.ts`. Load it via `useLevelRoles()` client-side or `_shared/levelRoleLookup.ts` server-side. **Never** compare a role to a literal to decide behaviour — read the flags.
- Admin CRUD: `mutate-level-role` + `components/admin/LevelRolesSection.tsx` (Settings → Warehouse). Deleting needs `wie_level_role_usage` all-zero — it counts the two references no FK can guard, `product_wms_attributes.allowed_level_roles` (array element) and `storage_types.level_template` (JSONB).

**Replenishment** (mig `00082`) — reserve/bulk → pick zone, same two-stage shape as putaway: `suggested --assign--> assigned --complete--> accepted|overridden`, stock moving only at `complete-replenishment`.
- Config is `product_home_bins.{min_qty,max_qty,replen_enabled}` (base units), guarded by a trigger to pick-zone levels. Its unique key is now `(product_id, warehouse_id, purpose)`.
- Detector `wie_replen_detect` runs advisorily after **every pick and every putaway**, plus on demand. The putaway hook is not redundant: "short but nothing to pull" is a state entered by a putaway, not a pick.
- Functions: `detect-`/`assign-`/`complete-`/`unassign-replenishment`, `recommend-replen-route` — all Admin/Manager/**Warehouse** (`transfer-stock` is Admin/Manager only, so it could never serve this).
- Frontend: `components/inventory/{ReplenQueuePage,ReplenQueueView,ReplenWalkView}.tsx` + `inventory/replen/ReplenStopCard.tsx`, `hooks/queries/useReplenishment.ts`.

**QR tracking & handling units** (migs `00074`–`00078`).
- **Scan identity.** The QR payload is **bare text** — a `locations.code`, a product SKU, or a handling-unit code — with no URL wrapper and no namespace prefix, so third-party scanner apps read something meaningful. The cost is that one string could name two things: `lib/scan/resolveScan.ts` returns `ambiguous` with every candidate and the UI asks the operator. **It never guesses.** Labels are rendered by `generate-labels` (`_shared/labelSheet.ts`) and logged to `label_print_log`; print UI is `components/admin/LabelPrintingSection.tsx`, input primitive is `components/ui/ScanField.tsx` (+ `lib/scan/useBarcodeScanner.ts`).
- **Handling units are an inventory dimension, not a sidecar.** There is no `hu_contents` table — `handling_unit_id` is a nullable 4th column on `inventory_balances`, folded into the unique slot index exactly as `batch_id` is: `UNIQUE (product_id, location_id, COALESCE(batch_id,0), COALESCE(handling_unit_id,0))`. A plate's contents **are** its balance rows, so mixed-SKU plates fall out for free and there is no second copy of the quantity to drift. `NULL` = loose/untracked stock and stays valid forever.
- **Per-plate capacity** (`00078`): a pallet consumes **one position**, not `qty × size_factor`. `v_bin_fill` is the single source of bin fill — don't re-derive it.
- Picking is scan-enforced: `_shared/pickScanCheck.ts` validates at `record-pick`.

**WIE gotchas** (each has cost real debugging time):
- `wie_putaway_candidates` is called with `p_limit: 200`, ordered by dock distance. A layout with >200 placements silently hides its farthest bays from the engine. It also returns **every** active placement regardless of `kind` — anything you place is a putaway target, so staging/returns must be `label` objects, not bins.
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
| `inventory_balances`, `inventory_movements` | `receive-stock`, `adjust-stock`, `transfer-stock`, `record-pick`, `decide-putaway`, `complete-putaway` | Admin, Manager, Warehouse | `00027`, `00032`, `00080` |
| `handling_units`, `label_print_log` | `generate-labels`, `receive-stock`, `complete-putaway` | Admin, Manager, Warehouse | `00074`, `00075` |
| `locations` (warehouses / bins) | `mutate-warehouse`, `mutate-warehouse-location` | Admin, Manager | `00036` |
| `warehouse_layouts`, `layout_*` | `mutate-layout`, `publish-layout` | Admin | `00045`, `00046` |
| `wie_rules`, `zone_profiles`, `storage_types`, `wie_scoring_profiles`, `product_wms_attributes`, `product_home_bins` | `mutate-wie-rule`, `mutate-zone-profile`, `mutate-storage-type`, `mutate-scoring-profile`, `mutate-wms-attributes`, `mutate-product-home-bin` | Admin | `00045`–`00061` |
| `level_roles` | `mutate-level-role` | Admin | `00081` |
| `wie_replen_tasks` | `detect-`/`assign-`/`complete-`/`unassign-replenishment` | Admin, Manager, Warehouse | `00082` |

- **Audit trail** for every privileged mutation → `audit_events` (mig `00012`). Admin-only SELECT; service_role-only INSERT.
- **Client error log** → `client_errors` (mig `00014`), written by `log-client-error`. Admin-only SELECT; service_role-only INSERT. `actor_id` nullable so pre-auth crashes are captured.
- **`verify_jwt = false` functions must gate themselves.** The eight functions listed in `supabase/config.toml` bypass the platform JWT check, so each re-implements auth in-body: cron callers via `isAuthorizedCronCall` (`_shared/cronToken.ts`), server-to-server callers via `isServiceRoleCall`, OAuth callbacks via state consumption. `send-email` had no gate at all until mig-era 2026-07 — it was world-callable and leaked order-ID existence through its `sent` vs `recipient_unresolved` response. Never add a `verify_jwt = false` entry without an in-body gate.
- **Storage buckets:** public read, `authenticated` write. The dev-only `anon_write_*` policies from `00004`/`00024` were dropped in `00081` — do not reintroduce anonymous writes; `FOR ALL TO anon` includes DELETE.
- **Rate limiting** (`_shared/rateLimit.ts`): `place-order` 10/min/user, `invite-user` 5/min/admin, `mutate-pantry-item` 60/min/user, `log-client-error` 30/min/IP, `send-email` 20/min/IP → 429 `TOO_MANY_REQUESTS`. Cross-isolate global cap via the `rate_limit_hit()` Postgres RPC + `rate_limit_counters` table (mig `00026`, fixed-window, hourly `pg_cron` cleanup); fails open to a per-isolate in-memory counter if the DB call errors.

## Role-Based Views

| Role | Views |
|------|-------|
| Admin | Dashboard, Products, HoReCas, Users, Suppliers, PO Inbox, Settings, Promotions, Invoicing, Routes, Stock, Warehouse (designer/putaway/picking), Audit Log |
| Manager | Dashboard, Products, HoReCas |
| Field Sales Rep | Rep Dashboard, Shop, Order History, Routes, Visits |
| Office Sales Rep | Rep Dashboard, Shop, Order History |
| Customer | Shop, Order History (scoped to own HoReCa) |
| Warehouse | Pick Queue, Dispatched, Receive Stock, Putaway, Replenishment, Stock, Documents, Warehouse (site-scoped via `profiles.home_warehouse_id`) |

## Gotchas

- **Supabase client must override `global.fetch`** — without it the client hangs on Windows. See `lib/supabase.ts`.
- **`persistSession: false`** — enabling session persistence with *either* localStorage or sessionStorage made `getSession()` hang on Windows. Sessions therefore don't survive a tab close (re-login required). Don't re-enable persistence without retesting on Windows.
- **RLS is enabled** (mig `00008` re-enables; `00009`+ lock down individual table mutations to Edge Functions). Direct INSERT/UPDATE/DELETE from `authenticated` is blocked for the tables in the lockdown table; mutations must go through Edge Functions.
- **Edge Function deploy order matters.** When wiring the client to a new function: deploy the function FIRST (`npx supabase functions deploy <name>`), then push the frontend, then apply any RLS lockdown migration LAST. Reversing the order breaks admin UIs.
- **Migrations are ledgered and checksummed** (`public.schema_migrations`, written by `supabase/migrate.mjs`). An applied file whose bytes change is a hard error, not a re-run — **edit forward with a new migration**. Ordering is (numeric prefix, full filename); `00022` and `00081` are each a duplicated-number pair of mutually independent files, so **do not renumber them** — a rename makes an applied migration look unapplied forever. Each file commits together with its ledger row (the `INSERT` is spliced before the single `COMMIT;`, or the file is wrapped in `BEGIN…COMMIT`).
- **The `tenant` tag is environment-derived, and `ayam` must never appear in prod.** `00087` re-points the eight `00042` column defaults and both derivation triggers at `public.default_tenant()`, which reads `environment_marker.tenant_key` — `ayam` on dev, `amadiya` on prod. It is `SECURITY DEFINER` with a pinned `search_path` because a column DEFAULT evaluates as the *inserting* role and `environment_marker` is service_role-only. On an unstamped database it returns NULL and the `NOT NULL` tenant columns reject the insert — that is intended, not a bug. The column is still **read by nothing**; it is written correctly so a future read-side filter has something true to filter on.
- **`APP_URL`, `ALLOWED_ORIGINS` and `PO_OAUTH_APP_BASE` have no defaults and fail closed.** Each previously fell back to the demo origin, and each failed *silently and successfully*: `send-email` would send a customer real links to the wrong app while answering `sent: true`, and `health` would probe the demo's `version.json` so prod reported `ok` while prod was down. **Set `ALLOWED_ORIGINS` on a project before deploying `_shared/cors.ts` to it** — `cors.ts` and `callbackCommon.ts` both read it, so the ordering breaks browser calls and OAuth callbacks together.
- **A missing `ALLOWED_ORIGINS` fails the fleet *gradually*, and reads as a client bug.** `cors.ts:53` reads the secret **once per isolate at module load**, so functions whose isolates are still warm keep serving the value they booted with while anything that cold-boots gets nothing. On 2026-07-29 the secret went missing from dev and only the three most recently deployed functions lost CORS — the browser reported `FunctionsFetchError` / **"Failed to send a request to the Edge Function"** (fetch rejected, no response ever reaches JS) on those, and worked everywhere else. Symptoms to recognise: that string; a preflight that returns `200` with `Access-Control-Allow-Headers` but **no `Access-Control-Allow-Origin`**; different functions disagreeing. Check with `npx supabase secrets list --project-ref <ref>` — it prints names, not values, so absence is the signal. After setting it, **redeploy** — a warm isolate does not re-read secrets. `curl -X OPTIONS -H "Origin: …"` across a few functions is the fastest confirmation, and a hostile origin must still get nothing.
- **Type-check** with `npx tsc --noEmit` before deploy (CI runs it but block-on-red isn't enforced on `main` yet).
- **Supabase Auth config lives in `supabase/apply-auth-config.mjs`, not `config.toml`.** That toml is per-function `verify_jwt` only and is never pushed. `buildDesired(config)` in the mjs is the source of truth for `site_url` / `uri_allow_list` / `password_min_length` / `disable_signup`, deriving the origins from `config/environments.mjs`; edit it and run `npm run auth:config:<env>` rather than clicking in Studio, or the next person has no way to know what the values should be. **The preview glob belongs to dev only** — in the prod allow-list it would make any preview build a valid password-reset landing page for a client account. The allow-list entries are **globs** — `*` does not cross a `/`, and `ForgotPasswordDialog` sends `${origin}/` with a trailing slash, so every entry needs a `/**` suffix to match. A `redirectTo` that misses the list is silently replaced with `site_url`, which reads as "the reset link sent me to the wrong place".
- **`mailer_otp_exp` (3600) is duplicated as prose** in `ForgotPasswordDialog` ("expires in 1 hour"). Change one, change the other.
- **Never `await` a supabase call inside an `onAuthStateChange` callback.** supabase-js dispatches it while holding its internal auth lock and awaits whatever you return; any PostgREST query needs `getSession()`, which waits for that same lock, and the lock deadlocks against itself. `signInWithPassword` doesn't take the lock but `setSession`/`getSession` do — so ordinary login looks fine while the password-recovery screen hangs on "Verifying recovery link…" with no error anywhere. `hooks/useAuth.ts` therefore does sync state updates inline and defers the profile fetch to a `setTimeout(…, 0)`; `__tests__/authProviderNoDeadlock.test.tsx` pins that.
- **Recovery links have four shapes, and `lib/auth/recoveryLink.ts` is the only place that knows them.** `#access_token=…` (default template), `?token_hash=…`, an `error`/`error_code` pair on **either** the hash or the query, and PKCE `?code=` — which is deliberately *not* claimed, because `persistSession: false` leaves nowhere for the code verifier and `?code=` is also the PO-Inbox OAuth popup's param. `isRecoveryUrl()` returns true for failed links on purpose: that is what routes them to a screen that can explain itself.
- `App.tsx` is intentionally thin (~170 lines). Don't add UI logic here — it belongs in `components/AppShell.tsx` or a view file under `views/`.

## Pending Work

Ordered by impact; one-line scope each so future agents don't drift.

**High**
1. **Branch protection** — CI's `verify` job runs on every PR but `main` doesn't yet *require* it. **Blocked by plan tier (2026-05-21):** GitHub's Free plan disallows branch protection *and* rulesets on **private** repos — both `PUT …/branches/main/protection` and `POST …/rulesets` return `403 "Upgrade to GitHub Pro or make this repository public"`. To unblock, either upgrade to **GitHub Pro** (~$4/mo) or make the repo public, then require the status-check context **`typecheck · test · build`** (= the `verify` job's `name:` in `ci.yml`) via Settings → Branches or the API. Ready-to-run payload + commands saved in `~/.claude/plans/add-branch-protection-generic-zebra.md`.
2. **Email setup (operator)** — `send-email` is live, gated and rate-limited; it is dormant only because `RESEND_API_KEY` is unset, and setting that one secret is the entire switch (no redeploy). Full procedure, test call, response table and rollback: **`docs/runbooks/enable-email.md`**. The trap worth knowing up front: leaving `EMAIL_FROM` unset falls back to `onboarding@resend.dev`, which Resend delivers *only* to the account owner — so customers get nothing while the response still says `sent: true`.

**Medium**
3. **Accessibility pass** — minimal ARIA. Add labels to icon-only buttons (`AccountsAgingTable`, sort headers, modal close), focus traps in `BundleSelectModal` / `OrderVerificationModal`, ARIA-live region for the toast container.
4. **Email expansion** — wire `invoice_issued` template on invoice → `issued`; decide whether to use the custom `user_invitation` template vs Supabase's built-in invite email.
5. **Test coverage expansion** — strong PO-inbox, pricing, scan, auth-link and WIE-engine coverage; PO-inbox matching resolvers use the `__tests__/support/fakeSupabase.ts` harness. Gaps: cart submission flow, pantry add/remove, HoReCa reason-prompt gate, role-based routing.

**Lower**
6. **Dead code sweep** — the original three-item list was two-thirds wrong; this is what's actually left. `components/SalesDashboard.tsx` and the root `CustomerForm.tsx` stub were deleted 2026-07-31 after a one-off `npx knip` run confirmed both (knip is *not* a dependency — write a throwaway `knip.json` at the repo root, run it, delete it). **`hooks/useLocalStorage.ts` is LIVE — do not delete it.** It is imported by `components/ActionItemsBoard.tsx:4,423`, which is mounted on both `AdminDashboard` and `RepDashboardV2`; the "zero imports" claim predates that board and has already survived one correction attempt (`PRODUCTION-READINESS-AUDIT.md:318`). **`constants.ts` is done** — commit `f631198` moved the demo seed data to `supabase/seedData/`; the file is 85 lines and all 9 exports are live, and "move to `supabase/seed.ts`" would *duplicate*, not move, since `supabase/seed.ts:16` already imports `USERS`/`DEFAULT_SETTINGS` **from** it. The one real residue is bundle hygiene, not deadness: `USERS` (6 demo records incl. `alice@nexorder.com.au`) reaches the browser via `App.tsx:8` — tracked at `PRODUCTION-LAUNCH-PLAN.md:221`, which wants it in `tests/fixtures/`, **not** under `supabase/`. Still-unswept candidates knip flagged, each needing its own check: `components/{Header,HoReCaAdmin,InvoiceAdmin,RoleSelector,UserSelector}.tsx`, `components/dashboard/AlertBanner.tsx`, `components/performance/{ProductMovementSection,TargetProjectionCard,VelocityBar}.tsx`, `hooks/{usePromotionStatus,useScheduledVisitLifecycle}.ts`, `hooks/queries/usePurchaseOrders.ts`, `services/supabase/purchaseOrderService.ts` (the last two are likely fallout from removing the manual Purchase Orders view).
7. **Inventory automation** — restock alerts are read-only. Add "generate PO from low-stock alerts", soft stock reservations on order confirmation, expiry/FIFO for perishables.
8. **Reports export** — add CSV/PDF download on accounts-aging, sales-by-rep, stock-status, promotion-ROI panels (CSV helper exists at `lib/csvExport.ts`).
9. **i18n** — UI is English-only; currency hardcoded `AUD`. Wire `react-i18next` before strings calcify if non-English markets are in scope.
10. **PWA** — no manifest/service worker. Low priority for B2B (reps online); install-to-home-screen would help field reps.

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
