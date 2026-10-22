# NX-0004 — Nex: an orb, a name and a personality for the voice assistant

```json brief
{
  "id": "NX-0004-voice-orb",
  "base": "a71899cc423ce0e58c649ecee74697079088cd5f",
  "approved": "2026-10-22 owner",
  "acceptance": [
    { "id": "A1", "check": "orbVisual maps every session state to its orb: requesting-mic/minting/connecting -> connecting; live listening -> listening driven by the mic; live thinking -> working; live speaking -> composing driven by the remote voice; idle/ended/text-only Ready -> breathing; error -> a frozen frame." },
    { "id": "A2", "check": "The orb and the status pill never disagree: for every phase x live x textOnly x error, orbVisual's tone equals voiceStatus's tone." },
    { "id": "A3", "check": "Level smoothing rises quickly on a loud frame, falls slowly after it, stays within 0..1, and settles to 0 on silence." },
    { "id": "A4", "check": "The sheet shows one aria-hidden hero orb above the status pill whose data-orb-state follows the session (listening while live-listening, composing while speaking, working while thinking)." },
    { "id": "A5", "check": "Only the hero orb animates during a chat: the sheet-header orb and the launcher orb are rendered static (data-orb-animate=burst), and the launcher shows an orb instead of the Mic icon while keeping its aria-label 'Talk to Nex Assistant'." },
    { "id": "A6", "check": "A burst orb plays only after it is triggered and stops again once its duration has passed." },
    { "id": "A7", "check": "Under prefers-reduced-motion an orb paints a single static frame and never requests an animation frame." },
    { "id": "A8", "check": "RealtimeClient keeps the remote MediaStream it receives in ontrack, so the speaking orb can meter the model's voice." },
    { "id": "A9", "check": "The level meter never connects its analyser to the AudioContext destination (no doubled playback), and close() disconnects its source." },
    { "id": "A10", "check": "thinking-orbs ships only in the voice chunk: a build with voice_assistant off contains none of its code.", "manual": "npm run build for dev and for a voice-off target, then grep dist/ for an engine symbol" },
    { "id": "A11", "check": "In a real browser the orb visibly follows a conversation (ripples with the mic, orbits while thinking, swells with the model's voice) and the model's audio is not doubled.", "manual": "npm run dev in Chrome, desktop and 360x720, one spoken conversation" },
    { "id": "A12", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" },
    { "id": "A13", "check": "The assistant is called Nex everywhere a user meets it: the sheet is titled 'Nex', the launcher is labelled 'Talk to Nex', and screen readers hear 'Nex:' before each of her transcript lines." },
    { "id": "A14", "check": "The model is told it is Nex, with a PERSONALITY section that makes her friendly, approachable and helpful, while the brevity and never-invent-a-number rules still hold and the prompt stays under MAX_INSTRUCTION_CHARS." },
    { "id": "A15", "check": "The session transcribes the rep with gpt-4o-transcribe in English, with a Nex Order vocabulary prompt and far-field noise reduction on the input." },
    { "id": "A16", "check": "Nex is told to fetch only what was asked, to say she did not catch it and ask again when unclear, and to decline off-topic requests (such as the weather) kindly while offering what she can help with." },
    { "id": "A17", "check": "When get_sales_summary finds no orders in the period it reports latestOrderDate, the date of the most recent in-scope non-cancelled order before the period ended, or null when there is none." },
    { "id": "A18", "check": "A user transcript line with letters but no Latin ones (a transcription hallucination in another script) is shown as \"(Didn't catch that)\"." },
    { "id": "A19", "check": "On the demo, 'what is the weather' gets a kind decline and redirect, a mumble gets a request to repeat, and the transcript stays English.", "manual": "owner re-test on nexorder.vercel.app after fn:deploy:dev voice-session and deploy:dev" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/orbState.test.ts", "test": "orbVisual > maps every session state to its orb", "proves": ["A1"] },
    { "file": "__tests__/voice/orbState.test.ts", "test": "orbVisual > agrees with the status pill's tone for every input", "proves": ["A2"] },
    { "file": "__tests__/voice/levelSmoothing.test.ts", "test": "smoothLevel > rises fast, falls slowly, clamps to 0..1 and settles to 0 on silence", "proves": ["A3"] },
    { "file": "__tests__/voice/voiceAssistantSheet.test.tsx", "test": "VoiceAssistantSheet > shows an aria-hidden hero orb that follows the live state", "proves": ["A4"] },
    { "file": "__tests__/voice/voiceAssistantSheet.test.tsx", "test": "VoiceAssistantSheet > keeps the header orb static while the hero orb animates", "proves": ["A5"] },
    { "file": "__tests__/voice/voiceAssistantLauncher.test.tsx", "test": "VoiceAssistantLauncher > shows a static orb instead of the mic icon, keeping its label", "proves": ["A5"] },
    { "file": "__tests__/voice/nexOrb.test.tsx", "test": "NexOrb > a burst plays when triggered and stops after its duration", "proves": ["A6"] },
    { "file": "__tests__/voice/nexOrb.test.tsx", "test": "NexOrb > paints one static frame and requests no animation frame under reduced motion", "proves": ["A7"] },
    { "file": "__tests__/voice/realtimeClient.test.ts", "test": "RealtimeClient > keeps the remote stream it receives for metering", "proves": ["A8"] },
    { "file": "__tests__/voice/audioLevel.test.ts", "test": "createLevelMeter > never connects to the destination and disconnects on close", "proves": ["A9"] },
    { "file": "__tests__/voice/voiceAssistantSheet.test.tsx", "test": "VoiceAssistantSheet > calls the assistant Nex in the title and the transcript", "proves": ["A13"] },
    { "file": "__tests__/voice/voiceAssistantLauncher.test.tsx", "test": "VoiceAssistantLauncher > invites the rep to talk to Nex by name", "proves": ["A13"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > introduces itself as Nex with a friendly, approachable, helpful personality", "proves": ["A14"] },
    { "file": "__tests__/voice/sessionRequest.test.ts", "test": "buildClientSecretRequest > transcribes English with gpt-4o-transcribe, a vocabulary prompt and far-field noise reduction", "proves": ["A15"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > tells Nex to ask again when unclear, decline off-topic kindly, and never fetch what was not asked", "proves": ["A16"] },
    { "file": "__tests__/voice/voiceTools.test.ts", "test": "get_sales_summary > reports the latest order date when the period is empty", "proves": ["A17"] },
    { "file": "__tests__/voice/transcript.test.ts", "test": "reduceTranscript > shows a non-Latin transcript as Didn't catch that", "proves": ["A18"] }
  ],
  "allow": []
}
```

## Goal

Reps glance at the Nex Assistant sheet mid-sentence and today see only a 10 px dot
and a word. Give the assistant a visible presence: a dotted 3D orb (the engine of
`thinking-orbs`, MIT, plain 2D canvas) whose animation follows the session state and,
while live, the real loudness of whoever is talking — so "it heard me", "it's
thinking" and "it's answering" are obvious at a glance.

Revised 2026-10-22 at the owner's request: the assistant is named **Nex** and is
given a friendly, approachable, helpful personality (A13, A14).

Revised again 2026-10-22 after the owner's demo test: asked "what's the weather?",
the transcript read "Восстановлено." and Nex volunteered a sales summary nobody asked
for (A15-A19).

## Approach

- `thinking-orbs@0.3.2`, exact pin, importing only `thinking-orbs/engine`
  (`resolvePreset` + `MODE_FRAMES`). We own the paint loop: any size, dots tinted with
  the pill's tones, audio-driven scale/speed, 250 ms cross-fade between states.
- `components/voice/orbState.ts` (pure): `orbVisual(phase, live, error, textOnly)`,
  derived beside `voiceStatus` and sharing its `StatusTone`.
- `lib/voice/levelSmoothing.ts` (pure, added to the purity list) and
  `lib/voice/audioLevel.ts` (`createLevelMeter`: AudioContext -> AnalyserNode, never
  to `destination`).
- `realtimeClient.ts` keeps the remote stream; `voiceSession.ts` / `useVoiceSession.ts`
  expose `getLevel('mic' | 'remote')`, read in the orb's rAF loop — no React state at 60 fps.
- `components/voice/NexOrb.tsx`: `animate: 'live' | 'burst'`; aria-hidden (the pill's
  `role="status"` already announces); reduced-motion = one static frame; pauses on hidden tab.
- Placements: hero orb in `VoiceAssistantSheet` above the pill (smaller below `sm` for
  the 664 px RS35); burst orbs replace the `Mic` icon in the sheet header and in
  `VoiceAssistantButton` (play on click only).
- Name: user-facing strings only ("Nex" title, "Talk to Nex", "Nex:" in the transcript).
  The module slug `voice_assistant`, component names and error-report messages keep
  "Nex Assistant" — they are internal and renaming them is churn.
- Personality: `_shared/voice/instructions.ts` opens "You are Nex, …" and STYLE becomes a
  PERSONALITY section (friendly, approachable, helpful; brief still wins). The voice stays
  `marin`. Takes effect on the next `voice-session` function deploy.
- Docs: an "Orb" section in `docs/claude/voice-assistant.md`.

Stacked on `feat/NX-0003-voice-assistant` (base above). Its PR targets that branch,
or `main` once NX-0003 has merged with a merge commit (a squash would orphan `base`).

## Out of scope

- Any change to session behaviour, tools, budget, CSP or the server.
- The library's own `<ThinkingOrb>` component and its other six states.
- A character mascot, sound effects, haptics.
- Showing session state on the launcher (the session ends when the sheet closes, so
  the launcher never has a live state to show).

## FINAL
