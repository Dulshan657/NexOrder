# The gate — how a change reaches `main`

Added 2026-10-13. This is phase A of adopting an "agent software factory"
(intake → brief → fan-out → fail-first → **gate** → use-like-a-human → soak and
ship): output is trusted because of the checks, not the prompts. This phase
makes the checks *bind*.

## Why it exists

- **`main` was red for two weeks and nobody saw.** From 2026-10-01 to
  2026-10-13 every push to `main` failed `typecheck · test · build`, across the
  QR-reorder and `00131` merges. The cause was `PaymentStatusBadge` formatting
  dates with the runtime's default locale: a developer box (en-AU) printed
  `30 Apr`, the runner (en-US) printed `Apr 30`. CI history shows earlier red
  spells too (Aug 28, Sep 22). A check that nothing waits on is a log, not a gate.
- **The "blocked by plan tier" note was stale.** The repo is **public**, so
  branch protection is free. Kept public deliberately (decision 2026-10-13).
- **83 Edge Functions were type-checked by nothing** — `supabase/functions` is
  outside `tsc`. All 83 already passed `deno check`, so that guard is absolute.

## The merge routine (every task)

```bash
/brief                                    # FIRST: brief approved by the owner, committed alone
                                          # (docs/claude/briefs.md) — then the work, then FINAL
npm run check:brief                       # fail-first + forbidden moves + FINAL, locally
git push -u origin <branch>
gh pr create --fill                       # base: main
gh pr checks --watch                      # all four required jobs green
# gate: from a DIFFERENT session/agent than the author — the `gate` agent
node scripts/gate.mjs --ref=<pr-number>   # or ask the gate agent to run it
gh pr comment <pr-number> --body-file ~/nexgate/gate-report.md
gh pr merge <pr-number> --merge --delete-branch
npm run deploy:dev                        # then check /version.json
```

- **Direct pushes to `main` are rejected, admins included.** A merge commit
  made locally has a sha CI never ran, so it can never satisfy a required
  check. Merge through the PR.
- `--merge` (not squash) keeps the repo's merge-commit history, and `rel-*`
  tags are still cut from `main`, so `releaseTag.mjs`'s ancestor rule holds.
- **`strict` is on**: a PR must be up to date with `main` before merging.
  `gh pr update-branch <n>` and wait for checks again.

## Required checks

| Context (job `name:` in `ci.yml`) | What it runs |
|---|---|
| `typecheck · test · build` | audit, guards, a11y lint, `tsc`, unit suite, build, `check:demo` |
| `axe · login surfaces` | axe in Chromium on the signed-out screens |
| `edge · deno check` | `scripts/check-edge-types.mjs` — every function entrypoint |
| `brief · fail-first` | `scripts/check-brief.mjs`, **the base branch's copy** — see [`briefs.md`](briefs.md) |

Renaming a job renames its context and silently un-requires it. Change the
ruleset (below) in the same PR.

### Applying / re-applying protection

`main` is protected by a **repository ruleset** (id `24973486`, "main: PR +
required checks (gate phase A)"), not classic branch protection: this repo
answers the classic `PUT …/branches/main/protection` with **404 "Branch
protection has been disabled on this repository"**. No bypass actors — admins
included. Proven 2026-10-13: a direct push was `push declined due to repository
rule violations`, and a red PR (#17) was BLOCKED for `gh pr merge` and
`gh pr merge --admin` alike.

```bash
gh api repos/Dulshan657/NexOrder/rules/branches/main        # what applies now
gh api repos/Dulshan657/NexOrder/rulesets/24973486          # the ruleset itself
# re-create from scratch (delete the old one first, or PUT …/rulesets/<id> to edit):
gh api -X POST repos/Dulshan657/NexOrder/rulesets --input - <<'EOF'
{
  "name": "main: PR + required checks (gate phase A)",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false, "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "typecheck · test · build" },
          { "context": "axe · login surfaces" },
          { "context": "edge · deno check" },
          { "context": "brief · fail-first" } ] } }
  ]
}
EOF
gh api -X PATCH repos/Dulshan657/NexOrder -F delete_branch_on_merge=true
```

Zero approvals because a solo developer cannot approve their own PR; the
independent review is the gate agent's report, not a GitHub approval.

## `scripts/gate.mjs`

One exact sha, in a detached worktree at `~/nexgate`. It force-resets and
`git clean -x`es that directory every run, so it **only reuses a directory it
created itself** (marked by `.gate-workdir`) and refuses any other — pointing
`--workdir` at `nexwt` or the tenant checkout would otherwise wipe uncommitted
work and `.env.*.local`. `npm ci` reruns only when `package-lock.json` changes.

| Row | Runs |
|---|---|
| 1 | `tsc --noEmit` + `npm run build` |
| 2 | full unit suite on **3 workers** (`--unit-workers`); each failing file → flake protocol |
| 3 | `check:edge-types` |
| 4 | `lint`, `check:overlays`, `check:viewport`, `check:csp`, `check:claude-md`, `check:demo` |
| 5 | every touched `tests/**/*.spec.ts`, whole — only with `--e2e-base-url=http://localhost:…` |
| 6 | `check-brief.mjs` **from the gate's checkout**: brief approved first, fail-first on the base, forbidden moves, FINAL ([`briefs.md`](briefs.md)) |

**Row 2 runs on 3 vitest workers, CI's count** (4 vCPU / 16 GB runner → cpus-1).
vitest's own default here is cpus-1 = **11 workers on a 7.7 GB machine**, ~0.7 GB
each; jsdom files then swap and hit the 5 s test timeout. That — not the tests —
is what blocked four full gate runs of PR #16 with "flakes" that passed 3/3 alone
on both sides every time. The gate judges the commit at CI's load; it is not a
stress test of the developer's machine. Load-sensitivity is still real: the
offending files are ticketed in `config/knownFlakes.json`.

Row 5 refuses a non-localhost URL: `.env.dev.local` pins `E2E_BASE_URL` to the
deployed demo, and a green run against that says nothing about the commit.

**Flake protocol** (`scripts/lib/flakeVerdict.mjs`, pure and tested): rerun the
failing file alone 3× on the tip and 3× on the merge-base (5× if either side
is mixed).

| Tip alone | Base alone | Verdict |
|---|---|---|
| always fails | always passes | **regression** — blocking |
| always fails | always fails, **same failing tests** | **pre-existing** — reported, not blamed |
| always fails | always fails, but the tip fails a test the base does not | **regression** — blocking |
| always passes | — | **flake** (fails only inside the suite) — blocking |
| mixed after 5, or steady over a flaky base | | **flake** — blocking until ticketed |

A flake blocks. It is a ticket to write, not a pass — **until it is
ticketed**: `config/knownFlakes.json` lists known failures named in advance
(`file`, `reason`, `since`; a missing reason is refused). A listing excuses
exactly one shape, turning `flake` into a non-blocking `known-flake`: the test
**fails inside the loaded full suite and passes EVERY run alone on the tip.**
Everything else still blocks:

- any verdict other than `flake` — a listing never excuses a regression;
- a tip that failed alone even once. The gate's eighth review found that
  `flake` also covers "fails every time alone over an unsteady base", which is
  in effect a regression: a PR breaking the source under a listed test (never
  touching the test file) would have been excused;
- a file the change touches — a PR editing a known-flaky test owns it again;
- an entry not **already on the base** — a change can add an entry, but it only
  takes effect for the next change, after review. A PR cannot list itself.

Delete the entry when the test is fixed. It exists because three jsdom tests
time out under a loaded full suite on `main` today and pass alone, and without
it the gate would block every PR on this machine for a reason no PR caused. And **"pre-existing" is
judged per TEST, never per file**: the gate's first review of itself found
that a file already red on `main` — exactly `paymentStatusBadge` for two
weeks — would have hidden any new failure added to it. An unhandled error in
the suite (vitest's JSON has no field for it; the gate reads the log) is never
excused at all.

**The gate does not read vitest's JSON reporter — it is lossy.** It exposes
failing tests and the first module-level error, and nothing a hook throws
inside a `describe` (that lands on the suite's own result). Three gate reviews
in a row each found a failure shape it dropped: a broken import in an
already-red file, a throwing top-level `afterAll`, then a throwing `afterAll`
inside a `describe` — each compared as "nothing new" and was excused. So row 2
runs its own reporter, `scripts/gate-reporter.mjs`, which walks the whole task
tree and records **every** failed module error, suite error and test as a key
(`scripts/lib/failureKeys.mjs`, workdir stripped), plus the unhandled errors.
It is loaded by absolute path from the gate's checkout, so it also works on a
base commit that predates it. If you ever change how failures are compared,
plant each of those three shapes in an already-red file and gate it with
`--base` — that is how each hole was found.

Keys are compared as a **multiset** (a fifth review found that, as a set, a new
failing test sharing its name with an already-red one vanished). Granularity is
**one key per failed test, suite error or module error**: a test already red on
the base that gains a *second* reason to fail (a throwing `afterEach` on that
same test) adds no key. Anything that breaks a test that was passing, or adds a
suite/module error, does. Verified against real vitest 4.1.4 for `test.fails`,
timeouts, `expect.soft`, a skipping `beforeAll`, collection failing partway,
and hooks at module and `describe` level.

### Verdicts and exit codes

| Exit | Verdict | Meaning |
|---|---|---|
| 0 | **GO** | full run (all six rows) against the merge-base, nothing failed — the only merge verdict |
| 1 | **NO-GO** | something failed |
| 2 | — | could not run (bad argument, git/npm failure) |
| 3 | **PARTIAL** | what ran passed, but the run was not a full one — never a merge verdict |

`gate-report.json` carries `verdict`, `go` and `exitCode`; `go` is `true` only
for GO. Two flags make a run PARTIAL by construction:

- `--rows=2,3` runs only those rows — for diagnosis, or a machine short on
  memory (a full run needs several GB: `check:demo` builds every target).
- `--unit-workers=N` runs the unit suite on N workers instead of CI's 3. Any
  value other than 3 is PARTIAL (lighter hides load-sensitivity CI would see,
  heavier invents it), is recorded in the report, and is validated before row 1.
- `--base=<ref>` compares against that commit instead of the merge-base with
  `origin/main`, for a stacked branch or for testing the gate itself. It must
  be a **strict ancestor** of the ref, or the commit's own failures would read
  as "already red on the base". Before the gate's third review a passing
  `--base` run said GO.

Note `main`'s own red can be invisible here: the `paymentStatusBadge` failure
was en-US-only, so on an en-AU machine `main` passes row 2. An
environment-only failure is CI's to catch — that is why CI is required too.

### What the gate does not claim

- No network-isolated build (not feasible on this Windows box).
- No second-machine run and no resource soak — CI is the second machine.
- Nothing about the RS35's IME scan mode; emulation cannot reach it.

## The gate agent

`.claude/agents/gate.md`. Read-only tools; runs the script, then reads the diff
for the invariants rows cannot see (module gating in both `AdminView` and
`AppShell`, `.nullish()`, DROP-before-replace, warehouse-id-vs-bin, forked
`_shared` modules, weakened tests …). It **never edits, pushes, comments or
deploys** — the coordinating session posts its report to the PR. It must not
be the session that wrote the change.
