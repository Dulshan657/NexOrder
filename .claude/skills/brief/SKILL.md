---
name: brief
description: Write the brief for a Nex Order change BEFORE any code — acceptance checks, the tests that must fail on the base, allowed forbidden moves — get the owner's go, and commit it alone as the branch's first commit. Use at the start of every task that will become a PR to main.
---

# /brief: the brief comes first

Every PR to `main` must carry exactly one `docs/briefs/NX-####-<slug>.md`, committed
**alone, first, on its `base`**. CI (`brief · fail-first`) and gate row 6 refuse
anything else. The full rules are in `docs/claude/briefs.md`. Read them if this is
your first brief in a session.

## Steps

1. **Pick the base.**
   - Run `git fetch origin`.
   - Start the branch from `origin/main`, in a worktree that is not OneDrive or `nexwt` (see CLAUDE.md).
   - `git rev-parse HEAD` gives the full sha. That is `base`.
2. **Take the next ID.** Find the highest `NX-####` in `docs/briefs/` on `origin/main`, *and* in open PR branches (`gh pr list --json headRefName`). Add 1. Slug: lowercase, hyphens.
3. **Draft from `docs/briefs/TEMPLATE.md`.**
   - **Acceptance checks are observable behaviours**, each stated so a test can fail on it. Anything a unit test cannot prove (deploy, browser walk, RS35, an Amadiya action) gets `"manual": "<how it will be verified>"`.
   - **failFirst names real tests by full vitest name** (`describe > it`), in `*.test.ts(x)` files. Each must fail on the base:
     - for a bug fix, a test that reproduces the bug;
     - for changed behaviour, at least one assertion-level failure, not only a new module that fails by absence.
   - **allow is rare.** Only list a forbidden move the work genuinely needs, with the reason (for example, editing the gate itself). Anything not allowed now cannot be allowed later.
   - Leave `## FINAL` empty.
4. **Show the owner the brief and stop.** Show it in full and ask for go. Do not write code before the go. If the owner changes it, redraft and ask again.
5. **On go:**
   - set `"approved": "<YYYY-MM-DD> owner"`;
   - create the branch `<feat|fix|…>/NX-####-<slug>`;
   - `git add` **only** the brief, then `git commit -m "docs(brief): NX-#### <title>"`;
   - check that `git show --stat HEAD` lists one file.
6. **Do the work test-first.** Write the named tests, watch them fail, then implement.
7. **Before pushing:**
   - write `## FINAL`: a table row per acceptance id (`claimed` with evidence, or `not-claimed` with why), and `### Not claimed` with at least one item;
   - commit, then run `npm run check:brief`, which must PASS;
   - put its fail-first table in the PR body.

## If scope changes mid-task

Edit the brief above `## FINAL` in a commit touching **only** the brief, and tell
the owner. The gate lists every revision. A revision that adds an `allow` excuses
nothing. If the work really needs a new allowance, it is a new brief on a new branch.
