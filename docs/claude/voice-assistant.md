# Nex Assistant — the in-app voice assistant

Added 2026-10-20 (brief `docs/briefs/NX-0003-voice-assistant.md`, branch
`feat/NX-0003-voice-assistant`, **not merged**). This is the argued detail behind the one-line
`voice_assistant` entry in `CLAUDE.md`. Open it before changing anything under `lib/voice/`,
`components/voice/`, `supabase/functions/voice-session/` or `supabase/functions/_shared/voice/`.

## What it is, and what v1 is not

A rep or manager taps the mic button, talks to Nex Assistant about their sales and stock, and
hears the answer. **Advisory and read-only**: it cannot place, change or cancel anything, and
the system prompt makes it say so and name the screen that can. Every tool result carries a
`basis` string and the prompt tells the model to state it, so each answer says what it rests on.

- English only. Voice `marin`, model `gpt-realtime-2.1`, transcription `gpt-4o-mini-transcribe`.
- Four roles: Admin, Manager, Field Sales Rep, Office Sales Rep (`VOICE_ROLES`). Warehouse,
  Customer and QR Staff are out of v1 (the money-hiding rule makes Warehouse a v2 item).
- Live transcript of both sides, Mute, End, and a typed box on the same session and tools. If the
  mic is blocked the callout offers **Type instead**: a text-only session (no `getUserMedia`, a
  receive-only connection, no Mute).
- No transcripts are stored. Usage and cost land on the `voice_sessions` row.
- No phone-number entry point. A tenant gets it only on a release tag that carries the module.

## Architecture

```
Browser (AppShell > lazy VoiceAssistantLauncher)
  useVoiceSession -> lib/voice/voiceSession.ts
    getUserMedia -> RealtimeClient --WebRTC: audio + data channel "oai-events"--> OpenAI Realtime
    function_call (response.done) -> runVoiceTool -> lib/voice/tools/*
        over the user's own, already-loaded, RLS-scoped data (no service-role path)
    startVoiceSession / endVoiceSession --HTTPS--> voice-session Edge Function
        builds the instructions + tool list, keeps the voice_sessions ledger, audits,
        mints a 120 s ek_ key with the standard OPENAI_API_KEY --> /v1/realtime/client_secrets
```

- The browser talks to OpenAI **directly** over WebRTC with a short-lived `ek_` key. The
  standard `OPENAI_API_KEY` never leaves the Edge Function.
- **Tools run in the browser**, over the arrays `App.tsx` already loaded for this user (orders,
  products, customers, targets, visits, routes, settings). There is no service-role data path,
  so RLS is the permission model: a rep's `orders` are RLS-limited to their own, and every
  rep-scoped tool also filters on `ctx.user.numericId` whatever arguments the model sends.
- The server mints the key, builds the system prompt and tool list for the caller's role and
  enabled modules, and keeps the ledger. **The instructions are sent to OpenAI only and are never
  in a response** (pinned by `voiceSessionContract.test.ts`).
- Connection: mic first, then mint, then SDP `POST /v1/realtime/calls` with the key. A 401 there
  means the 120 s key expired unused: the row is closed and ONE re-mint happens; a second 401
  is `expired`. 20 s without `session.created` fails as `connect-failed`.
- Tool calls are taken from `response.done` (authoritative), once per `call_id`. All outputs go
  back as `function_call_output` items, then ONE `response.create`.
- Result cap: `MAX_RESULT_CHARS` = 4000 per tool result (`lib/voice/resultBudget.ts`).

## The two `voice-session` actions

`POST /functions/v1/voice-session`, JWT required, roles Admin / Manager / Field Sales Rep /
Office Sales Rep, `requireModule('voice_assistant')`. Everything else is 403.

| Action | Request | Success (200) |
|---|---|---|
| `start` | `{ action: 'start' }` | `{ ok, sessionId, clientSecret, expiresAt, model, voice, maxSeconds, budget: { usedSeconds, dailySeconds } }` |
| `end` | `{ action: 'end', sessionId, usage?, reason? }` | `{ ok, costUsd }`, or `{ ok, alreadyEnded: true }` on a repeat |

- `reason` is one of `user cap silence hidden channel error unmount`. `usage` is the seven token
  counts, each an integer in `0..MAX_REPORTED_TOKENS` (10,000,000). A report outside that is
  rejected, which would leave the row open, so the client clamps (`realtimeUsage.ts`).
- Refusals: `429 TOO_MANY_REQUESTS` with `details: { code: 'DAILY_BUDGET', resetAt }` when less
  than 60 s are left (the UI shows a **budget** error); a plain 429 for the burst limit; `500`
  `Voice service unavailable` when the mint fails (OpenAI's body is logged, truncated, never
  forwarded); `500` if `OPENAI_API_KEY` is unset (checked before any row exists); `404` for an
  unknown or someone else's `sessionId` on `end`.
- `end` closes the caller's own row on the **server clock**, so a client cannot shorten its own
  session. It is idempotent: the UPDATE is `WHERE ended_at IS NULL`, so two concurrent ends
  are safe. `end` has its own limit, 30 a minute.
- Every start and end writes an `audit_events` row (`create` / `update`, resource `voice_session`).

## The ledger and the budget

`public.voice_sessions` (mig `00133`): `id` (supplied by the function), `user_id`, `role`,
`started_at` (DB default `now()`), `ended_at`, `ended_reason`, `model`, `voice`, token columns,
`usage` jsonb, `cost_usd`. **Service role only**: RLS on with no policy, `REVOKE ALL FROM anon,
authenticated` (so TRUNCATE too), listed in `config/lockedTables.mjs`; `check:grants:dev` is
the proof. It is a ledger and not a `rate_limit_counters` bucket because that table's cron
deletes rows after an hour.

The rules live in `supabase/functions/_shared/voice/budget.ts` (pure, 100% covered):

- **1,800 s a day per user, in a rolling 24 h window**, not a calendar day. A session counts
  if it STARTED within 24 h before now (exactly 24 h ago counts, 24 h + 1 ms does not).
- **Per-session cap 900 s.** `maxSeconds` = min(900, remaining). A session needs at least 60 s
  left to start.
- **An open session (no `ended_at`) is charged at the full 900 s**, until it is 24 h old. A
  crashed tab never earns free minutes, and a closed session counts its length rounded up,
  capped at 900.
- **10 starts an hour per user** (`rate_limit_hit`), the burst limit.
- An unreadable timestamp throws `RangeError` rather than being guessed at.

**Insert-then-verify.** The first check, the insert and the mint are separate statements with
no lock, so `start` inserts its open row and then RE-READS the ledger, charging itself only for
rows that sort strictly before its own (`rowsBefore`: earlier `started_at`, tie-break by id).
It builds the mint request BEFORE inserting, and from the insert to the returned key **any**
throw (budget refusal, failed re-read, unreadable timestamp, failed mint) deletes that one row
by id and rethrows (`handleStart`'s single catch).

**The residual race, stated honestly.** `started_at` is the transaction START time and a row is
visible to others only at COMMIT, so the later-sorting start sees the earlier one only if the
earlier insert had committed before the later re-read. If both re-read first, both are granted.
The window is one insert round trip, and the total stays bounded by the 10 an hour burst limit,
which itself degrades to per-isolate counting if the `rate_limit_hit` call fails (it fails open).

**`cost_usd` is informational.** It is computed from token counts the CLIENT reports, so it is
only as honest as the client; the budget never reads it. Input-audio transcription is billed
separately and is not in it.

## Tools

Ten tools, defined once in `supabase/functions/_shared/voice/toolSchemas.ts`:
`get_sales_summary`, `get_target_progress`, `get_follow_up_list`, `find_customer`,
`get_customer_insights`, `get_suggested_order_for_customer`, `get_stock_status`,
`get_reorder_recommendations`, `get_product_movement`, `get_visit_stats`. Runners are in
`lib/voice/tools/` (one file each), arguments are validated by `lib/voice/toolArgs.ts`, and
`find_customer` must come before any customer-specific tool (the prompt says so).

**`toolsForRole(role, modules)` is the one permission source of truth.** The server offers
exactly that list at mint time and `runVoiceTool` refuses anything outside it with
`Not available for your role` BEFORE parsing arguments. Never compare a role to a literal
anywhere else. Today it drops `get_reorder_recommendations` for reps, the three stock tools
(`get_stock_status`, `get_reorder_recommendations`, `get_product_movement`) without
`inventory_dispatch`, and `get_visit_stats` for anyone but a Field Sales Rep with `field_ops`;
a role outside the four gets `[]`.

**Adding a tool:**
1. Schema: `defineTool(...)` in `toolSchemas.ts`; add it to `VOICE_TOOL_NAMES` and `VOICE_TOOLS`,
   and its role/module rule to `isOffered`.
2. Arguments: a strict zod schema in `lib/voice/toolArgs.ts`.
3. Runner: `lib/voice/tools/<name>.ts` returning `{ ok, basis, data }` (use `scope.ts`
   helpers, `liveOrders` to drop cancelled orders, `ctx.now` and never the clock), then bind it
   in `RUNNERS` in `runVoiceTool.ts` (typed as `Record<VoiceToolName, Runner>`, so `tsc` fails
   until you do).
4. Tests: a case in `__tests__/voice/voiceTools.test.ts` (fixtures in `voiceFixtures.ts`), the
   offered-list case in `toolSchemas.test.ts`. `purity.test.ts` scans `lib/voice/tools/` itself.
5. Prompt: add a line in `instructions.ts` only if the model needs routing help. The prompt
   stays under `MAX_INSTRUCTION_CHARS` (4000); it is paid for on every turn.
6. Redeploy `voice-session`: the mint carries the tool list.

Ids: `Order.submittedBy.id`, `Visit.userId` and `SalesTarget.userId` are NUMERIC hashes of the
profile uuid (`numericIdForProfile`). Never compare them with `currentUserUuid`.

**Spoken periods are Sydney calendar days** (fix wave after the final review). `today`,
`this_week` (Monday to today), `this_month`, `last_month`, `last_30_days` and custom
`YYYY-MM-DD` dates resolve in `APP_TIME_ZONE` = `Australia/Sydney`
(`supabase/functions/_shared/voice/timeZone.ts`, pure, read by both runtimes), the same zone
`voice-session` uses to tell the model today's date. They were UTC days until then, so at
09:00 on 1 November in Sydney the model believed it was November while `this_month` was all
of October. `lib/voice/period.ts` turns a window into two exact instants (local midnight of
the first day, the last millisecond of the last day), finding the offset at that midnight
through `Intl` rather than assuming one: the first Sunday of October is 23 hours and the first
Sunday of April 25. `previous` is the same number of local days immediately before. Target
windows (`get_target_progress`) are stored date ranges and still go through
`lib/semantic` `dayRange`, which is UTC; the zone is fixed for every tenant (per-tenant is v2).

**Every spoken quantity is in BASE units.** `OrderItem.quantity` is in the line's unit of
measure (cartons on a carton line) and `packSize` is that unit's factor to base units
(undefined for a single unit; the server's `lineBaseUnits` is `quantity x COALESCE(pack_size, 1)`).
`lib/semantic` `sales.unitsByProduct`, `computeSalesVelocity` and `buyingPatternsService` sum the
quantity as entered, which other screens rely on, so the voice tools restate their input with
`lib/voice/baseUnits.ts` `toBaseUnitOrders` (quantity times the factor, line price divided by
it, so the line value is unchanged) before any quantity: top-product units, velocity (and so
movement, days remaining and the reorder quantity, which compare against base-unit stock), a
customer's usual quantities and the suggested order, which names each product's `unit`
(`units` when the product has none). Revenue reads the original orders.

**The sales-target adapter fix.** `toSalesTarget` used to do `Number(row.user_id) || 0`, but
`sales_targets.user_id` is a uuid, so every target had `userId` 0 and `get_target_progress`
returned nothing for a rep. It now uses `numericIdForProfile` (`__tests__/salesTargetAdapter.test.ts`).
Side effect on dev: the rep and admin dashboard target cards, which compared against
`currentUser.id`, now show the targets that exist.

## The module gate, and why `roles.ts` exists

`voice_assistant` requires `sales_orders` and is a folded constant, `MODULE_VOICE_ASSISTANT`.
`AppShell` gates the **declaration**, `const VoiceAssistantLauncher = MODULE_VOICE_ASSISTANT ?
lazyWithRetry(() => import('./voice/VoiceAssistantLauncher')) : null`, mounts it once after
`</main>` (inside the `relative` column, under its own `ErrorBoundary` and `Suspense`), and only
renders it when `canUseVoiceAssistant(currentUser.role)`. `AdminView.tsx` does not declare it.

**The entry bundle must not contain the tool contract.** `AppShell` imports
`canUseVoiceAssistant` statically, and that once imported `VOICE_ROLES` from `toolSchemas.ts`,
whose module-level `defineTool(...)` calls cannot be tree-shaken: the tool names and schemas
shipped in the entry chunk even with the module off. `supabase/functions/_shared/voice/roles.ts`
(no imports) now holds `VOICE_ROLES` and `REP_ROLES`, `toolSchemas.ts` re-exports them, and
`__tests__/voice/launcherGateImports.test.ts` fails if the launcher gate can reach
`toolSchemas.ts`. Verify a gate by building and grepping `dist/` for code symbols
(`oai-events`, `Talk to Nex Assistant`, `get_sales_summary`): with the module on they appear
only in the lazy `VoiceAssistantLauncher-*.js` chunk, and with it off nowhere.

## Microphone and CSP, per target

`vercel.ts` derives both from `target.modules`, and `npm run check:csp` asserts each in BOTH
directions for every target:
- `Permissions-Policy: microphone=(self)` where the module is on, `microphone=()` where it is
  off. An empty allowlist denies the mic to the document's own origin: `getUserMedia` rejects
  with `NotAllowedError` and no prompt ever appears.
- `connect-src` gains `https://api.openai.com` only where the module is on. The CSP is still
  Report-Only.

A target gains or loses these on its next BUILD, never from a toggle.

## iOS and Safari: autoplay and the synchronous `start()`

Safari only lets audio start inside a user gesture. The launcher's tap handler calls
`setOpen(true)` and `session.start()` **in the same synchronous handler**, and `startSession`
reaches `getUserMedia` with no `await` before it. The remote track's `audio.play()` runs in
`ontrack` against the sheet's `<audio autoPlay playsInline>` (`audioRef`). Do not move `start()`
into an effect or behind an `await`: `VoiceAssistantLauncher > starts the session synchronously
in the tap that opens the sheet` fails if you do. A standalone PWA may re-prompt for the mic on every
launch. **None of this has been proved on a real iPhone** (brief A14 is not claimed).

## Pricing (as of 2026-10-20)

Source: https://developers.openai.com/api/docs/pricing, `gpt-realtime-2.1`, USD per 1M tokens.
Held in `REALTIME_PRICING` (`_shared/voice/cost.ts`, `asOf: '2026-10-20'`) so a stored cost never
changes retroactively. When prices change, edit them AND bump `asOf`.

| | Input | Cached input | Output |
|---|---|---|---|
| Text | $4 | $0.40 | $24 |
| Audio | $32 | $0.40 | $64 |

Tokens the audio/text breakdown does not explain are billed at the audio rate, so the estimate
errs high.

**Rough scale, derived from the table above (an estimate, not a measurement).** Assume about
600 audio input tokens per minute the model hears and about 1,200 audio output tokens per
minute it speaks, the figures in Layer3's write-up
(https://www.layer3labs.io/guides/openai-realtime-api-pricing, a third-party estimate):

- listening: 600 x $32 / 1,000,000 = $0.0192, about **$0.02 a minute**;
- speaking: 1,200 x $64 / 1,000,000 = $0.0768, about **$0.08 a minute**.

It leaves out the conversation context re-sent as (mostly cached) input on every turn, which
grows through a session, text tokens, and transcription, which is billed separately. Treat it
as an order of magnitude; `cost_usd` on each row is the per-session figure.

## OpenAI key

`OPENAI_API_KEY` (an Edge Function secret) must be a project key allowed to use Realtime
(`model.request` scope). If the mint returns 401/403, check that first. If a model, field or
`semantic_vad` is rejected at mint, consult the client-secret reference, adjust
`_shared/voice/sessionRequest.ts` and note it here. The per-user safety identifier is sent as
the `OpenAI-Safety-Identifier` header; whether OpenAI honours that header is unconfirmed (an
unknown header is ignored). A monthly spend limit on the OpenAI project is the real hard
backstop, and both it and the Realtime scope are release gates: see below.

## Release gates (before ANY tenant release that carries this module)

Owner steps, run from **the tenant workspace** on a `rel-*` tag as the release runbook says
([`releasing.md`](releasing.md), the `voice_assistant` section). Nothing here is run from this
checkout.

1. **The OpenAI project that owns the tenant's `OPENAI_API_KEY` has Realtime access
   (`model.request` scope) and a MONTHLY SPEND LIMIT set.** Why the limit is not optional: the
   daily ledger and the 15-minute cap bind only a COOPERATIVE client. The server cannot end an
   OpenAI call. A modified client can call `end` early (closing the row, so the ledger counts
   a short session) and keep its WebRTC call alive up to OpenAI's own session limit, and repeat
   that up to the burst limit of 10 starts an hour. The OpenAI spend limit is the only control
   that holds against that.
2. **The order of operations**, each by its npm script name for the tenant target:
   1. `secrets` (the registry-derived `ENABLED_MODULES` gains `voice_assistant`; derived
      secrets are re-applied on every run);
   2. `migrate` (applies `00133_voice_sessions.sql`);
   3. `fn:deploy` for `voice-session` (warm isolates read `ENABLED_MODULES` once, so the
      redeploy is what makes the new value live; until then the function answers 403);
   4. `deploy` (the frontend). Function before frontend, always.
3. **The Realtime scope check is manual.** `secrets:check` can only see that `OPENAI_API_KEY`
   is set; nothing in it can tell whether the key's project may call Realtime or has a spend
   limit. Check both in the OpenAI dashboard and record that you did.

**v2 hardening (NOT implemented):** have the client report the OpenAI call id from the SDP
answer's `Location` header to `voice-session`, and let `end`, or a cron, hang up any call that
outlives its cap with `POST /v1/realtime/calls/{id}/hangup`. That would make the cap a server
control; until then it is the spend limit above.

## Known and accepted caveats

- **A user can send `session.update` on their own data channel** and change the instructions or
  tools. Data access is unaffected, because tools run under that user's own RLS. Accepted.
- **The budget window is rolling 24 h**, and an abandoned session counts at the full cap.
- **The start race** above: two near-simultaneous starts can both be granted.
- **A connection that dies before `session.created`** ends as `ended` ("Session ended") with no
  failure message: a data channel close calls `endSession('channel')`. The 20 s connect timeout
  only covers a connection that stays silent.
- **A page close ends the row with a keepalive request issued in the same tick** as
  `pagehide`/`beforeunload`/unmount, with the access token the session cached at start and
  refreshed every five minutes and at the cap warning (`Handles.accessToken`, never logged).
  Only with no cached token does it await `getSession()` first, and then a closing page can
  still leave the row open at the full cap.
- **The server cannot hang up an OpenAI call**, so the caps bind a cooperative client only;
  the OpenAI spend limit is the backstop (release gates above; the hang-up is v2).
- **The spoken-period zone is Australia/Sydney for every tenant.** A per-tenant setting is v2.
- `cost_usd` is client-reported and informational; transcription is not in it.

## Nex: the name, the personality and the orb (NX-0004)

Users meet the assistant as **Nex** ("Talk to Nex", the sheet titled "Nex", "Nex:" before
her lines for screen readers). Internal names keep "Nex Assistant" and the module slug
stays `voice_assistant`; renaming those would be churn. Her personality lives in the
`PERSONALITY` section of `_shared/voice/instructions.ts`: friendly, approachable and
helpful. It is the **last** section on purpose, so it colours the answers without
outranking the rules above it (brief answers, call a tool before any number). The voice
is `marin`. A prompt change reaches users only after `fn:deploy:<env> voice-session`.

The orb is `components/voice/NexOrb.tsx`, painted from the pure engine of
[`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs) (MIT, pinned exactly at
`0.3.2`, `thinking-orbs/engine` only; it ships in the launcher's lazy chunk and nowhere
else). `components/voice/orbState.ts` maps the session to a look:

| Session | Orb | Driven by |
|---|---|---|
| requesting-mic / minting / connecting | `connecting` | — |
| live listening | `listening` | the rep's mic |
| live thinking | `working` | — |
| live speaking | `composing` | Nex's voice |
| idle / ending / ended / text-only Ready | `breathing` | — |
| error | `breathing`, frozen | — |

The colour is `voiceStatus`'s tone, so the orb and the status pill cannot disagree.

- **Only the hero orb animates during a chat.** The header and launcher orbs are still
  icons that play a ~0.9 s burst when tapped (the header's also plays once as the sheet
  opens). The launcher never has a session to show: closing the sheet ends it.
- **Loudness is read per animation frame, never through React state** (`getLevel` →
  `readLevel` in `voiceSession.ts` → `lib/voice/audioLevel.ts`), so 60 fps does not
  re-render the sheet.
- **The analyser is never connected to the AudioContext's `destination`.** Nex's voice
  already plays through the sheet's `<audio>` element; wiring the analyser onward would
  play it twice. Chrome feeds a remote WebRTC stream into Web Audio only while it is also
  attached to a media element, which it is.
- Muted reads as 0 (the disabled track carries silence); text-only has no mic meter.
- Reduced motion gets one still frame per state; a hidden tab stops the loop.

## Operating it (dev)

```bash
npm run migrate:dev                       # 00133_voice_sessions.sql
npm run fn:deploy:dev voice-session       # after any change under supabase/functions/
npm run secrets:dev                       # re-applies ENABLED_MODULES (derived from the registry)
npm run deploy:dev                        # the web app
npm run check:grants:dev                  # voice_sessions must stay service-role only
npx -y deno@2 check --node-modules-dir=none supabase/functions/voice-session/index.ts
node supabase/apply-sql.mjs --env=dev --query "SELECT role, started_at, ended_at, ended_reason, cost_usd FROM public.voice_sessions ORDER BY started_at DESC LIMIT 10"
```

The function answers 403 `The voice assistant module is not enabled` until the project's
`ENABLED_MODULES` secret contains `voice_assistant`; `secrets:dev` fixes that, then redeploy the
function (a warm isolate does not re-read secrets). A release to a tenant is a separate owner
step, done from the tenant workspace on a `rel-*` tag; nothing in this doc is run from here.

Tests: `__tests__/voice/` (contracts, tools, hook, sheet, launcher, purity, gate imports).
