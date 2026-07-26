# NexOrder — Production Readiness Audit

**Date:** 2026-07-27 · **Branch audited:** `feat/qr-tracking` · **Target:** `https://nexorder.vercel.app` · **Supabase project:** `lsgkznyiabqitqfpveey`

Scope: three parallel reviews (security/auth, operations/reliability, code health & compliance) across 176 components, 61 Edge Functions, 82 migrations and 128 test files. Findings marked **[verified live]** were confirmed by read-only queries against the production database on the audit date, not inferred from source.

---

## Verdict

**Not ready for a paying client today. Roughly 3–4 weeks of focused work gets you to defensible.**

This is a well-engineered application with a specific and fixable set of holes. The core write path is genuinely good — privileged mutations funnel through Edge Functions, RLS is enabled on all 62 tables, `place-order` recomputes every price server-side, and there is a real audit trail. The gaps are not architectural sloppiness; they are the predictable residue of a system that grew as a demo and was never formally hardened for a paying customer.

Three categories block launch:

1. **Read-side data exposure.** Write access is locked down; *read* access largely is not. Any authenticated user — including a customer login — can read every other client's contract pricing, payment details, supplier list and margins.
2. **Money correctness in the PO-Inbox path.** `approve-po` bills catalogue price and writes no invoice. Contract customers are overcharged, and those orders bypass credit limits entirely.
3. **Operational floor.** No backups, no staging, no rollback, no alerting, no migration ledger. Any one of these turns a routine incident into an unrecoverable one.

Alongside those, two things must be *decided* rather than merely built: whether you are one-tenant or many (§4), and how you intend to issue a compliant Australian tax invoice (§3.3).

### Scorecard

| Dimension | Rating | One-line justification |
|---|---|---|
| Write-path security | 🟢 Green | Service-role-only mutations, RLS-blocked direct writes, audit trail, rate limiting on 57/60 functions |
| Read-path security | 🔴 Red | 9 tables carry `USING (true)` SELECT policies exposing pricing, payment details and margins |
| Money / data correctness | 🔴 Red | `approve-po` ignores contract pricing and promotions, and writes no invoice |
| Tax & legal compliance | 🔴 Red | No GST fields, no ABN, no privacy policy, no data-erasure path |
| Backups & disaster recovery | 🔴 Red | Supabase Free — no PITR, no backup policy, no restore runbook |
| Release engineering | 🔴 Red | Manual laptop deploy from any branch, no CI gate, no rollback, no migration ledger |
| Monitoring & alerting | 🟠 Amber | Health cron and error log exist; nothing pages a human — email alerting is unconfigured |
| Testing | 🟠 Amber | 1662 tests passing, deep on WIE/PO-inbox internals, thin on cart submission and role routing; E2E never runs in CI |
| Type safety | 🟠 Amber | `tsc` passes, but no `@types/react` + `strict` off means 176 components are effectively untyped; 61 Edge Functions excluded from CI typecheck |
| Multi-tenancy | 🔴 Red | The `tenant` column exists and nothing reads it; there is no tenant predicate in any RLS policy |
| Accessibility | 🟠 Amber | Minimal ARIA — `aria-describedby` appears zero times, so no form error is programmatically associated with its input |
| Frontend performance | 🟢 Green | Lazy-loaded routes and modals; main bundle heavy (~915 KB raw) but acceptable for a B2B tool |

---

## 1. Fixed during this audit

Three issues were confirmed live and actioned immediately.

### 1.1 Anonymous write/delete on all five storage buckets — **FIXED** ✅

**[verified live]** `pg_policies` returned five `anon_write_*_dev` policies, `cmd = ALL`, `roles = {anon}`, on `company-assets`, `visit-photos`, `signatures`, `product-images` and `avatars`. They were created by `00004_storage_buckets.sql:47-63` and `00024_image_buckets.sql:39-49` with a *"DEV ONLY … remove once auth + RLS are wired"* comment. Auth and RLS were wired in migrations `00008`–`00013`. The policies were never removed.

`FOR ALL` includes `DELETE`. The publishable key ships in the browser bundle by design, so **any internet user holding it could have deleted every delivery signature in the system** — your proof-of-delivery evidence for dispatched orders — plus overwrite product images and the company logo.

**Fix shipped:** migration `00081_drop_anon_storage_write.sql`, applied to production and verified (`anon_write%` now returns zero rows; the five `auth_write_*` policies remain intact). No legitimate capability was removed — every upload path uses an authenticated client.

### 1.2 `send-email` was a world-callable endpoint — **FIXED** ✅

`supabase/config.toml:49-50` sets `verify_jwt = false` for `send-email`, and the handler applied only an IP rate limit — no auth check, unlike every other `verify_jwt = false` function, which each re-implement a bearer or state check in-body. Anyone could `POST {"template":"order_confirmation","orderId":"…"}` and cause a real email to a real customer. The `sent: true` versus `reason: "recipient_unresolved"` response was also an **order-ID enumeration oracle**.

**Fix shipped:** added `isServiceRoleCall()` to `_shared/cronToken.ts` (reusing the existing constant-time comparison) and gated the handler on it. Both internal callers — `place-order/index.ts:510` and `health/index.ts:207` — already send the service-role key as their bearer token, so nothing broke. Covered by `__tests__/cronToken.test.ts` (10 tests). Deployed and verified against production:

| Caller | Result |
|---|---|
| No `Authorization` header | `401` |
| Publishable/anon key (what a browser holds) | `401 UNAUTHORIZED` |
| Service-role key (the real callers) | `200` — function executes normally |

### 1.3 Demo credentials on the public login page — **DEFERRED BY DECISION** ⚠️

`components/auth/LoginPage.tsx` publishes a click-to-fill roster of seven working accounts, including **Admin `alice@nexorder.com.au`**, and renders the shared password `Password123!` on screen. The string is present in the deployed bundle (`dist/assets/index-CHBE2c09.js`).

**[verified live]** All seven accounts exist in production `auth.users`, and `alice@nexorder.com.au` last signed in on **2026-07-26** — this is an active admin account, not a dormant fixture. Whether the published password still authenticates was not tested; it was set by `supabase/seed.ts:165` and there is no evidence of rotation.

You elected to keep the roster visible for now, which is reasonable while the deployment is a sales-demo surface. The code was changed so this is a switch rather than an edit: `VITE_SHOW_DEMO_LOGINS` now gates both the data and the markup, defaulting **on** so today's behaviour is unchanged. Setting it to `false` in the Vercel project env folds the ternaries at build time and strips the roster from the bundle.

Both directions were verified by building: with the flag off, `Password123!` and the roster are absent from `dist/`; with the default, they are present as before. One caveat found while testing — **`alice@nexorder.com.au` still appears in the bundle even with the flag off**, because `constants.ts` ships its seed `USERS` array to the browser (see §6). Turning the flag off removes the *password*; removing the admin's email as well needs the `constants.ts` split.

> **This exposure is still open.** Before the first paying client: set `VITE_SHOW_DEMO_LOGINS=false` **and** rotate the passwords on all seven seeded accounts. Turning the flag off stops advertising the credential; it does not invalidate it. **This is the single highest-priority manual action in this report.**

---

## 2. Blockers before the first paying client

### 2.1 Any authenticated user can read every client's confidential data 🔴

**[verified live]** Nine tables carry a `SELECT` policy of `USING (true)` for the `authenticated` role:

`app_settings` · `horeca_payment_methods` · `horeca_pricing` · `pantry_items` · `product_suppliers` · `product_uoms` · `products` · `promotions` · `suppliers`

The two that matter most:

- **`horeca_payment_methods`** (`00001_initial_schema.sql:616`) stores a free-text `details` field for `Credit Card` / `Bank Transfer` records. A restaurant customer login can `GET /rest/v1/horeca_payment_methods?select=*` and retrieve **every other customer's banking details**.
- **`horeca_pricing`** (`00001:592`) is your negotiated per-customer contract pricing. Every customer can read every other customer's rates.

Note the asymmetry: `horecas`, `orders` and `invoices` *are* correctly scoped (`00001:565,654,747`). These nine tables were simply missed. The publishable key plus any customer login is all that is required — RLS is the only control, and it is off for these reads.

**Fix:** replace `USING (true)` with the same role / `user_horeca_id()` predicates already used by `horecas_select_customer`. Where customers legitimately need a subset (product catalogue), expose a view with only the customer-safe columns. **Estimated effort: 1–2 days including tests.**

### 2.2 `approve-po` overcharges contract customers and bypasses credit limits 🔴

`supabase/functions/_shared/poInbox/orderTotals.ts:76-84` sets `unitPrice = product.price` — the catalogue price — with only the extracted PDF price as a fallback. It never consults `horeca_pricing` or the promotion engine. The function's own header says so plainly (`approve-po/index.ts:17-19`): *"Inbound POs do NOT currently apply horeca_pricing, promotions, or invoice creation."*

Two consequences, both financial:

1. **Every PO-Inbox order silently overcharges any customer with a negotiated discount.** PO Inbox is your admin daily-driver, so this is the high-volume path, not an edge case.
2. **No invoice is written.** The credit-limit check in `place-order/index.ts:197-205` works by summing unpaid `invoices`. PO-Inbox orders never appear there, so **a customer can consume unlimited credit through the PO inbox** and your AR ledger is incomplete.

The contrast is instructive and worth preserving: `place-order` is built correctly. It accepts only `productId` + `quantity` (`:36-41`), independently loads products, HoReCa pricing and promotions, and recomputes every line server-side (`:371-401`); a client-supplied `packSize` is overridden by the authoritative UOM factor (`:304-311`). The bug is confined to the later `approve-po` path, which was written to a deliberate MVP shortcut that was never revisited.

**Fix:** call the shared `_shared/pricing.ts` resolver from `buildOrderItems`, and create the invoice in the same flow as `place-order/index.ts:489-498`. **Estimated effort: 2–3 days.** Also audit any orders already approved through this path for undercharging/overcharging before invoicing a real client.

### 2.3 No backups, no point-in-time recovery, no restore runbook 🔴

`HOSTING-PLAN.md:24` records the current posture as **Supabase Free + Vercel Hobby**. The free tier has no PITR and no restore guarantee, and free projects pause on inactivity. A repo-wide search for `backup|PITR|restore|disaster` returns no database-recovery material at all.

Compounding it: **no down-migrations exist** for any of the 82 migration files, several of which contain destructive DDL. `supabase/run-migration.mjs:57` executes an entire file in a single `client.query()` and exits on error — a multi-statement file that does not open its own transaction can half-apply, with no way back.

Separately, **Vercel Hobby prohibits commercial use** (flagged in `HOSTING-PLAN.md:24`). Billing a client while hosted there is a terms violation that can take you offline without notice.

**Fix:** Supabase Pro (daily backups + 7-day PITR) and Vercel Pro; commit `docs/RUNBOOK-restore.md`; **perform one actual restore drill** — an untested backup is not a backup. **Estimated effort: half a day plus ~$45/mo.**

### 2.4 Every environment is production 🔴

There is no staging project, and this is not an oversight to be discovered — it is documented in the code:

- `playwright.config.ts:3-6` — *"There is no staging database … every run, local or CI, talks to the same Supabase project the production app uses"*
- `CLAUDE.md:40` — warehouse fixture scripts *"both write to PROD"*
- `vitest.integration.config.ts:15` loads `.env.local`, so the six `*.integration.test.ts` files mutate live data
- The project ref is hard-coded in `vercel.json:9`, `supabase/apply-sql.mjs:36` and `00059_health_monitoring.sql:124`

Today that is survivable because the data is demo-scale (51 orders, 9 HoReCas, 140 products, 27 invoices). Once real orders exist, a test run corrupting a client's inventory ledger is a matter of when.

**Fix:** stand up a second Supabase project as staging, make the project ref an env var everywhere, point `E2E_BASE_URL` and a `.env.staging` at it. **Estimated effort: 2–3 days** (mostly re-running migrations and seeding).

### 2.5 Nobody gets paged 🟠→🔴 at launch

The alerting path exists in code and is dead by configuration. `health/index.ts:171-215` alerts on status transitions via an in-app notification and an email through `send-email`. But `RESEND_API_KEY` is not set in production (`CLAUDE.md:221`, `docs/PRODUCT_SPEC.html:787`), so `send-email/index.ts:102-104` short-circuits; and the recipient is `ALERT_EMAIL`, also unset. The dispatch is `void fetch(...).catch(console.warn)`, and nobody reads Edge Function logs.

The only surviving channel is the Admin **System Health** tab — a dashboard with a 60s refetch that nobody is watching at 3am.

There is also a structural flaw: `health/index.ts:149-169` reads the previous status *from the database* and writes the new row *to the database*. In a total DB outage both fail, so the outage leaves **no record at all**, and `shouldAlert(null, 'ok')` returns false on recovery — the recovery alert is swallowed too. A system cannot reliably monitor itself.

**Fix (today, ~1 hour):** set `RESEND_API_KEY` and `ALERT_EMAIL` via `npx supabase secrets set`, then point an external monitor (UptimeRobot / BetterStack, free tier) at the unauthenticated `GET /functions/v1/health` endpoint — which was purpose-built for exactly this — with SMS escalation. That gives you a dead-man's switch outside the failure domain.

### 2.6 Release engineering has no gate and no rollback 🔴

- **Deploy is a manual laptop command from any branch.** `scripts/deploy.mjs` never checks the branch, never checks for a clean tree, and never runs tests or `tsc`. It reads whatever `git rev-parse HEAD` returns (`:38`), runs `vercel deploy --prod` (`:122`) and re-aliases production (`:137`). *The repo is currently checked out on `feat/qr-tracking`, not `main`.* There is no `npm run rollback`.
- **CI cannot block a merge.** `.github/workflows/ci.yml` runs a solid `verify` job (audit → overlay guard → `tsc` → tests → build) on every PR, but `main` does not require it — blocked by GitHub Free disallowing branch protection on private repos (`CLAUDE.md:220`). Red CI merges silently, and deploys don't consult CI at all.
- **No migration ledger.** No `schema_migrations` table of any kind. Migrations are applied ad hoc by `run-migration.mjs` or `apply-sql.mjs` against an arbitrary file path; neither records that it ran, checks ordering, or verifies idempotency. **Drift is already documented** — `tests/e2e/README.md` notes migration `00072` is not applied to prod — and there is a duplicate migration number (`00022_email_account_signed_out.sql` and `00022_po_aliases_origin.sql`), so even filename ordering is ambiguous.

**Fix:** ~$4/mo for GitHub Pro to require the `typecheck · test · build` check (runbook already saved at `~/.claude/plans/add-branch-protection-generic-zebra.md`); add a branch/clean-tree/green-tests guard to `deploy.mjs` plus an `npm run rollback` that re-aliases the previous verified deployment; adopt `supabase db push` or add a `_migrations(name, applied_at, checksum)` table both runners write to. **Estimated effort: 2–3 days.**

### 2.7 Smaller security items, same release 🟠

| Item | Evidence | Fix |
|---|---|---|
| CORS allows a squattable preview pattern | `_shared/cors.ts:28` — `copy-of-curatif-order-system-v1[._-]?3-[a-z0-9-]+\.vercel\.app`. Vercel hostnames are globally namespaced, so a third party can register a matching project and gain CORS access | Pin to the exact team suffix, or drop the pattern |
| CORS allows `localhost:3000` in production | `_shared/cors.ts:30` | Gate behind an env flag |
| RLS helpers have no pinned `search_path` | `00001:429,438` — `user_role()` and `user_horeca_id()` are `SECURITY DEFINER` without `SET search_path`, and they are the basis of *every* RLS policy. The other 53 definer functions all pin it | `ALTER FUNCTION … SET search_path = public, pg_temp` |
| CSP is report-only with no report endpoint | `vercel.json:8` uses `Content-Security-Policy-Report-Only` and sets no `report-uri`/`report-to` — it neither blocks nor informs | Add `report-to`, confirm clean, then promote to enforcing |
| `place-order` accepts an unbounded `items[]` | `place-order/index.ts:243-244` checks non-empty but never caps length; each item drives DB lookups and a reservation | `if (body.items.length > 200) return errorResponse('INVALID_INPUT', …)` |

---

## 3. Compliance — needed before you invoice anyone

### 3.1 No privacy policy, terms, or data-subject rights 🔴

A search across all components, views, services and `index.html` for `privacy polic|terms of (service|use)|cookie|gdpr|unsubscribe|data export|delete my data` returns **zero hits**. Meanwhile the system stores customer names, contact emails, delivery addresses, geolocation (`horecas.lat/lng`), signatures and full order history.

You need, at minimum: a `/privacy` route, a `/terms` route, and an admin action to export or erase a customer's data. Under the Australian Privacy Act an APP privacy policy is required if you're covered; if any client operates in the EU/UK, GDPR erasure is not optional. This also **blocks Google OAuth verification** for the Gmail PO-Inbox connector, which already requires an owned domain (`CLAUDE.md`).

### 3.2 PII is retained forever with no deletion path 🟠

- `inbound_messages.from_address` stores every sender's email address, and the FK is deliberately `ON DELETE RESTRICT`, so a mailbox and its senders' addresses can never be removed.
- `client_errors` (`00014:16-21`) stores `actor_id`, `user_agent`, stack traces and metadata breadcrumbs — **with no retention job**.
- `audit_events` (`00012:6-23`) stores full before/after JSONB for every privileged mutation — **with no retention job**.

Only three cleanup crons exist (`rate_limit_counters` hourly, `health_checks` 30 days, an inventory reconcile). On the Free tier's 500 MB ceiling, a busy warehouse writing before/after JSONB on every stock movement will fill the database — **and a full Postgres disk takes the whole application down.** This is simultaneously a compliance issue and an availability issue.

**Fix:** one migration adding `pg_cron` prunes using the guarded pattern already in `00026:114-122` — `client_errors` > 90d, `audit_events` > 1y, `po_extraction_audit` > 180d. **Half a day.**

### 3.3 Every invoice is non-compliant as an Australian tax invoice 🔴

There is no tax field anywhere in the schema. `invoices` has a bare `amount NUMERIC(12,2)` (`00001:182`); `orders.total` (`:139`) and `order_items.unit_price` (`:169`) likewise. A repo-wide grep for `gst|abn|tax invoice` returns only substring noise.

The ATO requires a tax invoice for supplies over $82.50 to show the supplier's ABN, the words "Tax invoice", and the GST amount. As it stands, **you cannot legally invoice an Australian business through this system**, and your customers cannot claim their input tax credits.

**Fix:** add `subtotal` / `tax_rate` / `tax_amount` to `orders` and `invoices`, ABN and registered business name to `app_settings`, and render them in the invoice UI and the `send-email` templates. Decide up front whether prices are GST-inclusive or exclusive — retrofitting that choice is painful. **Estimated effort: 3–4 days**, and worth a 30-minute conversation with your accountant first.

### 3.4 Email sender identification 🟢→🟠

`send-email/index.ts` sets no `List-Unsubscribe` header and the shared `layout()` footer carries no ABN or physical address. The four templates are transactional, which is largely exempt from the unsubscribe requirement, but Spam Act 2003 sender identification still applies. Adding ABN + business address to the footer is a ten-minute fix — do it when you set `RESEND_API_KEY`.

---

## 4. Before the *second* client: the tenancy decision

**This is a decision, not a task, and it needs making before you sign client #2.**

`00042_tenant_scoping.sql` added a `tenant` column to 8 tables. Its own header states enforcement is *"read-side (queries filter by the caller's tenant) — **NOT RLS** — which is acceptable for a single-Admin demo persona."*

It is worse than that: **nothing reads the column.** A grep for `tenant` across `lib/`, `services/`, `hooks/`, `context/`, `components/`, `views/`, `App.tsx` and `types.ts` returns one unrelated comment, and across all 125 Edge Function files returns three unrelated comments. Combined with §2.1's `USING (true)` policies, onboarding a second client exposes the first client's catalogue, customer list, margins and order history to them — reachable by hitting PostgREST directly with a customer login. **[verified live]**: production currently holds exactly one tenant, so nothing is exposed *yet*.

Three viable paths:

| Path | What it costs | What it buys |
|---|---|---|
| **Shared DB + tenant RLS** | Add `tenant` to `profiles`, write a `user_tenant()` helper, add `AND tenant = user_tenant()` to every policy, backfill, and test hard. ~1–2 weeks | Cheapest to operate; one deploy, one migration run. Highest blast radius if a single policy is wrong |
| **One Supabase project per client** | No RLS work. But migration drift, manual deploys and the missing ledger (§2.6) multiply by N — those must be fixed *first* | Hard isolation by construction; a bug can only ever affect one client |
| **Stay single-tenant** | Nothing now | Perfectly valid if AYAM is the only client for the next year. Just make it an explicit decision with a documented trigger, not a default |

My recommendation: if client #2 is more than ~6 months out, stay single-tenant and spend the time on §2 and §3 instead. If it's sooner, fix release engineering (§2.6) first and then choose project-per-client — it converts a security problem into an operations problem, and operations problems fail loudly.

---

## 5. Should fix soon (not launch blockers)

| # | Item | Evidence | Impact |
|---|---|---|---|
| 1 | **Sessions expire mid-shift.** `persistSession: false` **and** `autoRefreshToken: false` | `lib/supabase.ts:47-48` | Documented as a tab-close problem, but with refresh disabled the 1-hour access token simply expires — a field rep gets 401s mid-order. The `navigator.locks` hang behind this is a known supabase-js issue; passing a custom `storage` adapter plus `{ auth: { lock: (_n,_a,fn) => fn() } }` bypasses Web Locks and lets both flags be re-enabled |
| 2 | **No error tracking.** No Sentry/Datadog/Bugsnag anywhere | repo-wide | `client_errors` gives you rows, not grouping, release tagging, user-impact counts or source maps. `vite.config.ts:52` already exposes the commit SHA — wire it as the release tag |
| 3 | **E2E never runs in CI and is knowingly red.** 7 specs exist; no workflow invokes `npm run test:e2e` | `ci.yml` stops at build; `tests/e2e/README.md` | The one suite that would catch a broken checkout is manual-only and normalised-red. Mark the not-yet-shipped specs `test.fixme` so green means green |
| 4 | **Cron jobs are not in version control.** Both production crons are commented out in their migrations so tokens aren't committed | `00020:110-124`, `00059:119-133` | They exist only as snippets someone pasted into the SQL editor once. If `po-poll-inbox` silently stops, customer POs stop arriving and `health` still reports `ok` — `deriveStatus` doesn't look at cron freshness. Add a `max(last_sync_at)` assertion to the health check |
| 5 | **Type safety is nominal.** No `@types/react`; `strict`, `noImplicitAny`, `strictNullChecks` all absent from `tsconfig.json`; `tsconfig.json:24` excludes `supabase/functions` | verified: `tsc --noEmit` exits 0 | All props and hooks across 176 components resolve to `any`, and all 61 Edge Functions — the money- and inventory-handling code — are never typechecked by CI. The green check is close to meaningless. Install the types, then enable `strict` directory by directory |
| 6 | **No timeout or retry on Resend.** Single `fetch`, non-OK just logs | `send-email/index.ts:126-139` | A Resend outage silently drops order confirmations with no dead-letter queue. (OpenAI, by contrast, is handled well — 3 retries with jittered backoff and a 30s timeout — though there is no monthly spend cap) |
| 7 | **`npm audit` gates every PR before the tests run** | `ci.yml:33` | A new advisory in any transitive dep turns every PR red overnight with no code change, and masks all functional signal. Classic cause of teams disabling CI — move it to a separate non-blocking job |
| 8 | **Production credentials live in one laptop file.** `.env.local` (correctly gitignored) is read by four scripts | `deploy.mjs:49`, `apply-sql.mjs:20`, and two test harnesses | The entire production admin capability sits in one plaintext file on one OneDrive-synced machine, with no documented rotation procedure |
| 9 | **Multi-step writes use compensating deletes, not transactions** | `place-order:421-502`, `approve-po:451-471,537-542` | An invoice failure in `place-order` is explicitly not rolled back (`:499-502`) → a delivered order with no AR record. In `approve-po`, a failed reservation is non-fatal → an approved order against unreserved stock, which can then be sold twice. You already have the right pattern (`inv_reserve_order`, `wie_publish_layout_tx`) — move each sequence into one plpgsql function |

---

## 6. Nice to have

- **Bundle weight, and seed data shipped to the browser** — main chunk 915 KB raw (~250 KB gzip), plus a 443 KB second entry and a 319 KB `PieChart` chunk. `constants.ts` (1085 lines of seed users, HoReCas, orders, POs and invoices) is pulled into the main bundle by `App.tsx:8` importing `{ USERS, DEFAULT_SETTINGS }` from it, which defeats tree-shaking. This is not purely cosmetic: `constants.ts:6` is why **`alice@nexorder.com.au` remains in the production bundle even with the demo roster disabled** (§1.3), and it also publishes customer names like `Seaside Bistro`. Split the genuine constants (`CATEGORIES`, `ORDER_STATUS_*`, `UOM_CODES`, `DEFAULT_SETTINGS`) into `lib/constants.ts` and move the seed arrays to `tests/fixtures/`. Cheap fix, and it closes the residue of §1.3.
- **Accessibility** — `aria-describedby` appears **zero** times across 176 components, so no form error is programmatically associated with its input; `aria-live` appears 3 times; 175 `aria-label` against 576 `<button>`. Adding `aria-describedby` + `role="alert"` to the shared `Field` primitive in `components/ui` fixes most forms at once. The tablet breakpoint is also thin (`md:` 35 uses vs `sm:` 247) — worth checking on a rep's iPad.
- **Currency** — AUD hardcoded at ~15 sites with no shared `formatCurrency`. One `lib/money.ts` sourcing the code from `app_settings`.
- **Dead code** — `CustomerForm.tsx` is a blank stub with zero imports; delete it.
- **Duplicate migration number `00022`** — renumber one.

---

## 7. What is already good

Worth stating plainly, because the list above is long and the foundations are not the problem:

- **`place-order` is textbook.** It accepts only `productId` + `quantity`, independently loads products, HoReCa pricing and promotions, recomputes every line server-side, overrides client-supplied pack sizes with the authoritative UOM factor, and checks stock against `available` scoped to the warehouses the reservation will draw from. Direct `orders`/`order_items` writes are revoked from `authenticated`, so this is the only path.
- **Write-path lockdown is real** — `REVOKE INSERT/UPDATE/DELETE` from `authenticated` across the mutation tables, with every privileged write funnelled through an Edge Function and recorded in `audit_events`.
- **RLS is enabled on all 62 tables.** The problem is policy permissiveness on reads, not missing RLS.
- **Rate limiting is DB-backed** across 57 of 60 functions, with a cross-isolate cap via `rate_limit_hit()` and deliberate fail-open behaviour.
- **OAuth is done properly** — PKCE, atomic state consumption with expiry separation and delete-race detection, a redirect allowlist, and a fixed error taxonomy so no provider-controlled string is reflected.
- **No XSS sinks** — zero `dangerouslySetInnerHTML`; the single `innerHTML` interpolates only literals; email templates escape all interpolations.
- **No SQL injection** — no string-concatenated SQL in any Edge Function; all `EXECUTE format()` uses `%I` identifier quoting. `net.*` is revoked from `PUBLIC`/`anon`/`authenticated`, closing SSRF.
- **Secrets hygiene is clean** — `.gitignore` covers all `.env` variants, `git log --all -- .env*` returns nothing, and all 27 helper scripts read credentials from the environment and exit if absent.
- **1662 tests across 128 files, all passing**, with genuinely deep coverage of pricing, scan folding, the WIE engine and PO-inbox resolvers.

---

## 8. Sequenced roadmap

**Week 0 — done in this audit**
- ✅ Dropped anonymous write/delete on all storage buckets (mig `00081`, applied and verified)
- ✅ Authenticated `send-email` (deployed and verified)
- ⚠️ Made demo credentials a one-line switch — **still on by your decision**

**Week 1 — stop the bleeding** *(~4 days + ~$50/mo)*
1. Rotate all seven seeded account passwords — **highest priority, do it first**; then split `constants.ts` (§6) so the admin email leaves the bundle too
2. Supabase Pro + Vercel Pro; run one real restore drill
3. Set `RESEND_API_KEY` + `ALERT_EMAIL`; point an external uptime monitor with SMS at `GET /functions/v1/health`
4. Close the `USING (true)` read policies on the nine tables (§2.1)
5. Add retention crons for `client_errors` / `audit_events` (§3.2) — cheap, and prevents a disk-full outage
6. Pin `search_path` on `user_role()` / `user_horeca_id()`; tighten the CORS allowlist

**Weeks 2–3 — correctness and control** *(~8 days)*
7. Fix `approve-po` pricing + invoice creation (§2.2), and audit already-approved orders
8. GST / ABN / tax-invoice fields end to end (§3.3)
9. Privacy policy, terms, and a customer data export/erase action (§3.1)
10. Staging Supabase project; repoint E2E and integration tests (§2.4)
11. GitHub Pro + required status check; branch/clean-tree/tests guard in `deploy.mjs`; `npm run rollback`; a migration ledger (§2.6)

**Week 4 — hardening** *(~5 days)*
12. Sentry with the commit SHA as release tag
13. Re-enable session persistence + token refresh (§5.1)
14. E2E in CI against staging; `test.fixme` the unshipped specs
15. Install `@types/react`; enable `strict` on `lib/` and `services/`; add a Deno-aware typecheck for `supabase/functions`

**Before client #2**
16. Make the tenancy decision (§4) and implement it

---

## Appendix — verification queries

Read-only queries run against production on 2026-07-27, reproducible via `node supabase/apply-sql.mjs --query "…"`:

```sql
-- Storage exposure (returned 5 rows before mig 00081; 0 after)
SELECT policyname, cmd, roles::text, qual FROM pg_policies
 WHERE schemaname='storage' AND policyname LIKE 'anon_write%';

-- Permissive read policies (returned 9 rows — still open)
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
   AND 'authenticated'=ANY(roles) ORDER BY tablename;

-- Seeded demo accounts, and whether they are live
SELECT email, last_sign_in_at::date FROM auth.users ORDER BY created_at;

-- Current production data volume
SELECT (SELECT count(*) FROM orders)   AS orders,
       (SELECT count(*) FROM horecas)  AS horecas,
       (SELECT count(*) FROM invoices) AS invoices,
       (SELECT count(DISTINCT tenant) FROM horecas) AS tenants;
```

---

### Note on repo documentation

`CLAUDE.md` lists `hooks/useLocalStorage.ts` under dead code. It is live — imported at `components/ActionItemsBoard.tsx:4,423`. Don't delete it during the dead-code sweep.
