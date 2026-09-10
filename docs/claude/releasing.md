# Releasing to a tenant — why the gate refuses

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The command sequence stays in `CLAUDE.md`; this
> is the reasoning behind the three conditions. **Edit here, not there.**

A tenant deploys from a **release tag**, never from whatever is checked out
(`requireReleaseTag` in `scripts/deploy.mjs`; the decision is pure and tested in
`scripts/lib/releaseTag.mjs`). Module flags stop a tenant seeing a surface they
did not buy; this stops them getting one that is theirs and half-finished.

Three conditions, each ruling out a different way of shipping something nobody
looked at: a **clean tree** (an uncommitted edit is in the build and in no tag),
**HEAD at a `rel-*` tag** (marked deliberately, not merely current), and that tag
being an **ancestor of main** (a tag on an unmerged branch is a private commit
with a label on it). A missing `main` **warns** rather than refuses — the tenant
workspace is a detached worktree and may legitimately have none, and refusing a
deploy over a missing ref would be the gate failing at its own job. `dev` is
exempt: deploying whatever is checked out is the point of a demo environment.
