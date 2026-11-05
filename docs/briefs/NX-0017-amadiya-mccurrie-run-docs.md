# NX-0017 — Record the McCurrie run design and lift Amadiya's feature hold

```json brief
{
  "id": "NX-0017-amadiya-mccurrie-run-docs",
  "base": "137b73915da31b6a56e3343a1e8105b67bdb24f4",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "The spec and plan for the McCurrie run are on main.", "manual": "files present on origin/main after merge" },
    { "id": "A2", "check": "CLAUDE.md no longer says Amadiya gets no new features; it records the 2026-11-05 owner decision, with its module list unchanged.", "manual": "read the merged text" }
  ],
  "failFirst": [],
  "allow": []
}
```

## Goal

Put the approved design and plan on main, and correct the instruction that would otherwise stop Amadiya's release.

## Approach

Docs only: add `docs/superpowers/specs/2026-11-05-amadiya-mccurrie-run-design.md` and `docs/superpowers/plans/2026-11-05-amadiya-mccurrie-run.md`, and edit `CLAUDE.md:173-176`.

## Out of scope

No code, no release tag and no deploy. The tag and deploy remain owner steps. The matching comment in `config/environments.mjs` moves to NX-0018, because this brief must stay docs-only to have no failFirst.

## FINAL
