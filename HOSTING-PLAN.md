# NexOrder hosting: platform options, costed

## Context

Started as "is DigitalOcean a good idea?" and sharpened through discussion into: **one managed platform for frontend and backend, cheap, AU-resident, "like AWS but not AWS."** Constraints as stated:

1. **Billing / admin simplicity** — one invoice, one vendor, one console.
2. **AU data residency + latency.**
3. **Self-hosted Postgres is a dealbreaker** — managed stays managed.
4. Appetite: **exploring only, nothing gets touched yet.**

### Three findings that reframe the question

**1. You are already on AWS.** Supabase Cloud runs on AWS — that's why its regions are named `ap-southeast-1` / `ap-southeast-2`. Vercel runs on AWS too. "Not AWS" as a hardware goal is already lost. What's achievable is **one managed console**, which is a different and cheaper goal.

**2. The AU-residency driver is probably unmet today — and it has nothing to do with hosting.** TCP connect RTT measured from the dev machine: Sydney S3 **124 ms** · Singapore S3 **215 ms** · us-east-1 S3 **332 ms** · `lsgkznyiabqitqfpveey.supabase.co` **203 ms**. The project tracks Singapore. **Confirm in Studio → Settings → General → Region.** If confirmed, customer data sits in `ap-southeast-1` and every API call pays ~80 ms of avoidable latency — fixable by moving the Supabase project to `ap-southeast-2`, whoever serves the frontend. Static assets come off a global CDN either way; only Postgres's location matters.

**3. Every "one console" option costs the same thing: a rewrite.** The backend is seven coupled Supabase services — Postgres (73 migrations, RLS, plpgsql like `inv_apply_leg` / `wie_publish_layout_tx`), **GoTrue auth whose JWT claims every RLS policy depends on**, PostgREST, 58 Deno Edge Functions, Realtime WebSockets, Storage (`_shared/orderDocuments.ts`, product images), `pg_cron` in 6 migrations. AWS-like clouds sell managed *Postgres* and managed *compute*. **None of them sells auth-wired-to-RLS, an auto-generated data API, or Realtime.** Leaving Supabase means rebuilding those three — weeks, not days, on a live commercial system.

---

## The five options

Cost as **today** (Vercel Hobby + Supabase Free) / **ToS-clean** (Vercel Pro $20 — Hobby is licensed non-commercial and NexOrder is commercial B2B — plus Supabase Pro $25).

### ⭐ 1. Supabase *is* your managed cloud — move the DB to Sydney, put the bill under Vercel — **RECOMMENDED**

Supabase is a **Vercel Native** Marketplace integration: provisioned as a Vercel Storage resource, env vars auto-synced, and *"handle your invoices via Vercel instead of Supabase."* One invoice, one console. Separately, move the project to `ap-southeast-2`.

| | |
|---|---|
| **Cost** | **$0 today** / $45 ToS-clean |
| **Rewrite** | **None** |
| **Pros** | The only option that serves both drivers without a rewrite — billing consolidation is an account change, not an infra move. Everything stays managed. Keeps the CSP/HSTS headers, PR previews, and the deploy-verify tooling in `scripts/deploy.mjs`. Lowest risk by a wide margin, and reversible. |
| **Cons** | Two products under one bill — "one platform" only in the sense you named. The region move is real work: new project ref, dump/restore, every hard-coded `lsgkznyiabqitqfpveey` reference (incl. the CSP in `vercel.json`), re-register the Gmail/Outlook OAuth callbacks, regenerate keys. Confirm the Marketplace integration adopts an *existing* project — the docs don't say. |

### 2. DigitalOcean, Sydney (SYD1) — "AWS but simple"

App Platform static site + Managed Postgres + Spaces. The closest thing to the original instinct.

| | |
|---|---|
| **Cost** | **~$25–35/mo** (Managed PG $15.15 entry: 1 GiB/1 vCPU; Spaces $5; static free) |
| **Rewrite** | Auth + data API + Realtime + 58 functions |
| **Pros** | Genuinely one console, one bill, Sydney region. Far simpler and cheaper than the hyperscalers; predictable flat pricing. |
| **Cons** | DO sells a database and a container — **no auth product, no realtime, no PostgREST**. You rebuild all three. Entry Postgres is 1 GiB with no HA at that tier. Static sites **cannot set custom response headers**, so the CSP/HSTS config in `vercel.json` is lost ([documented gap](https://ideas.digitalocean.com/app-platform/p/static-site-headers-and-routing)). No PR previews. |

### 3. Google Cloud, `australia-southeast1` (Sydney) — the closest true AWS-equivalent

Cloud Run (Deno containers) + Cloud SQL Postgres + Firebase Auth + Cloud Storage + Cloud Scheduler.

| | |
|---|---|
| **Cost** | **~$50–100/mo**, usage-dependent |
| **Rewrite** | Auth + data API + Realtime + 58 functions |
| **Pros** | Full hyperscaler catalogue without being AWS. Sydney region. Cloud Run runs the Deno functions as containers with minimal change. Scales indefinitely. |
| **Cons** | Firebase Auth's token model isn't GoTrue's, so **every RLS policy keyed on JWT claims gets rewritten** — the single largest chunk of work. Still no PostgREST or Realtime equivalent (AppSync-style pubsub must be built). Usage-based billing is hard to forecast. Most complex console of the three. |

### 4. Azure, Australia East — same shape, enterprise flavour

Postgres Flexible Server + App Service/Container Apps + Entra External ID + Blob Storage.

| | |
|---|---|
| **Cost** | **~$40–90/mo** (Burstable B1ms Postgres is the cheap entry) |
| **Rewrite** | Auth + data API + Realtime + 58 functions |
| **Pros** | Sydney region, one bill, strongest compliance/procurement story if you ever sell to enterprise or government. Burstable Postgres tiers are cheaper than GCP's entry. |
| **Cons** | Identical rewrite to option 3, with the least pleasant developer experience of the three. Only worth it if a customer contract demands Azure. |

### 5. Nhost / Appwrite — replace Supabase wholesale

The only category that swaps the *whole* backend rather than assembling one from parts.

| | |
|---|---|
| **Cost** | **~$25–60/mo** |
| **Rewrite** | Every query in the app |
| **Pros** | Preserves the "one backend platform" model — Postgres + auth + storage + functions + realtime in a single managed product. Nhost is Postgres-native. |
| **Cons** | [Nhost is GraphQL-first via Hasura](https://encore.dev/articles/supabase-alternatives) — every `services/supabase/*.ts` call and TanStack Query hook is rewritten. Appwrite's lineage is MariaDB, so the Postgres schema doesn't port at all. **Neither confirms an Australian region**, so this fails driver 2 outright. Both are much smaller companies than Supabase — worse on the lock-in axis, not better. |

### Summary

| | $/mo | Rewrite | AU region | One bill |
|---|---|---|---|---|
| **⭐ 1. Supabase + Vercel (Sydney, one bill)** | **$0–45** | **none** | ✅ after move | ✅ |
| 2. DigitalOcean Sydney | $25–35 | auth + API + realtime + 58 fns | ✅ | ✅ |
| 3. GCP Sydney | $50–100 | same | ✅ | ✅ |
| 4. Azure Australia East | $40–90 | same | ✅ | ✅ |
| 5. Nhost / Appwrite | $25–60 | every query | ❌ | ✅ |

**Nothing on this list is cheaper than what is paid today.** Options 2–5 buy one console at the price of a multi-week rewrite of the auth/RLS coupling the entire permission model rests on — for an app that already works. Option 1 buys the same billing simplicity for an afternoon of account admin.

---

## Recommendation

**Option 1**, sequenced so each step stands alone and nothing is wasted:

1. **Confirm the Supabase region** — Studio → Settings → General. Five minutes, and it decides whether step 3 is needed at all. *Do this first.*
2. **Consolidate billing** via the Vercel Marketplace Supabase integration; check whether it adopts the existing project or only provisions new ones. Solves driver 1 alone.
3. **If the region isn't `ap-southeast-2`, plan the project move** as separate work. Solves driver 2. Bundle the domain purchase here — the OAuth callbacks must be re-registered anyway, and an owned domain also clears the blocked Gmail verification.
4. **Revisit the platform question only if the app outgrows Supabase** — at meaningful scale, option 2 or 3 becomes worth the rewrite. Today it isn't.

## Verification

Nothing to execute yet — this is a decision document. When a direction is chosen:

- **Region check (do now):** Studio → Settings → General → Region; cross-check against the RTT figures above.
- **Billing consolidation:** confirm a single invoice appears under Vercel and the app still loads with `VITE_SUPABASE_URL` / anon key resolving.
- **If the region moves:** replay all 73 migrations into the new project; log in as an existing seeded user to prove `auth.users` bcrypt hashes transferred; verify Storage objects **and** the public URLs stored in DB columns (mig `00024`); recreate the 6 `pg_cron` jobs; then the end-to-end pass — log in, place an order, confirm the order list updates via Realtime, upload a product image, connect a mailbox in PO Inbox.
- `npx tsc --noEmit` and `npm test` (1408 tests) green before any deploy.
