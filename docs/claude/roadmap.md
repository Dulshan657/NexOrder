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
1. **Branch protection — DONE 2026-10-13.** The repo is public, so it was never blocked on plan tier by the time anyone checked again. `main` now requires (via a repository ruleset — classic protection is disabled on this repo) `typecheck · test · build`, `axe · login surfaces` and `edge · deno check`, admins included, merge via PR only. Payload, merge routine, `scripts/gate.mjs` and the flake protocol: [`gate.md`](gate.md). **Follow-up:** 15 more explicit `toLocale*String(undefined, …)` calls remain on 14 lines across 11 files, plus bare `toLocaleDateString()` calls such as `components/OutstandingPayments.tsx:42`. Twelve format DATES (e.g. `components/PromotionAdmin.tsx:178`, two on `components/AdminDashboard.tsx:519`) and render US day/month order in a US-locale browser; three format NUMBERS (`AdminDashboard.tsx:503`, `RepDashboardV2.tsx:264`/`:420`). None is under test, so none is red. **Also:** four jsdom tests time out at 5 s in a loaded full suite and pass alone (`receiveMixedPallet`, `a11y/qrApproval`, `productImportCategories`, `hoReCaFormReps`) — listed in `config/knownFlakes.json` so the gate stops blocking unrelated PRs; fix each test's render cost and delete its entry.
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

## Warehouse map: what the 2026-11-23 audit left open

NX-0046 fixed the correctness faults. These were found by the same audit and deliberately not done. The plan that follows NX-0046 is, in order: one search box for product / bin / batch / pallet in 2D and 3D; the manager's live map (per-pallet contents, open tasks and movement history on a bin; a Work overlay of live putaway, replenishment, pick and off-home tasks; a capacity table per zone and rack); 3D racks and pallets that look real, derived with no new data entry; a picking mini-map on the RS35.

- **Speed, partly addressed by NX-0047.** A zoom now rebuilds the scene once, at the settle, and zone washes are one path per zone. Still open from the audit: any stock change in any warehouse rebuilds `locationsById` and with it the whole scene. Painting and pinch-zoom rebuild the scene per cell and per frame (`scale` is a scene-memo dependency). Zone washes draw one rectangle per cell. `selectFromMap` in `RackedWorkspace.tsx` gets a new identity every render. The scene memo in `WarehouseCanvas.tsx` omits `onRenameArea`, `onEditSign` and `signRegions`. Measure on a large site before fixing any of it.
- ~~**A grid 200 cells wide cannot be zoomed out far enough to see whole**~~. Fixed by NX-0047: the fit clamps to `FLOOR_MIN_SCALE` (0.05) and the zoom range follows the fit (`scaleLimitsForFit`).
- **Keyboard and screen readers.** Bins are not focusable in 2D or 3D. Overlay and floor buttons have no `aria-pressed`, tree rows no `aria-expanded`. 3D labels are hidden from screen readers and its help text is mouse-only. No Ctrl+Z while painting areas.
- **Files over the 800-line limit:** `mutate-warehouse-location/index.ts` (1988), `mutate-layout/index.ts` (1535), `RackedWorkspace.tsx` (1367+), `useLayoutEditorState.ts` (1189), `LayoutDesignerView.tsx` (1004), `WarehouseCanvas.tsx` (1000+), `_shared/wie/codePattern.ts` (898).
- **3D Aisle preset ignores what is around it.** With nothing selected it stands at the scene centre, which on the demo site is inside the bulk pallet grid with a post in the middle of the view. Seen in a browser 2026-11-24. Belongs with the rack-facing work in the realistic-3D piece.
- **3D, not checked:** whether a click passes through a wall to the rack behind it; shadows on a site much larger than the demo (they are fine there); performance at 1000 to 2000 locations; props are untyped across the lazy boundary.
- **Designer, not checked:** whether a no-op annotation save clears the hydration guard so a later refetch overwrites unsaved edits (`LayoutDesignerView.tsx` around the annotation save).
- **Not a fault after all:** "narrow areas cannot be renamed". `regionLabelBudget` gives every area at least six cells of label width. And the hand-built grid geometry in `three/SceneObjects.tsx` cannot leak in practice: it is rebuilt only when the grid size changes, and `WarehousePage` remounts the workspace per layout.
- **Other gaps:** a layout or location change made by another user is not pushed to the map (only `inventory_balances` is subscribed); the live map imports from the designer module (`WarehouseCanvas.tsx` imports `LayoutCanvas`); there is no deep link to a bin, floor or overlay; the "no three.js in a tenant build" check is manual.
- **Dev serves an unmerged build.** On 2026-11-24 `nexorder.vercel.app/version.json` was `79edf70`, the NX-0041 dev-merge, not `main`. Check before any `deploy:dev`.

## Warehouse 2D map: known issues after NX-0047 (2026-11-26)

NX-0047 made the 2D map animate, glide, zoom without rebuilding the scene, and gave it a new look. These are what it left open or found, with the evidence in the brief's FINAL (`docs/briefs/NX-0047-warehouse-map-premium.md`).

- **Zoom is paint-bound, not 60 fps.** A 2 s ctrl+wheel zoom on the Amadiya demo site ran at 15 to 38 fps on a 7.7 GB dev box (the base ran 29 to 33 fps). React does no scene work mid-zoom now; the browser repaints the whole SVG every frame. The per-rack sheen is the largest single cost (about 5 fps); the rack shadow and the frosted panels' backdrop blur cost little. **Fix:** during a gesture, move a cached GPU layer (a CSS transform on a `will-change` element, with an overscan margin so a pan shows no blank edge) and redraw the SVG only at the settle. Until then, consider dropping the sheen while `svg[data-moving]`, as the shadow already is.
- **Node count doubled** (312 to 625 on the Amadiya demo site): one sheen rect per rack plus the selection rings. Feeds the paint cost above.
- **Text is soft mid-zoom.** Counter-scaled labels and grid hairlines are drawn at the settled scale, so they grow or shrink with the map until the zoom stops, then snap crisp. Intended, but visible on a long zoom.
- **Not checked in a browser:**
  - the shadow returning at the settle, frame by frame, for a visible pop;
  - the hover card on a real top-row or edge bin (only unit-tested);
  - a pinch zoom and a thrown pan on a real touch device, the RS35 above all;
  - the contrast crawl (`tests/contrast/`, needs real staff credentials) with the new occupancy ramp, the muted label ink (now stone-700) and the blue hover ring.
- **Narrow maps:** below `sm` the controls are one row on the bottom edge and the zoom percentage and scale bar are hidden. A layout with several floors adds a button per floor to that row and will crowd a 328 px map; nothing wraps it yet.
- **Legend content is noisy.** It lists every storage form, level role, area and zone present, with duplicates in name ("Staging Area" twice on the demo). It collapses, but it starts open on desktop and runs to 13 rows there.
- **Over-capacity looks the same as full** on the occupancy ramp: a darker stop could not hold the label ink at 4.5:1. The number on the bin says "over".
- **Floor buttons show a digit.** `MapControls` takes `floorNames`, but layouts carry no floor names (`warehouse_layouts` has only `floor_count`), so nothing supplies them.
- **A button zoom that is still animating swallows a click on a bin**, the same as a tap that stops a glide. Deliberate (a press stops a moving map), but a quick zoom-then-tap on desktop will need a second tap.
- **Out of scope, still to do:** minimap, fullscreen, find-stock dimming and fly-to in 2D, keyboard navigation between bins.
- **`recode-gestures.spec.ts` cannot run locally** without `E2E_ADMIN_*`; the NX-0046 map spec signs in through the demo roster and can.

## Recently shipped

git history is the changelog. Only the items below carry something the sections above don't.

- **Nex Assistant v1 (2026-10-20, NX-0003) is BUILT, on branch `feat/NX-0003-voice-assistant`, and NOT merged.** It is deployed to dev (migration `00133`, the `voice-session` function, the web app) and released to no tenant: the owner merges when they declare v1, and a tenant gets it only on a `rel-*` tag cut from the tenant workspace. Architecture, ledger, tools and caveats: [`voice-assistant.md`](voice-assistant.md). **Nobody has yet held a spoken conversation on a real device** (brief A14); that walk is the owner's, on desktop Chrome, Android Chrome and iPhone Safari. **v2 ideas:** a Warehouse role without money (tools that never touch prices); persisted transcripts; Sinhala and Tamil; swapping the voice for a hosted one; a Playwright typed-fallback journey (a fake `RTCPeerConnection` plus a mocked `voice-session`); **server-side hang-up** (the client reports the OpenAI call id from the SDP answer's `Location` header, and `end` or a cron calls `POST /v1/realtime/calls/{id}/hangup` on a call that outlives its cap; today the caps bind only a cooperative client and the OpenAI project's monthly spend limit is the backstop, a release gate in [`releasing.md`](releasing.md)); a per-tenant time zone for spoken periods (fixed to Australia/Sydney); and a failure message when the connection dies before the session is live (today it ends as "Session ended").

- **Factory phase B (2026-10-14, NX-0001): every PR carries a brief, and its
  own tests must fail on the base.** `docs/claude/briefs.md`. CI's
  `brief · fail-first` runs the *base branch's* checker, so a PR cannot weaken
  the check it is judged by. The base run reuses the tip's `node_modules`
  through a link, so a dependency bump's fail-first is judged with the new
  dependencies. The report says so; nothing stops it.

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
