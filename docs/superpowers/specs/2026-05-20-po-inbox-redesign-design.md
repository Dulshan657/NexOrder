# PO Inbox redesign — design spec

**Date:** 2026-05-20
**Status:** Approved (design phase)
**Scope:** Visual redesign of the admin PO Inbox. Behaviour-neutral — no data
contracts, query keys, mutations, props, or routing change.

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
- URL sub-tab persistence (`?subtab=`) in `POInboxView`.

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
- **Sub-tabs / nav**: unchanged underline pattern (already clean and consistent).
- `MailboxHealthBanner`: minor consistency only (radii/spacing) — keep behaviour.

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

## 5. Files touched

| File | Change |
|---|---|
| `components/admin/POInboxTab.tsx` | Triage Rail row, count tab, skeleton, empty states, staggered reveal |
| `components/admin/POInboxDetailModal.tsx` | Header band, mismatch band, input/focus styling, doc toolbar, footer, entrance — **logic untouched** |
| `components/admin/POInboxStatsTile.tsx` | `inline` variant → KPI ribbon (card variant unchanged) |
| `components/admin/POInboxView.tsx` | Title description; spacing |
| `components/admin/poInboxFormat.ts` | **Add** `confidenceBand(c)` (+ test); existing helpers unchanged |
| `components/admin/ConfidenceRing.tsx` | **New** shared meter-ring component |
| `components/admin/MailboxHealthBanner.tsx` | Minor spacing/radii consistency |
| `components/admin/POInboxHeaderBadge.tsx` | Optional pulse |
| `index.css` | New keyframes/utilities: `.po-skeleton` shimmer, list reveal, badge pulse; all `prefers-reduced-motion` gated |

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

## 8. Testing

- **Unit (vitest):** add a test for `confidenceBand(c)` covering the three
  thresholds + boundary values (0.75, 0.95). Keep all existing `poInbox*`
  tests green (no signature changes).
- **Type-check:** `tsc --noEmit` clean before deploy (no CI gate yet).
- **Build:** `npm run build` succeeds.
- **Manual:** verify each Queue status tab (incl. empty + loading), a
  needs_review PO with and without sender mismatch, the modal for text-body / PDF
  / image / DOCX sources, and a resolved (approved/rejected) read-only PO.

## 9. Risks

- **Visual regression in the modal** is the main risk — it has the most logic.
  Mitigated by touching only className/layout, never handlers or state.
- **Conic-gradient ring** rendering: well-supported in all evergreen browsers;
  acceptable for an internal admin tool.
- **Stagger on large lists**: clamp the delay index so the cascade stays snappy.
