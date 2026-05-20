# PO Inbox Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behaviour-neutral visual redesign of the admin PO Inbox — a scannable "Triage Rail" queue with a conic confidence meter, hover Review action, count tab, KPI stats ribbon, skeleton + empty states, a detail-modal polish pass, and the Mailboxes sub-tab replaced by a header button + popover.

**Architecture:** React 19 + Tailwind v4 (`@theme` tokens) + Vite, no new dependency. CSS-only motion (new keyframes in `index.css`, all gated behind `prefers-reduced-motion`). Pure formatting/logic helpers live in `.ts` files and are unit-tested with Vitest (node env, `**/*.test.ts`); component/visual changes are verified with `tsc --noEmit` + `npm run build` + a manual checklist (no React-render test harness is installed).

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react (existing icon set), TanStack Query, Vitest.

**Source of truth:** `docs/superpowers/specs/2026-05-20-po-inbox-redesign-design.md`. Read its §2 behaviour-neutrality contract before starting — do not change any query hook, mutation, Edge Function, service, or the OAuth handshake logic.

**All commands run from the repo root** (`C:\Users\dulsh\OneDrive\Documents\Projects\OrderSystem\NexOrder`). Branch: `redesign/po-inbox` (already checked out).

---

## File Structure

**New files**
- `components/admin/ConfidenceRing.tsx` — shared conic confidence meter (sizes `sm`/`md`).
- `components/admin/emailAccountFormat.ts` — `formatRelative` (moved) + `summarizeMailboxHealth` (new, tested).
- `components/admin/MailboxesMenu.tsx` — Mailboxes button + popover; absorbs connect/pause/sign-out from `EmailAccountsTab`.
- `__tests__/poInbox.confidenceBand.test.ts` — unit test for `confidenceBand`.
- `__tests__/emailAccountFormat.test.ts` — unit test for `summarizeMailboxHealth` (formatRelative coverage stays in the existing file, retargeted).

**Modified files**
- `components/admin/poInboxFormat.ts` — add `confidenceBand`.
- `index.css` — add skeleton/reveal/popover/pulse keyframes + reduced-motion guard.
- `components/admin/POInboxTab.tsx` — Triage Rail row, count tab, skeleton, empty states, staggered reveal.
- `components/admin/POInboxStatsTile.tsx` — `inline` variant → KPI ribbon.
- `components/admin/POInboxDetailModal.tsx` — header band, mismatch band, input focus styling, doc toolbar, footer, entrance (logic untouched).
- `components/admin/POInboxView.tsx` — nav → Queue/Aliases + Mailboxes button; remove health banner; lift OAuth handling; sub-tab type.
- `components/AppShell.tsx` — post-OAuth routing no longer sets `subtab=mailboxes`.
- `index.tsx` — update a comment reference.
- `__tests__/emailAccountsTab.test.ts` — retarget `formatRelative` import.

**Deleted files** (last, after consumers are rewired)
- `components/admin/EmailAccountsTab.tsx`
- `components/admin/MailboxHealthBanner.tsx`

---

## Task 1: `confidenceBand` helper

**Files:**
- Modify: `components/admin/poInboxFormat.ts` (append)
- Test: `__tests__/poInbox.confidenceBand.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/poInbox.confidenceBand.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { confidenceBand } from '@/components/admin/poInboxFormat'

describe('confidenceBand', () => {
  it('returns high at and above 0.95', () => {
    expect(confidenceBand(0.95).key).toBe('high')
    expect(confidenceBand(1).key).toBe('high')
  })

  it('returns mid in [0.75, 0.95)', () => {
    expect(confidenceBand(0.75).key).toBe('mid')
    expect(confidenceBand(0.9499).key).toBe('mid')
  })

  it('returns low below 0.75', () => {
    expect(confidenceBand(0.7499).key).toBe('low')
    expect(confidenceBand(0).key).toBe('low')
  })

  it('exposes ring/track colours and a text class', () => {
    const b = confidenceBand(0.5)
    expect(b.ringColor).toMatch(/^#/)
    expect(b.trackColor).toMatch(/^#/)
    expect(b.textClass).toContain('text-')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/poInbox.confidenceBand.test.ts`
Expected: FAIL — `confidenceBand` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `components/admin/poInboxFormat.ts`:

```ts
export type ConfidenceBandKey = 'high' | 'mid' | 'low'

export interface ConfidenceBand {
  key: ConfidenceBandKey
  /** CSS colour for the conic-gradient fill. */
  ringColor: string
  /** CSS colour for the unfilled track. */
  trackColor: string
  /** Tailwind class for the centred percentage text. */
  textClass: string
}

/** Unfilled track colour for the confidence ring (stone-tinted). */
const RING_TRACK = '#f1f0ee'

/**
 * Maps a 0..1 confidence to its colour band. Thresholds mirror the
 * existing `confidenceBadgeStyle` / per-row tone helpers so every
 * confidence surface agrees: >=0.95 emerald, >=0.75 amber, else rose.
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.95) {
    return { key: 'high', ringColor: '#34d399', trackColor: RING_TRACK, textClass: 'text-emerald-700' }
  }
  if (confidence >= 0.75) {
    return { key: 'mid', ringColor: '#fbbf24', trackColor: RING_TRACK, textClass: 'text-amber-700' }
  }
  return { key: 'low', ringColor: '#f43f5e', trackColor: RING_TRACK, textClass: 'text-rose-700' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/poInbox.confidenceBand.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/admin/poInboxFormat.ts __tests__/poInbox.confidenceBand.test.ts
git commit -m "feat(po-inbox): add confidenceBand colour-band helper"
```

---

## Task 2: CSS motion utilities

**Files:**
- Modify: `index.css` (append inside/after the existing `@layer utilities` and keyframes block)

- [ ] **Step 1: Add the keyframes + utilities**

Append to `index.css` (after the existing `.btn-press` utilities and icon keyframes, before the cart-push block is fine — order is not significant):

```css
/* PO Inbox redesign — skeleton shimmer, list reveal, popover, badge pulse */
@keyframes po-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.po-skeleton {
  background: #ece9e6;
  background-image: linear-gradient(90deg, #ece9e6 0px, #f5f3f1 200px, #ece9e6 400px);
  background-size: 800px 100%;
  animation: po-shimmer 1.4s linear infinite;
  border-radius: 6px;
}

@keyframes po-row-in {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
/* --po-i is set inline (clamped index) so rows cascade in. */
.po-row-in {
  animation: po-row-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--po-i, 0) * 40ms);
}

@keyframes po-pop-in {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.po-pop-in {
  animation: po-pop-in 0.16s cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: top right;
}

@keyframes po-badge-pulse {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%      { transform: scale(1.12); opacity: 0.85; }
}
.po-badge-pulse { animation: po-badge-pulse 2.2s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .po-skeleton,
  .po-row-in,
  .po-pop-in,
  .po-badge-pulse {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Verify the build is clean**

Run: `npm run build`
Expected: build succeeds (Tailwind compiles the new CSS; no errors).

- [ ] **Step 3: Commit**

```bash
git add index.css
git commit -m "feat(po-inbox): add CSS motion utilities (skeleton, reveal, popover, pulse)"
```

---

## Task 3: `ConfidenceRing` component

**Files:**
- Create: `components/admin/ConfidenceRing.tsx`

- [ ] **Step 1: Create the component**

```tsx
// ConfidenceRing — a conic-gradient meter whose fill is proportional to the
// 0..1 AI-extraction confidence, colour-banded via confidenceBand, with the
// percentage in the centre. Shared by the Queue rows (sm) and the detail
// modal header (md).

import React from 'react'
import { confidenceBand } from './poInboxFormat'

interface ConfidenceRingProps {
  /** 0..1 confidence. */
  value: number
  size?: 'sm' | 'md'
}

const DIMENSIONS = {
  sm: { outer: 44, inner: 34, font: 'text-[11px]' },
  md: { outer: 48, inner: 37, font: 'text-xs' },
} as const

const ConfidenceRing: React.FC<ConfidenceRingProps> = ({ value, size = 'sm' }) => {
  const band = confidenceBand(value)
  const pct = Math.round(value * 100)
  const dim = DIMENSIONS[size]
  return (
    <div
      role="img"
      aria-label={`AI confidence ${pct}%`}
      title={`AI confidence ${pct}%`}
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{
        width: dim.outer,
        height: dim.outer,
        background: `conic-gradient(${band.ringColor} ${pct}%, ${band.trackColor} 0)`,
      }}
    >
      <span
        className={`rounded-full bg-white flex items-center justify-center font-mono font-semibold ${dim.font} ${band.textClass}`}
        style={{ width: dim.inner, height: dim.inner }}
      >
        {pct}%
      </span>
    </div>
  )
}

export default ConfidenceRing
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/ConfidenceRing.tsx
git commit -m "feat(po-inbox): add shared ConfidenceRing meter component"
```

---

## Task 4: Queue Triage Rail row + count tab

**Files:**
- Modify: `components/admin/POInboxTab.tsx` (imports; `FilterTab` ~127-140; `Row` ~180-228; tab nav ~53-65)

Reference the current file before editing. This task replaces the `Row` body and adds a count badge to the Needs Review filter tab. `senderMismatch`, `usePendingPos`, `sortForDisplay`, `formatAge`, and the `onClick`→`setOpenId` wiring stay exactly as they are.

- [ ] **Step 1: Update imports**

In `components/admin/POInboxTab.tsx`, add the ring + count hook + status badge import. Change the existing import lines:

```tsx
import { AlertTriangle, ChevronRight, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { usePendingPos, usePendingPoCount } from '@/hooks/queries/usePendingPos'
import { PO_INBOX_TABS, formatAge, sortForDisplay, statusBadge } from './poInboxFormat'
import ConfidenceRing from './ConfidenceRing'
```

(Adds `ChevronRight`, `usePendingPoCount`, `statusBadge`, `ConfidenceRing`. Keeps `senderMismatch` and the type imports as-is.)

- [ ] **Step 2: Fetch the needs-review count in the component**

Inside `POInboxTab`, just below the existing `const { data, isLoading, isFetching, refetch } = usePendingPos(activeStatus)` line, add:

```tsx
  const { data: needsReviewCount } = usePendingPoCount()
```

- [ ] **Step 3: Render the count badge on the Needs Review tab**

Replace the `PO_INBOX_TABS.map(...)` block (inside the `<nav aria-label="PO status filter">`) with:

```tsx
          {PO_INBOX_TABS.map(tab => (
            <FilterTab
              key={tab.key}
              active={activeStatus === tab.key}
              onClick={() => setActiveStatus(tab.key as PendingPoStatus)}
              title={tab.description}
              count={tab.key === 'needs_review' ? needsReviewCount : undefined}
            >
              {tab.label}
            </FilterTab>
          ))}
```

- [ ] **Step 4: Update `FilterTab` to render the count**

Replace the whole `FilterTab` component (and its props interface) with:

```tsx
interface FilterTabProps {
  active: boolean
  onClick: () => void
  title?: string
  count?: number
  children: React.ReactNode
}

const FilterTab: React.FC<FilterTabProps> = ({ active, onClick, title, count, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`py-2.5 text-sm transition-colors border-b-2 inline-flex items-center gap-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
    }`}
  >
    {children}
    {typeof count === 'number' && count > 0 && (
      <span className="font-mono text-[11px] rounded-full px-1.5 leading-5 bg-amber-50 text-amber-700 border border-amber-200">
        {count > 99 ? '99+' : count}
      </span>
    )}
  </button>
)
```

- [ ] **Step 5: Wrap the row list with the rounded container**

Replace the `<ul className="divide-y divide-stone-200/70">…</ul>` rows block (the `: (` branch after `<Empty>`) with a bordered container and indexed reveal:

```tsx
          <ul className="divide-y divide-stone-200/70 rounded-xl border border-stone-200 overflow-hidden bg-white">
            {rows.map((row, i) => (
              <Row
                key={row.id}
                row={row}
                index={i}
                hoReCa={row.matched_horeca_id != null ? horecaById.get(row.matched_horeca_id) : undefined}
                onClick={() => setOpenId(row.id)}
              />
            ))}
          </ul>
```

- [ ] **Step 6: Replace the `Row` component (and its props) with the Triage Rail layout**

Replace `interface RowProps { … }` through the end of the `Row` component with:

```tsx
interface RowProps {
  row: PendingPoSummaryRow
  hoReCa: HoReCa | undefined
  index: number
  onClick: () => void
}

const Row: React.FC<RowProps> = ({ row, hoReCa, index, onClick }) => {
  const customerName = hoReCa?.name ?? (row.matched_horeca_id ? `#${row.matched_horeca_id}` : null)
  const mismatch = senderMismatch(row.confidence_fields)
  const badge = statusBadge(row.status)
  // Priority rail: rose when risky (mismatch or low confidence), else the
  // status hue. Drives the eye to the rows that need a human first.
  const risky = !!mismatch || row.confidence_overall < 0.75
  const railClass = risky
    ? 'border-rose-400'
    : row.status === 'needs_review'
      ? 'border-amber-400'
      : 'border-transparent'
  // Clamp the stagger so a long backlog doesn't cascade forever.
  const revealIndex = Math.min(index, 12)

  return (
    <li className="po-row-in" style={{ '--po-i': revealIndex } as React.CSSProperties}>
      <button
        type="button"
        onClick={onClick}
        className={`group w-full text-left flex items-center gap-4 py-3 pl-4 pr-3 border-l-[3px] ${railClass} transition-colors hover:bg-stone-50 focus:outline-none focus-visible:bg-stone-50`}
      >
        <ConfidenceRing value={row.confidence_overall} size="sm" />

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-stone-900 truncate">
              {row.subject?.trim() || '(no subject)'}
            </span>
            {row.approved_order_id && (
              <span className="text-xs font-mono text-stone-500">{row.approved_order_id}</span>
            )}
            {mismatch && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5"
                title={`Sender mismatch — ${mismatch.sender ?? 'unknown'} is not a known address for this customer. Verify before approving.`}
              >
                <AlertTriangle className="w-3 h-3" /> sender mismatch
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500">
            {customerName ? (
              <span className="truncate">{customerName}</span>
            ) : (
              <span className="italic text-stone-400">unresolved</span>
            )}
            <span aria-hidden>·</span>
            <span className="truncate">{row.from_address || 'unknown sender'}</span>
            <span aria-hidden>·</span>
            <span>{formatAge(row.received_at)}</span>
          </span>
        </span>

        <span
          className={`shrink-0 text-[11px] font-medium rounded-full border px-2.5 py-0.5 ${badge.className}`}
        >
          {badge.label}
        </span>

        {/* Hover/focus affordance: chevron swaps to a Review pill. */}
        <span className="shrink-0 w-[68px] flex justify-end" aria-hidden>
          <ChevronRight className="w-4 h-4 text-stone-300 group-hover:hidden group-focus-visible:hidden" />
          <span className="hidden group-hover:inline-flex group-focus-visible:inline-flex items-center gap-1 text-xs font-semibold text-nexgen-blue border border-nexgen-blue/30 bg-white rounded-lg px-2.5 py-1">
            Review <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </span>
      </button>
    </li>
  )
}
```

Note: the old module-level `STATUS_LABEL`, `STATUS_TONE`, and `confidenceTone` constants in this file are now unused (status comes from `statusBadge`, confidence from the ring). Delete them.

- [ ] **Step 7: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors (in particular, no "unused variable" — confirm `STATUS_LABEL`/`STATUS_TONE`/`confidenceTone` were removed).
Run: `npm run build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add components/admin/POInboxTab.tsx
git commit -m "feat(po-inbox): Triage Rail queue rows + needs-review count tab"
```

---

## Task 5: Queue skeleton loader + composed empty states

**Files:**
- Modify: `components/admin/POInboxTab.tsx` (loading branch ~78-82; `Empty` ~142-152)

- [ ] **Step 1: Replace the loading spinner with a skeleton list**

Replace the `isLoading ? (...) :` branch (the `<div className="py-10 …">Loading…</div>`) with:

```tsx
        {isLoading ? (
          <QueueSkeleton />
        ) : rows.length === 0 ? (
```

- [ ] **Step 2: Add the `QueueSkeleton` component**

Add near the other subcomponents in the file:

```tsx
const QueueSkeleton: React.FC = () => (
  <ul className="divide-y divide-stone-200/70 rounded-xl border border-stone-200 overflow-hidden bg-white">
    {Array.from({ length: 4 }).map((_, i) => (
      <li key={i} className="flex items-center gap-4 py-3 pl-4 pr-3">
        <div className="po-skeleton shrink-0" style={{ width: 44, height: 44, borderRadius: 999 }} />
        <div className="flex-1">
          <div className="po-skeleton" style={{ width: `${55 + (i % 3) * 12}%`, height: 12 }} />
          <div className="po-skeleton mt-2" style={{ width: `${40 + (i % 2) * 10}%`, height: 9 }} />
        </div>
        <div className="po-skeleton shrink-0" style={{ width: 74, height: 20, borderRadius: 999 }} />
      </li>
    ))}
  </ul>
)
```

- [ ] **Step 3: Replace the `Empty` component with composed per-status states**

Replace the existing `Empty` component with:

```tsx
const EMPTY_COPY: Record<PendingPoStatus, { icon: React.ReactNode; title: string; body: string; tint: string }> = {
  needs_review: {
    icon: <CheckCircle2 className="w-6 h-6 text-emerald-600" />,
    title: 'Inbox zero — nothing to review',
    body: 'High-confidence POs flow straight through to Auto Approved. Anything the AI is unsure about lands here.',
    tint: 'bg-emerald-50',
  },
  auto_approved: {
    icon: <Inbox className="w-6 h-6 text-teal-600" />,
    title: 'No auto-approved POs yet',
    body: 'When the AI extracts a PO with full confidence, it becomes an order automatically and shows up here.',
    tint: 'bg-teal-50',
  },
  approved: {
    icon: <CheckCircle2 className="w-6 h-6 text-emerald-600" />,
    title: 'Nothing approved here yet',
    body: 'POs you approve from Needs Review appear here with their created order id.',
    tint: 'bg-emerald-50',
  },
  rejected: {
    icon: <Inbox className="w-6 h-6 text-stone-400" />,
    title: 'No rejected POs',
    body: 'POs you reject (with a recorded reason) are kept here for the audit trail.',
    tint: 'bg-stone-100',
  },
}

const Empty: React.FC<{ status: PendingPoStatus }> = ({ status }) => {
  const copy = EMPTY_COPY[status]
  return (
    <div className="py-16 text-center">
      <div className={`mx-auto w-13 h-13 rounded-full flex items-center justify-center ${copy.tint}`} style={{ width: 52, height: 52 }}>
        {copy.icon}
      </div>
      <p className="mt-4 font-semibold text-stone-900">{copy.title}</p>
      <p className="mt-1.5 mx-auto max-w-sm text-sm text-stone-500 leading-relaxed">{copy.body}</p>
    </div>
  )
}
```

- [ ] **Step 4: Add `CheckCircle2` to the lucide import**

Update the icon import to include `CheckCircle2`:

```tsx
import { AlertTriangle, CheckCircle2, ChevronRight, Inbox, Loader2, RefreshCw } from 'lucide-react'
```

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit` → no errors.
Run: `npm run build` → success.

- [ ] **Step 6: Commit**

```bash
git add components/admin/POInboxTab.tsx
git commit -m "feat(po-inbox): skeleton loader + composed empty states for the Queue"
```

---

## Task 6: Stats ribbon (`POInboxStatsTile` inline variant)

**Files:**
- Modify: `components/admin/POInboxStatsTile.tsx` (inline branch ~39-55, `InlineStat`/`InlineDivider` ~136-151)

The `card` variant and all data wiring stay unchanged. Only the `inline` branch is restyled.

- [ ] **Step 1: Replace the `inline` return block**

Replace the `if (variant === 'inline') { return ( … ) }` block with:

```tsx
  if (variant === 'inline') {
    return (
      <dl className="inline-flex items-stretch rounded-xl border border-stone-200 bg-white overflow-hidden divide-x divide-stone-200/70">
        <RibbonStat label="Received" value={received} />
        <RibbonStat label="Auto-approved" value={autoApproved} tone="emerald" />
        <RibbonStat label="Needs review" value={backlog} tone={backlogTone} emphasise />
        <RibbonStat
          label="Cost today"
          value={costToday}
          sub={data?.costUsdSevenDayAvg != null ? `7d ${describeCost(data.costUsdSevenDayAvg)}/d` : undefined}
        />
      </dl>
    )
  }
```

- [ ] **Step 2: Replace `InlineStat` + `InlineDivider` with `RibbonStat`**

Replace the `InlineStat` interface + component and the `InlineDivider` component with:

```tsx
interface RibbonStatProps {
  label: string
  value: string
  tone?: Tone
  sub?: string
  emphasise?: boolean
}

const RibbonStat: React.FC<RibbonStatProps> = ({ label, value, tone = 'default', sub, emphasise }) => (
  <div className={`px-4 py-2 text-right ${emphasise ? 'bg-amber-50' : ''}`}>
    <dt
      className={`text-[10px] uppercase tracking-wide ${
        emphasise ? 'text-amber-700' : 'text-stone-400'
      }`}
    >
      {label}
    </dt>
    <dd className={`font-mono text-base leading-tight ${INLINE_VALUE_TONE[tone]} ${emphasise ? 'font-bold' : 'font-semibold'}`}>
      {value}
    </dd>
    {sub && <div className="text-[10px] font-mono text-stone-400 leading-tight">{sub}</div>}
  </div>
)
```

(`INLINE_VALUE_TONE` already exists in the file and is reused.)

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → no errors (confirm no leftover references to `InlineStat`/`InlineDivider`).
Run: `npm run build` → success.

- [ ] **Step 4: Commit**

```bash
git add components/admin/POInboxStatsTile.tsx
git commit -m "feat(po-inbox): KPI stats ribbon for the inline tile variant"
```

---

## Task 7: Detail modal polish

**Files:**
- Modify: `components/admin/POInboxDetailModal.tsx` (container ~365-368; `Header` ~488-533; `DocumentPane` toolbar ~558-575; FormPane inputs throughout; mismatch callout ~755-765; `Footer` ~1288-1333)

Polish only. Do NOT change handlers, state, mutations, the document-preview logic, address modes, or `canApprove`.

- [ ] **Step 1: Add `ConfidenceRing` + `statusBadge` imports**

Add to the imports:

```tsx
import ConfidenceRing from './ConfidenceRing'
import { statusBadge } from './poInboxFormat'
```

- [ ] **Step 2: Soften the modal container shadow + add entrance**

Change the inner modal container className (currently `className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"`) to:

```tsx
        className="relative w-full max-w-6xl bg-white rounded-2xl shadow-elevated overflow-hidden flex flex-col po-pop-in"
```

- [ ] **Step 3: Rebuild the `Header` with the ring + status pill**

Replace the `Header` component body's returned JSX with:

```tsx
  const badge = detail ? statusBadge(detail.status) : null
  return (
    <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-stone-200/70">
      {detail && <ConfidenceRing value={detail.confidence_overall} size="md" />}
      <div className="min-w-0 flex-1">
        <h2
          id={DIALOG_TITLE_ID}
          className="font-display font-semibold text-stone-900 truncate text-base sm:text-lg tracking-tight"
        >
          {detail?.subject || 'Inbound PO'}
        </h2>
        {detail && (
          <div className="mt-1 text-xs text-stone-500 flex flex-wrap items-center gap-x-2">
            <span className="truncate">From {detail.from_address}</span>
            <span aria-hidden>·</span>
            <span>PO {detail.extracted_po.po_number ?? '(no number)'}</span>
          </div>
        )}
      </div>
      {badge && (
        <span className={`shrink-0 text-[11px] font-medium rounded-full border px-2.5 py-0.5 ${badge.className}`}>
          {badge.label}
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-md hover:bg-stone-100 text-stone-500 hover:text-stone-800"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
```

The `STATUS_DOT_TONE` and `confidenceTextTone` module constants are now unused — delete them.

- [ ] **Step 4: Promote the sender-mismatch warning to a band under the header**

In the modal's main return (in `POInboxDetailModal`), insert a mismatch band immediately after `<Header … />` and before the loading/`<div className="flex-1 grid …">` block:

```tsx
        <Header detail={detail} onClose={onClose} />

        {detail && senderMismatch(detail.confidence_fields) && (
          <div className="flex items-start gap-2 px-4 sm:px-6 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <p>
              <span className="font-semibold">Sender mismatch.</span>{' '}
              {senderMismatch(detail.confidence_fields)?.sender ?? 'An unknown address'} is not a known
              address for this customer. Verify the sender is genuine before approving.
            </p>
          </div>
        )}
```

Then remove the in-form mismatch callout in `FormPane` (the `{mismatch && ( <div className="mt-2 rounded-lg border border-rose-300 …"> … </div> )}` block under the Customer select) to avoid showing the warning twice. Leave the `mismatch`/`matchedCustomerName` computations only if still referenced; if `matchedCustomerName` becomes unused after removal, delete it too (verify with tsc).

- [ ] **Step 5: Unify input styling with a focus ring**

This file repeats the input className `"w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"` (and a couple of `rounded-lg … px-3 py-2` variants) across the customer select, date/slot, address inputs, line qty/pack, and notes. Standardise them to include a nexgen-blue focus ring. Define a shared constant near the top of the file (after imports):

```tsx
const FIELD_CLASS =
  'w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:border-nexgen-blue focus:ring-2 focus:ring-nexgen-blue/20 disabled:bg-stone-100 disabled:text-stone-500'
```

Then replace each input/select/textarea `className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:bg-stone-100"` (and the customer select's `"w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100"`) with `className={FIELD_CLASS}`. Use Edit with `replace_all` for the repeated literal, then handle the customer-select variant separately.

- [ ] **Step 6: Polish the document-pane toolbar**

In `DocumentPane`, replace the toolbar `<div className="px-3 py-2 text-xs text-stone-500 border-b border-stone-200 bg-white flex items-center gap-2">` opening so the label is uppercase and the link is a btn-press pill — change only the label span and keep the conditional "Open in new tab" anchor:

```tsx
      <div className="px-3 py-2 text-xs text-stone-500 border-b border-stone-200 bg-white flex items-center gap-2">
        <FileText className="w-3.5 h-3.5" />
        <span className="uppercase tracking-wide font-semibold text-stone-600">
          Original · {isTextBody ? 'Email body' : format.toUpperCase()}
        </span>
```

(Leave the rest of `DocumentPane` — the iframe/img/PDF/DOCX branches — exactly as-is.)

- [ ] **Step 7: Rebalance the `Footer` primary/secondary actions**

In the active (`needs_review`) branch of `Footer`, replace the `<div className="flex items-center justify-end gap-3">` action row with:

```tsx
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => props.setShowRejectForm(!props.showRejectForm)}
          className="text-sm font-medium text-stone-500 hover:text-rose-700 transition-colors btn-press"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={props.onApprove}
          disabled={!props.canApprove}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed btn-press"
          title={
            props.canApprove
              ? 'Create a real order from this PO'
              : 'Pick a customer and a product for every line first'
          }
        >
          {props.approving ? 'Approving…' : 'Approve & create order'}
        </button>
      </div>
```

- [ ] **Step 8: Type-check + build**

Run: `npx tsc --noEmit` → no errors (resolve any now-unused vars flagged: `STATUS_DOT_TONE`, `confidenceTextTone`, possibly `matchedCustomerName`).
Run: `npm run build` → success.

- [ ] **Step 9: Commit**

```bash
git add components/admin/POInboxDetailModal.tsx
git commit -m "feat(po-inbox): detail modal polish (header band, mismatch band, focus rings, footer)"
```

---

## Task 8: `emailAccountFormat.ts` — move `formatRelative`, add `summarizeMailboxHealth`

**Files:**
- Create: `components/admin/emailAccountFormat.ts`
- Test: `__tests__/emailAccountFormat.test.ts` (create)
- Modify: `__tests__/emailAccountsTab.test.ts` (retarget import)

- [ ] **Step 1: Write the failing test for `summarizeMailboxHealth`**

Create `__tests__/emailAccountFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summarizeMailboxHealth, formatRelative } from '@/components/admin/emailAccountFormat'

const acct = (status: 'active' | 'paused' | 'error') => ({ status })

describe('summarizeMailboxHealth', () => {
  it('reports ok when all active', () => {
    const h = summarizeMailboxHealth([acct('active'), acct('active')])
    expect(h.tone).toBe('ok')
    expect(h.count).toBe(2)
    expect(h.erroredCount).toBe(0)
  })

  it('reports paused when one paused and none errored', () => {
    const h = summarizeMailboxHealth([acct('active'), acct('paused')])
    expect(h.tone).toBe('paused')
    expect(h.pausedCount).toBe(1)
  })

  it('reports error when any errored (error wins over paused)', () => {
    const h = summarizeMailboxHealth([acct('paused'), acct('error')])
    expect(h.tone).toBe('error')
    expect(h.erroredCount).toBe(1)
  })

  it('handles empty list', () => {
    const h = summarizeMailboxHealth([])
    expect(h).toEqual({ count: 0, erroredCount: 0, pausedCount: 0, tone: 'ok' })
  })
})

describe('formatRelative (moved)', () => {
  it('still formats minutes', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/emailAccountFormat.test.ts`
Expected: FAIL — module `emailAccountFormat` does not exist.

- [ ] **Step 3: Create the module**

Create `components/admin/emailAccountFormat.ts`:

```ts
// Pure formatting + summary helpers for the Mailboxes UI. Kept in a .ts
// file (no React) so Vitest can exercise them. formatRelative was moved
// here out of EmailAccountsTab when that tab collapsed into MailboxesMenu.

import type { EmailAccountStatus } from '@/services/supabase/emailAccountsService'

/**
 * Lightweight relative-time formatter. Avoids a date library dependency.
 * Precision beyond "minutes ago" is not load-bearing.
 */
export function formatRelative(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const deltaSec = Math.round((nowMs - t) / 1000)
  if (deltaSec < 60) return 'just now'
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} min ago`
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)} h ago`
  return `${Math.round(deltaSec / 86_400)} d ago`
}

export type MailboxHealthTone = 'ok' | 'paused' | 'error'

export interface MailboxHealth {
  count: number
  erroredCount: number
  pausedCount: number
  tone: MailboxHealthTone
}

/**
 * Summarises connected mailboxes for the header button's health dot.
 * error wins over paused wins over ok.
 */
export function summarizeMailboxHealth(
  accounts: ReadonlyArray<{ status: EmailAccountStatus }>,
): MailboxHealth {
  let erroredCount = 0
  let pausedCount = 0
  for (const a of accounts) {
    if (a.status === 'error') erroredCount += 1
    else if (a.status === 'paused') pausedCount += 1
  }
  const tone: MailboxHealthTone =
    erroredCount > 0 ? 'error' : pausedCount > 0 ? 'paused' : 'ok'
  return { count: accounts.length, erroredCount, pausedCount, tone }
}
```

- [ ] **Step 4: Retarget the existing `formatRelative` test import**

In `__tests__/emailAccountsTab.test.ts`, change line 3 from:

```ts
import { formatRelative } from '../components/admin/EmailAccountsTab'
```

to:

```ts
import { formatRelative } from '../components/admin/emailAccountFormat'
```

- [ ] **Step 5: Run both tests**

Run: `npx vitest run __tests__/emailAccountFormat.test.ts __tests__/emailAccountsTab.test.ts`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add components/admin/emailAccountFormat.ts __tests__/emailAccountFormat.test.ts __tests__/emailAccountsTab.test.ts
git commit -m "feat(po-inbox): extract emailAccountFormat (formatRelative + summarizeMailboxHealth)"
```

---

## Task 9: `MailboxesMenu` component (button + popover)

**Files:**
- Create: `components/admin/MailboxesMenu.tsx`

This absorbs the connect/pause/sign-out logic from `EmailAccountsTab` verbatim (hooks unchanged) and adds the button + popover shell. It does NOT include the `?connected` URL effect — that lifts to `POInboxView` in Task 10.

- [ ] **Step 1: Create the component**

Create `components/admin/MailboxesMenu.tsx`:

```tsx
// MailboxesMenu — header button + popover for connecting and managing the
// Gmail / Outlook mailboxes the PO Inbox poller scans. Replaces the former
// Mailboxes sub-tab (EmailAccountsTab). All data hooks and the OAuth popup
// handshake are unchanged — only the presentation moved into a popover.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Mail,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Link as LinkIcon,
  LogOut,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react'
import {
  useDisconnectEmailAccount,
  useEmailAccounts,
  usePauseEmailAccount,
  useStartOAuthFlow,
} from '@/hooks/queries/useEmailAccounts'
import type {
  EmailAccountProvider,
  EmailAccountRow,
  EmailAccountStatus,
} from '@/services/supabase/emailAccountsService'
import { formatRelative, summarizeMailboxHealth } from './emailAccountFormat'

interface MailboxesMenuProps {
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /** Bumped by POInboxView after an OAuth callback to auto-open the popover. */
  autoOpenNonce?: number
}

const PROVIDER_LABEL: Record<EmailAccountProvider, string> = {
  gmail: 'Gmail / Google Workspace',
  outlook: 'Microsoft 365 / Outlook',
}

const STATUS_DOT: Record<EmailAccountStatus, { label: string; dot: string; text: string }> = {
  active: { label: 'Active', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  paused: { label: 'Paused', dot: 'bg-stone-400', text: 'text-stone-500' },
  error: { label: 'Needs reconnect', dot: 'bg-amber-500', text: 'text-amber-700' },
  signed_out: { label: 'Signed out', dot: 'bg-stone-300', text: 'text-stone-400' },
}

const HEALTH_DOT: Record<'ok' | 'paused' | 'error', string> = {
  ok: 'bg-emerald-500',
  paused: 'bg-stone-400',
  error: 'bg-amber-500',
}

const MailboxesMenu: React.FC<MailboxesMenuProps> = ({ addToast, autoOpenNonce }) => {
  const accountsQuery = useEmailAccounts()
  const startOAuth = useStartOAuthFlow()
  const pauseMutation = usePauseEmailAccount()
  const disconnectMutation = useDisconnectEmailAccount()

  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState<EmailAccountProvider | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<EmailAccountRow | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const accounts = accountsQuery.data ?? []
  const health = summarizeMailboxHealth(accounts)
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        if (a.status === 'error' && b.status !== 'error') return -1
        if (b.status === 'error' && a.status !== 'error') return 1
        return a.email_address.localeCompare(b.email_address)
      }),
    [accounts],
  )

  // Parent (POInboxView) bumps autoOpenNonce after an OAuth callback.
  useEffect(() => {
    if (autoOpenNonce && autoOpenNonce > 0) setOpen(true)
  }, [autoOpenNonce])

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setMenuFor(null)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setMenuFor(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleConnect(provider: EmailAccountProvider) {
    try {
      setConnecting(provider)
      const { authorizeUrl } = await startOAuth.mutateAsync(provider)
      const popup = window.open(authorizeUrl, 'nexorder-po-oauth', 'width=520,height=720,popup=yes')
      if (!popup) {
        addToast?.(
          'Popup was blocked — opening the connect flow in this tab instead. You will be asked to sign in again after connecting.',
          'info',
        )
        window.location.href = authorizeUrl
        return
      }

      const expectedOrigin = window.location.origin
      type OAuthCompleteMessage = {
        type?: string
        connected?: boolean
        error?: string | null
        message?: string | null
      }
      const onCompleteMsg = (data: OAuthCompleteMessage) => {
        if (!data || data.type !== 'nexorder-oauth-complete') return
        cleanup()
        if (data.connected) {
          addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
          accountsQuery.refetch()
        } else if (data.error) {
          addToast?.(`Connect failed (${data.error}): ${data.message ?? data.error}`, 'error')
        }
      }

      let channel: BroadcastChannel | null = null
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('nexorder-oauth')
        channel.addEventListener('message', e => onCompleteMsg(e.data as OAuthCompleteMessage))
      }
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return
        onCompleteMsg(event.data as OAuthCompleteMessage)
      }
      window.addEventListener('message', handleMessage)

      const startedAt = Date.now()
      const closedPoll = window.setInterval(() => {
        if (popup.closed) {
          cleanup()
          return
        }
        if (Date.now() - startedAt > 5 * 60_000) cleanup()
      }, 800)

      function cleanup() {
        window.removeEventListener('message', handleMessage)
        window.clearInterval(closedPoll)
        if (channel) {
          channel.close()
          channel = null
        }
        setConnecting(null)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Could not start OAuth flow: ${message}`, 'error')
      setConnecting(null)
    }
  }

  async function handlePauseToggle(account: EmailAccountRow) {
    setMenuFor(null)
    if (account.status === 'error') {
      addToast?.('This account needs reconnecting — Pause/Resume will not recover it. Use Reconnect.', 'info')
      return
    }
    const desiredStatus = account.status === 'active' ? 'paused' : 'active'
    try {
      await pauseMutation.mutateAsync({ id: account.id, desiredStatus })
      addToast?.(
        `Mailbox ${account.email_address} ${desiredStatus === 'paused' ? 'paused' : 'resumed'}.`,
        'success',
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Update failed: ${message}`, 'error')
    }
  }

  async function handleSignOutConfirm(account: EmailAccountRow): Promise<void> {
    try {
      const result = await disconnectMutation.mutateAsync(account.id)
      addToast?.(`Signed out of ${account.email_address}.`, 'success')
      if (result.manualRevokeUrl) {
        addToast?.(
          `To fully revoke at Microsoft, visit ${result.manualRevokeUrl} and remove NexOrder's access.`,
          'info',
        )
      }
      setSignOutTarget(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      addToast?.(`Sign out failed: ${message}`, 'error')
    }
  }

  const errored = health.tone === 'error'

  return (
    <div className="relative pb-1.5" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 text-sm font-medium rounded-lg border px-3 py-1.5 transition-colors btn-press ${
          errored
            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
            : 'bg-white border-stone-200 text-stone-800 hover:bg-stone-50'
        }`}
      >
        <Mail className="w-4 h-4 text-stone-500" />
        Mailboxes
        {health.count > 0 && <span className="font-mono text-[11px] text-stone-500">{health.count}</span>}
        <span
          className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[health.tone]}`}
          title={
            health.tone === 'error'
              ? `${health.erroredCount} mailbox${health.erroredCount === 1 ? '' : 'es'} need reconnecting`
              : health.tone === 'paused'
                ? `${health.pausedCount} paused`
                : 'All mailboxes healthy'
          }
        />
        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connected mailboxes"
          className="po-pop-in absolute right-0 top-[calc(100%+6px)] z-30 w-[380px] max-w-[calc(100vw-1rem)] rounded-xl border border-stone-200 bg-white shadow-elevated overflow-hidden
                     max-sm:fixed max-sm:inset-x-2 max-sm:right-2 max-sm:top-auto max-sm:w-auto"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/70">
            <span className="font-semibold text-sm text-stone-900">Connected mailboxes</span>
            <span className="font-mono text-[11px] text-stone-400">{health.count}</span>
          </div>

          {accountsQuery.isLoading ? (
            <MailboxSkeleton />
          ) : sortedAccounts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Mail className="w-7 h-7 mx-auto text-stone-300" />
              <p className="mt-2 text-sm text-stone-600">No mailboxes connected yet.</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-auto divide-y divide-stone-200/60">
              {sortedAccounts.map(account => (
                <AccountRow
                  key={account.id}
                  account={account}
                  menuOpen={menuFor === account.id}
                  onToggleMenu={() => setMenuFor(id => (id === account.id ? null : account.id))}
                  onConnect={handleConnect}
                  onTogglePause={handlePauseToggle}
                  onSignOut={a => {
                    setMenuFor(null)
                    setSignOutTarget(a)
                  }}
                  busy={pauseMutation.isPending}
                />
              ))}
            </ul>
          )}

          <div className="flex gap-2 px-4 py-3 border-t border-stone-200/70 bg-stone-50">
            <ConnectButton provider="gmail" busy={connecting === 'gmail'} disabled={startOAuth.isPending && connecting !== 'gmail'} onClick={handleConnect} />
            <ConnectButton provider="outlook" busy={connecting === 'outlook'} disabled={startOAuth.isPending && connecting !== 'outlook'} onClick={handleConnect} />
          </div>
        </div>
      )}

      {signOutTarget && (
        <SignOutConfirmDialog
          account={signOutTarget}
          submitting={disconnectMutation.isPending}
          onCancel={() => setSignOutTarget(null)}
          onConfirm={() => handleSignOutConfirm(signOutTarget)}
        />
      )}
    </div>
  )
}

const MailboxSkeleton: React.FC = () => (
  <ul className="divide-y divide-stone-200/60">
    {Array.from({ length: 2 }).map((_, i) => (
      <li key={i} className="flex items-center gap-3 px-4 py-3">
        <div className="po-skeleton" style={{ width: 8, height: 8, borderRadius: 999 }} />
        <div className="flex-1">
          <div className="po-skeleton" style={{ width: '60%', height: 11 }} />
          <div className="po-skeleton mt-2" style={{ width: '40%', height: 9 }} />
        </div>
      </li>
    ))}
  </ul>
)

interface ConnectButtonProps {
  provider: EmailAccountProvider
  busy: boolean
  disabled: boolean
  onClick: (p: EmailAccountProvider) => void
}

const ConnectButton: React.FC<ConnectButtonProps> = ({ provider, busy, disabled, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(provider)}
    disabled={busy || disabled}
    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-nexgen-blue border border-nexgen-blue/25 bg-white rounded-lg hover:bg-nexgen-blue/5 disabled:opacity-60 disabled:cursor-not-allowed btn-press"
  >
    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
    Connect {PROVIDER_LABEL[provider].split(' / ')[0]}
  </button>
)

interface AccountRowProps {
  account: EmailAccountRow
  menuOpen: boolean
  onToggleMenu: () => void
  onConnect: (p: EmailAccountProvider) => void
  onTogglePause: (account: EmailAccountRow) => void
  onSignOut: (account: EmailAccountRow) => void
  busy: boolean
}

const AccountRow: React.FC<AccountRowProps> = ({
  account,
  menuOpen,
  onToggleMenu,
  onConnect,
  onTogglePause,
  onSignOut,
  busy,
}) => {
  const reconnecting = account.status === 'active' && account.consecutive_failures > 0
  const status = reconnecting
    ? {
        label: account.consecutive_failures > 1 ? `Reconnecting (${account.consecutive_failures})` : 'Reconnecting…',
        dot: 'bg-amber-400 animate-pulse',
        text: 'text-amber-600',
      }
    : STATUS_DOT[account.status]

  return (
    <li className="relative flex items-center gap-3 px-4 py-3">
      <span className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-stone-900 truncate">{account.email_address}</div>
        <div className="text-[11px] text-stone-500 truncate">
          {PROVIDER_LABEL[account.provider].split(' / ')[0]} · {status.label}
          {account.last_sync_at && account.status === 'active' && !reconnecting && (
            <> · synced {formatRelative(account.last_sync_at)}</>
          )}
        </div>
      </div>

      {account.status === 'error' ? (
        <button
          type="button"
          onClick={() => onConnect(account.provider)}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg btn-press"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${account.email_address}`}
          className="shrink-0 p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 btn-press"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}

      {menuOpen && account.status !== 'error' && (
        <div
          role="menu"
          className="po-pop-in absolute right-3 top-[calc(100%-6px)] z-10 w-40 rounded-lg border border-stone-200 bg-white shadow-elevated overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => onTogglePause(account)}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
          >
            {account.status === 'active' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {account.status === 'active' ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onSignOut(account)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 border-t border-stone-200/70"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </li>
  )
}

interface SignOutConfirmDialogProps {
  account: EmailAccountRow
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}

const SignOutConfirmDialog: React.FC<SignOutConfirmDialogProps> = ({ account, submitting, onCancel, onConfirm }) => {
  const isGmail = account.provider === 'gmail'
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signout-dialog-title"
      onClick={onCancel}
      onKeyDown={e => {
        if (e.key === 'Escape' && !submitting) onCancel()
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200">
          <h3 id="signout-dialog-title" className="font-display font-semibold text-stone-900">
            Sign out of {account.email_address}?
          </h3>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm text-stone-700">
          {isGmail ? (
            <p>
              We'll revoke this app's access at Google and clear the stored token. Existing purchase orders from this
              mailbox stay in your audit history.
            </p>
          ) : (
            <>
              <p>We'll clear the stored token so this mailbox stops syncing immediately.</p>
              <p className="text-stone-600">
                Microsoft doesn't support automatic revoke — to fully remove access at Microsoft, visit{' '}
                <a
                  href="https://account.live.com/consent/Manage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-stone-900"
                >
                  account.live.com/consent/Manage
                </a>{' '}
                after signing out here.
              </p>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-200 rounded-md disabled:opacity-60 btn-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-60 btn-press"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default MailboxesMenu
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors. (If `EmailAccountRow` lacks `consecutive_failures` / `last_error` / `last_sync_at`, re-check against `services/supabase/emailAccountsService.ts` — these fields are used by the current `EmailAccountsTab`, so they exist.)
Run: `npm run build` → success.

- [ ] **Step 3: Commit**

```bash
git add components/admin/MailboxesMenu.tsx
git commit -m "feat(po-inbox): MailboxesMenu button + popover (replaces Mailboxes sub-tab)"
```

---

## Task 10: Rewire `POInboxView`

**Files:**
- Modify: `components/admin/POInboxView.tsx` (full rewrite below)

Drops the `mailboxes` sub-tab, mounts `MailboxesMenu` in the sub-tab nav, removes `MailboxHealthBanner`, and lifts the OAuth `?connected` handling here (always mounted) — toasting the result, stripping params, and bumping `autoOpenNonce` so the popover opens.

- [ ] **Step 1: Replace the whole file**

Replace `components/admin/POInboxView.tsx` with:

```tsx
// POInboxView — single parent for the consolidated PO Inbox admin tab.
//
// Two sub-tabs (Queue, Aliases) + a Mailboxes button/popover in the nav.
// URL-persists the active sub-tab via `?subtab=` so deep-links and browser
// back/forward work. Owns the post-OAuth-callback handling (it's always
// mounted while the PO Inbox tab is open) and opens the Mailboxes popover
// when a connection completes.

import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { LoadingSkeleton } from '../Skeleton'
import POInboxStatsTile from './POInboxStatsTile'
import MailboxesMenu from './MailboxesMenu'
import type { HoReCa, Product } from '../../types'

const POInboxTab = lazy(() => import('./POInboxTab'))
const POAliasesTab = lazy(() => import('./POAliasesTab'))

export type POInboxSubTab = 'queue' | 'aliases'

const VALID_SUBTABS: ReadonlyArray<POInboxSubTab> = ['queue', 'aliases']

interface POInboxViewProps {
  hoReCas: HoReCa[]
  products: Product[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  onViewInOrderImport?: (orderId: string) => void
}

function readInitialSubtab(): POInboxSubTab {
  if (typeof window === 'undefined') return 'queue'
  const raw = new URLSearchParams(window.location.search).get('subtab')
  if (raw && (VALID_SUBTABS as ReadonlyArray<string>).includes(raw)) {
    return raw as POInboxSubTab
  }
  // Legacy or unknown values (e.g. the removed 'mailboxes') fall back to Queue.
  return 'queue'
}

function writeSubtabToUrl(next: POInboxSubTab): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('subtab', next)
  window.history.replaceState({}, '', url.toString())
}

const POInboxView: React.FC<POInboxViewProps> = ({
  hoReCas,
  products,
  addToast,
  onViewInOrderImport,
}) => {
  const [subtab, setSubtab] = useState<POInboxSubTab>(readInitialSubtab)
  const [presetPendingPoId, setPresetPendingPoId] = useState<string | null>(null)
  // Bumped to ask MailboxesMenu to open its popover (after an OAuth callback).
  const [mailboxOpenNonce, setMailboxOpenNonce] = useState(0)

  const switchSubtab = useCallback((next: POInboxSubTab) => {
    setSubtab(next)
    writeSubtabToUrl(next)
  }, [])

  useEffect(() => {
    function onPopState() {
      setSubtab(readInitialSubtab())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    writeSubtabToUrl(subtab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Post-OAuth callback: surface the result, open the Mailboxes popover, then
  // strip the params so a refresh doesn't repeat the toast. Lifted here from
  // the former EmailAccountsTab so it fires even though the popover isn't
  // mounted at page load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const connectError = params.get('connect_error')
    if (!connected && !connectError) return
    if (connected === '1') {
      addToast?.('Mailbox connected. The first sync will run within a minute.', 'success')
      setMailboxOpenNonce(n => n + 1)
    } else if (connectError) {
      const message = params.get('message') ?? connectError
      addToast?.(`Connect failed (${connectError}): ${message}`, 'error')
      setMailboxOpenNonce(n => n + 1)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('connected')
    url.searchParams.delete('connect_error')
    url.searchParams.delete('account_id')
    url.searchParams.delete('message')
    window.history.replaceState({}, '', url.toString())
  }, [addToast])

  const handleViewSourcePo = useCallback(
    (pendingPoId: string) => {
      setPresetPendingPoId(pendingPoId)
      switchSubtab('queue')
    },
    [switchSubtab],
  )

  useEffect(() => {
    if (subtab !== 'queue' && presetPendingPoId) {
      setPresetPendingPoId(null)
    }
  }, [subtab, presetPendingPoId])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-semibold tracking-tight text-stone-900">
              PO Inbox
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              Inbound purchase orders extracted from email, ready to review.
            </p>
          </div>
          <POInboxStatsTile variant="inline" />
        </div>

        <nav
          className="mt-6 flex items-center justify-between gap-4 border-b border-stone-200/70"
          aria-label="PO Inbox sub-navigation"
        >
          <div className="flex items-center gap-6">
            <SubtabButton active={subtab === 'queue'} onClick={() => switchSubtab('queue')}>
              Queue
            </SubtabButton>
            <SubtabButton active={subtab === 'aliases'} onClick={() => switchSubtab('aliases')}>
              Aliases
            </SubtabButton>
          </div>
          <MailboxesMenu addToast={addToast} autoOpenNonce={mailboxOpenNonce} />
        </nav>
      </header>

      <main className="mt-6">
        <Suspense fallback={<LoadingSkeleton />}>
          {subtab === 'queue' && (
            <POInboxTab
              hoReCas={hoReCas}
              addToast={addToast}
              presetPendingPoId={presetPendingPoId}
              onViewInOrderImport={onViewInOrderImport}
            />
          )}
          {subtab === 'aliases' && (
            <POAliasesTab
              hoReCas={hoReCas}
              products={products}
              addToast={addToast}
              onViewSourcePo={handleViewSourcePo}
            />
          )}
        </Suspense>
      </main>
    </div>
  )
}

interface SubtabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

const SubtabButton: React.FC<SubtabButtonProps> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative -mb-px py-2.5 text-sm transition-colors border-b-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
    }`}
  >
    {children}
  </button>
)

export default POInboxView
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors. `EmailAccountsTab` and `MailboxHealthBanner` are no longer imported here (they're deleted in Task 11; they still exist on disk now, so the build is green at this step too).
Run: `npm run build` → success.

- [ ] **Step 3: Commit**

```bash
git add components/admin/POInboxView.tsx
git commit -m "feat(po-inbox): rewire POInboxView — Mailboxes button, lift OAuth handling"
```

---

## Task 11: Update `AppShell` + `index.tsx`, delete dead files

**Files:**
- Modify: `components/AppShell.tsx` (`adminView` initializer ~1291-1304)
- Modify: `index.tsx` (comment ~43)
- Delete: `components/admin/EmailAccountsTab.tsx`
- Delete: `components/admin/MailboxHealthBanner.tsx`

- [ ] **Step 1: Update the post-OAuth routing in `AppShell`**

In `components/AppShell.tsx`, replace the `if (params.has('connected') || params.has('connect_error')) { … }` block inside the `adminView` initializer with:

```tsx
        // After the OAuth callback, route to the consolidated PO Inbox tab.
        // POInboxView reads the ?connected / ?connect_error params, toasts the
        // result, and opens the Mailboxes popover so the operator sees their
        // new connection in context.
        if (params.has('connected') || params.has('connect_error')) {
            params.set('subtab', 'queue');
            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
            return 'PO Inbox';
        }
```

(Only the comment and `params.set('subtab', 'queue')` change — previously `'mailboxes'`. The `?connected`/`?connect_error` params are intentionally NOT stripped here; `POInboxView` strips them after handling.)

- [ ] **Step 2: Update the `index.tsx` comment**

In `index.tsx`, change the comment near line 43 that references `EmailAccountsTab::handleConnect` to reference `MailboxesMenu`:

```tsx
// it to NEXORDER_OAUTH_POPUP_NAME in MailboxesMenu::handleConnect.
```

(Match the surrounding comment style; this is a comment-only change — no logic.)

- [ ] **Step 3: Delete the dead files**

```bash
git rm components/admin/EmailAccountsTab.tsx components/admin/MailboxHealthBanner.tsx
```

- [ ] **Step 4: Verify nothing else imports them**

Run: `npx tsc --noEmit`
Expected: no errors. If tsc reports an unresolved import of `EmailAccountsTab` or `MailboxHealthBanner` anywhere, fix that importer (none expected — `POInboxView` was the only runtime consumer and the test was retargeted in Task 8).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add components/AppShell.tsx index.tsx
git commit -m "refactor(po-inbox): route post-OAuth to Queue + popover; remove EmailAccountsTab + MailboxHealthBanner"
```

---

## Task 12: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests pass, including `poInbox.confidenceBand`, `emailAccountFormat`, and the retargeted `emailAccountsTab` (formatRelative).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Manual checklist (dev server)**

Run: `npm run dev` and log in as an Admin. Verify:
- Queue: each status tab loads; Needs Review shows its count badge; rows show the confidence ring (rose/amber/emerald), priority rail, status pill; hovering a row swaps the chevron for the Review pill and tints the row; the list cascades in.
- Skeleton shows on first load (no spinner); each empty tab shows its composed empty state.
- Stats ribbon renders with Needs review emphasised and the 7-day cost sub-line.
- Detail modal: header shows the ring + status pill; a mismatch PO shows the rose band once (not twice); inputs show the blue focus ring; document toolbar reads "Original · …"; footer has Reject (text) + emerald Approve. Approve/Reject still work end-to-end on a `needs_review` PO. A resolved PO is read-only.
- Mailboxes button sits at the right of the sub-tab nav with the count + health dot (amber when a mailbox is errored). Popover opens/closes on click + Escape + click-outside; lists accounts errored-first; kebab Pause/Resume + Sign out work; Connect Gmail/Outlook launches the popup; the sign-out confirm modal appears.
- `prefers-reduced-motion`: enable it (OS setting) and confirm the reveal/shimmer/pulse stop animating.

- [ ] **Step 5: Final no-op commit if any manual fixes were needed**

If the manual pass surfaced fixes, commit them with a clear message. Otherwise this task ends with the branch green and ready for review/PR.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4.1 ConfidenceRing → Task 3 (+ confidenceBand Task 1). §4.2 queue rows/count/reveal → Tasks 4-5. §4.3 skeleton/empty → Task 5. §4.4 POInboxView nav/banner/OAuth lift/sub-tab type → Task 10. §4.5 modal polish → Task 7. §4.6 stats ribbon → Task 6. §4.7 MailboxesMenu (+ emailAccountFormat) → Tasks 8-9. §4.8 AppShell → Task 11. §3 motion utilities → Task 2. §6 counts decision (Needs Review only) → Task 4 Step 3. §8 testing → Tasks 1, 8, 12.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO; commands have expected output.
- **Type consistency:** `confidenceBand`→`ConfidenceBand` consumed by `ConfidenceRing`; `summarizeMailboxHealth`→`MailboxHealth` consumed by `MailboxesMenu` (`health.tone`/`count`/`erroredCount`/`pausedCount`); `MailboxesMenu` prop `autoOpenNonce` matches `POInboxView`'s `mailboxOpenNonce` state; `statusBadge` returns `{ label, className }` used by both the row and modal header.
```
