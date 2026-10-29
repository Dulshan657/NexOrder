# NX-0009 — Nex by voice, end to end: a test instrument

```json brief
{
  "id": "NX-0009-voice-e2e",
  "base": "49dcab410816c02f6d092b25ebec518c55d71385",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "playwright.config.ts registers a 'voice' project whose testDir is tests/voice-e2e, outside tests/e2e, and neither a bare `npm run test:e2e` nor CI (the a11y project) runs it. (Revision after the gate's NO-GO: a bare `playwright test` runs every defined project, so the voice project is defined only when E2E_VOICE=1.)" },
    { "id": "A2", "check": "The spec accepts a number however Nex says it (\"22\", \"twenty-two\", \"twenty two\") and does not accept a different number." },
    { "id": "A3", "check": "The committed question recordings are PCM16 mono 24 kHz WAVs with at least 2 s of silence before and after the speech, so the session is listening when it starts and the speech detector hears the turn end." },
    { "id": "A4", "check": "'How many orders did we process this month?' spoken through a fake microphone is answered with the shipped count, equal to SQL, with no 'about' before it; 'How many orders came in this month?' with the placed count, equal to SQL.", "manual": "E2E_BASE_URL=https://nexorder.vercel.app npx playwright test --project=voice" },
    { "id": "A5", "check": "A run leaves no voice session open in the ledger: the spec presses End and waits for voice-session to record it, so a run costs about a minute of the account's day, not the 15-minute cap per abandoned session.", "manual": "SELECT count(*) FROM voice_sessions WHERE ended_at IS NULL for the test account after a run = 0" },
    { "id": "A6", "check": "tests/e2e/README.md lists the voice project beside soak and perf: what it proves, what it costs, how to run it, and that it needs a demo account with Nex time left.", "manual": "read tests/e2e/README.md, section 'voice'" }
  ],
  "failFirst": [
    { "file": "__tests__/voiceE2eHarness.test.ts", "test": "voice e2e harness > registers a voice project outside tests/e2e", "proves": ["A1"] },
    { "file": "__tests__/voiceE2eHarness.test.ts", "test": "voice e2e harness > matches a count said as digits or words, and no other count", "proves": ["A2"] },
    { "file": "__tests__/voiceE2eHarness.test.ts", "test": "voice e2e harness > ships recordings as PCM16 mono 24 kHz with silence either side", "proves": ["A3"] }
  ],
  "allow": [
    { "move": "edit-test-config", "reason": "playwright.config.ts only: a voice instrument needs its own Playwright project (testDir outside tests/e2e) so the default suite and CI never run it. Additive: no existing project changes." },
    { "move": "timeout-raised", "reason": "tests/voice-e2e/nex-order-numbers.spec.ts only: a real voice round trip (login, Realtime connect, speech, tool call, spoken answer) takes 15 to 40 s, past the suite's 30 s default. New spec only; no existing timeout changes." }
  ]
}
```

## Goal

NX-0008 made Nex and the dashboard agree. Its live run proved it by voice: a
recorded question through a fake microphone, the real OpenAI Realtime session,
Nex's spoken answer checked against SQL. That harness needed a new Playwright
project and a longer timeout, which NX-0008's brief did not allow, so it lands
here on its own. It is an **instrument**, like `soak` and `perf`: run on demand
against dev, never in CI, because it spends OpenAI minutes and a language
model's wording is not a regression test. It pins the numbers, not the phrasing.

## Approach

- `tests/voice-e2e/nex-order-numbers.spec.ts`: the spec from NX-0008's run
  (18a4f00). It launches its own Chromium with
  `--use-file-for-fake-audio-capture`, reads the `Conversation` log, checks
  against `__tests__/support/orderNumbersSql.ts`, and presses End before closing.
  The pure number matcher moves to `tests/voice-e2e/spokenForms.ts` so a unit
  test can reach it.
- `tests/voice-e2e/make-fixtures.mjs` and the two committed WAVs (OpenAI TTS,
  run once; `OPENAI_API_KEY` from `.env.dev.local`, never printed).
- `playwright.config.ts`: one added `voice` project, nothing else touched.
- `tests/e2e/README.md`: the instruments section grows from two to three.

## Out of scope

- Any change to Nex, the app or a database.
- Running it in CI, or against Amadiya (where Nex is off; the config already
  refuses a tenant origin).
- Asserting Nex's phrasing beyond the numbers and the "about" rule.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `voice e2e harness > registers a voice project outside tests/e2e` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `voice e2e harness > matches a count said as digits or words, and no other count` | 0 to 99 in words; larger counts as digits only |
| A3 | claimed | `voice e2e harness > ships recordings as PCM16 mono 24 kHz with silence either side` | |
| A4 | claimed | `E2E_BASE_URL=https://nexorder.vercel.app npx playwright test --project=voice` as alice@, 2 passed: "22 orders went out: 5 dispatched and 17 delivered. There are 39 orders still in the warehouse" / "19 orders placed this month" (SQL: shipped 22 = 5 + 17, placed 19) | |
| A5 | claimed | After that run, alice@ has 0 open sessions; the run's two sessions came to about 68 s of her day | |
| A6 | claimed | tests/e2e/README.md, "Three projects that are instruments" | |

### Not claimed

- Nex still sometimes quotes its own rule ("using the 'shipped means processed' rule") although the instructions say not to; the spec pins numbers and "about", not phrasing.
- Speech recognition is OpenAI's: one run heard "Orders did we process this month." for the first words. The answer was still right, but a mis-heard question would fail the run without the app being at fault.
- Not run in CI by design, and so not run on every change: it is only as current as the last time someone ran it.
