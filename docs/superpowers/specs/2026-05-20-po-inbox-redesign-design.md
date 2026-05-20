# PO Inbox redesign — design spec

**Date:** 2026-05-20
**Status:** Approved (design phase)
**Scope:** Visual redesign of the admin PO Inbox. Behaviour-neutral on the data
layer — no query keys, mutations, Edge Functions, or service logic change. The
one **structural** change: the Mailboxes sub-tab is replaced by a header
button + popover (§4.7), which removes `'mailboxes'` from the sub-tab set and
moves the post-OAuth landing behaviour.

---

## 1. Goal

The PO Inbox is the daily-driver surface where admins/managers triage inbound
purchase orders the AI extracted from email. The current UI is competent and
dense but **flat**: the triage signals an operator needs to make a
keep/verify/reject decision — confidence, status, age, and risk flags — are all
crammed into one undifferentiated grey meta line. Loading shows a generic
spinner; the empty state is thin.

This redesign raises **scannability** and **visual hierarchy** while staying
fully consistent with the existing admin app's design language. It is a
look-and-feel pass, not a re-architecture.

## 2. Non-goals (explicit behaviour-neutrality contract)

The following MUST NOT change. They are load-bearing and out of scope:

- Any TanStack Query hook, query key, `staleTime`, or realtime invalidation.
- Any Edge Function call, mutation (`approve-po`, `reject-po`), or service in
  `services/supabase/poInboxService.ts` / `poInboxStatsService.ts`.
- Component **props / public interfaces** of every file touched.
- The detail modal's **form logic**: document preview (PDF / image /
  sandboxed-HTML iframe handling), saved-vs-new delivery-address modes, line
  item state, confidence-field sourcing, the `canApprove` guard, approve/reject
  handlers, and the read-only resolved view.
- `poInboxFormat.ts` pure helpers' **signatures** (`PO_INBOX_TABS`, `formatAge`,
  `sortForDisplay`, `statusBadge`, `confidenceBadgeStyle`) — their existing
  vitest suite must stay green. New formatting helpers may be *added*.
- Email-account data layer: `services/supabase/emailAccountsService.ts`, the
  hooks (`useEmailAccounts`, `useStartOAuthFlow`, `usePauseEmailAccount`,
  `useDisconnectEmailAccount`), the OAuth Edge Functions, and the popup
  connect/complete handshake logic (window name `nexorder-po-oauth`,
  BroadcastChannel + postMessage + popup-closed poll). These move location
  (§4.7) but their behaviour is preserved verbatim.

URL sub-tab persistence (`?subtab=`) is **retained** for the remaining tabs
(`queue`, `aliases`) but the `'mailboxes'` value is removed; a stale
`?subtab=mailboxes` deep-link falls back to `queue` (§4.7).

## 3. Design system (reuse, do not invent)

Pulled from `index.css` `@theme` + existing utilities. No new dependency.

| Token | Value | Use |
|---|---|---|
| Display font | Plus Jakarta Sans (`font-display`) | titles |
| Body font | DM Sans (`font-sans`) | everything |
| Mono font | JetBrains Mono (`font-mono`) | all numerics (confidence, age, counts, cost) |
| Accent | `nexgen-blue` `#2E86DE` | primary actions, focus rings, Review action |
| Neutrals | stone palette | surfaces, text, borders |
| Status — needs_review | amber (`amber-50/200/700`) | |
| Status — auto_approved | teal (`teal-50/200/700`) | |
| Status — approved | emerald (`emerald-50/200/700`) | |
| Status — rejected | rose (`rose-50/200/700`) | |
| Utilities | `.shadow-card`, `.btn-press` | existing; reuse |

**Motion: CSS-only.** No `framer-motion`. New keyframes go in `index.css`. Animate
only `transform` / `opacity` / `background-position`. Respect
`prefers-reduced-motion` (wrap perpetual/entrance animation in a media query that
disables it).

**Confidence colour bands** (single source of truth — reuse the existing
thresholds in `confidenceBadgeStyle` / `confidenceTone`):
- `>= 0.95` → emerald
- `>= 0.75` → amber
- `< 0.75` → rose

## 4. Component-by-component design

### 4.1 Confidence meter ring (new shared sub-component)

The hero triage signal. A circular conic-gradient "meter" whose fill is
proportional to the score, colour-banded as above, with the mono percentage
centered.

- Markup: an outer `div` (e.g. 44px queue / 48px modal header) with
  `background: conic-gradient(<bandColor> <pct>%, <track> 0)`, containing an
  inner white circle (~78% diameter) holding `{Math.round(c*100)}%` in
  `font-mono`.
- Colour from a shared `confidenceBand(c)` helper returning
  `{ ring, track, text }` Tailwind/style values. Add to `poInboxFormat.ts`
  (additive — keeps logic testable; add a unit test).
- `title` / `aria-label`: `AI confidence {pct}%`.
- Two sizes via a `size` prop (`'sm'` = list row, `'md'` = modal header).
- Reduced-motion: static (no animation needed; it's a static fill).

### 4.2 `POInboxTab` — the Queue (primary work)

**Filter tabs (`FilterTab`):** keep the underline pattern. Add a count badge to
the **Needs Review** tab only, sourced from `usePendingPoCount()` (already
fetched for the header badge — no new query). Badge: mono, `amber-50` pill,
shown when `> 0`. Other tabs: no count (all-time per-status counts don't exist
cheaply — see §6). The active tab keeps its strong underline.

**Row (`Row`) — "Triage Rail":** restructured into a horizontal scan grid:

```
[priority rail] [confidence ring] [ title + flags / customer · sender · age ] [status pill] [chevron→Review on hover]
```

- **Priority rail**: 3px left border. Rose when `senderMismatch` present OR
  `confidence_overall < 0.75`; otherwise the status colour (amber for
  needs_review). Encodes "look at me first".
- **Confidence ring** (§4.1, `sm`).
- **Primary line**: subject `font-semibold text-stone-900` (truncate). Inline
  sender-mismatch pill (rose, rounded-full, `AlertTriangle` + "sender mismatch")
  kept from today. Approved-order id chip when present.
- **Secondary line**: `customer · sender · age` in `text-xs text-stone-500`
  (replaces today's confidence/status-in-meta-line — those move to the ring and
  pill).
- **Status pill**: right-aligned, status-coloured rounded-full chip
  (reuse `statusBadge`).
- **Hover action**: on `group-hover`, the chevron is replaced by a
  `Review ›` pill (nexgen-blue outline) and the row gets `bg-stone-50` + a
  subtle inset ring/lift. Pure CSS (`group` + `group-hover:` + `transition`).
  Clicking anywhere in the row still opens the modal (unchanged `onClick`); the
  Review pill is affordance, not a separate handler.
- Keyboard focus mirrors hover (`focus-within` / `focus:` styles) for a11y.

**List entrance:** staggered reveal via CSS — each `<li>` gets
`animation-delay: calc(var(--i) * 40ms)` with a short fade/translate-up
keyframe, `--i` set inline from the map index. Capped so a long list doesn't
cascade forever (clamp index used for delay at ~12). Disabled under
`prefers-reduced-motion`.

### 4.3 Loading + empty states

**Skeleton (replaces the spinner):** a `<ul>` of 3–5 skeleton rows matching the
Triage Rail layout — a circle (ring placeholder), two stacked bars (title +
meta), and a pill placeholder — using a `.po-skeleton` shimmer utility
(`background-position` keyframe) added to `index.css`. No `Loader2` spinner in
the list body. (The refresh-button spinner stays — it's a control affordance,
not a content loader.)

**Empty (`Empty`):** composed per status — an icon in a soft tinted circle, a
headline, and a one-line explanation:
- `needs_review`: emerald check, "Inbox zero — nothing to review", subtext that
  high-confidence POs auto-approve and uncertain ones land here.
- `auto_approved` / `approved` / `rejected`: status-appropriate icon + concise
  copy. Keep copy concrete (no filler words).

### 4.4 `POInboxView` — header + stats + sub-tabs

- **Title block**: keep `<h1>` "PO Inbox"; add a one-line `text-sm
  text-stone-500` description beneath it.
- **Stats ribbon** (`POInboxStatsTile` `inline` variant): from a loose text run
  to a flat bordered KPI ribbon (rounded-xl, `divide-x`), mono values, tiny
  uppercase labels. **Needs review** segment emphasised (`amber-50` tint,
  heavier weight) since it's the actionable number. **Cost today** keeps a muted
  `7d $X/d` sub-line. Still flat (no elevated card) — it lives in page chrome.
  The `card` variant (used by `AdminDashboard`) is left as-is.
- **Sub-tabs / nav**: keep the underline pattern, now just **Queue / Aliases**.
  The nav row gains a right-aligned **Mailboxes button** (§4.7).
- **`MailboxHealthBanner` is removed** — its job (surfacing paused/errored
  mailboxes) folds into the Mailboxes button's health dot/tint (§4.7).
- **OAuth-callback handling lifts here.** `POInboxView` is always mounted while
  the PO Inbox tab is open, so it owns: reading `?connected=1` / `?connect_error`
  from the URL, toasting the result, stripping the params, and **auto-opening
  the Mailboxes popover** so the operator sees their new connection. This
  replaces the mount-effect that lived in `EmailAccountsTab` and the
  `?subtab=mailboxes` redirect in `AppShell` (§4.8).
- **Sub-tab type:** `POInboxSubTab` becomes `'queue' | 'aliases'`;
  `VALID_SUBTABS` drops `'mailboxes'`; `readInitialSubtab()` maps an unknown or
  legacy `'mailboxes'` value to `'queue'`.

### 4.5 `POInboxDetailModal` — polish only (§2 logic untouched)

- **Header band**: reuse the confidence ring (§4.1, `md`) on the left + subject
  (display font) + meta (`From … · PO … · age`) + a status pill (reuse
  `statusBadge`) + close button. Replaces the current text-only header.
- **Sender-mismatch band**: promote the mismatch warning to a full-width rose
  band directly under the header (currently inline in the form). The in-form
  rose callout can be removed or kept minimal — keep one, not two.
- **Inputs/controls**: unify to `rounded-lg border-stone-300` with a
  **nexgen-blue focus ring** (`focus:border-nexgen-blue
  focus:ring-2 focus:ring-nexgen-blue/20`). Apply to selects, date/number/text
  inputs, textarea. Labels stay above inputs (already compliant).
- **Document pane toolbar**: cleaner — uppercase "Original · {type}" label with
  `FileText` icon, "Open in new tab" pinned right. Pane preview logic unchanged.
- **Footer**: keep Reject as a quiet text action and "Approve & create order" as
  the prominent emerald primary (semantic: creates a real order). Add
  `.btn-press` tactile feedback. Disabled/loading states unchanged.
- **Modal container**: keep `max-w-6xl`, `rounded-2xl`; refine to a slightly
  softer shadow. Add a quick fade/scale-in entrance (CSS, reduced-motion aware).

### 4.6 `POInboxHeaderBadge`

Optional consistency only: keep the bell/Inbox + amber count. A subtle CSS pulse
on the badge when `count > 0` (reduced-motion aware). No interface change.

### 4.7 `MailboxesMenu` (new) — button + popover

Replaces the Mailboxes sub-tab. A new `components/admin/MailboxesMenu.tsx` owns
the button + popover and absorbs the connect / pause / sign-out logic that lives
in `EmailAccountsTab` today — reusing the **unchanged** hooks
(`useEmailAccounts`, `useStartOAuthFlow`, `usePauseEmailAccount`,
`useDisconnectEmailAccount`).

**Button** (right of the sub-tab nav): `Mail` icon + "Mailboxes" + a mono
connected count + a **health indicator** derived from account statuses:
- all `active` → emerald dot, quiet.
- any `paused` (none errored) → stone dot.
- any `error` → amber dot **and** an amber tint + short "Reconnect" affordance,
  so a down mailbox (no POs flowing in) gets more weight than a 7px dot.

**Popover** (anchored, right-aligned, ~380px; `rounded-xl` `.shadow-elevated`
`border-stone-200`): a header ("Connected mailboxes" + count), then the account
list sorted **errored-first** (reuse the existing sort). Each row: status dot +
email + `provider · last sync` (or `· last_error` when errored/reconnecting),
and either an inline **Reconnect** (errored) or a **⋯ kebab** menu
(Pause/Resume + Sign out). Footer: **Connect Gmail / Connect Outlook**. Loading
→ skeleton rows (reuse the shimmer); empty → composed "No mailboxes connected"
with the two connect buttons.

**Open/close**: discrete `useState` boolean (this is allowed — it's UI toggle
state, not continuous animation). Click-outside + Escape close it; entrance is a
short CSS fade/scale (reduced-motion aware). The popover stays mounted while a
connect popup is in flight (the user opened it to click Connect), so the
existing BroadcastChannel/postMessage completion path is unaffected.
`MailboxesMenu` accepts an `autoOpenNonce?: number` prop; `POInboxView` bumps it
when it detects an OAuth callback (§4.4), and a `useEffect` on the nonce opens
the popover — so the parent triggers the open without owning the day-to-day
toggle state.

**Sign-out confirmation** stays a centered modal — reuse the existing
`SignOutConfirmDialog` (extract it from `EmailAccountsTab` into `MailboxesMenu`
or a small sibling; behaviour identical).

**Responsive**: below `sm`, the popover becomes a near-full-width sheet
(`fixed inset-x-2`, capped height, internal scroll) instead of a 380px anchored
panel, per the mobile-collapse rule.

**`formatRelative`** moves out of `EmailAccountsTab` into a small
`components/admin/emailAccountFormat.ts` (or is replaced by the equivalent
`poInboxFormat.formatAge`); the one consumer test import is updated (§5, §8).

### 4.8 `AppShell` — post-OAuth routing

`AppShell`'s `adminView` initializer (≈ lines 1291–1304) currently routes to the
PO Inbox tab **and** sets `?subtab=mailboxes` after an OAuth callback. Change it
to route to PO Inbox with `subtab=queue` (or default) and leave the
`?connected` / `?connect_error` params in place so `POInboxView` (§4.4) toasts
the result and auto-opens the popover. The `POInboxHeaderBadge` onClick
(`subtab=queue` → PO Inbox) is unaffected. The comment in `index.tsx` that
references `EmailAccountsTab::handleConnect` is updated to point at
`MailboxesMenu`.

## 5. Files touched

| File | Change |
|---|---|
| `components/admin/POInboxTab.tsx` | Triage Rail row, count tab, skeleton, empty states, staggered reveal |
| `components/admin/POInboxDetailModal.tsx` | Header band, mismatch band, input/focus styling, doc toolbar, footer, entrance — **logic untouched** |
| `components/admin/POInboxStatsTile.tsx` | `inline` variant → KPI ribbon (card variant unchanged) |
| `components/admin/POInboxView.tsx` | Title description; nav → Queue/Aliases + Mailboxes button; remove health banner; lift OAuth `?connected` handling + popover auto-open; sub-tab type |
| `components/admin/poInboxFormat.ts` | **Add** `confidenceBand(c)` (+ test); existing helpers unchanged |
| `components/admin/ConfidenceRing.tsx` | **New** shared meter-ring component |
| `components/admin/MailboxesMenu.tsx` | **New** — button + popover; absorbs connect/pause/sign-out logic from `EmailAccountsTab` (hooks unchanged) |
| `components/admin/emailAccountFormat.ts` | **New** — `formatRelative` extracted out of `EmailAccountsTab` |
| `components/admin/EmailAccountsTab.tsx` | **Removed** — logic relocated to `MailboxesMenu`; lazy import dropped from `POInboxView` |
| `components/admin/MailboxHealthBanner.tsx` | **Removed** — folded into the Mailboxes button health dot |
| `components/admin/POInboxHeaderBadge.tsx` | Optional pulse |
| `components/AppShell.tsx` | Post-OAuth routing no longer sets `subtab=mailboxes` (§4.8) |
| `index.tsx` | Comment ref `EmailAccountsTab` → `MailboxesMenu` |
| `__tests__/emailAccountsTab.test.ts` | Update `formatRelative` import path (move only — no behaviour change) |
| `index.css` | New keyframes/utilities: `.po-skeleton` shimmer, list reveal, badge pulse, popover entrance; all `prefers-reduced-motion` gated |

New file kept small and single-purpose per repo convention (many small files).

## 6. Data note (counts)

Only the **needs-review backlog** count is available cheaply (`usePendingPoCount`
/ `stats.needsReviewBacklog`). `usePoInboxStats` exposes only *today's*
per-status breakdown; all-time counts for Auto Approved / Approved / Rejected
would require a new per-status `count('exact', head:true)` query.

**Decision:** badge the Needs Review tab only. All-tab counts are an optional
future enhancement (a `usePendingPoCounts()` read hook mirroring the stats
service) and are out of scope here to keep the change behaviour-neutral.

## 7. Accessibility

- Confidence ring carries `aria-label`; status conveyed by pill text, not colour
  alone.
- Row hover affordance mirrored on `:focus` / `focus-within`; rows remain a
  single focusable `button` (unchanged).
- All entrance/perpetual motion disabled under `prefers-reduced-motion`.
- Modal keeps `role="dialog"`, `aria-modal`, labelled title, Escape-to-close
  (unchanged).
- Mailboxes button is a real `<button>` with `aria-expanded` / `aria-haspopup`;
  the popover closes on Escape and click-outside and returns focus to the
  button. The health dot has a text label (`title` / sr-only) so status isn't
  colour-only. The kebab menu items are focusable buttons.

## 8. Testing

- **Unit (vitest):** add a test for `confidenceBand(c)` covering the three
  thresholds + boundary values (0.75, 0.95). Keep all existing `poInbox*`
  tests green (no signature changes).
- **Type-check:** `tsc --noEmit` clean before deploy (no CI gate yet).
- **Build:** `npm run build` succeeds.
- **Manual:** verify each Queue status tab (incl. empty + loading), a
  needs_review PO with and without sender mismatch, the modal for text-body / PDF
  / image / DOCX sources, and a resolved (approved/rejected) read-only PO.
- **Mailboxes (manual):** open the popover; verify the health dot/tint for
  all-active / paused / errored mixes; connect via popup (success + popup-blocked
  full-tab redirect → confirm the toast fires and the popover auto-opens);
  pause/resume; sign out (Gmail + Outlook confirm copy). Keep
  `emailAccountsTab.test.ts` green after the `formatRelative` import move.

## 9. Risks

- **Visual regression in the modal** is the main risk — it has the most logic.
  Mitigated by touching only className/layout, never handlers or state.
- **Conic-gradient ring** rendering: well-supported in all evergreen browsers;
  acceptable for an internal admin tool.
- **Stagger on large lists**: clamp the delay index so the cascade stays snappy.
- **OAuth callback path** is the highest-risk part of the Mailboxes move: the
  popup-blocked full-tab redirect must still surface its result. Mitigated by
  lifting the `?connected` handling to the always-mounted `POInboxView` (§4.4)
  and updating `AppShell` routing (§4.8) — both must land together or a connect
  result could be dropped.
- **Popover positioning**: anchored panel must flip/clamp within the viewport
  and degrade to a full-width sheet under `sm` to avoid horizontal overflow.
