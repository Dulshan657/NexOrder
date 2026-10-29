# NX-0012 — Nex says what the data says, and a golden question set to prove it

```json brief
{
  "id": "NX-0012-nex-honest-answers",
  "base": "ff50c5caaa883473b3d90c942b25e405a34335df",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "get_visit_stats reports the visits a rep logged (visitsLogged, visitsWithOrder) apart from route stops, and carries no stop counts when no route was planned, so a rep with 28 logged visits and no route is never handed a completed count of 0." },
    { "id": "A2", "check": "get_sales_summary marks a period, and a previous period, that ends before the first order recorded in scope (noOrdersBefore: the date of that first order)." },
    { "id": "A3", "check": "get_customer_insights returns the customer's most recent non-cancelled order: date, order id, status, total and its lines with base-unit quantities." },
    { "id": "A4", "check": "The instructions tell Nex to name the comparison dates from previous.label, to say the history does not reach back when a tool marks noOrdersBefore (never growth or decline), and to answer 'what did they order last' from lastOrder's lines, never from top products." },
    { "id": "A5", "check": "A golden question set of at least 30 cases (the 30 asked on 2026-10-29 as Admin and Field Sales Rep) exists; every case names a role, the tool(s) Nex must call (each offered to that role), the facts it must state as paths into that tool's output, or that it must refuse." },
    { "id": "A6", "check": "The golden scorer flags: a number in the answer that no tool returned (whole-dollar rounding and 'about' tolerated), a required fact not stated, a required tool not called, and a must-refuse question answered." },
    { "id": "A7", "check": "npm run nex:golden:dev asks every golden question through the real Nex on nexorder.vercel.app, one session per role, presses End on each, and writes a scored report; the runner refuses any --env other than dev." },
    { "id": "A8", "check": "On dev after deploy, the four misleading answers found on 2026-10-29 (0 visits, 'up on last year', last order from top products, 'last month' for a partial window) each score as passing in the golden report.", "manual": "npm run nex:golden:dev after deploy:dev; report attached to FINAL" },
    { "id": "A9", "check": "Merged and deployed to dev, frontend and voice-session; /version.json shows the merge sha.", "manual": "deploy:dev + fn:deploy:dev voice-session verification" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_visit_stats > reports logged visits apart from route stops", "proves": ["A1"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_visit_stats > has no stop counts when no route was planned", "proves": ["A1"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_summary > marks a period that ends before the first recorded order", "proves": ["A2"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_summary > comparison with the previous period > marks a previous period before the first recorded order", "proves": ["A2"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_customer_insights > returns the last order with its lines", "proves": ["A3"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > names the comparison dates", "proves": ["A4"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > says the history does not reach back instead of calling it growth", "proves": ["A4"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > answers the last order from its lines", "proves": ["A4"] },
    { "file": "__tests__/voice/goldenQuestions.test.ts", "test": "golden questions > has at least 30 cases", "proves": ["A5"] },
    { "file": "__tests__/voice/goldenQuestions.test.ts", "test": "golden questions > every case names a tool its role is offered", "proves": ["A5"] },
    { "file": "__tests__/voice/goldenScore.test.ts", "test": "scoreGoldenCase > flags a number no tool returned", "proves": ["A6"] },
    { "file": "__tests__/voice/goldenScore.test.ts", "test": "scoreGoldenCase > passes a rounded dollar figure", "proves": ["A6"] },
    { "file": "__tests__/voice/goldenScore.test.ts", "test": "scoreGoldenCase > flags a required fact not stated", "proves": ["A6"] },
    { "file": "__tests__/voice/goldenScore.test.ts", "test": "scoreGoldenCase > flags a missing tool call", "proves": ["A6"] },
    { "file": "__tests__/voice/goldenScore.test.ts", "test": "scoreGoldenCase > flags an answer to a question that must be refused", "proves": ["A6"] },
    { "file": "__tests__/voice/nexGoldenArgs.test.ts", "test": "nexGoldenArgs > refuses any env but dev", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

On 2026-10-29 Nex was asked 30 real questions on dev as Admin and as a Field
Sales Rep, and every answer was checked against SQL. Every number the tools
returned was right. Four answers still misled:

- **"You completed 0 visits"**: Charlie had logged 28 visits, 12 of which ended
  in an order. `completed` counts route stops, and he had no route.
- **"Up on last year, because there were no sales then"**: the data begins in
  Dec 2025. There is no last year to compare with.
- **"What did Seaside order last time?"**: answered from their usual products
  ("items like…"), with no quantities. The tool has no last order to give.
- **"Compared with last month"**: the comparison window was a partial or
  shifted one, and Nex called it "last month" anyway.

This fixes those four. It also turns the 30 questions into a **golden set** with a
scorer and a live runner, so every later Nex change (new tools, analysis) is
measured against the same questions rather than a feeling.

## Approach

- `lib/voice/tools/getVisitStats.ts`: the output becomes
  `{ visitsLogged, visitsWithOrder, conversionRate, routeStops? }`. `routeStops`
  `{ planned, arrived, skipped, rate }` is present only when stops were
  planned. The basis wording follows.
- `lib/voice/tools/getSalesSummary.ts`: the first non-cancelled order in scope
  (any date). `noOrdersBefore` is set on the period and on `previous` when the
  window ends before it.
- `lib/voice/tools/getCustomerInsights.ts`: `lastOrder` comes from `liveOrders`
  in base units (`toBaseUnitOrders`), the same scope as the rest of the tool.
- `supabase/functions/_shared/voice/instructions.ts`: three lines, kept under
  `MAX_INSTRUCTION_CHARS`. The tool descriptions in `toolSchemas.ts` name the new
  fields.
- Golden set:
  - `__tests__/voice/golden/questions.json` holds the cases.
  - `lib/voice/golden/score.ts` is a pure scorer. Facts are paths into the
    recorded tool output, such as `get_visit_stats.visitsLogged`, so the
    expected value is whatever the live data says that day, and nothing goes
    stale.
  - `scripts/nex-golden.mjs` is the live runner, productised from the
    2026-10-29 probe. It captures tool calls off the Realtime data channel.
    Its pure argument parser lives in `scripts/lib/nexGoldenArgs.mjs`.
  - `package.json` gets a `nex:golden:dev` script. The report is written under
    `test-results/` (already gitignored).

## Out of scope

- **New tools or analysis.** Single-product stock and sales, category and rep
  breakdowns, promotions, change decomposition, follow-ups ranked by dollars,
  reorders net of open POs and the target gap stated in orders are all later
  PRs, each scored against this set.
- **Running the golden set in CI.** It spends OpenAI minutes and a model's
  behaviour varies between runs (NX-0009's reasoning). CI runs the scorer's and
  the question set's unit tests. The model is measured live, on demand.
- Suggested quantities said with "about". Minor, not changed here.
- Any change to Amadiya, where Nex is off.

## FINAL
