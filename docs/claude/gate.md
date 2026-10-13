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
git push -u origin <branch>
gh pr create --fill                       # base: main
gh pr checks --watch                      # all three required jobs green
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

Renaming a job renames its context and silently un-requires it. Change the
protection payload in the same PR.

### Applying / re-applying protection

```bash
gh api -X PUT repos/Dulshan657/NexOrder/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": [
    "typecheck · test · build", "axe · login surfaces", "edge · deno check" ] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
gh api -X PATCH repos/Dulshan657/NexOrder -f delete_branch_on_merge=true
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
| 2 | full unit suite; each failing file → flake protocol |
| 3 | `check:edge-types` |
| 4 | `lint`, `check:overlays`, `check:viewport`, `check:csp`, `check:claude-md`, `check:demo` |
| 5 | every touched `tests/**/*.spec.ts`, whole — only with `--e2e-base-url=http://localhost:…` |

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

A flake blocks. It is a ticket to write, not a pass. And **"pre-existing" is
judged per TEST, never per file**: the gate's first review of itself found
that a file already red on `main` — exactly `paymentStatusBadge` for two
weeks — would have hidden any new failure added to it. An unhandled error in
the suite (vitest's JSON has no field for it; the gate reads the log) is never
excused at all.

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
