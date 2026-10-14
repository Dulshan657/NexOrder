# Briefs, fail-first and FINAL — what a change must prove

Added 2026-10-14. This is phase B of the "agent software factory" (intake →
**brief** → fan-out → **fail-first** → gate → use-like-a-human → soak and
ship). Phase A ([`gate.md`](gate.md)) made the checks bind. Phase B makes the
change say, **before any code**, what it will prove. The checks then confirm
three things:
- the proof was real: the change's own test fails without it;
- nothing was weakened to get green;
- the author said what was **not** proven.

## The rule, in one paragraph

Every PR adds exactly one brief, `docs/briefs/NX-####-<slug>.md`, in a commit
of its own that is the **first** commit of the branch and sits on the commit
the brief names as `base`. Each `failFirst` test it names must **fail on the
base and pass on the tip**: the tip's copy of the test is run against the
base's code. The diff must contain no forbidden move unless the brief **as
approved** allows it. The `## FINAL` section, written last, accounts for every
acceptance id and lists at least one thing not claimed. CI's
`brief · fail-first` job (required on `main`) and gate row 6 both run the same
checker, `scripts/check-brief.mjs`.

## Writing one

Use `/brief` (`.claude/skills/brief/SKILL.md`). It does five things:
1. drafts from the request;
2. takes the next number from `docs/briefs/`, which is the ledger;
3. shows the brief to the owner;
4. commits it alone, only after the owner says go;
5. names the branch `<type>/NX-####-<slug>`.

The template is [`docs/briefs/TEMPLATE.md`](../briefs/TEMPLATE.md).

The header is one ```` ```json brief ```` block of **strict JSON**. The repo has no
YAML parser, and a contract that could be read two ways is refused rather than
guessed at. `scripts/lib/brief.mjs` `parseBrief` refuses:
- an unknown key, or a missing `id` / `base` / `approved` / `acceptance` / `failFirst`;
- an `id` not shaped `NX-0001-slug`, or a `base` that is not a full 40-char sha;
- a duplicate acceptance id, or a `proves` naming an id that does not exist;
- an acceptance check that no failFirst test proves and that has no `"manual"`
  note saying how it is verified by hand. Deploys, browser walks and the RS35
  are `manual`;
- a failFirst `file` that is not a `*.test.ts(x)`. Playwright specs cannot be
  fail-first here, because they need a running app. That is phase C;
- an `allow` entry with an unknown move or no reason.

`"test"` is the **full name** vitest prints: `describe > nested > it`.

## Approval is a commit shape, not a signature

A solo developer cannot approve their own PR on GitHub. So "the owner approved
the brief before any code" is checked from git (`checkApproval`):

- the commit that adds the brief touches **only** the brief;
- no commit of the branch comes before it;
- its parent is exactly `brief.base`.

After that, editing anything **above `## FINAL`** is a *revision*. A revision is
legal only as a brief-only commit, and every one is listed in the report so the
owner sees the re-scoping at SHIP. FINAL is written last and is not a revision.

## Fail-first

`scripts/check-brief.mjs` creates a throwaway worktree at the base, outside
every checkout, under the OS temp dir. It checks out the **tip's** copy of each
named test file into that worktree, links `node_modules` from the tip (a
junction on Windows), and runs those files with the gate's reporter. It then
runs the same files on the tip. Verdicts (`scripts/lib/failFirstVerdict.mjs`):

| Base | Tip | Verdict |
|---|---|---|
| test failed (assertion, or a hook on its suite) | passed | **proven** |
| file could not load (e.g. the module it tests is new) | passed | **proven-by-absence**: passes, noted as weaker |
| passed | passed | **not-fail-first**: blocking. The test never needed the change |
| didn't run (skipped, conditional) | passed | **base-not-run**: blocking |
| — | failed / didn't load | **tip-red**: blocking |
| — | no such test | **unknown-test**: blocking (a typo in the brief) |

**Proven-by-absence is honest but weak.** It says only "this module did not
exist". When the change modifies existing code, name at least one test that
fails *by assertion*. Phase B's own brief does this with
`isPartialRun > five rows is partial now that the gate has six`.

The fail-first run **is the mutation check**. "Revert the fix and watch the
test go red" is what the base run does, mechanically, for every named test.

If `package-lock.json` differs between base and tip, the base run used the
tip's dependencies, and the report says so.

## Forbidden moves

`scripts/lib/forbiddenMoves.mjs` reads `git diff base..tip`:

| Move | What trips it |
|---|---|
| `removed-assertion` | a test file loses more `expect(` / `assert` lines than it gains (a deleted test file counts) |
| `skip-only` | an added `.skip` `.only` `.todo` `.fixme` `.skipIf` `.runIf`, or `xit` / `fit` / `xdescribe`… |
| `timeout-raised` | a `timeout` / `testTimeout` / `hookTimeout`, or a test's trailing ms argument, raised above what it replaced |
| `flake-listed` | a new file in `config/knownFlakes.json` |
| `suppression-added` | `eslint-suppressions.json` total count grew, `overlay-baseline.json` grew, `config/grantBaseline.mjs` gained lines |
| `edit-gate-scripts` | `scripts/gate*.mjs`, `scripts/check-brief.mjs`, the gate's `scripts/lib/*`, `.github/workflows/**`, `.claude/agents/gate.md` |
| `edit-test-config` | `vitest*.config.*`, `playwright*.config.*` |
| `deploy-or-push` | `package.json`, `scripts/`, `supabase/ops/` or `.github/` gaining `git push`, `--env=amadiya`, `deploy:amadiya`, `vercel deploy`/`--prod`, or a new `"deploy:…"` script |

Strings and comments are blanked before the `skip` and `timeout` patterns run,
so a test that *quotes* `it.skip(` is not one. The gate's own files are
reported only as `edit-gate-scripts`, because they must spell out the very
patterns they look for.

**An allowance counts only if it was in the brief's first commit.** An
allowance added later is shown with "excuses nothing" and blocks. This is the
same principle as `knownFlakes`: a change cannot excuse itself after it has
seen the red.

An empty `failFirst` is legal **only** when the diff touches no code: `*.md`,
`docs/**` and images (`touchesCode`).

## FINAL

```
| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `badge > formats en-AU` fails on base, passes on tip | |
| A2 | not-claimed | | dev deploy blocked on X |

### Not claimed

- No browser walk on the RS35.
```

`checkFinal` refuses:
- an empty FINAL;
- a missing, unknown or duplicated acceptance id;
- a status other than `claimed` / `not-claimed`;
- `claimed` with no evidence;
- no `### Not claimed` item.

The gate copies "Not claimed" into its report, so it reaches the PR comment.

## Running it

```bash
npm run check:brief                 # local, before pushing: clean tree, HEAD = the commit judged
node scripts/check-brief.mjs --base=origin/main --head=<sha> --repo=<checkout at sha> --md=out.md
```

Exit 0 = pass, 1 = fail, 2 = could not run.

**CI runs the base branch's copy of the checker**, not the PR's. A PR is not
judged by a checker it edited. Only the PR that introduced the checker ran its
own, with a warning. Likewise, gate row 6 runs `check-brief.mjs` from the
gate's checkout.

## Not covered (phase E and later)

- API contracts written first for two-session features;
- routing by model tier;
- the 10-minute idle check on parallel sessions.

Fail-first for Playwright journeys is phase C.
