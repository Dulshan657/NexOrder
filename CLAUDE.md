# CLAUDE.md

## Project Overview

AYAM Order System (Nex Order) — B2B order management for AYAM brand Asian food products. Sales reps and restaurant/hotel (HoReCa) customers place orders; admins/managers manage products, customers, suppliers, purchase orders, and AI-triaged inbound-PO email.

**App root:** this directory (`NexOrder/`, the git repo root) — all commands run from here.
**Production:** https://nexorder.vercel.app (Vercel project `dulshan657s-projects/copy-of-curatif-order-system-v1.3`)

> The app directory was renamed `copy-of-curatif-order-system-v1.3/` → `NexOrder/`. The Vercel **project** still carries the old name — don't "fix" it.

## Commands

```bash
npm install
npm run dev                        # Vite on :3000
npm run build
npm test                           # vitest run (1652 tests / 127 files today)
npm run test:watch                 # vitest in watch mode
npm run test:coverage              # vitest + coverage report
npm run test:integration           # vitest against a live pg (vitest.integration.config.ts)
npm run test:e2e                   # Playwright (:ui / :headed variants)
npm run deploy                     # deploy to prod AND alias nexorder.vercel.app

# Type-check before deploy (no CI block-on-red yet)
npx tsc --noEmit

# Run a migration
SUPABASE_DB_PASSWORD="$DB_PW" node supabase/run-migration.mjs supabase/migrations/<file>.sql

# Deploy an Edge Function (requires SUPABASE_ACCESS_TOKEN, no TTY login)
SUPABASE_ACCESS_TOKEN="$TOK" npx supabase functions deploy <name> --project-ref lsgkznyiabqitqfpveey

# Seed DB
SUPABASE_URL="$URL" SUPABASE_SERVICE_ROLE_KEY="$KEY" npx tsx supabase/seed.ts

# Run raw SQL against the live DB (Management API; the direct DB host is unreachable on Windows)
node supabase/apply-sql.mjs --query "SELECT ..."   # or: node supabase/apply-sql.mjs <file.sql>

# Warehouse fixtures (both write to PROD — there is no staging project)
npm run warehouse:main:seed / :reset   # MAIN floor plan + engine slotting of all stock
npm run demo:wie:seed / :reset         # standalone WIE-DEMO racked warehouse
```

**Never run `vercel deploy --prod` directly** — it won't move the `nexorder.vercel.app` alias, and users will report fixes as "not live". Always use `npm run deploy` (wraps deploy + alias set).

## Supabase

| Key | Value |
|-----|-------|
| Project ref | `lsgkznyiabqitqfpveey` |
| URL | `https://lsgkznyiabqitqfpveey.supabase.co` |
| Anon / publishable key | _see `NexOrder/.env.local` → `VITE_SUPABASE_ANON_KEY`_ |
| Service role / secret key | _see `NexOrder/.env.local` → `SUPABASE_SERVICE_ROLE_KEY`_ |
| DB password | _see `NexOrder/.env.local` → `SUPABASE_DB_PASSWORD`_ |
| Seeded user password | `Password123!` (all users) |

**Note:** Credentials use Supabase's `sb_publishable_*` / `sb_secret_*` API key format (rotated 2026-05-18; legacy JWT-format keys are revoked). Never paste live credentials into this file — it's loaded into every Claude session and ends up in transcripts. Edge Function reads of `SUPABASE_SERVICE_ROLE_KEY` use the platform-injected value.

## Stack

React 19 · TypeScript · Tailwind v4 · Vite 6 · Supabase Postgres + Deno Edge Functions · TanStack Query · Lucide · Leaflet · Resend (email) · OpenAI (PO + floor-plan extraction) · Vitest.

## Architecture

**Data flow:** Supabase → Edge Functions OR `services/supabase/*.ts` → `hooks/queries/*.ts` (TanStack Query) → `lib/adapters.ts` (snake_case ↔ camelCase) → `App.tsx` → `<AppShell>` → role-gated views via contexts.

**Key files:**
- `App.tsx` (~170 lines) — data root: auth, queries, adapters, `placeOrderMutation`, mounts `<AppShell>`. No render tree, no UI state.
- `components/AppShell.tsx` (~1450 lines) — owns UI/nav state; mounts `<OrderProvider>` + `<PantryProvider>`; inner component (`AppShellInner`) consumes contexts and renders the entire UI tree.
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
- `supabase/functions/` — Deno Edge Functions (server-side validation gate, 60 functions). All admin, order and inventory mutations route through here.
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
- Migration is incremental: `components/overlay-baseline.json` lists the files still hand-rolling an overlay. Each migration PR prunes its entries; when the list is empty the guard becomes absolute.
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
- **Tables:** `email_accounts`, `oauth_pending_states`, `inbound_messages`, `pending_pos`, `po_customer_aliases`, `po_product_aliases`, `po_extraction_audit` (migrations `00018`–`00023`).
- **Design docs:** `docs/superpowers/specs/2026-05-20-po-inbox-redesign-design.md` (+ plan alongside).

### Gmail OAuth / Google Cloud setup

The Gmail connect flow (`start-po-oauth` → `_shared/poInbox/oauthUrls.ts` → `gmail-oauth-callback`) uses a Google Cloud OAuth client; client id/secret live in Edge Function secrets `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` (Outlook: `OUTLOOK_OAUTH_CLIENT_*`).

- **Registered redirect URI:** `https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/gmail-oauth-callback` (built by `buildCallbackUri()` from `SUPABASE_URL`). Outlook: `…/outlook-oauth-callback`.
- **Scopes:** `gmail.readonly` (a Google **restricted** scope), `userinfo.email`, `openid`; `access_type=offline`, `prompt=consent`.
- **OAuth consent screen** (Google Cloud Console → APIs & Services → OAuth consent screen): **App name = `NexOrder`**, publishing status **Testing**. The App name is what shows on the consent dialog ("NexOrder wants access…"); if blank, Google falls back to displaying the redirect host (`…supabase.co`). Manage who can connect via **Test users**. Don't add a logo / Homepage / Privacy / ToS URLs unless intentionally going through brand verification.
- **Known limitation:** removing the "Google hasn't verified this app" interstitial requires full verification + (for the restricted scope) a CASA assessment, which needs an **Authorized Domain you own and can verify in Search Console**. `supabase.co` / `vercel.app` don't qualify, so verification is blocked until a custom owned domain fronts the callback. Until then, Testing-mode users click through the interstitial.

## Warehouse & inventory (WIE)

The largest subsystem after ordering. Migrations `00027`–`00083`; ~34 of the 66 Edge Functions.

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
- **Type-check** with `npx tsc --noEmit` before deploy (CI runs it but block-on-red isn't enforced on `main` yet).
- `App.tsx` is intentionally thin (~170 lines). Don't add UI logic here — it belongs in `components/AppShell.tsx` or a view file under `views/`.

## Pending Work

Ordered by impact; one-line scope each so future agents don't drift.

**High**
1. **Branch protection** — CI's `verify` job runs on every PR but `main` doesn't yet *require* it. **Blocked by plan tier (2026-05-21):** GitHub's Free plan disallows branch protection *and* rulesets on **private** repos — both `PUT …/branches/main/protection` and `POST …/rulesets` return `403 "Upgrade to GitHub Pro or make this repository public"`. To unblock, either upgrade to **GitHub Pro** (~$4/mo) or make the repo public, then require the status-check context **`typecheck · test · build`** (= the `verify` job's `name:` in `ci.yml`) via Settings → Branches or the API. Ready-to-run payload + commands saved in `~/.claude/plans/add-branch-protection-generic-zebra.md`.
2. **Email setup (operator)** — `send-email` is live but dormant. Set `RESEND_API_KEY` (and optionally `EMAIL_FROM` / `EMAIL_REPLY_TO` / `APP_URL`) via `npx supabase secrets set` to start sending order confirmations.
3. **Recovery URL setup (operator)** — add `https://nexorder.vercel.app` (and `http://localhost:3000` for dev) to Supabase Studio → Auth → URL Configuration → Redirect URLs so password-reset links return to the app.

**Medium**
4. **Accessibility pass** — minimal ARIA. Add labels to icon-only buttons (`AccountsAgingTable`, sort headers, modal close), focus traps in `BundleSelectModal` / `OrderVerificationModal`, ARIA-live region for the toast container.
5. **Email expansion** — wire `invoice_issued` template on invoice → `issued`; decide whether to use the custom `user_invitation` template vs Supabase's built-in invite email.
6. **Test coverage expansion** — 1652 tests today (strong PO-inbox, pricing, scan and WIE-engine coverage; PO-inbox matching resolvers covered via the `__tests__/support/fakeSupabase.ts` harness). Gaps: cart submission flow, pantry add/remove, HoReCa reason-prompt gate, role-based routing.

**Lower**
7. **Dead code sweep** — `CustomerForm.tsx` (stub, at the repo root — not under `components/`), `constants.ts` (seed data still shipped to browser; move to `supabase/seed.ts`), `hooks/useLocalStorage.ts` (zero imports). Verify with `knip`/`ts-prune` before deleting.
8. **Inventory automation** — restock alerts are read-only. Add "generate PO from low-stock alerts", soft stock reservations on order confirmation, expiry/FIFO for perishables.
9. **Reports export** — add CSV/PDF download on accounts-aging, sales-by-rep, stock-status, promotion-ROI panels (CSV helper exists at `lib/csvExport.ts`).
10. **i18n** — UI is English-only; currency hardcoded `AUD`. Wire `react-i18next` before strings calcify if non-English markets are in scope.
11. **PWA** — no manifest/service worker. Low priority for B2B (reps online); install-to-home-screen would help field reps.

## Recently shipped

Condensed changelog; git history has the detail.

- **Warehouse programme** (see the Warehouse & inventory section) — multi-warehouse core (`00036`), racked/directed inventory (`00039`–`00041`), the WIE engine + layout designer (`00045`–`00060`), storage forms & capacity (`00061`), stock adjustments (`00062`), directed per-bin picking (`00064`), floor-plan AI import (`00058`), and bulk catalogue/opening-stock CSV import.
- **QR tracking programme** (4 phases, migs `00074`–`00078`) — scan identity + printable labels, handling units as an inventory dimension, scan-enforced picking, per-plate capacity. See the QR section above.
- **Two-stage putaway** (mig `00080`) — Accept no longer moves stock; assign at the desk, then walk a routed list and scan bin + plate to commit the transfer.
- **Pick Zone + replenishment** (migs `00081`–`00083`) — "Pick face" is now **Pick Zone**, and the level-role vocabulary is operator-managed rather than hardcoded in eleven places; replenishment moves stock reserve/bulk → pick zone on a min/max trigger, through the same assign → walk → scan pipeline. **`00083` (order allocation prefers the pick zone) is committed but deliberately NOT applied** — see its header for the gate and rollback.
- **Rack levels & storage forms** — addressable pick/reserve/bulk rack levels (`00072`) and a seeded levelled "Rack" form (`00073`); adding a form needs zero code.
- **Multi-supplier products & multi-UOM** — N suppliers per product with their own SKU/cost (`00070`); N-level units of measure each/carton/pallet (`00067`–`00069`).
- **MAIN floor plan + slotting** — `NexOrder/warehouse-main/` (`warehouse:main:{seed,reset}`) replaces MAIN's placeholder 15-bin layout with a 189-bay DC and drives the real `recommend-putaway` → `decide-putaway` path to slot every SKU. See `warehouse-main/README.md`.
- **PO Inbox** — AI email-to-PO triage subsystem (see the PO Inbox section).
- **Tridon demo (cookie-cutter)** — self-contained `NexOrder/tridon-demo/` for a repeatable real-email hardware demo: email `tridon-sydney-auto.pdf` (auto-approves) + `tridon-sydney-review.pdf` (one uncatalogued Milwaukee line → review). Scripts `demo:tridon:{seed,reset,pdfs}`. Shares the `dulshanb@…` sender with the V2food demo (seed repoints it; re-run `seed:v2food-demo` after). See `tridon-demo/README.md`.
- **Admin-mutation lockdown** — 8+ `mutate-*` Edge Functions + `audit_events` + `_shared/{auth,errors,audit,cors}.ts` + RLS mig `00013`. Invoices locked down later in `00017`.
- **Realtime, error boundaries, audit-log viewer, transactional email** — see Architecture / lockdown sections; Admin "Audit Log" tab over `audit_events` + `client_errors` with filters, pagination, diffs, CSV export.
- **Auth polish** — password reset (`<ForgotPasswordDialog>` → `resetPasswordForEmail` → `<ResetPasswordView>`) and 30-min idle timeout (`hooks/useIdleTimeout.ts`).
- **CI** — `.github/workflows/ci.yml` single `verify` job: `tsc --noEmit` → `npm test` → `npm run build`. Block-on-red is a branch-protection setting (see Pending #1).
- **Perf** — `React.lazy`/`Suspense` bundle splitting for admin/modals/heavy views; DB indexes + constraints (migs `00016`).
- **Pantry redesign** — `components/pantry/*` with frequency intelligence, OOS substitutes, keyboard nav, mobile card stack.
- **Order-status rework** — fulfillment model went 5→6 statuses grouped into three Order Import tabs (Received: `processing`/`processed`; In Progress: `picked`/`packed`; Completed: `dispatched`/`delivered`). Mig `00025`.
- **Image pipeline** — product/avatar/photo uploads now compress to WebP (`browser-image-compression`) and land in Storage buckets; columns store public object URLs instead of base64 data URLs. Mig `00024`.
- **Global rate limiting** — `_shared/rateLimit.ts` now backs the cap with the `rate_limit_hit()` Postgres RPC + `rate_limit_counters` table (mig `00026`) for a true cross-isolate cap, with hourly `pg_cron` cleanup and fail-open to the legacy per-isolate in-memory counter.
- **Settings revamp + health monitoring** — Settings split into 6 sub-tabs under `components/admin/settings/`; security headers, a health cron and an admin "System Health" tab over `health_checks` (mig `00059`).
