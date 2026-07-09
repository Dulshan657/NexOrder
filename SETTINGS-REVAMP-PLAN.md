# Settings Tab Revamp — Implementation Plan

> After approval: save a copy of this plan to the project root as `SETTINGS-REVAMP-PLAN.md` (user request).

## Context

The admin Settings tab is a single 608-line monolith (`components/SettingsPanel.tsx`): one long scroll of flat cards mixing true app settings, per-customer credit/tier tables, a HoReCa pricing editor, and three warehouse-intelligence CRUD sections. Problems: no shared form primitives (repeated inline class strings), a dead "low stock preview" stub, a hardcoded fake order-ID timestamp, PO auto-approve settings hidden in a PO Inbox popover and absent from Settings, and Managers see the Settings nav item but get a blank pane. Goal: restructure into clean sub-tabs matching the established PO Inbox pattern, extract reusable primitives, add dirty-state save UX, and fix the role/consistency quirks — making Settings easy to use, professional, and future-proof (new settings get an obvious home).

**User-approved decisions:** sub-tabs with `?subtab=` URL persistence · Credit Limits + HoReCa Pricing stay in Settings under a Customers tab · hide Settings nav from Managers (Admin-only, matching the edge function) · surface the 3 PO auto-approve toggles in an Automation tab.

**Design language:** stay within NexOrder's existing system — stone palette, `font-display` headers, `nexgen-blue` accent, `btn-press`. No new fonts/colors. Prefer section grouping (`divide-y`, headers) over nested cards.

## New file structure

```
components/admin/settings/
  SettingsView.tsx          shell: header, subtab nav, URL sync, lazy tab mounting
  primitives.tsx            SettingsSection, SettingsField, TextInput, NumberInput,
                            SelectInput, Toggle, SubtabButton, SaveBar
  useSettingsDraft.ts       per-tab draft/dirty/save hook (wraps useSettings/useUpdateSettings)
  GeneralTab.tsx            company info + logo upload
  OrdersPricingTab.tsx      orderIdPrefix, minimumOrderValue, currency, cartonDiscountPercent
  InventoryTab.tsx          lowStockThreshold, showStockToHoReCa
  WarehouseTab.tsx          renders the 3 existing warehouse sections untouched
  CustomersTab.tsx          defaultCreditLimit + credit-limits table + HoReCa pricing editor
  AutomationTab.tsx         3 PO auto-approve toggles
  autoApprovalPolicy.ts     shared TOGGLES config (used by AutomationTab + AutoApprovalMenu)
lib/
  subtabUrl.ts              pure, node-testable URL helpers
  settingsDraft.ts          pure pick/diff helpers
  settingsValidation.ts     pure per-field validators
```

`components/SettingsPanel.tsx` is **deleted** (single importer: `AdminView.tsx:10` — no shim needed). The three warehouse sections (`WarehousesSettingsSection.tsx`, `StorageTypesSection.tsx`, `ZoneProfilesSection.tsx`) stay where they are, imported by WarehouseTab — do NOT move or restyle them (they own modals, hooks, and the `?designer=` deep-link logic).

## Data flow: hooks over props

Verified: `App.tsx:75,101` already derives `appSettings` from `useSettings()` + `toAppSettings` — the `['settings']` query cache is the single source of truth, so tabs using hooks directly stay consistent. `fromAppSettings` (`lib/adapters.ts:519`) only emits defined keys → supports partial per-tab patches.

- Tabs read/write settings via `useSettingsDraft` (wraps `useSettings` + `useUpdateSettings` + `toAppSettings`/`fromAppSettings`). Toasts via `useToasts()` (SettingsPanel already does this).
- Keep as props only: `hoReCas`, `products`, `onUpdateHoReCa` (AppShell-owned horecas mutation used by many views).

```ts
interface SettingsViewProps {
  hoReCas: HoReCa[];
  products: Product[];
  onUpdateHoReCa: (customer: HoReCa, reason?: string) => void;
}
```

Cleanup in the same change: remove `appLogo`, `onUpdateLogo`, `onSaveSettings` from `AdminViewProps` (AdminView.tsx:39,41,42) and the AppShell prop sites (AppShell.tsx:1094-1106) — nothing else consumes them. `appSettings` stays on AdminView (Dashboard uses `lowStockThreshold`). Make Settings lazy: `lazyWithRetry(() => import('./admin/settings/SettingsView'))` (currently the only eager heavy admin view).

## Core pure logic + hook

```ts
// lib/settingsDraft.ts
pickSettings(s, keys)                       // Pick<AppSettings, K>
diffSettings(base, draft)                   // only changed keys; {} when clean

// lib/settingsValidation.ts
validateSettings(draft): SettingsErrors
// companyEmail format (when non-empty), orderIdPrefix 1-6 chars A-Z0-9,
// minimumOrderValue >= 0, cartonDiscountPercent 0-50, lowStockThreshold >= 1,
// defaultCreditLimit >= 0

// components/admin/settings/useSettingsDraft.ts
useSettingsDraft(keys) => { loaded, draft, setField, isDirty, errors, isSaving, save, discard }
// base = pickSettings(toAppSettings(row), keys); resync from server ONLY while not dirty;
// save() no-ops when errors or clean; mutateAsync(fromAppSettings(diff)) + toast;
// cast fromAppSettings result to SettingsUpdate here (one place, no scattered `as any`)

// lib/subtabUrl.ts (takes a search string, never touches window)
parseSubtab(search, valid, fallback)
settingsSubtabFromSearch(search)   // 'warehouse' when ?designer= or ?import= present, else parseSubtab
```

## Shell + URL wiring

`SettingsSubTab = 'general' | 'orders' | 'inventory' | 'warehouse' | 'customers' | 'automation'`

Copy the POInboxView pattern (`components/admin/POInboxView.tsx:31-83`): initial state from `settingsSubtabFromSearch(window.location.search)`, `history.replaceState` writes, popstate listener, stamp-on-mount. **Designer deep link keeps working**: `settingsSubtabFromSearch` checks `designer` before `subtab`, so `openDesigner` (AdminView.tsx:86-93) → Settings mounts on the Warehouse tab → `WarehousesSettingsSection`'s existing mount effect (lines 36-50) consumes and strips the param. Stale `?subtab=queue` from PO Inbox falls back to `general` gracefully.

Header follows POInboxView: `text-2xl font-display font-semibold tracking-tight` + description + `border-b border-stone-200/70` nav with `SubtabButton` (moved verbatim into `primitives.tsx`). Tabs are `lazyWithRetry` + Suspense, only the active tab mounted. **No global "Save All" button** — saving is per-tab.

## Primitives (`primitives.tsx`)

- `SettingsSection({ title, description?, icon?, actions?, children })` — heading block; tab layout = `max-w-3xl` column with `divide-y divide-stone-200` separation, no nested `bg-stone-50` cards.
- `SettingsField({ label, htmlFor?, helper?, error?, children })` — label above, helper/error text below.
- `TextInput` / `NumberInput` / `SelectInput` — one shared class string: `w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 focus:border-nexgen-blue`, `border-red-300` when invalid.
- `Toggle({ checked, onChange, disabled?, label, description? })` — real `role="switch"` button, `w-9 h-5` track (`bg-nexgen-blue` on / `bg-stone-300` off), translating thumb, `btn-press`.
- `SaveBar({ isDirty, isSaving, onSave, onDiscard })` — disabled until dirty, spinner while saving, 2s emerald "Saved" flash, `bg-stone-900 hover:bg-stone-800 text-white btn-press`, "Discard" text button when dirty.

## Tab specs

- **General** — `useSettingsDraft(['companyName','companyAddress','companyPhone','companyEmail'])`. Logo upload ported as-is (SettingsPanel lines 108-132, 236-271; `company-assets` bucket); logo saves immediately on upload/remove (not part of the draft — matches current behavior; keep the fire-and-forget bucket delete as-is).
- **Orders & Pricing** — `useSettingsDraft(['orderIdPrefix','minimumOrderValue','currency','cartonDiscountPercent'])`. `CURRENCIES` const lives here. Order-ID preview uses `useRef(Date.now())` (fixes hardcoded `1711817600000`).
- **Inventory** — `useSettingsDraft(['lowStockThreshold','showStockToHoReCa'])`; Toggle for show-stock; **dead low-stock preview stub (lines 377-384) not ported**. Helper text points to Settings → Customers for per-customer overrides.
- **Warehouse** — `<WarehousesSettingsSection /><StorageTypesSection /><ZoneProfilesSection />` in a `space-y-6` column, untouched.
- **Customers** — two sections:
  1. *Credit & access*: `useSettingsDraft(['defaultCreditLimit'])` + ported per-customer table (lines 165-168, 417-493) with `creditLimitEdits`/`stockTabEdits` queues, **plus tier moved into the same queue** (today tier saves immediately while neighbors queue — unify; user-visible change, note in PR). One SaveBar: dirty = draft dirty OR any queue non-empty; save = draft save then flush queues per changed customer via `onUpdateHoReCa` (mirrors current handleSave lines 139-159). Show "N customers modified" count.
  2. *HoReCa pricing*: port the editor (lines 33-101, 496-602) with its own per-customer "Save pricing" button — semantics unchanged, restyled with primitives.
- **Automation** — renders shared `TOGGLES` from `autoApprovalPolicy.ts` (master/sub-policy indent + disabled-when-master-off + amber note, lifted from `AutoApprovalMenu.tsx:34-52,84-99,138-166`). Saves **immediately per toggle** (snake_case patch, same as the popover). Refactor AutoApprovalMenu to import the shared TOGGLES/PolicyKey (delete its local copy; no behavior change). Both surfaces share `['settings']` → auto-sync.

## Manager fix

- `AppShell.tsx:820-825`: wrap the Settings nav button in `{isAdmin && (...)}` (copy Audit Log's pattern right below at 826-833).
- Related dead-end: `AdminView.tsx:114` passes `openDesigner` to WarehousePage unconditionally — change to `onOpenDesigner={props.currentUser.role === UserRole.ADMIN ? openDesigner : undefined}` (`onOpenDesigner` is already optional at WarehousePage.tsx:31; verify the CTA hides when undefined, guard inside WarehousePage if not).

## Tests (vitest is node-env, `**/*.test.ts` only — pure `.ts` modules, no component tests)

- `__tests__/subtabUrl.test.ts` — parseSubtab valid/unknown/missing; `?designer=3` → warehouse (wins over `subtab=`), `?subtab=customers` → customers, stale `?subtab=queue` → general.
- `__tests__/settingsDraft.test.ts` — diffSettings returns only changed keys, `{}` when clean, `companyLogoUrl: null` vs undefined, numbers not conflated with string-numbers.
- `__tests__/settingsValidation.test.ts` — bad email, bad prefix (empty/7-char/lowercase), negative min order, carton 51, threshold 0; valid → `{}`.
- `__tests__/adapters.appSettings.test.ts` — to/from roundtrip; `po_auto_approve_*` default to true when columns absent (adapters.ts:511-515); `fromAppSettings({})` → `{}`.

## Implementation order

0. Save this plan to project root as `SETTINGS-REVAMP-PLAN.md`.
1. **Pure libs + tests**: `lib/subtabUrl.ts`, `lib/settingsDraft.ts`, `lib/settingsValidation.ts` + 4 test files. Verify: `npx tsc --noEmit`, `npm test`.
2. **Primitives + shared config**: `primitives.tsx`, `autoApprovalPolicy.ts`. Verify: tsc.
3. **Hook**: `useSettingsDraft.ts`. Verify: tsc.
4. **Simple tabs**: General, OrdersPricing, Inventory, Automation + AutoApprovalMenu refactor. Verify: tsc.
5. **WarehouseTab + CustomersTab** (largest port — logic moved intact). Verify: tsc.
6. **Shell**: `SettingsView.tsx`.
7. **Wire-up + deletion**: AdminView swap (lazy import, props removal), AppShell cleanup (1094-1106) + nav gate (820) + conditional onOpenDesigner (AdminView:114), delete `SettingsPanel.tsx`. Grep for `SettingsPanel`, `onSaveSettings`, `onUpdateLogo`, `appLogo` → zero refs. Verify: tsc + `npm test`.
8. **Manual QA** (`npm run dev`):
   - Each tab renders; SaveBar disabled until edit; save → toast + persists on refresh; discard resets.
   - Validation blocks save with inline errors (bad email, 51% carton discount).
   - `?subtab=` persists, survives refresh + back/forward; PO Inbox ↔ Settings param handoff degrades gracefully.
   - Warehouse designer CTA → Settings → Warehouse tab with designer open; params stripped.
   - Customers: edit 2 credit limits + tier + stock override → one save flushes all; pricing save unchanged.
   - Automation toggle ↔ PO Inbox popover stay in sync.
   - Logo upload/remove round-trips; sidebar logo updates.
   - Manager login: no Settings nav item, designer CTA hidden.
9. **Optional isolated commit**: refactor POInboxView to use shared `parseSubtab` + `SubtabButton` (skip if time-constrained).

## Risks / gotchas

- Prop-removal fallout across the giant AppShell JSX blob — tsc is the gate, plus grep for stringly usages.
- Warehouse sections keep their own card chrome (interim inconsistency, follow-up candidate) — only their import location changes; do not clean them up in this pass.
- Never read `settingsQuery.data` snake_case fields directly in tabs — always through `toAppSettings` (hook enforces).
- No edge-function changes needed — every written field already round-trips `mutate-app-settings`; do not add new keys.
- Lazy-loading Settings changes chunking; `lazyWithRetry` handles stale-chunk redeploys.

## Key files

- `components/SettingsPanel.tsx` (source of ported logic; deleted at end)
- `components/AdminView.tsx` (import swap, props, gates)
- `components/AppShell.tsx` (nav gate ~820, prop cleanup 1094-1106)
- `components/admin/POInboxView.tsx` (pattern reference)
- `components/admin/AutoApprovalMenu.tsx` (shared TOGGLES refactor)
- `lib/adapters.ts:496-539`, `hooks/queries/useSettings.ts`, `types.ts:688-705`
