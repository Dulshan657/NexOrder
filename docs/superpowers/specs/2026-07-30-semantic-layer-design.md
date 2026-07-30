# Semantic layer — design

Date: 2026-07-30

## Problem

Business meaning in NexOrder lives wherever it was first needed. There is no place
to look up what "revenue" means, and the copies disagree.

Measured, not assumed:

| Concept | Copies | Do they agree? |
|---|---|---|
| Order revenue | `SalesDashboard.tsx:223` (line-sum), `AdminDashboard.tsx:103` (stored `total`), `RepDashboardV2.tsx:64` (stored `total`) | **No** — Sales re-sums the lines and discards promotions / header adjustments |
| Inclusive date range | `AdminDashboard.tsx:86` (`>= start && <= end`), `SalesDashboard.tsx:206` (`>= start && < end+1d`), `AdminDashboard.tsx:473` (`endDate + 'T23:59:59'`) | **No** — three spellings; the third silently drops the last second of the day |
| Target achieved | `AdminDashboard.tsx:480`, `SalesDashboard.tsx:426`, `RepDashboardV2.tsx:398`, `targetProjectionService.ts:5` | Four copies. `computeWeeklyPace:113` documents its own wrong one: *"Simplified: count unique customer IDs"* |
| Stock health buckets | `services/inventoryDashboardService.ts:27`, `lib/stockStatus.ts` | Agree — and `stockStatus.ts:9` says so in a comment, which is the duplication admitting itself |

Separately, on the matching side: `_shared/poInbox/aliasResolver.ts:547` sends the
**entire product catalog, capped at 500 rows**, to `gpt-4o-mini` for every PO line
that misses its alias. The cap is a correctness ceiling (SKU 501 can never be
matched) and the prompt is ~15k tokens per line.

## Scope

Two independent subsystems. Deliberately **excluded**: NL→SQL / AI query layer,
in-app semantic product search, duplicate-entity detection, and the receivables
and customer-activity metric domains.

## Part 1 — Metric registry (`lib/semantic/`)

A metric is **data plus a pure function**, not just a function:

```ts
interface MetricDef<TValue> {
  id: string                  // 'sales.revenue'
  label: string               // 'Revenue'
  description: string         // what is counted, what is excluded, in prose
  unit: 'currency' | 'count' | 'ratio' | 'quantity'
  requires: readonly (keyof MetricContext)[]
  supportsLineScope: boolean  // see "the category rule" below
  compute(ctx: MetricContext, filter: OrderFilter): TValue
}
```

`MetricContext` is `{ orders, products, settings, now }`. **`now` is always
injected** — no metric reads the clock — following the precedent already set by
`computeDispatchFunnel(orders, windowDays, now)`.

`filterOrders(orders, filter)` is the single scoping definition: date range,
customer, rep, role, status, and the line-level category scope. It resolves the
three-way inclusive-range disagreement in favour of **whole-day inclusive** —
`to` includes everything up to `23:59:59.999` of that date.

### The category rule

`SalesDashboard.tsx:219`'s line-sum override is not purely drift. When its
category filter is active it re-totals from the surviving lines on purpose, which
is the only correct answer to "revenue from category X" — an order's stored total
cannot be attributed to one category. So the layer carries **two** revenue metrics
and a rule connecting them:

- `sales.revenue` — Σ stored `order.total`. Canonical booked revenue.
- `sales.lineRevenue` — Σ `price × quantity` over lines surviving the filter. The
  correct metric under a line-level scope, and a reconciliation probe otherwise.

A filter carrying `category` makes `sales.revenue` unanswerable. `evaluateMetric`
throws rather than returning a number nobody should trust; `supportsLineScope`
declares which metrics accept the scope.

**Verified on dev before migrating:** all 64 orders have stored total == line sum
to the cent (68423.01 both ways), so adopting the stored total changes no number
today. The reconciliation test is what will catch the first divergence once
promotions or header-level adjustments make the two differ.

### Recognition

All six statuses count, on placement date. This preserves today's numbers exactly.
The status filter is declared explicitly, so a shipped-only variant is a
one-line addition rather than a rewrite.

### The inventory rule

An inventory metric either wraps an existing pure helper or reads a
DB-computed field. It **never** re-derives what Postgres already computes —
`inventory_balances.available` is a generated column and `v_bin_fill` is the
single source of bin fill. Bin fill and pick/putaway throughput stay in the
database and are referenced, not recomputed. `Product.inventory` (on-hand) and
`Product.available` (reservable) are distinct caches, and each metric's
`description` names which one it reads.

## Part 2 — Semantic retrieval for PO product lines

`product_embeddings` (pgvector, `text-embedding-3-small`, 1536 dims) keyed by
`product_id`, carrying a `content_hash` so re-embedding is idempotent. An HNSW
cosine index and a `match_products` RPC, both service_role only.

`resolveProduct` shortlists ~20 candidates by cosine and hands them to the
**unchanged** `aiPickProduct`. Everything else — the 0.9 auto-alias threshold, the
alias write, `matchSource: 'ai_fuzzy_match'`, the audit row — is untouched. Only
the candidate list changes.

Fail-open in every direction: no `rpc` on the client, an RPC error, an embedding
failure, or fewer than 3 hits all fall back to today's 500-row catalog path. The
existing `aliasResolver` tests must pass unmodified; that is the proof.

## Testing

- Registry invariants: unique ids, non-empty description, accurate `requires`.
- Per-metric unit tests over fixtures with a fixed injected `now`.
- **Equivalence tests** written before the dashboards are touched: each registry
  metric is asserted equal to the inline expression it replaces, so any change in
  a displayed number is deliberate and named.
- Retrieval: vector path shortlists; missing `rpc`, RPC error, and <3 results each
  fall back.

## Consequences

- One place to look up what a number means, and one place to change it.
- `SalesDashboard` stops disagreeing with `AdminDashboard` about revenue.
- The PO product catalog is no longer capped at 500 SKUs.
- Cost per unmatched PO line drops by roughly an order of magnitude.
- Receivables and customer-activity math stays inline for now, and is the
  obvious next domain.
