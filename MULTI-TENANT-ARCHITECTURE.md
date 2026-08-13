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

Amadiya Agro Products is tenant #1. There is no shared database, and there never was one to
migrate away from — which is the entire reason this was cheap to decide now.

> **Correction, 2026-08-12.** This section used to say "on its own Sydney project. NexGen's
> Singapore project is the demo and stays that way." Both halves turned out to be wrong. The
> existing project was already in `ap-southeast-2` (the registry's `ap-southeast-1` was simply
> incorrect), so there was no latency argument for a second one, and Amadiya's warehouse was
> already drawn in it. It **became** Amadiya's production database: the demo was exported to
> disk and deleted (`supabase/ops/purge-demo.mjs`), and the demo is rebuilt later on a separate
> Supabase + Vercel account. The decision above is unchanged — one project per tenant — but the
> fleet currently has **one project and no demo**, and therefore no environment to rehearse a
> migration in. Standing that back up is the outstanding cost.

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

**THREE optional modules, and they are the three group headings the sidebar already
draws.** BUILT 2026-08-13; this section described nine finer slugs, unimplemented, until
then. The list lives in code as `ALL_MODULES` in `config/environments.mjs`; the
function-by-function assignment is `config/moduleOwnership.mjs`.

| slug | surfaces | Edge Functions |
|---|---|---|
| `sales_orders` | Shop, Order Import, PO Inbox, Accounts, Promotions; customer Order History and Pantry | 16 — `place-order`, `update-order-status`, `mutate-promotion`, `mutate-invoice-status`, `mutate-purchase-order`, `mutate-pantry-item`, and the PO-Inbox set (`approve-`/`reject-po`, `extract-po`, `poll-inbox`, `mutate-po-alias`, `start-po-oauth`, `create-po-document-url`, `pause-`/`disconnect-`/`retry-email-account`) |
| `field_ops` | HoReCa Insights, Scheduled Visits, Walk-in Review | 1 — `mutate-sales-target`. Thin because these surfaces are RLS-scoped table access; the frontend gate is the whole gate, and it is no weaker for it |
| `inventory_dispatch` | Stock, Receive Stock, Putaway, Replenishment, Stocktake, Pick Queue, Dispatched, Documents, Warehouse; **and the Warehouse role itself** | 40 — the warehouse programme end to end |

> **Why three and not nine.** The nine (`warehouse`, `po_inbox`, `field_sales`,
> `customer_portal`, `purchasing`, `invoicing`, `promotions`, `analytics`, `email`) were
> finer than the product is actually sold. `po_inbox` without ordering has nowhere to put an
> approved PO; `analytics` without the surface it reports on draws empty charts. Splitting a
> module later is easy; un-splitting one a tenant has already bought is not. Three also means
> the gate is something an operator can point at on screen, which is what makes it reviewable.

**Two surfaces sit under a module's heading and are CORE anyway**, and both are load-bearing:
`Products` is drawn under "Inventory & Dispatch" but Sales & Orders reads its prices, and
`HoReCa` is drawn under "Field Ops" but is where orders come from at all. Grouping is a UI
fact; licensing is a commercial one. `HoReCa Insights` — the analytics on top of the customer
list — *is* Field Ops. See `TAB_MODULES` in `lib/adminTabUrl.ts`.

**A module that empties a role must also withhold the role.** With `inventory_dispatch` off
the Warehouse role has no nav, no landing view and nothing to render, so
`lib/assignableRoles.ts` removes it from the invite form — otherwise an admin creates an
account that logs in successfully to a blank page, with no error anywhere to explain it. The
Field Sales Rep is deliberately NOT withheld when `field_ops` is off: they keep the Shop,
Order Import, Accounts and the customer list. Only remove a role when the module takes away
everything it could do.

### The mechanism — three layers

**Layer A · Frontend, build time.** `vite.config.ts` imports the registry, resolves the target
from `NEXORDER_ENV` (one build-env var per Vercel project — already an accepted target source,
`scripts/lib/env.mjs`), and `define`s **one boolean constant per module**:
`__MODULE_SALES_ORDERS__`, `__MODULE_FIELD_OPS__`, `__MODULE_INVENTORY_DISPATCH__`.
`lib/modules.ts` wraps them and is the only file that should read them raw.

> **One boolean per module, never an array.** `MODULES.includes('warehouse')` is a runtime
> method call: Vite's `define` will substitute the array literal, but no bundler can fold the
> call, so the branch survives and every byte of WIE ships to a tenant who did not buy it. A
> bare `__MODULE_INVENTORY_DISPATCH__` substituted to `false` folds the branch and drops the
> lazy chunk. This is the difference between *hidden* and *not shipped*, and it is the one
> detail here that is easy to get wrong and invisible when you do.

Gates go in **four** places. The first two were in the original design; the last two were
found by building with a module off and grepping the output, which is the only check that can
tell "not rendered" from "not shipped":

- `components/AppShell.tsx` — the nav.
- `lib/adminTabUrl.ts` — `adminTabFromSearch` already role-validates `?tab=`; a disabled
  module's tab must be rejected by exactly the same path. Skipping this is how a deep link
  renders a blank page, which is the existing failure mode that validation was added to stop.
- **The `lazyWithRetry(() => import(...))` DECLARATIONS**, in `AdminView.tsx` *and*
  `AppShell.tsx`. A JSX gate stops the view rendering, but the `import()` runs at module scope
  and Rollup still emits the chunk. `const X = MODULE_Y ? lazyWithRetry(...) : null` puts it
  in a branch that folds away.
- **Both files, for anything either can reach.** `StockView` and `ReceiveStockView` are
  declared in AppShell *and* AdminView; gating one left the chunk alive through the other.
  That is exactly how `putawayService` survived the first attempt.

> **Verify by building, not by reading.** `NEXORDER_ENV=dev npm run build` with a module
> removed from its registry entry, then grep `dist/` for that module's symbols
> (`PutawayQueuePage`, `WarehouseCanvas`, `decide-putaway`, …). Measured on the first pass:
> 95 assets / 3044 kB with all three on, 47 assets / 2574 kB with only `sales_orders`.
> Tab-name strings like `'Putaway'` legitimately remain — they live in the core `AdminTab`
> union — so grep for code symbols, not for labels.

**Layer B · Server, runtime.** An `ENABLED_MODULES` Edge Function secret, comma-separated,
derived from the same registry entry by `supabase/ops/secrets.mjs` and re-applied on every run
alongside `ALLOWED_ORIGINS`/`APP_URL` — drift between the registry and the project IS the bug.
`_shared/modules.ts` exports `requireModule(slug)`, called beside `requireAuth` at the top of
each of the 57 owned functions.

Two details worth knowing before touching it:

- **`supabase/functions` is type-checked by nothing** (excluded from `tsc`, nothing imports it,
  and `functions deploy` without Docker only uploads). `__tests__/moduleOwnership.test.ts`
  therefore parses every owned function with the TypeScript compiler and asserts the gate is
  imported, correctly spelled, and **inside a try block** — `requireModule` throws, and outside
  a try that is an unhandled 500 rather than a 403.
- **`poll-inbox` is the one exception and uses `isModuleEnabled` instead.** It is a cron with
  no try/catch that composes raw Responses, and it fires every minute whether or not the tenant
  bought PO Inbox — a 403 a minute is a log full of errors describing a deployment working as
  configured. It returns `{ ok: true, skipped: 'module_disabled' }`, *after* the cron-token
  gate so an unauthenticated caller learns nothing about which modules exist.

**`supabase/ops/deploy-functions.mjs` also refuses to deploy a disabled module's functions at
all**, which gives the server the same "absent, not merely refusing" property the frontend has.
It will not *retire* one already deployed to a project whose module was later switched off —
deleting a live function is not a decision a deploy script should take — so it reports that
case with the command to run.

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

- ~~**`deploy.mjs` must pin the Vercel project.**~~ **Done 2026-08-12.** Both
  `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` ride in the `vercel` child env from the registry;
  `orgId` is a new field, because `projectId` alone does not resolve. Amadiya's `projectId` is
  still null until its Vercel project exists, and `deploy.mjs` warns loudly on that path rather
  than silently falling back to `.vercel/project.json`.
- **`<cmd>:all` fan-out scripts** — iterate the registry, report a per-target table, exit
  non-zero if any target failed. Never let a partial fleet update report success.
- ~~**`supabase/ops/secrets.mjs`**~~ **Done 2026-08-12**, with `--check` as a Gate A assertion,
  and still the natural home for `ENABLED_MODULES`. Note the design choice: `ALLOWED_ORIGINS`,
  `APP_URL` and `PO_OAUTH_APP_BASE` are **derived from the registry and re-applied every run**,
  not read from an env file — each has already caused a silent-and-successful outage by being
  wrong for the target it was set on. `schedule-crons.mjs` and `bootstrap-admin.mjs` shipped
  alongside it, plus `scripts/lib/tenantGuard.mjs` (the inverse of `fixtureGuard`: registry says
  tenant, marker agrees, `--confirm=<projectRef>` typed out).

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

- ~~**Six `app_settings` fields are written and rendered nowhere.**~~ **Four of six now read**
  (2026-08-12): `_shared/companyIdentity.ts` loads them and the pick slip / dispatch advice
  header renders name, address, phone·email and the logo. There is deliberately **no fallback
  to 'Nex Order'** — a blank header is noticed, a confidently wrong one is not. `currency` is
  still unread (it rides with the GST work). `companyLogoUrl` renders only as PNG or JPEG:
  pdf-lib supports no others, and the logo upload does not compress, so an SVG is skipped and
  the header goes text-only. Layer 1 of §2 now does what it claims.
- **`AUD` is hardcoded at ~15 sites** while `app_settings.currency` is stored and edited. A
  tenant outside Australia is a code change today. Tracked in launch-plan Phase B.
- ~~**The nine `USING (true)` read policies.**~~ **Eight closed** by `00105` (2026-08-12),
  keyed on a new `public.user_is_staff()`. The ninth, `app_settings`, is a singleton and cannot
  be fixed with a row predicate — closing it means splitting the internal thresholds into their
  own table. So the §1 prerequisite for shared tenancy is *nearly* met; that one table would
  still leak an operator's own config across tenants in a pooled database, and would have to be
  dealt with before pooling anyone.
- **`00042` does not cover `locations` / `warehouse_layouts`.** Irrelevant under
  project-per-tenant; it would matter immediately under a shared database.
