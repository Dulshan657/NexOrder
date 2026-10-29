# NX-0008 — Nex and the dashboard: same words, same calendar, same numbers

```json brief
{
  "id": "NX-0008-shipped-metric",
  "base": "b642eb7537cea30a4115a1ebfd2185c90940b2f9",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "A new metric sales.shippedCount counts each order once, in the window that contains the FIRST time its status history reached dispatched or delivered, whenever it was placed. An order placed in September and dispatched in October counts for October; an order placed in October and not yet dispatched does not." },
    { "id": "A2", "check": "sales.shippedCount never counts a cancelled order and honours the horecaId and repId scope, like every other sales metric." },
    { "id": "A3", "check": "get_sales_summary returns shippedCount, shippedByStatus { dispatched, delivered } (where the shipped orders are now) and stillInWarehouse (orders in scope currently processing to packed), and its basis says that placed orders are counted by order date and shipped orders by ship date." },
    { "id": "A4", "check": "Nex's instructions carry an ORDER WORDS section: 'processed / shipped / sent / went out' is answered with the shipped count and its split; 'placed / came in / received' with the placed count; an ambiguous ask with both, each named; and the stored status 'processed' is spoken as 'confirmed'. The instructions stay under the existing 4,000-character limit for every role and module set." },
    { "id": "A5", "check": "The order status stored as 'processed' is shown as 'Confirmed' everywhere it is labelled (ORDER_STATUS_LABELS and the fulfilments panel). The stored value, the database and the Edge Functions are unchanged." },
    { "id": "A6", "check": "computeDispatchFunnel accepts a 'month' window: orders placed from Sydney midnight on the 1st of the current month up to now." },
    { "id": "A7", "check": "computeDispatchFunnel returns the cancelled count separately; the stages never contain 'cancelled'." },
    { "id": "A8", "check": "The dashboard card is titled 'Order pipeline', offers This month / 7d / 30d / 90d, opens on This month, and shows cancelled orders as one muted line under the chart ('N cancelled in this period'), hidden when there are none." },
    { "id": "A9", "check": "On dev as Alice, 'how many orders did we process this month' is answered with the shipped count, the delivered/dispatched split and the number still in the warehouse; 'how many orders came in this month' with the placed count.", "manual": "voice session on nexorder.vercel.app" },
    { "id": "A10", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" },
    { "id": "A11", "check": "ONE calendar everywhere. The Admin Dashboard's Today / This Week / This Month / Custom windows come from the same Sydney-calendar function Nex uses (week starts Monday, Sydney midnight, independent of the browser's time zone), and sales.revenueByDate groups by the Sydney calendar day, not the UTC day." },
    { "id": "A12", "check": "Parity on one data set: for This month, Nex's orderCount equals the dashboard's Orders KPI equals the sum of the pipeline stages; Nex's ordersByStatus equals the pipeline stage by stage; and every source excludes cancelled from its counts the same way." },
    { "id": "A13", "check": "Parity on dev's real data: the three sources in A12 and Nex's shippedCount agree with counts computed independently in SQL (Sydney month, status_history) on the dev database.", "manual": "npm run test:integration -- numbersParity" },
    { "id": "A14", "check": "End to end, dashboard: signed in as Admin on nexorder.vercel.app, the This month Orders KPI, each pipeline bar and the cancelled line equal the SQL counts from A13.", "manual": "E2E_BASE_URL=https://nexorder.vercel.app npx playwright test tests/e2e/order-numbers.spec.ts" },
    { "id": "A15", "check": "End to end, Nex: Chromium with a fake microphone plays a recorded 'how many orders did we process this month'; Nex's transcript states the shipped count equal to SQL, and a second recording 'how many orders came in this month' gets the placed count. Run on dev only, never in CI (it costs OpenAI minutes).", "manual": "npx playwright test --project=voice tests/voice-e2e/nex-order-numbers.spec.ts" }
  ],
  "failFirst": [
    { "file": "__tests__/semantic.sales.test.ts", "test": "sales.shippedCount > counts an order shipped in the window even when it was placed before it", "proves": ["A1"] },
    { "file": "__tests__/semantic.sales.test.ts", "test": "sales.shippedCount > counts each order once, by the first time it reached dispatched or delivered", "proves": ["A1"] },
    { "file": "__tests__/semantic.sales.test.ts", "test": "sales.shippedCount > never counts a cancelled order and honours the rep scope", "proves": ["A2"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_summary > reports orders shipped in the period by ship date, with the dispatched and delivered split", "proves": ["A3"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_summary > says in the basis that placed and shipped orders are counted by different dates", "proves": ["A3"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > tells Nex that processed means shipped and to say what it counted", "proves": ["A4"] },
    { "file": "__tests__/orderStatusLabels.test.ts", "test": "ORDER_STATUS_LABELS > shows the processed status as Confirmed", "proves": ["A5"] },
    { "file": "services/__tests__/inventoryDashboardService.test.ts", "test": "computeDispatchFunnel > counts orders placed since the start of the Sydney calendar month for 'month'", "proves": ["A6"] },
    { "file": "services/__tests__/inventoryDashboardService.test.ts", "test": "computeDispatchFunnel > keeps cancelled orders out of the stages and counts them separately", "proves": ["A7"] },
    { "file": "__tests__/inventoryDispatchSection.test.tsx", "test": "InventoryDispatchSection > opens on This month and shows cancelled orders as a line under the chart", "proves": ["A8"] },
    { "file": "__tests__/semantic.sales.test.ts", "test": "sales.revenueByDate > groups an early-morning Sydney order on its Sydney date", "proves": ["A11"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > starts This Week on Monday at Sydney midnight, like Nex", "proves": ["A11"] },
    { "file": "__tests__/numbersParity.test.ts", "test": "order numbers parity > Nex, the Orders KPI and the pipeline agree for This month", "proves": ["A12"] }
  ],
  "allow": []
}
```

## Goal

The owner asked Nex "how many orders we processed this month" and got 19. The
Dispatch Funnel showed different numbers. The data agreed. The words did not:

- the owner meant *shipped* (dispatched or delivered);
- Nex counted orders *placed*;
- the app has its own status called "Processed", which really means *confirmed*.

The funnel also used rolling windows while people think in calendar months, and
it drew cancelled orders as the last pipeline stage. Decided with the owner on
2026-10-29 (interview):

- "processed this month" means shipped this month, by the date it shipped;
- Nex answers and says what it counted. It does not ask first;
- the funnel stays a snapshot of where orders are now, renamed to match;
- cancelled orders move to a line under the chart;
- the "Processed" label becomes "Confirmed";
- "This month" is added and is the default.

## Approach

- `lib/semantic/metrics/sales.ts`: add `sales.shippedCount` (plus a shipped-orders
  helper for the split). It applies the scope filter **without** the date bounds, then
  tests the first `statusHistory` entry at `dispatched`/`delivered` against `[from, to]`.
  Registry tests are updated for the new id.
- `lib/voice/tools/getSalesSummary.ts` gets the new fields and basis. The
  `get_sales_summary` schema description is updated.
  `supabase/functions/_shared/voice/instructions.ts` gets the new ORDER WORDS section.
- Move the calendar-period logic from `lib/voice/period.ts` to a neutral
  `lib/period.ts`, with `lib/voice/period.ts` re-exporting it. The dashboard must not
  import a module's code (voice is a module flag). It stays pure (no clock of its own).
- `constants.ts` `ORDER_STATUS_LABELS.processed` and
  `components/OrderFulfillmentsPanel.tsx` change to "Confirmed". The semantic stage labels
  come from the same map.
- `services/inventoryDashboardService.ts`: `DispatchWindow = 'month' | 7 | 30 | 90`, and
  `computeDispatchFunnel` returns `{ stages, cancelled }`.
  `components/admin/InventoryDispatchSection.tsx` gets the title, buttons and default.
  `components/charts/DispatchFunnelChart.tsx` renders stages plus the cancelled line
  (`text-stone-600`, contrast-safe on white).

- Consistency (owner, 2026-10-29: "make sure the assistant and graphs answers are
  consistent and correct"). `components/AdminDashboard.tsx` `getDateRange` is replaced by
  `dashboardRange` in `lib/period.ts`, built on the same `resolvePeriod` Nex uses. Today
  it is browser-local, with a Sunday week start. `sales.revenueByDate` and the custom
  range in `lib/semantic/filter.ts` move from UTC days to Sydney days. The existing UTC
  assertions in the semantic tests are updated to the Sydney ones (behaviour change,
  stated here).
- Testing end to end (owner: "test this e2e"):
  - `__tests__/numbersParity.integration.test.ts` loads dev's orders through the app's
    own service and adapter, runs Nex's tool, the dashboard metrics and the pipeline, and
    compares all of them with SQL written independently.
  - `tests/e2e/order-numbers.spec.ts` (Playwright, Admin) reads the dashboard and
    compares it with the same SQL.
  - A new `voice` Playwright project, excluded from `npm run test:e2e` like `soak`/`perf`,
    runs Chromium with `--use-fake-device-for-media-stream` and a WAV of the question,
    generated once with OpenAI TTS and committed as a fixture. It reads Nex's
    transcript.
  - All of it runs against dev only (the config already refuses a tenant origin).

## Out of scope

- Any change to stored statuses, the DB, migrations or Edge Functions other than
  the voice instructions (shared module, shipped with the `voice-session` function).
- A cumulative ("how far orders got") funnel. The owner chose the snapshot.
- A shipped-by-date chart on the dashboard. Only Nex reports shipped counts.
- The demo data's high cancellation rate (19 of 43).
- Amadiya: `voice_assistant` stays off there. The label and pipeline changes ride the
  next release tag.

## FINAL
