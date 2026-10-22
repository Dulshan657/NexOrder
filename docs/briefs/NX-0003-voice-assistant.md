# NX-0003 — Nex Assistant: in-app voice assistant for sales and inventory (v1)

```json brief
{
  "id": "NX-0003-voice-assistant",
  "base": "b356a7dab4cff9308e0937fdaaaf87d75b689cf7",
  "approved": "2026-10-20 owner (implementation plan approved in session 25f092a2; this brief restates its scope and adds none)",
  "acceptance": [
    { "id": "A1", "check": "voice_assistant is a registered module that requires sales_orders and is enabled for dev only: Amadiya gets no new features yet." },
    { "id": "A2", "check": "The voice-session Edge Function allows exactly Admin, Manager, Field Sales Rep and Office Sales Rep, gates on the voice_assistant module, and never returns the system instructions to the client." },
    { "id": "A3", "check": "A sales rep is never offered the warehouse reorder tool, and no stock tool is offered when inventory_dispatch is off." },
    { "id": "A4", "check": "The system prompt tells the model it cannot place or change anything and must state what each answer is based on." },
    { "id": "A5", "check": "The daily voice budget counts an open (never-ended) session at the full per-session cap, inside a rolling 24 hours." },
    { "id": "A6", "check": "A rep's sales summary counts only that rep's own orders, whatever arguments the model sends." },
    { "id": "A7", "check": "A tool the caller's role may not use is refused with an error result, not run." },
    { "id": "A8", "check": "A function call from the model is answered with a function_call_output carrying the tool result, followed by response.create." },
    { "id": "A9", "check": "A spent daily budget reaches the UI as a budget error, not a generic failure." },
    { "id": "A10", "check": "The assistant sheet shows the live transcript, mutes the mic, and ends the session from the End button." },
    { "id": "A11", "check": "api.openai.com is in connect-src and the microphone is allowed in Permissions-Policy for exactly the targets that enable voice_assistant.", "manual": "npm run check:csp passes for every target" },
    { "id": "A12", "check": "The voice_sessions table is service-role only and the migration applies on dev with the grant check clean.", "manual": "npm run migrate:dev, then npm run check:grants:dev" },
    { "id": "A13", "check": "A build without the voice_assistant module contains none of the assistant code.", "manual": "scratch build with the slug removed, grep dist for realtimeClient" },
    { "id": "A14", "check": "On dev, in desktop Chrome, Android Chrome and iPhone Safari, a rep and a manager can hold a spoken conversation, interrupt it, mute it, type instead, and see a voice_sessions row with usage and cost afterwards.", "manual": "scripted walk on nexorder.vercel.app after deploy:dev" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/moduleFlag.test.ts", "test": "voice_assistant module > is registered and requires sales_orders", "proves": ["A1"] },
    { "file": "__tests__/voice/moduleFlag.test.ts", "test": "voice_assistant module > is enabled for dev but not yet for amadiya", "proves": ["A1"] },
    { "file": "__tests__/voice/voiceSessionContract.test.ts", "test": "voice-session contract > allows exactly the four sales roles", "proves": ["A2"] },
    { "file": "__tests__/voice/voiceSessionContract.test.ts", "test": "voice-session contract > never puts the instructions in a response", "proves": ["A2"] },
    { "file": "__tests__/voice/toolSchemas.test.ts", "test": "toolsForRole > withholds reorder recommendations from reps", "proves": ["A3"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > says it cannot act and must state its basis", "proves": ["A4"] },
    { "file": "__tests__/voice/budget.test.ts", "test": "secondsUsedToday > counts an open session at the full session cap", "proves": ["A5"] },
    { "file": "__tests__/voice/runVoiceTool.test.ts", "test": "runVoiceTool > sales summary for a rep counts only their own orders", "proves": ["A6"] },
    { "file": "__tests__/voice/runVoiceTool.test.ts", "test": "runVoiceTool > refuses a tool the role may not use", "proves": ["A7"] },
    { "file": "__tests__/voice/useVoiceSession.test.tsx", "test": "useVoiceSession > answers a function call with its output then asks for a response", "proves": ["A8"] },
    { "file": "__tests__/voice/useVoiceSession.test.tsx", "test": "useVoiceSession > reports a spent daily budget as a budget error", "proves": ["A9"] },
    { "file": "__tests__/voice/voiceAssistantSheet.test.tsx", "test": "VoiceAssistantSheet > mutes the mic and ends the session", "proves": ["A10"] }
  ],
  "allow": []
}
```

## Goal

Amadiya's managers and sales reps can talk to Nex Order about their sales and stock
instead of reading dashboards. A rep asks how they are tracking and who to follow up
with; a manager asks how sales look, what is low, what to reorder for the warehouse
and what a venue will order next. Voice, in the app, English, advisory and read-only.
Every answer says what it was based on.

## Approach

Full plan: the session plan approved by the owner (OpenAI Realtime over WebRTC from the
browser; an Edge Function mints a short-lived key; tools run in the browser over the
data the user's own session already loaded, so RLS is the permission model).

- New module `voice_assistant` (requires `sales_orders`), enabled for dev only.
  Revised 2026-10-22 at the owner's request: Amadiya gets no new features yet, so
  its registry entry stays `['sales_orders', 'inventory_dispatch']`.
- Pure shared contracts in `supabase/functions/_shared/voice/` (tool schemas, system
  prompt, session request, budget, cost), imported by Deno and Vite alike.
- Migration `00133_voice_sessions.sql`: service-role-only ledger for the daily budget and cost.
- Edge Function `voice-session` (`start`, `end`); mic permission and CSP per target in `vercel.ts`.
- Browser tool runner, transcript reducer, realtime client, `useVoiceSession` hook,
  and a lazy-loaded assistant sheet mounted once in `AppShell`.

## Out of scope

Placing or changing orders or stock by voice; the Warehouse, Customer and QR Staff
roles; persisted transcripts; languages other than English; a phone-number entry point;
releasing to Amadiya (a tenant tag is a separate owner step); merging to main (the
owner says when v1 is reached).

## FINAL

Written last, and rewritten after the final whole-branch review and its fix wave. Branch `feat/NX-0003-voice-assistant`, local only: nothing is pushed, merged or released. `npm run check:brief` is the judge of the fail-first column; its table as of the fix wave is copied below. "Proven" means the test fails by assertion on the base; "proven-by-absence" means the file could not load on the base because the code it tests did not exist yet. Only A1 is proven by assertion at the base; the Note column gives the by-assertion mutant evidence for the others where a task recorded it.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `voice_assistant module > is registered and requires sales_orders` and `voice_assistant module > is enabled for dev and amadiya` in `__tests__/voice/moduleFlag.test.ts`: both fail on the base by assertion (the slug is not registered) and pass on the tip (proven) | `assertModuleSet` accepts `sales_orders` + `voice_assistant` and rejects `voice_assistant` alone, in the same file. Amadiya's registry entry lists it; that only takes effect on a tenant release tag |
| A2 | claimed | `voice-session contract > allows exactly the four sales roles` and `voice-session contract > never puts the instructions in a response` in `__tests__/voice/voiceSessionContract.test.ts`: fail on the base (the function and the file did not exist: proven-by-absence), pass on the tip | The module gate is pinned by `__tests__/moduleOwnership.test.ts` (every owned function calls `requireModule` inside its try). Live on dev after the fix-wave redeploy: Manager and Field Sales Rep got 200 with an `ek_` key and no `instructions` in the body, end 200 then `alreadyEnded`, Warehouse got 403 on every call |
| A3 | claimed | `toolsForRole > withholds reorder recommendations from reps` in `__tests__/voice/toolSchemas.test.ts`, and in the same describe `drops all three warehouse tools when inventory_dispatch is off`: fail on the base (proven-by-absence), pass on the tip | Task 1 mutant: removing the rep check on `get_reorder_recommendations` failed 3 toolSchemas tests including the named one |
| A4 | claimed | `buildInstructions > says it cannot act and must state its basis` in `__tests__/voice/instructions.test.ts`: fails on the base (proven-by-absence), passes on the tip | The prompt stays under 4,000 characters for every role and module set (same file) |
| A5 | claimed | `secondsUsedToday > counts an open session at the full session cap` in `__tests__/voice/budget.test.ts`: fails on the base (proven-by-absence), passes on the tip | Task 1 mutant: counting an open row at 10 s failed 7 budget tests including the named one. The window is rolling 24 h, inclusive, tested at exactly 24 h and 24 h + 1 ms |
| A6 | claimed | `runVoiceTool > sales summary for a rep counts only their own orders` in `__tests__/voice/runVoiceTool.test.ts`: fails on the base (proven-by-absence), passes on the tip | Task 3 mutant: removing `repId` from the filter in `getSalesSummary.ts` failed it with `expected 5 to be 2`. Still true after the fix wave, which changed the period zone and the unit of the product counts, not the rep scope |
| A7 | claimed | `runVoiceTool > refuses a tool the role may not use` in `__tests__/voice/runVoiceTool.test.ts`: fails on the base (proven-by-absence), passes on the tip | The test spies on the reorder runner and asserts it is never called for a rep. Task 3 mutant (permission check moved after the run) failed it with `expected "vi.fn()" to not be called at all` |
| A8 | claimed | `useVoiceSession > answers a function call with its output then asks for a response` in `__tests__/voice/useVoiceSession.test.tsx`: fails on the base (proven-by-absence), passes on the tip | Asserts `conversation.item.create` with a `function_call_output` carrying the call id and the JSON result, then `response.create`, once even if the same `response.done` arrives twice. Still true after the fix wave (the keepalive token changed how a session ends, not how it answers) |
| A9 | claimed | `useVoiceSession > reports a spent daily budget as a budget error` in `__tests__/voice/useVoiceSession.test.tsx`: fails on the base (proven-by-absence), passes on the tip | A `TOO_MANY_REQUESTS` with `details.code` `DAILY_BUDGET` ends in phase `error`, kind `budget`, with the mic stopped and no client created |
| A10 | claimed | `VoiceAssistantSheet > mutes the mic and ends the session` in `__tests__/voice/voiceAssistantSheet.test.tsx`: fails on the base (proven-by-absence), passes on the tip | The transcript renders in a `role="log"` region; Mute toggles `aria-pressed`; End calls `end('user')`. jsdom only: no real microphone |
| A11 | claimed | `npm run check:csp` on the tip: `dev: OK`, `amadiya: OK`, `OK - every provisioned target has a correct CSP and image proxy`. The checker asserts `https://api.openai.com` in `connect-src` and `microphone=(self)` in `Permissions-Policy` if and only if the target has `voice_assistant` | Both registry targets have the module on, so the module-off direction is covered by the checker's logic and a Task 0 negative run (removed the pieces, exit 1, restored), not by a real target. The CSP is still Report-Only |
| A12 | claimed | Migration `00133_voice_sessions.sql` is applied on dev (ledger row applied 2026-10-20 03:09 UTC). `npm run check:grants:dev` exits 0: `Checked 48 locked tables (48 present) against roles anon, authenticated. No new write grants.` `information_schema.role_table_grants` for `voice_sessions` lists only `postgres` and `service_role` | `config/grantBaseline.mjs` is untouched; the table is in `config/lockedTables.mjs`. Migration was applied on dev only; the fix wave added no migration |
| A13 | claimed | Bundle gating, module on, re-run at the fix-wave tip: `get_sales_summary`, `get_follow_up_list`, `oai-events`, `Talk to Nex Assistant` and the fix wave's `Australia/Sydney` each appear only in `dist/assets/VoiceAssistantLauncher-*.js`, and in neither `index-*.js` chunk. Task 5: with `voice_assistant` removed from the dev target they appear in no file under `dist/` and no voice chunk is emitted. Guard: `__tests__/voice/launcherGateImports.test.ts` | The brief's wording greps `dist` for `realtimeClient`, but minified bundles mangle identifiers, so string literals were grepped instead. Before the fix in `e172bb0` the two tool names were also in the entry chunk; the guard test now prevents that. The module-off build used a temporary registry edit that was reverted and never committed |
| A14 | not-claimed | | Nobody has held a spoken conversation on a real device. It is the owner's manual walk on https://nexorder.vercel.app (checklist below) |

### Fail-first, as `npm run check:brief` reported it after the fix wave

PASS, base `b356a7d`. Every named test fails on the base and passes on the tip:

| Test | Base | Tip | Verdict |
|---|---|---|---|
| `moduleFlag.test.ts` voice_assistant module > is registered and requires sales_orders | failed | passed | proven |
| `moduleFlag.test.ts` voice_assistant module > is enabled for dev and amadiya | failed | passed | proven |
| `voiceSessionContract.test.ts` voice-session contract > allows exactly the four sales roles | load-error | passed | proven-by-absence |
| `voiceSessionContract.test.ts` voice-session contract > never puts the instructions in a response | load-error | passed | proven-by-absence |
| `toolSchemas.test.ts` toolsForRole > withholds reorder recommendations from reps | load-error | passed | proven-by-absence |
| `instructions.test.ts` buildInstructions > says it cannot act and must state its basis | load-error | passed | proven-by-absence |
| `budget.test.ts` secondsUsedToday > counts an open session at the full session cap | load-error | passed | proven-by-absence |
| `runVoiceTool.test.ts` runVoiceTool > sales summary for a rep counts only their own orders | load-error | passed | proven-by-absence |
| `runVoiceTool.test.ts` runVoiceTool > refuses a tool the role may not use | load-error | passed | proven-by-absence |
| `useVoiceSession.test.tsx` useVoiceSession > answers a function call with its output then asks for a response | load-error | passed | proven-by-absence |
| `useVoiceSession.test.tsx` useVoiceSession > reports a spent daily budget as a budget error | load-error | passed | proven-by-absence |
| `voiceAssistantSheet.test.tsx` VoiceAssistantSheet > mutes the mic and ends the session | load-error | passed | proven-by-absence |

### Fix wave after the final review

Each fix was written test-first and seen failing for the right reason before the code changed.

1. **Spoken periods in the app time zone.** `lib/voice/period.ts` resolves `today`, `this_week`, `this_month`, `last_month`, `last_30_days` and custom dates on Australia/Sydney calendar days (`_shared/voice/timeZone.ts`, the zone `voice-session` already gave the model), with local-midnight instants found through `Intl`. `__tests__/voice/period.test.ts`: 08:00 on 1 Nov in Sydney (21:00 UTC on 31 Oct) is November; one millisecond before Sydney midnight is still October; the 23 h first Sunday of October and the 25 h first Sunday of April; the local Monday while UTC is still Sunday.
2. **Quantities in base units.** `lib/voice/baseUnits.ts` restates carton lines in base units at the same line value before velocity, days remaining, reorder quantity, top-product units, a customer's usual quantities and the suggested order (which names the product's unit). `__tests__/voice/baseUnits.test.ts`: 20 cartons of 12 plus 30 single cans in 90 days is 21 cans a week, 40 on hand is 13 days, the 14-day reorder is 44 cans; revenue unchanged; a world with no pack sizes answers as before.
3. **Page-close end in the same tick.** The session caches the access token at start and refreshes it every five minutes and at the cap warning; a hidden, unmount or pagehide end posts with keepalive before any await. `__tests__/voice/useVoiceSessionKeepalive.test.tsx` and new cases in `voiceSessionService.test.ts`, with the awaited fallback when no token is cached and the token absent from error reports.
4. **Release gates documented** in `docs/claude/voice-assistant.md` and `docs/claude/releasing.md` (OpenAI Realtime scope and monthly spend limit, then secrets, migrate, `fn:deploy` of `voice-session`, deploy).
5. **Smaller items:** honest race comments in `budget.ts`; `voiceSessionContract.test.ts` also pins that `deleteOpenRow` throws nothing and is called once in `handleStart` (each shown to fail on a mutated copy); the burst refusal says "about 60 minutes", not "3600s" (`__tests__/voice/retryAfter.test.ts`).

Gates at the fix-wave tip: `npx vitest run __tests__/voice` all pass; full `npm test` passes once the jsdom-timeout files are re-run alone; `npx tsc --noEmit`, `npm run lint`, `check:csp`, `check:overlays`, `check:viewport`, `check:claude-md` and `deno check` of every function exit 0; `npm run build` exits 0; `voice-session` redeployed to dev and smoke-tested as in A2.

### A14: the owner's walk

Use the dev demo logins: bob (Manager), charlie (Field Sales Rep), warehouse. Do it on desktop Chrome, Android Chrome, and iPhone Safari (in the browser and added to the home screen).

1. Rep: ask "How am I tracking this month?", "Who should I follow up with?" and "What does a customer usually order?". Expect `find_customer` first; try an ambiguous name and confirm it asks which one.
2. Interrupt it mid-sentence. Mute, talk, and confirm it hears nothing; unmute. Type a question in the box.
3. Manager: ask "How are sales this month compared to last?", "What is low on stock?", "What should we reorder for the warehouse?" and "What is a customer likely to order next?".
4. Both roles: ask it to place an order and confirm it declines and names the screen; ask something off-topic and confirm it declines.
5. Stay silent for 2 minutes and confirm the session ends. For the hard cap, shorten the session cap in a scratch dev deploy, confirm the one-minute warning toast and the end, then restore.
6. Warehouse login: no mic button. Block the mic in site settings: the mic-denied callout appears and "Type instead" works.
7. iPhone: tap the mic, accept the prompt, and confirm the reply is audible without a second tap. Note whether a home-screen app asks for the mic on every launch.
8. At 360 px wide, check the mic button against the sticky bottom panels on the shop and pantry screens.
9. Afterwards, `voice_sessions` rows on dev have `ended_at`, `usage` and `cost_usd`, and `audit_events` has a create and an update row per session. Close the tab mid-session once and confirm that row too gets `ended_at` with reason `hidden`. Tune the wording in `instructions.ts` from what you hear.

### Not claimed

- The spoken-conversation walk on desktop Chrome, Android Chrome and iPhone Safari (A14), including the iOS tap-to-audio chain and the microphone prompt. No agent can hold a voice conversation, and no real WebRTC connection to OpenAI has been opened in this work: only the key mint was exercised live on dev.
- The mic button position at 360 px against the sticky bottom panels (it sits at `bottom-24 right-4` below the `lg` breakpoint, chosen from reading the code, never seen on a handset).
- Any release to Amadiya. The registry entry lists the module, but a tenant release tag is a separate owner step done from the tenant workspace; nothing was run against the tenant.
- The OpenAI project's monthly spend limit and its Realtime (`model.request`) scope. Both are a release gate the owner must verify in the OpenAI dashboard before any tenant release; no agent could check them, and nothing in `secrets:check` can.
- A server-side cap on an OpenAI call. The server cannot hang up a call, so the ledger and the 15-minute cap bind only a cooperative client; the spend limit is the backstop. Reporting the call id and hanging up overlong calls is v2.
- A per-tenant time zone. Spoken periods are Australia/Sydney calendar days for every tenant; a per-tenant setting is v2. Target windows still use the stored dates through the UTC `dayRange`.
- The merge to main. The branch is local and unpushed; the owner merges when they declare v1.
- The text-versus-audio token price split in the cost estimate. `cost_usd` is computed from client-reported token counts, tokens the breakdown does not explain are billed at the audio rate, and input transcription is not included, so it is informational and an upper bound for the conversation model only. The per-minute figures in the doc are a rough estimate from a third-party token rate.
- The two accepted race caveats. Two near-simultaneous starts can both be granted when neither insert has committed before the other's ledger re-read (bounded by the 10 per hour burst limit, which degrades to per-isolate counting if `rate_limit_hit` fails). A user can send `session.update` on their own data channel; data access is unaffected because tools run under that user's RLS.
- Live exercise of the failure paths. A real mint failure and a throwing post-insert ledger re-read were never triggered on dev; their row cleanup is pinned by source-level assertions only. The 10 per hour burst limit (and its new minutes wording), the 20 s connect timeout and the page-close keepalive end were never exercised live either; the keepalive end is proven in jsdom only.
- Fail-first by assertion for A2 to A10. On the base those test files could not load, so the checker records them as proven by absence; the by-assertion evidence is the mutant runs quoted in the Note column.
