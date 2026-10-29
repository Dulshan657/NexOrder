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

## voice_assistant

Before ANY tenant release that carries the `voice_assistant` module (Nex Assistant), from the
tenant workspace, as an owner step. The argued detail is in
[`voice-assistant.md`](voice-assistant.md) (Release gates).

1. **OpenAI first, by hand.** The OpenAI project that owns the tenant's `OPENAI_API_KEY` must
   have Realtime access (`model.request` scope) and a **monthly spend limit**. The daily
   ledger and the 15-minute session cap bind only a cooperative client: the server cannot end
   an OpenAI call, so a modified client can call `end` early and keep its WebRTC call alive up
   to OpenAI's own session limit, up to 10 starts an hour. The spend limit is the real hard
   backstop. Nothing in `secrets:check` can verify either setting: it sees only that the key
   is set.
2. **Then, in this order, by npm script name for the tenant target:** `secrets` (so the
   registry-derived `ENABLED_MODULES` gains `voice_assistant`), `migrate` (migration
   `00133`), `fn:deploy` of `voice-session` (warm isolates read `ENABLED_MODULES` once; the
   redeploy is what makes the new value live), then `deploy` for the frontend. **Function
   before frontend.**
