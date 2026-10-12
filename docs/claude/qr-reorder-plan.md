# HoReCa Location QR Reorder

## Context
HoReCa customers (restaurants/hotels) want a printed QR code on-site so kitchen staff can
reorder fast without a full login. Scanning opens a landing screen to reorder the venue's
last order and jump to Shop / Order History / Pantry. Because the sticker is public, the QR
only identifies the venue; each staff member unlocks with their own PIN, and QR orders are
held for approval before they reach the distributor.

## Agreed workflow (from interview, 2026-10-12)

**Code & printing**
- One QR per HoReCa (not per delivery address). Encodes a URL with an opaque venue token.
- Printable by admin/manager/rep from the HoReCa profile, and by the HoReCa's own Customer login.
- Two formats: A4 poster and small sticker. Content: operator logo, HoReCa name,
  "Scan to reorder — enter your staff PIN", operator phone number.
- Revocation: regenerate the code (old sticker dies; PINs survive) AND remove individual PINs.

**Staff PINs**
- PIN per staff member (name + 4–6 digit PIN). Managed by the HoReCa Customer login, the rep,
  and admin/manager.
- Correct PIN → device unlocked for **2 hours**. Server-side wrong-PIN attempt limiting
  (not chosen as a visible feature by the user; kept as a security requirement — flag at review).
- Unlocked staff can do everything a Customer login can (Shop, Reorder, History, Pantry),
  minus account/password settings.
- An existing Customer login on the phone skips the PIN and lands on the same screen.

**Landing screen**
- "Order same again" (confirm screen → submit) and "Edit before ordering" (loads into cart).
- Pending-approval banner ("your 10:42 order is waiting for approval").
- Last 3 orders with status + reorder on each; Pantry list shortcut; active promotions;
  quick nav to Shop and Order History.

**Approval**
- Every QR/PIN order is pending until approved. Approvers: any Customer login for the HoReCa,
  the HoReCa's rep, admin/manager. Notified via the in-app notification bell only.
- Approver can edit lines, approve, or reject. The staff member can cancel their own pending order.
- No stock reserved while pending; reservation happens at approval, shortages flagged then.
- Orders show "via QR · <staff name>". Normal Customer-login orders are unchanged.

**Scope**
- Shop tenants only — ships under the existing `shop` module (Amadiya does not get it).

**Follow-up decisions**
- Reps: add **assigned reps per HoReCa** (`horeca_reps`, set by admin/manager). Only assigned
  reps approve QR orders / manage PINs for that venue.
- PINs: **chosen by the manager, 4–6 digits**, weak ones refused (1234, 0000, repeats, runs),
  unique within the venue.
- Kitchen staff do **not** see invoices.

## Implementation design

### Key decisions
1. **New role `'QR Staff'`, one hidden Supabase auth user per staff member** (fails closed:
   every function with a role allow-list — `place-order`, `invite-user`, `mutate-profile` —
   rejects it by default; `user_is_staff()` is false for it).
   - `qr-unlock` (public, `verify_jwt=false`, self-gated by rate limits) checks token + PIN, then
     `admin.generateLink({type:'magiclink'})` → returns `hashed_token`; client calls
     `verifyOtp({token_hash})` (same mechanism as `ResetPasswordView.tsx:145`). No email sent.
   - **2 hours is enforced in the database**: `qr_staff.unlocked_until`. `public.user_horeca_id()`
     (same signature, SECURITY DEFINER, pinned search_path) returns NULL for a QR Staff user
     without an active unlock, so every own-HoReCa RLS policy and realtime goes dark at expiry
     regardless of JWT/refresh token. `_shared/auth.ts` `requireAuth` rejects expired QR
     sessions with 401 `QR_SESSION_EXPIRED`. Client timer (`hooks/useQrSessionExpiry.ts`)
     signs out locally and returns to the PIN pad — convenience only.
   - Revoking a staff member bans the auth user and deletes their `auth.sessions`
     (service_role-only RPC). Regenerating the code ends all unlocks for the venue.
2. **Pending orders live in a separate `qr_order_requests` table, not a new `orders.status`** —
   keeps them out of reports, pick queue, invoices, credit checks and the `STATUS_ORDER.indexOf`
   trap. Lines stored as JSONB (single insert, no half-writes). Mirrors `pending_pos` → `approve-po`.
3. **Approval re-uses `place-order` logic, not a copy of it.** Extract
   `place-order/index.ts:244-575` into `_shared/placeOrderCore.ts` (+ pure
   `_shared/orderPricing.ts`) with a `dryRun` mode that collects all problems (shortages,
   credit, minimum). `place-order` becomes a thin wrapper with identical error codes. Approval
   runs the core for real → `inv_reserve_order`, invoice and email happen exactly as today.
   (Avoids the `approve-po` trap: it bypasses place-order and gets no HoReCa pricing/promos.)
   Race-safe claim: `UPDATE … SET status='approving' WHERE status='pending'`; staff cancel uses
   `WHERE status='pending' AND requested_by=auth.uid()`.
4. **Posters generated server-side** with pdf-lib (existing `generate-labels` pipeline) +
   `qrcode-generator` via esm.sh, QR drawn as vectors, ECC level Q. Logo/phone from
   `_shared/companyIdentity.ts`. PDF bytes returned directly — no bucket, no tokens in storage.

### Migration `00129_qr_reorder.sql` (newest today is 00128)
- `qr_codes` (horeca_id PK, token UNIQUE — 24 random bytes base64url, `rotated_at`,
  `failed_attempts`, `locked_until`). **No client grants.**
- `qr_staff` (id, horeca_id, auth_user_id UNIQUE, name, `pin_hmac` = HMAC-SHA256 with
  `QR_PIN_PEPPER` secret over `horeca_id:pin`, unlocked_until, last_unlocked_at, created_by,
  revoked_at/by). Unique `(horeca_id, pin_hmac) WHERE revoked_at IS NULL`.
- `qr_order_requests` (id, horeca_id, requested_by, qr_staff_id, status CHECK
  pending|approving|approved|rejected|cancelled, items jsonb, notes, delivery fields,
  quoted_total, claimed_at, decided_at/by, decision_reason, last_error, edited_by_approver,
  approved_order_id UNIQUE → orders).
- `horeca_reps` (horeca_id, rep_id) — managed through `mutate-horeca`.
- `profiles_role_check` += `'QR Staff'`; `user_horeca_id()` unlock gate.
- Rewrite the 4 Customer-literal SELECT policies to `NOT user_is_staff() AND … = user_horeca_id()`
  (00105 pattern): `horecas`, `orders`, `order_items` (00001), `horeca_addresses` (00021:83).
  **`invoices_select_customer` stays Customer-only.**
- RLS: `qr_staff` / `qr_order_requests` readable by staff or own HoReCa.
- **Grants**: `REVOKE ALL … FROM anon, authenticated` on all new tables (00101 default
  privileges would otherwise grant them, TRUNCATE included); then column-level
  `GRANT SELECT (id, horeca_id, name, unlocked_until, last_unlocked_at, created_at, revoked_at)
  ON qr_staff` (never `pin_hmac`) and `GRANT SELECT ON qr_order_requests`.
- Service_role-only RPCs: `qr_verify_pin` (row-locks `qr_codes`, backoff, atomic counters),
  `qr_end_sessions`. EXECUTE revoked from PUBLIC/anon/authenticated.
- `qr_order_requests` added to the `supabase_realtime` publication.
- Register in `config/lockedTables.mjs`; never touch `grantBaseline.mjs`.

### Edge Functions (all `requireModule('shop')`, mapped in `config/moduleOwnership.mjs`, audited)
| Function | Callers | Notes |
|---|---|---|
| `qr-unlock` (new, `verify_jwt=false`) | anonymous | `resolve` (venue name/logo), `unlock`. IP buckets 30/10 min (unlock), 60/min (resolve). Per-code DB backoff: 5 fails → 1 min, 10 → 15 min, 15 → 1 h, 20 → locked until reset + approvers notified. Same "Incorrect PIN" message always. |
| `mutate-qr-access` (new) | Admin, Manager, assigned reps, Customer (own HoReCa) | get/regenerate code, create/rename/reset-PIN/revoke staff, unlock code. PIN validated by shared `_shared/qrPin.ts` (4–6 digits, denylist, uniqueness). Separate `:regen:` and `:pin:` buckets. |
| `qr-order-request` (new) | submit/cancel: QR Staff; preview/approve(+edits)/reject(reason): Customer, assigned reps, Admin, Manager | Notifications on submit (per Customer + assigned rep, broadcast to Admin/Manager) and on decision (to requester). |
| `generate-qr-poster` (new) | same as mutate-qr-access | `{horecaId, format:'a4'|'sticker'}` → PDF. |
| `place-order` (refactor) | unchanged | wraps `placeOrderCore`; still rejects QR Staff. |
| `mutate-horeca` (change) | Admin, Manager | set assigned reps. |

New secret `QR_PIN_PEPPER` → add to `secrets:check`. Rotating it invalidates all PINs (document).

### Frontend
- `types.ts`: `UserRole.QR_STAFF`, `QrStaff`, `QrOrderRequest`. Exclude from
  `lib/assignableRoles.ts`, Users list and HoReCa user counts. `lib/orderSource.ts`: `qr_kitchen`
  → "via QR · {name}".
- `index.tsx` Root: `?qr=<token>` → `components/qr/QrEntryScreen.tsx` + `PinPad.tsx` (44 px
  targets) before `AuthGate`. Pure `lib/qr/qrEntryDecision.ts`: same-venue Customer or unlocked
  QR Staff → skip PIN; expired/other-venue QR Staff → sign out, PIN pad; any other signed-in user
  → "Signed in as X — continue / use kitchen PIN" (never silent sign-out). Last token kept in
  localStorage so expiry returns to that venue's PIN pad. Ensure `lib/auth/recoveryLink.ts`
  ignores `?qr=`.
- `components/AppShell.tsx`: new `'kitchen'` view → `views/KitchenHomeView.tsx`, default for QR
  Staff and for a Customer arriving via QR. QR Staff nav: Kitchen, Shop, Reorder, History,
  Pantry; no account/password items. Mount `useQrSessionExpiry`.
- `KitchenHomeView`: "Order same again" (`<Modal>` confirm → submit request), "Edit before
  ordering" (`handleReorderItems(items,'replace')` at `context/OrderContext.tsx:381` → Reorder
  tab, `components/ReorderTab.tsx` / `lastOrderForHoReCa` at `hooks/useOrderingState.ts:144`),
  pending banner, last 3 orders, pantry shortcut, promotions, Shop/History links. Totals labelled
  "estimate".
- Submit path branches on role (QR Staff → `qrService.submitRequest`, else existing
  `placeOrder`) inside `OrderContext` checkout, so the whole Shop works for QR Staff.
- Approvals: `components/qr/PendingQrRequests.tsx` (top of Order History, staff OrdersPage
  "Awaiting approval (n)", rep dashboard; cancel for own requests);
  `components/qr/QrRequestReviewModal.tsx` (`<Modal>` with `dirty`, server preview + shortages,
  edit lines, Approve / Reject with reason). `NotificationCenter` opens it for
  `qr_order_pending`.
- `components/qr/QrAccessPanel.tsx` (`<Sheet>`): staff list, add (name + chosen PIN), rename,
  reset PIN, revoke, regenerate (`<ConfirmDialog>`), print A4 / sticker. Opened from a
  "QR & PINs" button in `HoReCaProfile.tsx` header (~:85-103) and a "Kitchen QR" nav item for
  Customers. Assigned-reps picker added to the HoReCa form.
- Data: `services/supabase/qrService.ts`, `hooks/queries/useQrAccess.ts`,
  `useQrOrderRequests.ts`, adapters in `lib/adapters.ts`, realtime entry in
  `hooks/useRealtimeSubscriptions.ts`.
- **Module gating**: every new lazy declaration `MODULE_SHOP ? lazyWithRetry(...) : null` in
  **both** AppShell.tsx and AdminView.tsx; `QrEntryScreen` likewise.

### Rollout (per branch → merge → deploy rule)
1. Branch `feat/qr-reorder`. Migration 00129 first (additive: new tables locked at creation,
   policy rewrites only widen to a role nobody holds yet). Rehearse with `npm run migrate:dev`.
2. Functions: `place-order` refactor first, smoke-test on dev; then the four new functions +
   `_shared/auth.ts`. Set `QR_PIN_PEPPER` on dev before deploy.
3. Frontend → `npm run deploy:dev`.
4. Housekeeping: `check:grants:dev`, `check:storage:dev`; include QR tables/users in
   `export:demo` / `import-demo.mjs` / `mint-demo-users.mjs`; CLAUDE.md stub +
   `docs/claude/qr-reorder.md`; lockdown table rows.
5. Amadiya: nothing to ship (no `shop`); the migration still travels with the next release tag.

### Things to confirm on dev before building on them
- GoTrue accepts `qr-<uuid>@qr.nexorder.invalid` emails; `generateLink` magiclink +
  `verifyOtp` type naming.
- A logged-out deep link survives login through `AuthGate` (believed yes, untested).

## Verification
- **node tests** (`*.test.ts`): `qrLink`, `qrEntryDecision`, `qrPin` (denylist/length),
  `qrUnlockPolicy` backoff, `qrRequestTransitions`, `orderPricing` dry-run, poster layout,
  `orderSource`, `assignableRoles`, `moduleOwnership`, grant expectations. Existing
  `serverPricing`, `uomPricing`, `orderService.placeOrder` tests must pass **unchanged** (proves
  the extraction is behaviour-neutral).
- **ui tests** (`*.test.tsx`): PinPad (+axe), QrEntryScreen three branches, KitchenHomeView,
  QrRequestReviewModal (dirty guard, edited payload), QrAccessPanel.
- **integration** (`npm run test:integration`, dev): QR Staff reads own venue only while
  unlocked and nothing after `unlocked_until`; cannot read `pin_hmac`, invoices, or write any QR
  table; lockout after N failures; cancel-vs-approve race has one winner.
- `npx tsc --noEmit`, `deno check` on changed functions, `npm run lint`, `check:overlays`,
  `check:viewport`.
- `npm run build` with `NEXORDER_ENV=amadiya` and grep `dist/` for `KitchenHomeView` /
  `QrAccessPanel` → must be absent.
- **Browser E2E on dev** (360 px, `E2E_BASE_URL=http://localhost:3000`): print A4 + sticker,
  scan URL on phone → PIN → "Order same again" → Customer gets notification → edits + approves
  → order appears "via QR · Sam" with stock reserved; wrong PIN ×5 → backoff; wait/forge expiry
  → bounced to PIN pad; regenerate code → old URL dead.

## Hardening pass (migration `00132`, 2026-10-12)

Review findings fixed after the first build. The rules that now hold:

- **The PIN failure counter is a rolling 24 h window and a correct unlock never touches it.**
  `qr_codes.failure_window_started_at` marks the first failure of a run; a failure after 24 h
  starts a new run at 1. Before this, any staff member's success zeroed the counter, so a guesser
  could interleave guesses with an honest cook's unlocks forever. Only `unlock_code` and
  `regenerate_code` reset it. Thresholds unchanged (5 -> 1 min, 10 -> 15 min, 15 -> 1 h, 20 -> locked).
  Approvers get a `qr_code_locked` bell entry at the 5th, 10th and 20th wrong PIN
  (`metadata.failedAttempts`, `metadata.permanent`); each counted failure is one structured
  `console.warn` (venue + count, never the PIN).
- **`clientIp()` is `_shared/clientIp.ts`**: `cf-connecting-ip`, then `x-real-ip`, then the RIGHT-most
  `x-forwarded-for` entry, capped at 64 chars. The left-most entry is what the client wrote.
  `qr-unlock` also has a header-independent bucket, `qr-unlock:tok:<16 hex of sha256(token)>`, 20 per
  10 min, applied once the token names a real venue.
- **A kitchen phone cannot read `horeca_payment_methods`** (the own-venue arm now requires the
  Customer role). The other own-venue policies still include QR Staff by design.
- **`QR_CLAIM_STALE_MS` is 10 minutes** and the approve finalize UPDATE matches `claimed_at`, so a
  taken-over claim cannot stamp its request with the other approver's order.
- **`revoke_staff` cancels that person's `pending` requests** (reason "Staff member removed") and
  retires their bell entries. Every decision (approve, reject, cancel, revoke) marks the request's
  `qr_order_pending` notifications read (`retirePendingNotifications`).
- **`mutate-qr-access` `lock_self`** is the only action a QR Staff login may call; it clears the
  caller's own unlock and deletes its sessions. The Lock button and the session-end handler call it
  best-effort (2.5 s cap) before the local sign-out. A session that already lapsed is refused by
  `requireAuth` (QR_SESSION_EXPIRED) and the call is ignored - the database gate had already shut it.
- **Caps**: 50 active staff per venue; 3 waiting (`pending` + `approving`) requests per staff member.
  Both are read-then-write, so a burst can overshoot by a request or two; the rate limits bound it.
- **Submit refuses** an inactive product and a delivery date outside today .. today + 90 (UTC).
  `placeOrderCore` itself still ignores `is_active`.
- **`regenerate_code` rotates the token first**, then clears unlocks and sessions.
- `qr_staff`'s venue arm excludes revoked rows; Admin/Manager/assigned reps and the login's own row still see them.

