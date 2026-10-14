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

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `parseBrief > refuses an unknown key` fails on base (by absence), passes on tip; 13 more `parseBrief`/`briefBody` cases in `__tests__/brief.test.ts` | |
| A2 | claimed | `checkFinal > refuses a FINAL missing an acceptance id`; scratch scenario (d) on real commits → `FINAL does not account for A2`, exit 1 | |
| A3 | claimed | `findForbiddenMoves > flags a removed assertion in a test file` + 12 move cases; scratch scenario (b) → `removed-assertion`, exit 1 | |
| A4 | claimed | `applyAllowances > an allowance added after the code excuses nothing`; scratch scenario (c) → "allowance added after approval — excuses nothing", exit 1; (h) brief after code → blocks | |
| A5 | claimed | `judgeFailFirst > a test that also passes on the base is not-fail-first`; scratch scenario (a) on a real existing test → `not-fail-first` (base passed, tip passed), exit 1 | |
| A6 | claimed | `touchesCode > a docs-only diff touches no code`; scratch (e) docs-only → PASS, (f) code with `failFirst: []` → blocks | |
| A7 | claimed | `isPartialRun > five rows is partial now that the gate has six` — fails on the base **by assertion**, passes on tip | gate row 6 itself is proven by the full gate run on this PR |
| A8 | not-claimed | | Needs this PR merged first: the ruleset edit and the blocked probe PR are reported in the PR thread after merge |
| A9 | not-claimed | | Post-merge: `deploy:dev` and `/version.json` reported in the PR thread |

### Not claimed

- Six of the seven fail-first tests are **proven by absence** (the modules are new); only A7's fails by assertion.
- The CI job's base run links the tip's `node_modules` on Linux; it is exercised for the first time by this PR's own CI run, not locally.
- This PR is judged by its OWN `check-brief.mjs` in CI (main has none yet); every later PR is judged by main's copy.
- Revision detection (`checkRevisions`) is covered only by scratch scenario (i), not by a unit test — it is git plumbing.
- Nothing here checks that a brief's acceptance checks match the code's intent; that is the gate agent's read of the diff.
