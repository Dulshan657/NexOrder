# NX-0003 — Nex Assistant: in-app voice assistant for sales and inventory (v1)

```json brief
{
  "id": "NX-0003-voice-assistant",
  "base": "b356a7dab4cff9308e0937fdaaaf87d75b689cf7",
  "approved": "2026-10-20 owner (implementation plan approved in session 25f092a2; this brief restates its scope and adds none)",
  "acceptance": [
    { "id": "A1", "check": "voice_assistant is a registered module that requires sales_orders and is enabled for dev and amadiya." },
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
    { "file": "__tests__/voice/moduleFlag.test.ts", "test": "voice_assistant module > is enabled for dev and amadiya", "proves": ["A1"] },
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

- New module `voice_assistant` (requires `sales_orders`), enabled for dev and amadiya.
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

_Written last._
