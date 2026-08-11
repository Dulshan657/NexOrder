# NexOrder multi-tenancy — the decision record

**Status:** decided, mostly unbuilt · **Written:** 2026-08-11 · **Companion docs:** `PRODUCTION-LAUNCH-PLAN.md`, `PRODUCTION-READINESS-AUDIT.md` §4

This document closes the question `PRODUCTION-LAUNCH-PLAN.md` left open at its Phase C
tenancy bullet — *"whether client #2 is a second project or a read-side filter on this column.
Make it explicit with a documented trigger."*

**Read this first if you are about to:** add a second client, add a per-client feature, wonder
why the `tenant` column is read by nothing, or reach for a branch named after a customer.

---

## 1. The decision

**One Supabase project per tenant. One Vercel project per tenant. One `main`, always.**

Amadiya Agro Products is tenant #1, on its own Sydney project. NexGen's Singapore project is
the demo and stays that way. There is no shared database, and there never was one to migrate
away from — which is the entire reason this was cheap to decide now.

### What was rejected, and why

**Shared database with a `tenant` RLS predicate.** The `tenant` column exists (`00042`,
re-pointed at `default_tenant()` by `00087`) and would have been the seed of it. Rejected on
blast radius: the app currently ships **nine `USING (true)` read policies** (`app_settings`,
`horeca_payment_methods`, `horeca_pricing`, `pantry_items`, `product_suppliers`,
`product_uoms`, `products`, `promotions`, `suppliers`). In a single-tenant database those are a
customer-sees-customer problem, scheduled for Phase B. In a shared database they are a
*client-sees-client* problem — one query returning another distributor's contract rates and
banking details. Closing them is a prerequisite for shared tenancy and merely good hygiene
without it, and the difference between those two risk levels is not worth the hosting saving.

**A per-tenant branch.** Rejected on arithmetic, see §2.

### The consequence, stated plainly

**The `tenant` column is now permanently written and read by nothing.** That was previously a
pending decision; it is now a settled one. Under project-per-tenant there is nothing to filter
— a database contains exactly one tenant, and a `WHERE tenant = …` predicate could only ever
be a tautology. It stays because:

- it is provenance on every row, at zero cost, if a database is ever merged or forensically
  examined;
- `environment_marker.tenant_key` feeds it via `default_tenant()`, and that marker is fixture
  guard #3 — the only guard that survives both a mis-set env file and a mis-edited registry.

Do not delete it, and do not build a read side for it. If you find yourself wanting one, the
answer is that you have taken the shared-database path by accident.

### The trigger for revisiting

Revisit when **a prospective tenant's revenue does not cover a dedicated Supabase project**
(~US$10/mo compute on an existing Pro org, plus the operational cost of another target in the
fleet). At that point the honest options are a pooled project for small tenants — which means
closing the nine read policies first, without exception — or declining the tenant. Write down
which, here, when it happens.

---

## 2. Why there is never a per-tenant branch

The tempting shape is `main` plus a long-lived branch per client, each carrying that client's
features and periodically merged from `main`. It does not survive contact with a second client.

With N tenant branches, every bug fix costs **N merges, N conflict resolutions, N test runs and
N deploys**, and the conflict rate rises over time because the branches keep diverging from the
thing they are merging from. The failure is not that it is laborious; it is that the laboriousness
falls due precisely when you are least able to pay it — during an incident, on the branch you
have touched least recently.

**Everything lives on `main`.** Tenant differences are expressed in this order, and you should
exhaust each before reaching for the next:

1. **`app_settings` data** — company identity, thresholds, currency, auto-approval policy. No
   code, no deploy. Already exists; see §5 for what it can and cannot currently do.
2. **Registry config** — `config/environments.mjs`: hosts, origins, aliases, redirect
   allow-lists, modules. Version-controlled, reviewable, one file.
3. **Module flags** — a whole surface on or off. §3.
4. **A `tenants/<slug>/` overlay directory, on `main`** — genuinely bespoke code that no other
   tenant will ever run, imported through a registry map behind the same build-time flag as a
   module. Still not a branch. Nothing needs this today and it should stay hypothetical until
   something real demands it.

---

## 3. Modules — the vocabulary and the mechanism

### The vocabulary

Core surfaces are **not gateable**: auth, dashboard, products, customers (HoReCa), orders,
users, settings, audit. An ordering system without them is not the product.

Nine optional modules. The list lives in code as `ALL_MODULES` in `config/environments.mjs`;
this table is what each one actually means.

| slug | surfaces | Edge Functions |
|---|---|---|
| `warehouse` | Warehouse (designer/map), Stock, Stocktake, Putaway, Replenishment, Pick Queue, Dispatched, Receive Stock, Documents, and the Warehouse role itself | ~35 — `receive-stock`, `adjust-stock`, `transfer-stock`, `record-pick`, `decide-`/`complete-putaway`, `count-bin`, `mutate-layout`, `publish-layout`, `generate-labels`, `*-replenishment`, `mutate-wie-rule`, `mutate-zone-profile`, `mutate-storage-type`, `mutate-scoring-profile`, `mutate-wms-attributes`, `mutate-product-home-bin`, `mutate-level-role`, `mutate-warehouse`, `mutate-warehouse-location`, `mutate-warehouse-setup-ack`, `recommend-*` |
| `po_inbox` | PO Inbox (queue, aliases, mailboxes) | `start-po-oauth`, `gmail-oauth-callback`, `outlook-oauth-callback`, `poll-inbox`, `extract-po`, `approve-po`, `reject-po`, `create-po-document-url`, `mutate-po-alias`, `pause-`/`disconnect-`/`retry-email-account` |
| `field_sales` | Routes, Visits, Rep Dashboard; the two Sales Rep roles | read-mostly |
| `customer_portal` | HoReCa logins, Shop, Pantry, customer Order History; the Customer role | `mutate-pantry-item`, the customer path of `place-order` |
| `purchasing` | Suppliers, multi-supplier products | `mutate-supplier`, `mutate-purchase-order` |
| `invoicing` | Invoicing, credit limits, accounts aging | `mutate-invoice-status` |
| `promotions` | Promotions, bundles | `mutate-promotion` |
| `analytics` | performance panels, sales targets, semantic layer | `mutate-sales-target`, `embed-products` |
| `email` | outbound transactional mail | `send-email` |

### The mechanism — three layers

**Layer A · Frontend, build time.** `vite.config.ts` imports the registry, resolves the target
from `NEXORDER_ENV` (one build-env var per Vercel project — already an accepted target source,
`scripts/lib/env.mjs`), and `define`s **one boolean constant per module**:
`__MODULE_WAREHOUSE__`, `__MODULE_PO_INBOX__`, … `lib/modules.ts` wraps them.

> **One boolean per module, never an array.** `MODULES.includes('warehouse')` is a runtime
> method call: Vite's `define` will substitute the array literal, but no bundler can fold the
> call, so the branch survives and every byte of WIE ships to a tenant who did not buy it. A
> bare `__MODULE_WAREHOUSE__` substituted to `false` folds the branch and drops the lazy chunk.
> This is the difference between *hidden* and *not shipped*, and it is the one detail here that
> is easy to get wrong and invisible when you do.

Gates go in two places, and both are required:
- `components/AppShell.tsx` — the nav.
- `lib/adminTabUrl.ts` — `adminTabFromSearch` already role-validates `?tab=`; a disabled
  module's tab must be rejected by exactly the same path. Skipping this is how a deep link
  renders a blank page, which is the existing failure mode that validation was added to stop.

**Layer B · Server, runtime.** An `ENABLED_MODULES` Edge Function secret, comma-separated,
written from the same registry entry. `_shared/modules.ts` exports `requireModule(slug)`,
called beside `requireAuth` at the top of each gated function.

> **Unset must mean all-modules-enabled — fail OPEN.** This is deliberate and it is the
> opposite of the rule for `ALLOWED_ORIGINS`. A fail-closed module gate deployed before its
> secret is set would disable the entire application, and it would do so *gradually*: secrets
> are read once per isolate at module load, so warm isolates keep serving while cold ones
> refuse, which is exactly the shape of the 2026-07-29 CORS incident that read as a client bug
> for a day. A module gate is a **commercial** control. The **security** controls are roles and
> RLS, and nothing here changes them: a tenant with `warehouse` disabled who calls
> `receive-stock` directly is still stopped by `requireAuth`.

**Layer C · Data.** Nothing. **Every tenant runs every migration.** Disabling a module never
drops a table, never skips a migration, never branches the schema. This is what keeps
`schema_migrations` comparable across the fleet — the Gate A schema-digest diff is only
meaningful if every project is supposed to be identical — and it makes enabling a module later
a config change rather than a data migration against a live client.

### Build order, when it is built

Layer A and Layer B must ship in the order the deploy rules already require: **Edge Function
first, frontend second.** A frontend that hides a module while the function still serves it is
harmless; a function that refuses a module the frontend still shows is a broken client.

---

## 4. Operating the fleet

Adding a tenant is a registry entry plus a scripted fan-out. The `--env=<target>` contract
already generalises — that is what `PRODUCTION-LAUNCH-PLAN.md` §A1 bought, a release early.

### Stays manual, on purpose

Creating the Supabase project (its **region cannot be changed later**), DNS, domain
verification, and OAuth client registration with Google/Azure. These are irreversible or
involve a third party's console; an unattended provisioner's failure mode here is a project in
the wrong region with a client's data in it.

### Scripted

`migrate` · `fn:deploy` · `secrets` · `auth:config` · `deploy`, each `--env=<target>`.

### What still needs building before tenant #2

Small, named, and none of it urgent while there is one tenant:

- **`deploy.mjs` must pin the Vercel project.** It runs a bare `vercel deploy`, which resolves
  the project from `.vercel/project.json` — a single pinned id. Pass
  `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID` in the child env from `config.vercel.projectId`
  (the field exists and is read by nothing yet). **This is the one hard blocker** to
  project-per-tenant on the Vercel side.
- **`<cmd>:all` fan-out scripts** — iterate the registry, report a per-target table, exit
  non-zero if any target failed. Never let a partial fleet update report success.
- **`supabase/ops/secrets.mjs`** — the required/optional secret name lists plus `--check`, still
  outstanding from launch-plan §A3.6, and the natural home for `ENABLED_MODULES`.

Already done, and worth knowing why:

- **`fixtureTargets()`** — guard #1's allow-list is derived from `allowFixtures` rather than
  hardcoded to `['dev']`, so a tenant can never become a fixture target by omission.
  Guard #3 still compares against the **literal** `'dev'` and reads nothing from the registry;
  deriving it would collapse three independent guards into two.
- **`tenantTargets()`** — `playwright.config.ts` and `__tests__/support/loadEnv.ts` fail closed
  against *every* tenant. They previously named the single `prod` entry, which would have gone
  on protecting only the first client after a second was added, with nothing anywhere saying so.
- **`markerName`** — `environment_marker.name` is constrained by migration `00086` to
  `CHECK (name IN ('dev','prod'))`, and `00086` is applied and checksummed, so the *database's*
  vocabulary is frozen at two values while target names are open-ended. `migrate.mjs --stamp`
  writes `config.markerName`, not `config.name`. Stamping the target name would have failed the
  CHECK on the first production run and nowhere earlier.

### Never copied between tenants

- **`PO_ENCRYPTION_KEY`** — generate a fresh one per project. Mailbox refresh tokens are
  encrypted with it and it cannot be rotated without re-consenting every mailbox.
- **`email_accounts` rows** — same reason. Encrypted with the source project's key; they will
  decrypt to garbage.
- **Storage URLs** — stored absolute, containing the project ref. A catalogue bootstrapped by
  export from another project leaves every `image_url` pointing at that project forever. Any
  catalogue import must **re-upload** images.
- **OAuth clients** — separate Google/Azure clients per tenant, so a client's mailbox grants are
  not entangled with the demo's test-user roster.

---

## 5. Known gaps this design assumes will be closed

Not blockers, but the design reads better than the code does until these land:

- **Six `app_settings` fields are written and rendered nowhere** — `companyName`,
  `companyAddress`, `companyPhone`, `companyEmail`, `currency`, `companyLogoUrl`. Layer 1 of §2
  ("express it as data") is therefore weaker than it looks. `_shared/orderDocuments.ts`
  hardcodes `companyName: 'Nex Order'` onto every pick slip and dispatch advice. Tracked in
  launch-plan §A5.
- **`AUD` is hardcoded at ~15 sites** while `app_settings.currency` is stored and edited. A
  tenant outside Australia is a code change today. Tracked in launch-plan Phase B.
- **The nine `USING (true)` read policies.** Harmless-ish per-tenant, disqualifying for shared
  tenancy. See §1.
- **`00042` does not cover `locations` / `warehouse_layouts`.** Irrelevant under
  project-per-tenant; it would matter immediately under a shared database.
