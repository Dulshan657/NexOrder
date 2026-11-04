# NX-0014 — Nex answers about one product, breaks a period down, and knows the promotions

```json brief
{
  "id": "NX-0014-nex-products-breakdowns-promotions",
  "base": "ed7ef7456ffce0f3f9ec6c3ce22d9e514cd64610",
  "approved": "2026-11-04 owner",
  "acceptance": [
    { "id": "A1", "check": "find_product fuzzy-matches active products by name, folds spoken units ('210 mill', '210 millilitres' and '210 ml' all match 210ml; 'grams' to g, 'kilos' to kg), and says ambiguous when two products match equally." },
    { "id": "A2", "check": "The semantic OrderFilter takes a productId line scope, like category: lines narrow to that product, orders left with none drop out, and a stored-total metric (sales.revenue) refuses the scope." },
    { "id": "A3", "check": "get_product_summary gives one product's stock (on hand, available, low or out) and its sales for a period from the semantic layer: units in base units, line value, orders, distinct customers, the top 5 customers and the previous period's units. Stock is left out when the tenant has no inventory_dispatch module." },
    { "id": "A4", "check": "For a rep, get_product_summary and get_sales_breakdown count only the rep's own orders, whatever arguments the model sends." },
    { "id": "A5", "check": "get_sales_breakdown(period, by customer, product, category or rep) ranks rows by value, with totals. With the previous period it also returns the drivers of the change: the rows that moved most in the direction of the total change, each with its change and its share of the total change." },
    { "id": "A6", "check": "get_sales_breakdown values categories and products at line value and customers and reps at the stored order total, and its basis says which; a rep asking for a rep ranking gets an error result, not a ranking." },
    { "id": "A7", "check": "get_promotions lists the promotions active now: name, kind, the discount, what it covers (storewide, product names or categories), who it is for, and its end date. It is offered only where the promotions module is on." },
    { "id": "A8", "check": "The instructions send product questions through find_product then get_product_summary, and 'what drove the change' through get_sales_breakdown's drivers." },
    { "id": "A9", "check": "The golden cases NX-0012 marked refuse for these questions (one product's stock, units of one product, best category, top rep, promotions, which customers drove a change) now name the tool and the fact Nex must state, and a rep asking for a rep ranking is a refuse case." },
    { "id": "A10", "check": "On dev, the golden run scores at least NX-0012's 33/34 on the unchanged cases, and the converted cases pass.", "manual": "npm run nex:golden:dev after deploy:dev and voice-session; report quoted in FINAL" },
    { "id": "A11", "check": "Merged and deployed to dev (frontend and voice-session); /version.json shows the merge sha.", "manual": "deploy:dev + voice-session deploy verification" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/findProduct.test.ts", "test": "findProduct > folds spoken units", "proves": ["A1"] },
    { "file": "__tests__/voice/findProduct.test.ts", "test": "findProduct > says ambiguous when two products match equally", "proves": ["A1"] },
    { "file": "__tests__/semantic.filter.test.ts", "test": "filterOrders — product is a line-level scope > narrows lines to one product", "proves": ["A2"] },
    { "file": "__tests__/semantic.filter.test.ts", "test": "filterOrders — product is a line-level scope > a stored-total metric refuses the product scope", "proves": ["A2"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_product_summary > reports stock and sales for one product", "proves": ["A3"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_product_summary > leaves stock out without the warehouse module", "proves": ["A3"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_product_summary > counts only a rep's own orders", "proves": ["A4"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_breakdown > counts only a rep's own orders", "proves": ["A4"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_breakdown > ranks customers by revenue with totals", "proves": ["A5"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_breakdown > names the drivers of a change with their share", "proves": ["A5"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_breakdown > values categories at line value and says so", "proves": ["A6"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_breakdown > refuses a rep ranking to a rep", "proves": ["A6"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_promotions > lists only promotions active now, with what they cover", "proves": ["A7"] },
    { "file": "__tests__/voice/toolSchemas.test.ts", "test": "toolsForRole > offers get_promotions only with the promotions module", "proves": ["A7"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > sends product questions through find_product", "proves": ["A8"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > answers what drove a change from the breakdown drivers", "proves": ["A8"] },
    { "file": "__tests__/voice/goldenQuestions.test.ts", "test": "golden questions > answers what NX-0012 had to refuse", "proves": ["A9"] }
  ],
  "allow": []
}
```

## Goal

Item 3 of the 2026-10-29 review: questions Nex could not answer at all.
- "How much Coconut Milk 400ml do we have?"
- "How many Oyster Sauce did we sell?" (it only knew the top five)
- "Best category?" and "Which rep sold the most?"
- "Which customers drove the drop?"
- "What promotions are running?"

Each becomes a tool built on the same semantic layer as the dashboard. Each
golden case that had to refuse becomes one Nex must answer, so the golden score
shows the effect.

## Approach

- `lib/voice/nameMatch.ts`: `findCustomer`'s fuzzy scoring, made generic (the
  filler words become a parameter). `findCustomer` keeps its behaviour and its
  tests. `lib/voice/findProduct.ts` adds unit folding.
- `lib/semantic`: an `OrderFilter.productId` line scope next to `category`. One
  `hasLineScope(filter)` replaces the `category !== undefined` checks in
  `filter.ts`, `evaluate.ts` and `effectiveRevenue`.
- Tools in `lib/voice/tools/`: `findProductTool`, `getProductSummary`,
  `getSalesBreakdown` and `getPromotions`. Each has schemas in
  `_shared/voice/toolSchemas.ts` and args in `toolArgs.ts`.
  - `get_product_summary` sits with the warehouse tools only for its stock part:
    it is offered everywhere, and the stock is omitted without `inventory_dispatch`.
  - `get_promotions` is offered only with `promotions`. It uses `pricing.ts`
    `isPromotionActive`, the Shop's own rule.
- `VoiceToolContext` gains `promotions`. `AppShell` passes the promotions it
  already holds to `VoiceAssistantLauncher`.
- `instructions.ts`: two lines, kept under `MAX_INSTRUCTION_CHARS` (about 3,400
  of 4,000 today).
- `__tests__/voice/golden/questions.json`: the conversions in A9, plus
  `rep-rep-ranking` (refuse).
- `docs/claude/voice-assistant.md`: the Tools section.

## Out of scope

- **Item 4, deeper analysis.** That covers cancellations in the sales summary
  (19 of October's 38 orders were cancelled), outlier detection, follow-ups
  ranked by dollars at risk, reorders net of open POs, and the target gap stated
  in orders. Its own brief.
- `isPromotionActive` compares dates in UTC, not Sydney. Reused as the Shop
  uses it. The fix belongs to the Shop and Nex together, in a separate change.
- Any write action. Nex stays read-only (NX-0003).
- Amadiya: Nex is off there.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `findProduct > folds spoken units`, `> says ambiguous when two products match equally` (check:brief) | `find_customer`'s own tests pass unchanged on the shared `nameMatch.ts` |
| A2 | claimed | `filterOrders — product is a line-level scope > narrows lines to one product`, `> a stored-total metric refuses the product scope` (check:brief) | |
| A3 | claimed | `get_product_summary > reports stock and sales for one product`, `> leaves stock out without the warehouse module` (check:brief) | Live: "628 units on hand, with 568 available" for Coconut Milk 400ml |
| A4 | claimed | `get_product_summary > counts only a rep's own orders`, `get_sales_breakdown > counts only a rep's own orders` (check:brief) | |
| A5 | claimed | `get_sales_breakdown > ranks customers by revenue with totals`, `> names the drivers of a change with their share` (check:brief) | |
| A6 | claimed | `get_sales_breakdown > values categories at line value and says so`, `> refuses a rep ranking to a rep` (check:brief) | Live `rep-rep-ranking`: "rep sales breakdowns are only available to managers and admins" |
| A7 | claimed | `get_promotions > lists only promotions active now, with what they cover`, `toolsForRole > offers get_promotions only with the promotions module` (check:brief) | Live: the four promotions running on dev, each with its discount and who it is for |
| A8 | claimed | `buildInstructions > sends product questions through find_product`, `> answers what drove a change from the breakdown drivers` (check:brief) | |
| A9 | claimed | `golden questions > answers what NX-0012 had to refuse` (check:brief) | 36 cases |
| A10 | claimed | Golden run on dev, 2026-11-04, build 68d3498 (this branch plus NX-0013 and NX-0011), voice-session deployed from it: **35/36** as scored live, **36/36** re-scored after 1745206 | The one live failure was the scorer, not Nex: "Executive Heating and Cooling" for "Executive Heating & Cooling". All seven converted cases pass, and `admin-top-rep-last-month` says Charlie Brown, $2,463, as SQL does |
| A11 | not-claimed | | Not merged. Dev serves the local combined build 68d3498 |

### Not claimed

- **Every "this month" case ran against an empty month.** The demo has had no orders since 21 Oct, so `admin-best-category` is *unchecked* (its list is empty), and the drivers for "which customers drove the change" are simply every customer, down to zero.
- **The new tools were exercised once each, by one model run.** A pass is not a rate.
- **Two Receive Stock UI tests timed out (about 5.5 s) in one full-suite run** while a browser run shared the machine. That file passes alone (10/10). It is unrelated to this change, and not listed as a known flake.
- **`isPromotionActive` compares UTC dates.** Reused as-is so Nex agrees with the Shop; around Sydney midnight both can be a day out.
- **Nothing was tried by voice**, only typed. NX-0009's spec covers the spoken path for the sales summary only.
- **Stacked on #29.** It cannot merge before #29 does.
