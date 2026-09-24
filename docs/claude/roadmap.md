# Roadmap — pending work and recently shipped

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**

## Pending Work

Ordered by impact; one-line scope each so future agents don't drift.

**High**
0. **Make Amadiya usable.** The infrastructure is finished: `rel-2026-08-20`
   (`e2afb8e`) is live on nexorder.com.au running
   `['sales_orders', 'inventory_dispatch']` — warehouse management plus orders
   keyed in by their own office — with 57 functions deployed, the **19 belonging
   to disabled modules deleted** from the project, `po-poll-inbox` unscheduled
   (6 crons, not 7), `check:grants` and `check:storage` clean, and the Vercel
   project moved to the `nexgen14` team. **What is missing is the data**: 0
   products, 0 customers, and one Admin login with no Warehouse staff. Import
   the converted catalogue from `Amadiya/`, invite staff, put Amadiya's
   phone/email/logo into `app_settings`, confirm `bootstrap:admin:amadiya` for
   `info@amadiya.com.au`, then Gates C and E — full sequence in
   `PRODUCTION-LAUNCH-PLAN.md` Phase 3.
   The demo half is done and needs nothing: `uqvekvavkjjurpqtovbq` + the
   `nexgen13` Vercel team, live on nexorder.vercel.app, isolation verified in
   both directions (each project's Edge Functions return an ACAO header for
   their own origin and **none** for the other's).
1. **Branch protection** — CI's `verify` job runs on every PR but `main` doesn't yet *require* it. **Blocked by plan tier (2026-05-21):** GitHub's Free plan disallows branch protection *and* rulesets on **private** repos — both `PUT …/branches/main/protection` and `POST …/rulesets` return `403 "Upgrade to GitHub Pro or make this repository public"`. To unblock, either upgrade to **GitHub Pro** (~$4/mo) or make the repo public, then require the status-check context **`typecheck · test · build`** (= the `verify` job's `name:` in `ci.yml`) via Settings → Branches or the API. Ready-to-run payload + commands saved in `~/.claude/plans/add-branch-protection-generic-zebra.md`.
2. **Email setup (operator)** — `send-email` is live, gated and rate-limited; it is dormant only because `RESEND_API_KEY` is unset, and setting that one secret is the entire switch (no redeploy). Full procedure, test call, response table and rollback: **`docs/runbooks/enable-email.md`**. The trap worth knowing up front: leaving `EMAIL_FROM` unset falls back to `onboarding@resend.dev`, which Resend delivers *only* to the account owner — so customers get nothing while the response still says `sent: true`.

**Medium**
3. **Desktop entry point for a stocktake** — `count-bin` and the Stocktake page ship phone-first (scan a bin, count it). The office-side case — reconciling against a paper count, or correcting one bin noticed while looking at the map — still has only `AdjustStockModal`. Scope it as a "Count this bin" action on `BinDetailPanel` (`components/inventory/warehouse/BinDetailPanel.tsx`) and on the Stock page, opening the same `CountSheet` in a `<Modal>`. No server work: `count-bin` already takes any location.
4. **Accessibility: finish the form-label tail.** The programme landed 2026-08-28 — see "Accessibility, and the public surface" above for the three enforced tiers, the measured contrast table and the two disclosed exceptions. Everything in the old version of this item is done: the icon-only buttons, the sort headers, the toast live region, the focus rings, the landmarks, the skip link. **What remains is ~242 raw `<input>`/`<textarea>` with no programmatic label across ~80 files**, frozen in `eslint-suppressions.json` at a count that can only fall. Burn it down per-PR: prefer `components/ui/Field`, which now wires `aria-labelledby`/`aria-describedby`/`aria-invalid` for free, then `npm run lint:prune`. The other two open items are the severity badge palette (all three colours fail, so it is a palette decision) and rotating the seven seeded demo passwords.
5. **Email expansion** — wire `invoice_issued` template on invoice → `issued`; decide whether to use the custom `user_invitation` template vs Supabase's built-in invite email.
6. **Test coverage expansion** — strong PO-inbox, pricing, scan, auth-link and WIE-engine coverage; PO-inbox matching resolvers use the `__tests__/support/fakeSupabase.ts` harness. Gaps: cart submission flow, pantry add/remove, HoReCa reason-prompt gate, role-based routing.
7. **ERP / accounting export — approved orders parked for pickup** (flagged 2026-09-24, not yet needed). Today an approved PO becomes a NexOrder order and stops there: there is no file drop, feed or webhook an ERP/accounting system collects from (MYOB appears only in a comment in `00037`; the only export is the manual orders CSV in `components/OrderHistory.tsx`). The prospect demo video (`scripts/demo-video/`) **mocks** this stage with a recording-only "Order Import Queue" page (`erp-mock.html`, injected via `page.route`, never shipped) — so anything a prospect saw there is a promise, not a feature. Scope when it is wanted: a per-tenant export format (CSV/JSON first; Xero/MYOB/QuickBooks connectors later), written on approval (manual and `auto`) to a parked location with a picked-up/acknowledged status, idempotent per order.

**Lower**
8. **Dead code sweep** — the original three-item list was two-thirds wrong; this is what's actually left. `components/SalesDashboard.tsx` and the root `CustomerForm.tsx` stub were deleted 2026-07-31 after a one-off `npx knip` run confirmed both (knip is *not* a dependency — write a throwaway `knip.json` at the repo root, run it, delete it). **`hooks/useLocalStorage.ts` is LIVE — do not delete it.** It is imported by `components/ActionItemsBoard.tsx:4,423`, which is mounted on both `AdminDashboard` and `RepDashboardV2`; the "zero imports" claim predates that board and has already survived one correction attempt (`PRODUCTION-READINESS-AUDIT.md:318`). **`constants.ts` is done** — commit `f631198` moved the demo seed data to `supabase/seedData/`; the file is 85 lines and all 9 exports are live, and "move to `supabase/seed.ts`" would *duplicate*, not move, since `supabase/seed.ts:16` already imports `USERS`/`DEFAULT_SETTINGS` **from** it. ~~The one real residue is bundle hygiene: `USERS` reaches the browser via `App.tsx:8`.~~ **Fixed in the cutover** — `USERS` moved to `supabase/seedData/users.ts` (beside the seed data that needs it; the launch plan suggested `tests/fixtures/`, but `supabase/seedData/orders.ts` consumes it and a `supabase/ → tests/` import is the wrong direction). Verified by building and grepping: `alice@nexorder.com.au`, `Password123!` and the demo customer domains are all absent — **but only with `VITE_SHOW_DEMO_LOGINS=false` as well**, because `LoginPage.tsx` carries its own `DEMO_ACCOUNTS` copy. The move and the flag each remove a different one; neither is sufficient alone. **`components/Header.tsx` is DELETED** (2026-08-28): 45 lines, zero imports repo-wide, and it referenced `i.pravatar.cc`, which is not in the CSP's `img-src`. Note also that the `VITE_SHOW_DEMO_LOGINS=false` caveat above is obsolete — the flag is gone and the roster is derived from the target registry. Still-unswept candidates knip flagged, each needing its own check: `components/{HoReCaAdmin,InvoiceAdmin,RoleSelector,UserSelector}.tsx`, `components/dashboard/AlertBanner.tsx`, `components/performance/{ProductMovementSection,TargetProjectionCard,VelocityBar}.tsx`, `hooks/{usePromotionStatus,useScheduledVisitLifecycle}.ts`, `hooks/queries/usePurchaseOrders.ts`, `services/supabase/purchaseOrderService.ts` (the last two are likely fallout from removing the manual Purchase Orders view).
9. **Inventory automation** — restock alerts are read-only. Add "generate PO from low-stock alerts", soft stock reservations on order confirmation, expiry/FIFO for perishables.
10. **Reports export** — add CSV/PDF download on accounts-aging, sales-by-rep, stock-status, promotion-ROI panels (CSV helper exists at `lib/csvExport.ts`).
11. **i18n** — UI is English-only; currency hardcoded `AUD`. Wire `react-i18next` before strings calcify if non-English markets are in scope.
12. **PWA** — no manifest/service worker. Low priority for B2B (reps online); install-to-home-screen would help field reps.

## Recently shipped

git history is the changelog. Only the items below carry something the sections above don't.

- **The demo rebuild (2026-08-13) left four things worth knowing.** (1) A new
  Vercel project ships with `ssoProtection: 'all_except_custom_domains'`, so a
  `*.vercel.app` alias 302s to `vercel.com/sso-api` — `deploy.mjs` then reports
  `TIMEOUT` on `version.json` while the build is perfectly fine, because the
  poller is parsing an SSO redirect page as JSON. Clear it via
  `PATCH /v9/projects/<id> {"ssoProtection":null}`. (2) The Vercel CLI's global
  login is still Amadiya's account; `deploy:dev` works only because
  `VERCEL_TOKEN` rides in `.env.dev.local`. Do not run `vercel login` to "fix"
  anything — it would swap the account under `deploy:amadiya`, which has no
  token. (3) `npm run auth:config:dev` cannot manage email templates on a free
  project, and the PATCH is all-or-nothing, so `authEmailTemplates: false` in
  the registry is what stops four cosmetic keys taking `disable_signup` and
  `password_min_length` down with them. (4) Demo email works but has **no
  `EMAIL_FROM`**, so Resend delivers only to the account owner — deliberate on
  a demo, and a trap to remember before demoing an emailed order confirmation.

- **`00083` (order allocation prefers the pick zone) is APPLIED as of 2026-07-27.** Its gate — one replenishment task driven `suggested → assigned → accepted` with the stock actually moving — was satisfied on WIE-DEMO first; `supabase/exercise-replen-gate.mjs` reproduces it and re-runs idempotently. All four of the header's verify steps were run against prod (one overload; pick zone wins on an expiry tie; **FEFO still beats the preference**; a bulk warehouse's ordering is provably unchanged — 0 of its 7 candidate locations carry a `level_role`, so the new CASE has exactly 1 distinct value). Rollback is `00075`'s body.
- **`00085` fixes a real bug that gate exercise uncovered.** `wie_convert_rack_to_levels_tx` (mig `00072`) moves a flat bin's stock onto L1 when it is first levelled, but it predates handling units (`00075`) and never passed `p_handling_unit_id`. It therefore read the plate's balance row and wrote the delta to the **loose (`NULL`-HU) slot**, driving it negative until `inventory_balances_alloc_bound` rejected the whole transaction. Since `receive-stock` creates a plate per receipt, that is the normal case — converting essentially any stocked bin failed. The CHECK constraint is what prevented silent duplication; treat it as load-bearing, not decorative.
- **Replenishment ledger legs name their task as of mig `00109`** (`ref_type = 'replen_task'`, `ref_id` = the completion record's id, on BOTH legs). This entry said they did not until 2026-08-18. Three things worth keeping:
  - **`inv_transfer_stock` takes `p_ref_type`/`p_ref_id` and their DEFAULTS reproduce the pre-00109 values exactly**, so putaway, reslot and quarantine still write `('transfer', NULL)` with no edit. Pass them when a caller has an identity worth recording; don't otherwise.
  - **The id stamped is `v_completed`, not `p_task_id`.** They are the same row on a full completion, but a partial leaves the original task holding the remainder and inserts a new row carrying the quantity that moved — and the leg must name the row whose quantity is in the leg.
  - **Legs written before `00109` still read `('transfer', NULL)`** and nothing backfills them. Any query over history has to tolerate both.
- **Order statuses are 6, grouped into 3 Order Import tabs** — Received (`processing`/`processed`), In Progress (`picked`/`packed`), Completed (`dispatched`/`delivered`). Mig `00025`.
- **Image columns store public Storage URLs, never base64.** Uploads compress to WebP via `browser-image-compression` (mig `00024`) — don't reintroduce data URLs.
- **`warehouse-main/`** — replaces MAIN's placeholder 15-bin layout with the real 189-bay DC and drives `recommend-putaway` → `decide-putaway` to slot every SKU (`warehouse:main:{seed,reset}`). See its README.
- **`tridon-demo/`** — self-contained real-email hardware demo: one auto-approving PO, one that lands in review (an uncatalogued Milwaukee line). `demo:tridon:{seed,reset,pdfs}`. It **steals** the `dulshanb@…` sender from the V2food demo, so re-run `seed:v2food-demo` afterwards. See its README.

Everything else — the warehouse/WIE programme, scan tracking, two-stage putaway, Pick Zone + replenishment, rack levels, multi-supplier & multi-UOM, PO Inbox, the admin-mutation lockdown, realtime, error boundaries, the audit-log viewer, CI, perf splitting, the pantry redesign, the settings revamp, health monitoring and the password-reset round trip — is described in the sections above.
