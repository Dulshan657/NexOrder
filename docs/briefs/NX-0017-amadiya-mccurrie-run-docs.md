# NX-0017 — Lift Amadiya's feature hold (notes only)

```json brief
{
  "id": "NX-0017-amadiya-mccurrie-run-docs",
  "base": "137b73915da31b6a56e3343a1e8105b67bdb24f4",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "CLAUDE.md and docs/claude/environments.md no longer say Amadiya gets no new features yet; both record the 2026-11-05 owner decision that Amadiya is to move to current code at its next release.", "manual": "read the merged text of both files" },
    { "id": "A2", "check": "CLAUDE.md no longer says Amadiya gets no new features; it records the 2026-11-05 owner decision, with its module list unchanged.", "manual": "read the merged text" }
  ],
  "failFirst": [],
  "allow": []
}
```

## Goal

Lift Amadiya's feature hold in the project notes, which still say Amadiya gets no new features and would otherwise stop its release. Notes only.

## Approach

Docs only, notes only: edit `CLAUDE.md:173-176` and `docs/claude/environments.md:14-23` to record the owner decision of 2026-11-05. No new files other than this brief.

## Out of scope

No code, no release tag and no deploy. The tag and deploy remain owner steps. The matching comment in `config/environments.mjs` moves to NX-0018, because this brief must stay docs-only to have no failFirst.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | not-claimed | | Needs the files present on origin/main after merge. They are on this branch only (commit b75fbf1), unmerged and unpushed |
| A2 | not-claimed | | The check is to read the merged text. The edit to `CLAUDE.md:173-176` is on this branch only (commit b75fbf1); the module list is unchanged. The matching note in `docs/claude/environments.md` was aligned in commit 5cb03a7 |

### Not claimed

- No release tag and no Amadiya deploy has happened. Both remain owner steps.
- The old "no new features yet" wording is still in `config/environments.mjs` (moves to NX-0018) and in a comment in `__tests__/voice/moduleFlag.test.ts`. The test file is code, so it stays out of this docs-only brief.
- This brief's Approach section names the spec, the plan and `CLAUDE.md`, but not `docs/claude/environments.md`. That file was edited as well (commit 5cb03a7) so it does not contradict `CLAUDE.md`. The approved text above `## FINAL` was not revised to say so.
- The spec and plan were copied as written, apart from the plan's brief number, its Task 1 file list and Step 2 wording. They were not re-reviewed here.
