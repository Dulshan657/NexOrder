# NexOrder → Production for Amadiya Agro Products

**Status:** database cut over; front end outstanding · **Written:** 2026-07-27 · **Last updated:** 2026-08-12 · **Companion docs:** `MULTI-TENANT-ARCHITECTURE.md`, `PRODUCTION-READINESS-AUDIT.md`, `HOSTING-PLAN.md`, `ONBOARDING-AUDIT.md`

---

## ⚠️ Four decisions taken on 2026-08-12 supersede parts of this plan

Read these before following any section below. Where they conflict, these win;
the original text is left in place because the reasoning still explains *why*
each piece exists.

**1. There is no new Sydney project. `lsgkznyiabqitqfpveey` IS Amadiya's
production database.** The plan assumed a clean-slate project in
`ap-southeast-2`. It turned out the existing project was *already* in
`ap-southeast-2` — this document and `config/environments.mjs` both said
Singapore and were simply wrong, per the Management API — its organisation was
already on Pro, and Amadiya's 134-location warehouse was already drawn in it.
The region and plan rationale for a second project had evaporated. So §A0.3 and
§A3.1 do not apply, and the "clean slate, no data migration" premise is replaced
by a purge.

**2. The demo was exported to disk, not rehomed.** `supabase/ops/export-demo.mjs`
wrote 68 tables, 102,426 rows and 223 storage objects to `demo-export/`
(archived at `../backup/demo-export-2026-08-12/`). It is rebuilt later on a
separate Vercel + Supabase account. **Until that exists there is no
non-production environment at all** — the single biggest cost of this decision,
and the reason everything that needed the demo data to prove it was done first.

**3. The purge took the history with it, because it had to.** `profiles` has 36
inbound foreign keys, 35 at NO ACTION. There is no order in which the seeded
demo accounts — including `alice@nexorder.com.au`, a live Admin on a password
printed in these docs — can be deleted while their audit events, ledger
movements and orders exist. Either they stay in a client's user list forever or
the history goes. It went. `supabase/ops/purge-demo.mjs`.

**4. Phase B's read-side security landed early**, in migrations `00104`/`00105`,
*before* the purge — because the demo customer logins were the only way to prove
a customer predicate, and they were about to be deleted. Eight of the nine
`USING (true)` policies are closed. `app_settings` is not, and that is argued
out in `00105`'s header rather than papered over.

### What is done

- Demo exported and archived · read policies closed and verified against real
  customer sessions · tenant identity read by the documents · demo credentials
  out of the bundle · `secrets`/`schedule-crons`/`bootstrap-admin`/`tenantGuard`
  written · Vercel project pinning · database purged, re-badged
  `('prod','amadiya')`, secrets and auth config applied, 71 functions deployed,
  7 crons scheduled.
- **Gate A passes.** Gate B's isolation half passes: `nexorder.vercel.app` is
  refused by CORS, which is the proof the old demo alias can no longer reach
  this database.

### What is left

Phase 3 of the working plan: the Amadiya **Vercel project** and
`nexorder.com.au`, retiring the old alias, `info@amadiya.com.au`'s account,
Amadiya's phone/email/logo, `RESEND_API_KEY` + Auth SMTP, UptimeRobot, and Gates
B–E. Then rebuild the demo elsewhere.

---

**Original progress note (2026-08-11):** `nexorder.com.au` registered (A0.1 done). A1 + A2 under way. Vercel Pro and the
Sydney Supabase project not yet purchased — A3 onwards is blocked on them.

---

## Context

NexOrder is being handed to its first paying client, **Amadiya Agro Products Pty Ltd** (1 Furlong Street, Cranbourne West VIC 3977). Peter has confirmed the engagement and supplied an ABN; Shian Fernando and Aslam Assen will enter real stock.

Today there is exactly one environment. `nexorder.vercel.app` is simultaneously the sales demo, the dev target, the E2E target and the would-be production system, backed by a single Supabase project in **Singapore** that holds AYAM seed data, Tridon and V2food demo tenants, WIE-DEMO and the MAIN warehouse fixtures. `PRODUCTION-READINESS-AUDIT.md` (27 Jul) rates read-path security, backups, release engineering and tax compliance **red**. `ONBOARDING-AUDIT.md` records a **P1**: invited users cannot set a password, so the "individual logins" promised as Phase 1 item #5 has never actually worked through the UI.

The outcome this plan delivers: a **clean-slate production tenant in Sydney** on paid plans with backups, reachable at `nexorder.com.au`, carrying Amadiya's business identity on its documents while the product stays NexOrder-branded — and the existing Singapore project demoted to **dev/demo**, keeping every demo asset alive and permanently unable to touch client data.

### ABN — verified, and one correction

`55 604 212 142` = **NEX GEN INNOVATIONS PTY LTD**, Australian Private Company, active since 13 Feb 2015, GST-registered 4 Apr 2019, VIC 3337. Verified against ABN Lookup. Valid for the `.com.au` registration, which must be held by the ABN holder — NexGen is the correct registrant.

**It is not Amadiya's ABN.** Peter's email places it directly beneath Amadiya's address block, which reads otherwise. A tax invoice must carry the **supplier's** ABN — Amadiya's — and that has not been supplied. Phase B is blocked on it.

### Decisions locked

| | |
|---|---|
| Hosting | Option 1 — stay Supabase + Vercel, DB in Sydney, one Vercel bill |
| Topology | **New** `ap-southeast-2` project = Amadiya (empty). Existing `lsgkznyiabqitqfpveey` = DEV/demo. No data migration. |
| Domains | `nexorder.com.au` → Amadiya · `nexorder.vercel.app` → dev/demo |
| Vercel | **One Vercel project per target** — see §A8. Revised 2026-08-11; this row previously read "one project, `main` → Production, `develop` → Preview". |
| Tenancy | **Project-per-tenant**, decided 2026-08-11 — `MULTI-TENANT-ARCHITECTURE.md`. Not shared-DB-with-RLS. |
| Target name | The deployment target is **`amadiya`**, not `prod`. `--env=prod` is a deprecated alias for one release. |
| Starting data | Empty + in-app setup checklist; Amadiya enter their own data |
| Identity | `app_settings` = Amadiya (documents/invoices). App chrome, login, favicon = NexOrder. |
| Tenant tag | Prod stamps `tenant = 'amadiya'`. **The string `ayam` must not appear in the prod database.** NexGen owns the NexOrder application; Amadiya is a tenant of it. Mechanism in A2.4. |
| Client logins | One shared account on `info@amadiya.com.au` — **confirmed by Peter 2026-07-28** (consequence noted below) |
| GST | Build now, prices **GST-inclusive** (back-compute as `total/11`) |
| PO Inbox | Deferred — functions deploy, OAuth registration does not |
| Timeline | Phase A by Wed 29 Jul → supervised Shian walkthrough. Real stock gated on Phase B. |

**Shared-login consequence, stated once:** every `audit_events` row, stock movement, putaway and pick will read `info@amadiya.com.au`. In a system whose value proposition is traceability, that is the one capability being given up. Build it so splitting into two named users later is an invite, not a migration — don't seed anything that assumes a single operator.

### Needed from Peter

1. **Amadiya's ABN** — blocks tax invoices (Phase B). *Still outstanding.*
2. **Amadiya's logo** (PNG/SVG, transparent) — for `app_settings.company_logo_url`. *Still outstanding.*
3. ~~Confirmation that one shared login is acceptable, or two individual addresses.~~
   **Resolved 2026-07-28 — shared `info@amadiya.com.au` confirmed.** A4 (invite flow) is still
   required so that account can set its own password through the UI.
4. ~~Approval to register `nexorder.com.au` under NexGen's ABN.~~ **Done — domain registered.**

---

## Phase A — production environment (target Wed 29 Jul)

### A0 · Procurement (not code, do first — gates A3, not A1/A2)

**A0.1 · Domain — DONE.** **nexorder.com.au** registered under ABN 55 604 212 142
(Nex Gen Innovations Pty Ltd), eligibility "service the registrant provides", auDA Licensing
Rules 2.4.4(2)(vi). Unblocks three separate things: the Vercel domain, Resend sender
verification, and Google's Authorized Domain requirement.

**Do not add the domain to the Vercel project yet.** `main` currently deploys the Singapore
project with demo data and demo logins visible, so `nexorder.com.au` would resolve to the demo.
Configure DNS early so SSL and propagation complete, but withhold the domain assignment until
the Phase A gates pass. Use the exact records Vercel shows in Project → Settings → Domains at
the time you add it — the apex A-record IP has changed more than once, and a stale value fails
with a certificate error.

**A0.2 · Vercel Pro (US$20/mo).** Hobby prohibits commercial use, and the Production/Preview
split in A8 needs a paid team.

1. `vercel.com/dashboard` → switch to the **`nexgen14`** team (NexGen's own), not your
   personal scope. Superseded 2026-08-19: this step originally named
   `dulshan657s-projects`, and `nexorder-amadiya` WAS created there. It has since been
   transferred to `nexgen14` — a tenant's hosting belongs on a NexGen-owned scope, the
   same rule the demo follows on `nexgen13`. Do not re-provision into a personal scope.
2. Settings → Billing → Upgrade to **Pro**. Pro is **per seat**; at one member that is US$20/mo.
3. Set a **Spend Management** pause threshold while you are there — not just a notification.
4. **Install the CLI:** `npm i -g vercel`, then `vercel whoami`. It is not currently installed on
   this box, and `scripts/deploy.mjs` shells out to a bare `vercel`. Confirm before A8.

**A0.3 · Supabase — the Sydney project.** Two cost findings that correct the original line above:

- **Pro is billed per *organization*** ($25/mo base + usage), not per project. Putting the Sydney
  project in the **same org** as `lsgkznyiabqitqfpveey` means one $25 covers both, and the demo
  project also gains Pro (no inactivity pause, and `VITE_SUPABASE_IMAGE_TRANSFORMS` becomes
  usable). A separate org costs a second $25/mo and buys clean per-client billing and a separate
  member list — but **not** credential isolation: a Supabase personal access token is
  account-scoped and spans every org, so `SUPABASE_ACCESS_TOKEN` reaches both either way.
  → **Same organization.** The isolation this plan relies on is software-side (the registry, the
  URL assertion, `environment_marker`) and none of it is org-scoped. Revisit at client #2.
- **PITR is not included in Pro.** Pro gives daily backups at 7-day retention; point-in-time
  recovery is a ~US$100/mo add-on. Gate E below was written assuming Pro included it.
  → Launch on **Pro daily backups**, and run Gate E as a restore-from-daily-backup drill. This is
  a known, priced gap, not a surprise to discover during an incident.

Steps: create the project in the chosen org, name `nexorder-prod`, region **`ap-southeast-2`
(Sydney)**, plan **Pro from the outset** — region cannot be changed later, and discovering the
restore drill is impossible after the client has data is the failure mode being avoided. Capture
the ref, DB password, `sb_publishable_*` and `sb_secret_*` straight into `.env.amadiya.local`, never
into `CLAUDE.md`. Pre-enable **`pg_cron`** and **`pg_net`** in Database → Extensions
(`00020:62` needs them and the Management API sometimes refuses to create extensions). Do not run
migrations here — that is A3, through `migrate.mjs`, not `apply-sql.mjs`.

### A1 · Environment plumbing — one source of truth per environment

**New `config/environments.mjs`** — the *only* file where either project ref appears. Refs, URLs, origins, Vercel targets, `allowFixtures`. No secrets (all of it is public).

**New `scripts/lib/env.mjs`** — `resolveTarget({ allow, argv })`, replacing the five copy-pasted `loadEnv()` implementations in `supabase/apply-sql.mjs:17`, `supabase/apply-auth-config.mjs:53`, `scripts/deploy.mjs:46`, `wie-demo/lib.mjs:14`, `warehouse-main/lib.mjs`.

- Target comes from `--env=<dev|amadiya>` (equals-form only — `apply-sql.mjs:49` picks its SQL file as `args.find(a => !a.startsWith('--'))`, so `--env amadiya` would be read as a filename), else `NEXORDER_ENV`, else **hard fail**. No default anywhere — that alone kills the `|| 'lsgkznyiabqitqfpveey'` fallback class.
- Credentials from `.env.dev.local` / `.env.amadiya.local`. Both already match `.gitignore`'s `.env.*.local`, and critically **Vite never loads them** (it reads `.env.production.local`, a different name) — so a laptop build cannot silently repoint at the client's database.
- Asserts the loaded `SUPABASE_URL` matches the registry entry for the target.

**Added 2026-08-11, when the registry was generalised for multiple tenants:**

- `ENV_NAMES` is **derived** from the registry keys; `fixtureTargets()` and `tenantTargets()`
  replace two hardcoded lists. The `allowFixtures` field, declared since A1 and read by nothing,
  is now guard #1's actual source — so a tenant cannot become a fixture target by omission.
- **`markerName` is a separate field from `name`.** `environment_marker.name` is constrained by
  `00086` to `CHECK (name IN ('dev','prod'))` and `00086` is applied and checksummed, so the
  database's vocabulary is frozen at two values while target names are open-ended. `migrate.mjs
  --stamp` writes `markerName`; stamping the target name would fail the CHECK on the first
  production run and nowhere earlier.
- **`vercel.ts` is now a prerequisite, not a Phase C nicety.** `vercel.json` is static and the
  platform reads it *before* the build, so no prebuild step can generate it — which means one
  file cannot express a per-target CSP host or a per-target image rewrite. See §A8.

**De-hardcode these** (mechanism per site):

| Site | Change |
|---|---|
| ~~`vercel.json:9`~~ → `vercel.ts` | **DONE 2026-08-11.** `vercel.json` is deleted; `vercel.ts` derives the CSP per target from the registry via `NEXORDER_ENV`, so there is no hand-maintained host list to diverge. `frame-src` is present (it was absent, falling back to `default-src 'self'`, and would have broken `POInboxDetailModal` and `DocumentViewerContext` on promotion to enforcing). Note Vercel **refuses to start** if both files exist — that is the error you get, not a silent precedence rule. |
| `supabase/apply-sql.mjs:36`, `apply-auth-config.mjs:72` | delete the literal fallbacks |
| `apply-auth-config.mjs:27-51` | `DESIRED` → `buildDesired(env)`. Prod allow-list is `https://nexorder.com.au/**` **only** — the preview glob must never appear there, or a preview build becomes a valid password-reset landing page for a client account. |
| `scripts/deploy.mjs:22,122,128` | alias, target and team slug from the registry |
| `scripts/deploy.mjs:83-117` | **bug** — `recordDeployment` reads `.env.local`, so a prod deploy writes its `deployments` row into the *dev* database. Use the resolved target. |
| `_shared/cors.ts:21-31` | `Deno.env.get('ALLOWED_ORIGINS')`, comma-separated exact origins, **fail closed**. Delete the squattable `copy-of-curatif-…` regex at `:28` (audit §2.7) and drop `localhost:3000` from prod. |
| `_shared/poInbox/callbackCommon.ts:50-70` | same secret; delete `PRODUCTION_DEFAULT` — today's fallback would send a client's completed OAuth flow to the demo app |
| `send-email/index.ts:33`, `health/index.ts:39` | **delete `DEFAULT_APP_URL`; throw if unset.** Unset today means every customer email links to the demo app, and prod's health cron polls the demo's `version.json` — so prod reports `ok` while prod is down. Both fail silently *and successfully*. |
| `.mcp.json:5` | pin to **dev, permanently**. Never add a prod entry — an agent session with MCP write access to the client's DB is the largest unforced risk here. |
| `__tests__/imageUrl.test.ts:11`, `lazyWithRetry.test.ts:12`, `tests/e2e/fixtures/env.ts:37` | fixture refs → `testref`; make `adminEmail` required (the default `alice@nexorder.com.au` won't exist in Sydney) |

**`package.json`:** delete plain `deploy` / `auth:config`; add `:dev` / `:amadiya` pairs for `deploy`, `auth:config`, `migrate`, `fn:deploy`, `secrets`. Muscle memory is the threat model — which is also why the second half of each pair is the tenant's name and not `prod`.

**Rewrite `CLAUDE.md` in the same PR.** It is loaded into every agent session and currently states production is `nexorder.vercel.app`, that there is no staging project, and that the warehouse fixtures "both write to PROD". Left stale, an agent will seed over the client's database *while following instructions*. Same for `playwright.config.ts:3-6`.

### A2 · Migration ledger + fixture guards

**New `supabase/migrate.mjs`** — creates `public.schema_migrations(filename PK, checksum, applied_at, applied_by)`, enumerates `supabase/migrations/*.sql` sorted by (numeric prefix, full filename) — which deterministically resolves both duplicate-number pairs (`00022`×2, `00081`×2; each pair is mutually independent, so either order is safe — **do not renumber**). Skips files already recorded with a matching sha256; errors on drift. Applies via the Management API, the only transport that works from this box.

Atomicity, from the actual file shapes: 62 of 87 files already carry `BEGIN;`, none has more than one `COMMIT;`, and none uses `CREATE INDEX CONCURRENTLY`. So splice the ledger `INSERT` before the single `COMMIT;` where one exists, and wrap the other 25 (`00001`–`00020`, `00024`, `00031`, `00044`, `00060`, `00073`) in `BEGIN;…COMMIT;`.

Then `--baseline` the dev project. **Before baselining, verify the drift `tests/e2e/README.md` claims** (mig `00072` unapplied) — a blind baseline enshrines it and leaves dev and prod on different schemas, defeating the point.

**Three independent fixture guards**, because any one can be defeated by a mistake:

1. `resolveTarget({ allow: ['dev'] })` in every seed/demo/reset script — exits before any I/O, no `--force` escape hatch.
2. The URL assertion in A1 — catches prod creds pasted into the dev file.
3. **New migration `00086_environment_marker.sql`** — a singleton
   `environment_marker(id=1, name CHECK IN ('dev','prod'), tenant_key)` stamped by
   `migrate.mjs --stamp`. Every `allow:['dev']` script does one `SELECT` and aborts on `'prod'`.
   This is the only guard that survives a mis-set env file *and* a mis-set registry.
   The table is created **empty**; the stamp writes the row from `config/environments.mjs`.
   Empty is fail-closed — the guards abort and `default_tenant()` (A2.4) returns NULL, which the
   `NOT NULL` tenant columns reject loudly rather than silently defaulting to something wrong.

Scripts to convert: `supabase/seed.ts`, all seven `tests/fixtures/po-samples/*-seed.mjs` + `inject.mjs`, `tridon-demo/{seed,reset}.mjs`, `wie-demo/lib.mjs`, `warehouse-main/lib.mjs`, `scripts/clear-po-inbox.mjs`, `scripts/reprocess-misselected-pos.mjs`, `supabase/exercise-replen-gate.mjs`.

`vitest.integration.config.ts:15` → load `.env.dev.local` only and throw on a prod URL. `playwright.config.ts` → assert `E2E_BASE_URL` is not the prod domain.

### A2.4 · Tenant identity — `amadiya`, not `ayam`

`00042_tenant_scoping.sql` puts `tenant TEXT NOT NULL DEFAULT 'ayam'` on eight tables
(`products`, `horecas`, `suppliers`, `promotions`, `email_accounts`, `orders`, `pending_pos`,
`invoices`) and two BEFORE INSERT triggers (`set_tenant_from_horeca`, `set_pending_po_tenant`)
whose fallback is the same literal. Left alone, every row Amadiya creates on Sydney would be
stamped `ayam` — the wrong client's name, in the client's own database.

**The column is written but never read.** No consumer exists in `lib/`, `services/`, `hooks/`,
`components/`, `views/`, `context/` or `supabase/functions/` — the demo-persona separation
actually happens in `lib/demoAccounts.ts`. So this is a pure data-correctness change with no
runtime blast radius, and it is cheapest now, while the prod DB does not exist.

**New migration `00087_tenant_from_environment.sql`.** `00042` is *not* edited — it is already
applied on dev, and `migrate.mjs` would flag the checksum drift.

```sql
CREATE FUNCTION public.default_tenant() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT tenant_key FROM public.environment_marker WHERE id = 1 $$;
```

`SECURITY DEFINER` with a pinned `search_path`, matching the 53 other definer functions in the
schema. This is load-bearing, not stylistic: a column DEFAULT evaluates as the **inserting**
role, and `environment_marker` is service_role-only, so invoker rights would break every
non-service-role insert. `GRANT EXECUTE` to `authenticated` and `anon`.

Then `ALTER COLUMN tenant SET DEFAULT public.default_tenant()` on all eight tables, and
`CREATE OR REPLACE` both trigger functions with every `'ayam'` literal replaced by
`public.default_tenant()`. Semantics are preserved exactly — the guard means "the caller left the
default", and the default is now per-environment.

No backfill, no data change. Dev's marker says `ayam`, so every existing dev row is already
correct and re-running is a no-op; Sydney's says `amadiya`, so the first row Amadiya ever creates
is stamped correctly.

The remaining `ayam` hits are dev-only or cosmetic and are swept without a migration:
`.env.example:18`, `supabase/seedData/products.ts:19`, the comment at `lib/imageUrl.ts:34`, the
fixtures in `__tests__/imageUrl.test.ts` / `__tests__/productImportRow.test.ts`, `wie-demo/lib.mjs:49`,
and the header comments in `00001` / `00042` / `00083`. **Sweep the migration headers before
`--baseline`, or not at all** — afterwards they are checksummed.

### A3 · Stand up Sydney

1. Create the project (`ap-southeast-2`, Pro). Capture ref, DB password, `sb_publishable_*`, `sb_secret_*`.
2. **Canary first:** deploy one trivial function and print the injected env names. `invite-user/index.ts:74` reads `SUPABASE_ANON_KEY`; Supabase has been migrating that toward `SUPABASE_PUBLISHABLE_KEY`. If it's absent, `invite-user` throws and you cannot onboard a single user.
3. `npm run migrate:amadiya` — **count the files, do not trust this number** (105 as of 2026-08-11; it was 89 when this plan was written and it grows every week). Then `--stamp` writes `environment_marker = ('prod','amadiya')` — note `'prod'`, the frozen database vocabulary, not the target name. Note `00020:62` needs `pg_cron`/`pg_net` (enable in Dashboard first if the API refuses); `00027:184` creates the `MAIN` warehouse, which `inv_default_location()` requires. Bootstrap config arrives free: `app_settings` id=1, 4 storage forms, 3 level roles, 8 zone profiles, 9 buckets.
4. **Prove the schema matches dev** — diff an `information_schema.columns` digest, the `pg_proc` count, the `pg_policies` per-table counts and `storage.buckets`. This is the only signal you get that 85 migrations really landed.
5. `npm run fn:deploy:amadiya` (71 deployable — 72 directories under `supabase/functions/` less `_shared/`). **Verify** the **9** `verify_jwt=false` entries in `config.toml` were honoured — nine, not eight: `embed-products` was added after this plan and after `deploy-functions.mjs`'s own comment. Count them; the header comments have been wrong twice — wrong in either direction is silent and severe (`true` on `send-email`/`poll-inbox` breaks order emails and PO polling, because the `sb_secret_*` service key is non-JWT and the gateway 401s it).
6. **Secrets** — new `supabase/ops/secrets.mjs` holding the required/optional name lists + `--check`. Set: `PO_ENCRYPTION_KEY` (**generate fresh — never copy dev's**; it cannot be rotated without re-consenting every mailbox), `POLL_INBOX_CRON_TOKEN`, `HEALTH_CRON_TOKEN`, `OPENAI_API_KEY`, `PO_OAUTH_APP_BASE`, `APP_URL`, `ALLOWED_ORIGINS`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `ALERT_EMAIL`. Do **not** set `PO_ENCRYPTION_KEY_ALLOW_RESET`. OAuth client secrets deferred with the PO Inbox.
   **Sequencing trap:** set `ALLOWED_ORIGINS` on *both* projects before deploying the new fail-closed `cors.ts`.
7. `npm run auth:config:amadiya`. Extend `DESIRED` with **`disable_signup: true`** — a fresh Supabase project ships with signup *enabled*, and `handle_new_user()` (`00001:1050`, SECURITY DEFINER) would hand any stranger a working Customer account inside Amadiya's system. Also `mailer_autoconfirm: false`, `mailer_otp_exp: 3600`, refresh-token rotation. Check the same on dev.
8. **New `supabase/ops/schedule-crons.mjs`** — recreates `po-poll-inbox` and `health-check`, which today exist only as commented snippets in `00020`/`00059` and live nowhere but the old database. Definitions in version control, tokens from `.env.<t>.local`. Don't schedule `health-check` until `nexorder.com.au/version.json` is live. Expect 7 jobs total.
9. **New `supabase/ops/bootstrap-admin.mjs`** — resolves the chicken-and-egg (`invite-user` needs an existing Admin; direct `profiles` INSERT is RLS-blocked) via `auth.admin.createUser({ user_metadata: { role: 'Admin' } })`, letting the `handle_new_user` trigger write the profile. Throwaway temp password, then immediately drive Forgot-password so no plaintext credential sits in a file.

### A4 · Fix the broken invite flow — the actual Phase 1 blocker

`invite-user` calls `inviteUserByEmail`, whose link carries `type=invite`. `lib/auth/recoveryLink.ts` understands only `type=recovery`, so invited users land on a bare login page and can never set a password — which is why every persona to date was created directly in the DB. **Phase 1 item #5 ("individual logins") does not work through the UI today.**

Fix reuses what exists rather than adding a parallel path: extend `RecoveryLink` with `'invite' | 'signup'` kinds in `lib/auth/recoveryLink.ts` (pure, already fully tested), widen `isRecoveryUrl()`, and have `components/auth/ResetPasswordView.tsx` render set-password copy for the invite case. `index.tsx` routing is unchanged. Also fix the P2 that blocks the same flow: the Add-user dialog can't be submitted on a short screen (`components/UserForm.tsx` — the overlay body needs `flex-1 min-h-0 overflow-y-auto` per the `components/ui` contract).

### A5 · Tenant identity, branding and demo shutdown

- Set prod `app_settings`: `company_name = 'Amadiya Agro Products Pty Ltd'`, address `1 Furlong Street, Cranbourne West VIC 3977`, logo, `currency AUD`. ABN column arrives in Phase B.
- **`_shared/orderDocuments.ts:158` hardcodes `companyName: 'Nex Order'`** — every pick slip and dispatch advice would print the wrong company. Read `app_settings` instead.
- **It is worse than one field.** Audited 2026-08-11: **six** `app_settings` columns are stored, editable in Settings, and rendered *nowhere* — `company_name`, `company_address`, `company_phone`, `company_email`, `currency`, `company_logo_url`. The operator fills in the General tab, saves, and nothing anywhere changes. Two consequences: the tenant-identity story is weaker than `MULTI-TENANT-ARCHITECTURE.md` §2 layer 1 assumes, and `currency` being unread is why `AUD` is hardcoded at ~15 sites (Phase B). The sidebar and both auth screens use the static `/assets/Nex-Order-no-bg-logo.png`, not the uploaded logo.
- `VITE_SHOW_DEMO_LOGINS=false` in the Vercel **Production** env, `true` in Preview.
- **Split `constants.ts`** — `App.tsx:8` imports from it, so its seed `USERS` array ships to the browser and `alice@nexorder.com.au` stays in the bundle even with the flag off. On Sydney that account doesn't exist, so click-to-fill would 400 and look broken. Move the seed arrays to `tests/fixtures/`, keep `CATEGORIES`/`UOM_CODES`/`DEFAULT_SETTINGS`/status maps.
- **Rotate all seven seeded passwords on dev.** Turning the flag off stops advertising the credential; it does not invalidate it. `alice@` signed in 2026-07-26 — it is a live admin.
- `index.html:5` points at a non-existent `/vite.svg` — the favicon is broken. Point it at the NexOrder logo.

### A6 · First-run setup checklist

There is no wizard today; a new admin lands on an empty dashboard with no idea of the required order, and the ordering genuinely matters (warehouse → storage forms → layout → publish → products → stock → putaway). Build a dismissible admin-only checklist modelled on `components/inventory/warehouse/WarehouseEmptyState.tsx`, which already deep-links via `?designer=<id>&import=1` (consumed at `components/admin/WarehousesSettingsSection.tsx:36-53`). Steps derive from live counts, so it self-completes: Company details → Warehouse → *(racked only)* Layout published → Products → Opening stock → Users.

### A6.5 · Auth emails — custom SMTP is not optional

**Done 2026-08-11:** the recovery and invite templates moved off
`{{ .ConfirmationURL }}` to `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=…`, so the link a
client clicks reads `nexorder.com.au`, not `<ref>.supabase.co`. They live in
`apply-auth-config.mjs`'s `buildDesired()`, applied and verified idempotent on dev, and
end-to-end verified by a real email and a real browser round trip.

**Still outstanding, discovered by that verification:** Supabase's **built-in** mailer
appends its own footer to every auth email —

```
<a href="https://supabase.com/opt-out/lsgkznyiabqitqfpveey">Opt out of these emails</a>
```

— and sends from `noreply@mail.app.supabase.io`. So on the built-in mailer the project ref is
*still* in the email and the sender is still not the client's, no matter what the template says.
Fixing the template got the link; only **custom SMTP** gets the rest.

**This is a different switch from A7's `RESEND_API_KEY`.** That secret is read by the app's own
`send-email` Edge Function (order confirmations). Supabase Auth does not use it — auth mail is
sent by Supabase, and pointing it at Resend means filling in **Auth → SMTP Settings** on the
project (host `smtp.resend.com`, port 465, user `resend`, password = the same Resend API key,
sender on the verified domain). Both are needed and neither implies the other.

Two further reasons this is not cosmetic: the built-in mailer is **rate-limited** to a handful
of messages per hour, which is not enough to onboard a team; and a client who sees a
`supabase.io` sender on their password reset has reasonable grounds to ask what it is.

Add to Gate C: the recovery email's **sender** is on `nexorder.com.au` and the body contains no
`supabase.co` / `supabase.com` string at all.

### A7 · Email + monitoring

Set `RESEND_API_KEY` (procedure in `docs/runbooks/enable-email.md` — note its five hardcoded refs need updating as you follow it). `EMAIL_FROM` on `nexorder.com.au` once DNS verifies — **leaving it unset falls back to `onboarding@resend.dev`, which Resend delivers only to the account owner, while the response still says `sent: true`**. Set `ALERT_EMAIL`, and point an external monitor (UptimeRobot free) at `GET /functions/v1/health` with SMS escalation — the in-DB health check cannot report a total DB outage.

### A8 · Vercel wiring and switchover

**Revised 2026-08-11.** This section previously specified one Vercel project with `main` →
Production → Sydney and a new `develop` branch → Preview → Singapore. That is replaced by
**one Vercel project per target**, for two reasons:

1. It is what project-per-tenant requires (`MULTI-TENANT-ARCHITECTURE.md`). Vercel env vars are
   per-*environment*, not per-domain, so one project cannot hold two tenants' Supabase
   credentials. Deferring the split to tenant #2 means doing it under time pressure.
2. **It removes this section's own admitted flaw.** The one-project shape meant no preview ever
   exercised production config, so the first execution of production config was the production
   deploy itself. Separate projects make Amadiya's project exercise Amadiya's config on every
   deploy to it.

Both projects build the same `main`, so **`develop` is no longer needed and is not created.**
Each project sets `NEXORDER_ENV` as a build env var (`dev` / `amadiya`); `vite.config.ts` and
`vercel.ts` both read it, so one variable determines Supabase credentials, CSP hosts, the image
rewrite and (later) the module flags.

| | dev/demo project | Amadiya project |
|---|---|---|
| `NEXORDER_ENV` | `dev` | `amadiya` |
| Supabase | Singapore | Sydney |
| Domain | `nexorder.vercel.app` | `nexorder.com.au` + `www` redirect |
| `VITE_SHOW_DEMO_LOGINS` | `true` | `false` |

**`nexorder.vercel.app` is currently the production alias of the existing project.** It stays
exactly where it is — the existing project simply *becomes* the demo project, which is a
rename and an env-var change, not a migration. Amadiya's is the new project. Nothing about the
demo's URL changes, so no bookmark breaks and there is nothing to announce.

`deploy.mjs` must pin the project once there are two: pass `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID`
from `config.vercel.projectId` (the field exists, read by nothing yet), or a bare
`vercel deploy` resolves whichever project `.vercel/project.json` happens to name. Keep the
existing post-alias `GET /functions/v1/health` assertion regardless.

---

## Phase B — before Shian enters real stock (week 2)

Everything here was gated on "real stock" in the email to Peter. Nothing below blocks a supervised walkthrough.

1. **Close the 9 `USING (true)` read policies** — `app_settings`, `horeca_payment_methods`, `horeca_pricing`, `pantry_items`, `product_suppliers`, `product_uoms`, `products`, `promotions`, `suppliers` (`00001:508,532,592,616,822,846,1029`, `00067:153`, `00070:155`). `horeca_payment_methods.details` is free-text banking detail and `horeca_pricing` is contract rates — every customer login can read every other customer's. Reuse the `user_horeca_id()` predicate from `horecas_select_customer` (`00001:565`); expose a customer-safe product view. **Cheapest now, while there is no data to break.** 1–2 days with tests.
2. **GST / tax invoices, prices GST-inclusive.** Add `subtotal`/`tax_rate`/`tax_amount` to `orders` and `invoices`; `abn` + `registered_business_name` to `app_settings` (+ `types.ts`, `lib/adapters.ts`, `mutate-app-settings` zod schema, `GeneralTab`). Render "Tax invoice", the ABN and the GST line in `InvoiceAdmin`, the `orderDocuments` PDFs and the `send-email` templates. Back-compute GST as `total/11` so no catalogue re-pricing is needed. Add `lib/money.ts` sourcing the code from `app_settings.currency`, which is stored and edited but read by nothing — AUD is hardcoded at ~15 sites. **Blocked on Amadiya's ABN.**
3. **Privacy policy, terms, data export/erase.** Zero hits today across the whole repo. Required under the Privacy Act, and a prerequisite for Google OAuth verification later.
4. **Retention crons** — `client_errors` > 90d, `audit_events` > 1y, `po_extraction_audit` > 180d, using the guarded pattern already in `00026:114`. Also an availability fix: unbounded before/after JSONB on every stock movement fills the disk, and a full Postgres disk takes the app down.
5. **Pin `search_path`** on `user_role()` / `user_horeca_id()` (`00001:429,438`) — SECURITY DEFINER, and the basis of *every* RLS policy; the other 53 definer functions all pin it.
6. **Promote CSP to enforcing** once `frame-src` is fixed and a `report-to` endpoint confirms clean.
7. **Restore drill** — do this in Phase A while the DB is empty (Gate E), then write `docs/runbooks/RUNBOOK-restore.md` from what actually happened.

---

## Phase C — release engineering and the deferred surfaces (weeks 3–4)

- **GitHub Pro (~$4/mo)** + require the `typecheck · test · build` check. With `main` deploying straight to a client — and, per §A8, to *every* client at once — red-CI-merges-silently stops being hygiene. Runbook at `~/.claude/plans/add-branch-protection-generic-zebra.md`. Move `npm audit` (`ci.yml:33`) to a non-blocking job first, or an unrelated transitive advisory turns every promotion red.
- **`npm run rollback:<target>`** — re-alias to the previous verified `deployments` row. Frontend only; migrations and Edge Functions have no rollback, which upgrades CLAUDE.md's deploy-order rule (function → frontend → lockdown migration) from advice to a hard rule. Add branch/clean-tree/green-test guards to `deploy.mjs`.
- **Session persistence** (`lib/supabase.ts:47-48`) — `persistSession:false` *and* `autoRefreshToken:false` means the 1-hour token simply expires; warehouse staff get 401s mid-shift. A custom `storage` adapter plus `{ auth: { lock: (_n,_a,fn) => fn() } }` bypasses the Web Locks hang that forced this.
- ~~**`vercel.ts`** replacing `vercel.json`, CSP derived from `VITE_SUPABASE_URL`.~~ **DONE 2026-08-11** — derived from the registry via `NEXORDER_ENV` rather than from `VITE_SUPABASE_URL`, so one variable drives the CSP, the `/storage` image proxy, the Vite dev proxy and (later) the module flags. Pulled forward from Phase C because per-tenant Vercel projects cannot share a static config. Note CI moved to Node 24 with it: `check:csp` imports `vercel.ts`, and type-stripping needs 22.18+ — on Node 20 that step dies with "Unknown file extension .ts". Node 24 also matches the Vercel runtime, which CI had never been aligned with.
- **Sentry** with the commit SHA as release tag (`vite.config.ts:52` already exposes it).
- **E2E in CI against the dev preview**; `test.fixme` the unshipped specs.
- **PO Inbox for production** — register prod Google Cloud + Azure OAuth clients against the Sydney ref (`https://<prodref>.supabase.co/functions/v1/{gmail,outlook}-oauth-callback`); use separate clients from dev so the client's mailbox grants aren't entangled with the demo test-user roster. Add an `OAUTH_CALLBACK_BASE` override to `buildCallbackUri()` now (three lines, honoured in **both** `start-po-oauth:111` and `callbackCommon:224` or the token exchange 400s) so fronting the callback with `nexorder.com.au` — the actual blocker on Google verification — is later a config change, not a code change under pressure. **Never copy `email_accounts` rows between projects**; refresh tokens are encrypted with each project's own key.
- **Fix `approve-po`** (`_shared/poInbox/orderTotals.ts:76-84`) — bills catalogue price, ignores `horeca_pricing` and promotions, and writes no invoice, so those orders bypass credit limits entirely. Must land before Amadiya uses the PO Inbox.
- ~~**Tenancy decision** for client #2 (audit §4).~~ **DECIDED 2026-08-11 — `MULTI-TENANT-ARCHITECTURE.md`.** Project-per-tenant, one Vercel project per tenant, one `main`, module flags for per-tenant surfaces. The `tenant` column stays **read by nothing, permanently**: under project-per-tenant a `WHERE tenant = …` predicate could only be a tautology. The documented trigger for revisiting is in §1 of that document (a tenant too small to cover a dedicated project). What remains here is build work, not decision work — the fleet gaps are listed in §4 of that document, and none blocks Amadiya.

---

## Verification

Gates run in order; each must pass before the next.

**Gate A — infrastructure.** `schema_migrations` row count equals `ls supabase/migrations/*.sql | wc -l` **measured at the time you run it** (105 on 2026-08-11) — the two must be compared, never checked against a number written down here; schema digest matches dev; 9 buckets and `anon_write%` = 0; 71 functions with the right **9** at `verify_jwt=false`; every secret in A3.6 present; 7 cron jobs; `auth:config:check:amadiya` exits 0 with `disable_signup = true`; `GET /functions/v1/health` → 200.

**Tenant assertions, same gate.** `SELECT public.default_tenant()` → `'amadiya'`;
`environment_marker` = exactly one row `('prod','amadiya')`; and the count of `tenant = 'ayam'`
rows summed across all eight tenant tables is **0**. Then create one HoReCa and place one order
through the normal path and confirm both land as `'amadiya'` — the DEFAULT and the trigger are
two separate mechanisms and only the order exercises the trigger.

**Gate B — frontend and isolation.** `nexorder.com.au/version.json` serves the deployed sha. Bundle grep: Sydney URL present; `lsgkznyiabqitqfpveey`, `Password123!` and `alice@nexorder.com.au` all **absent**. `OPTIONS` with `Origin: https://evil.example` returns no ACAO; with `https://nexorder.com.au` echoes it; with `https://nexorder.vercel.app` against a **prod** function is **refused** — that last one is the proof the environments are isolated.

**Gate C — functional round trip** as the bootstrap Admin. Log in / out; forgot-password lands on `nexorder.com.au`. **Invite a second user and complete set-password** — this exercises both the `SUPABASE_ANON_KEY` canary and the A4 fix. Create supplier + product + HoReCa; upload a product image and confirm the stored URL host is the Sydney ref and it renders. `receive-stock` into MAIN; place an order; confirm it appears in a second window without refresh (Realtime); confirm `inventory_balances` decremented. Order-confirmation email arrives and **every link points at `nexorder.com.au`**. Advance status; generate a pick slip and confirm it prints **Amadiya**, not Nex Order.

**Gate D — RLS spot-checks** as a Customer, hitting PostgREST directly with the publishable key. `orders` returns only their own HoReCa. `POST /rest/v1/orders` → 403. `POST /auth/v1/signup` → refused. `horeca_pricing` / `horeca_payment_methods` **will return everything** until Phase B — record the finding, don't let it block Phase A, and don't onboard real customers before it's closed.

**Gate E — recovery drill**, done in Phase A while only the bootstrap admin exists and it is risk-free. **Pro gives daily backups, not PITR** (see A0.3) — so: confirm a daily backup exists and note its timestamp; `DELETE FROM app_settings`; restore that backup; confirm the row returns and the admin can still authenticate (proves the `auth.users` bcrypt hashes survive). Record the actual RPO the drill demonstrates — with daily backups it is up to 24 hours, and that number is what the client is really being offered. Write the runbook from what happened, not from the docs.

Throughout: `npx tsc --noEmit` and `npm test` (2557 tests in 172 files as of 2026-08-11 — it was 1662 when this was written; the count is context, not an assertion) green before any deploy; `node scripts/check-overlays.mjs` for the A4 dialog fix and `node scripts/check-csp.mjs` for the CSP hosts.

---

## Two things a clean project does not fix

Worth stating plainly so they aren't mistaken for solved:

- **Storage URLs are not portable.** Image columns store absolute URLs containing the project ref. If Amadiya's catalogue is ever bootstrapped by exporting from dev, every `image_url` points at the dev project — prod then depends on dev existing forever. Any catalogue import must **re-upload** images.
- **The 9 open read policies travel with the schema.** Migrating to a clean database changes nothing about them.
