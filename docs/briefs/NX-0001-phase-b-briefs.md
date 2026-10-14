# NX-0001 — Phase B: brief, fail-first, FINAL package

```json brief
{
  "id": "NX-0001-phase-b-briefs",
  "base": "b8a539e7d1890233addab2ace240c7f8b027a898",
  "approved": "2026-10-14 owner (plan approved in session f79257e7)",
  "acceptance": [
    { "id": "A1", "check": "A brief is parsed strictly: an unknown key, a missing field, a duplicate acceptance id, or a `proves` naming no acceptance id is refused." },
    { "id": "A2", "check": "A FINAL that leaves an acceptance id unaccounted for, or claims one without evidence, is refused." },
    { "id": "A3", "check": "The diff is scanned for forbidden moves: a removed assertion, an added .skip/.only, a raised timeout, a new knownFlakes / suppression entry, an edit to the gate's own scripts or test config." },
    { "id": "A4", "check": "An allowance excuses a forbidden move only if it was in the brief's FIRST commit — one made before any code. A PR cannot excuse itself." },
    { "id": "A5", "check": "Each fail-first test must fail on the base and pass on the tip; a test that also passes on the base blocks." },
    { "id": "A6", "check": "An empty failFirst list is legal only for a diff that touches no executable code." },
    { "id": "A7", "check": "The gate runs a sixth row (brief · fail-first), and a run without all six rows is PARTIAL." },
    { "id": "A8", "check": "CI runs `brief · fail-first` on every PR and main's ruleset requires it; a PR whose test also passes on the base cannot be merged, admins included.", "manual": "probe PR after merge, BLOCKED for gh pr merge and --admin" },
    { "id": "A9", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/brief.test.ts", "test": "parseBrief > refuses an unknown key", "proves": ["A1"] },
    { "file": "__tests__/brief.test.ts", "test": "checkFinal > refuses a FINAL missing an acceptance id", "proves": ["A2"] },
    { "file": "__tests__/forbiddenMoves.test.ts", "test": "findForbiddenMoves > flags a removed assertion in a test file", "proves": ["A3"] },
    { "file": "__tests__/forbiddenMoves.test.ts", "test": "applyAllowances > an allowance added after the code excuses nothing", "proves": ["A4"] },
    { "file": "__tests__/forbiddenMoves.test.ts", "test": "touchesCode > a docs-only diff touches no code", "proves": ["A6"] },
    { "file": "__tests__/failFirstVerdict.test.ts", "test": "judgeFailFirst > a test that also passes on the base is not-fail-first", "proves": ["A5"] },
    { "file": "__tests__/flakeVerdict.test.ts", "test": "isPartialRun > five rows is partial now that the gate has six", "proves": ["A7"] }
  ],
  "allow": [
    { "move": "edit-gate-scripts", "reason": "Phase B extends the gate itself: gate.mjs, gate-reporter.mjs, flakeVerdict.mjs, ci.yml and the gate agent are the deliverable." }
  ]
}
```

## Goal

Make the post's *brief* and *fail-first* stages mechanical. Every PR names, before
any code, what it will prove and which test proves it. The gate and CI then check
that the test fails without the change, that nothing was weakened to get green,
and that the FINAL section says what is not claimed.

## Approach

- `scripts/lib/brief.mjs`, `forbiddenMoves.mjs`, `failFirstVerdict.mjs` — pure, test-first.
- `scripts/check-brief.mjs` — one CLI for CI, the gate (row 6) and a local pre-push.
- CI job `brief · fail-first`, then added to ruleset 24973486.
- `/brief` project skill; `docs/claude/briefs.md`; `docs/briefs/TEMPLATE.md`.

## Out of scope

API contracts for two-session features, model-tier routing, the idle check (phase E).

## FINAL
