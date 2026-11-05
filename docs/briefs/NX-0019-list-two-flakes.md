# NX-0019 — list two known flakes that block every PR

```json brief
{
  "id": "NX-0019-list-two-flakes",
  "base": "137b73915da31b6a56e3343a1e8105b67bdb24f4",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "config/knownFlakes.json lists __tests__/kitchenHomeView.test.tsx and __tests__/poInbox.encryption.test.ts, each with a reason and a since date." },
    { "id": "A2", "check": "The four existing entries are unchanged." },
    { "id": "A3", "check": "After this merges, re-gating PR #33 reports these two as known-flake if they fail again inside the full suite.", "manual": "Seen in the re-gate of PR #33; if neither fails in that run, not claimed." }
  ],
  "failFirst": [
    { "file": "__tests__/knownFlakesList.test.ts", "test": "known flakes list > names the Order home and PO Inbox encryption flakes with a reason and a date", "proves": ["A1"] },
    { "file": "__tests__/knownFlakesList.test.ts", "test": "known flakes list > still holds the four earlier entries", "proves": ["A2"] }
  ],
  "allow": [
    { "move": "flake-listed", "reason": "Listing these two is the whole purpose of this change; the owner chose it on 2026-11-05 after the gate's NO-GO on PR #33." }
  ]
}
```

## Goal

The gate's NO-GO on PR #33 came from two tests that fail in the full suite and pass
alone, neither caused by that PR, and a PR cannot list its own flakes. Listing them
in advance is the route the gate's rules provide.

## Approach

- `config/knownFlakes.json` gains two entries:
  - **`kitchenHomeView.test.tsx`:** timed out in the full suite (31s against a 5s
    limit) with about 1.65 GB of memory free afterwards; passes 3/3 alone on tip and base.
  - **`poInbox.encryption.test.ts`:** a real product bug, not a test problem.
    Encrypted tokens start with random base64, so about 1 in 4,096 start with `ey`,
    which migration `00018`'s CHECK refuses. The entry says to delete it once that's fixed.
- A small test pins both new entries and the four earlier ones.

## Out of scope

- Fixing the PO Inbox encryption bug. It stays open for its own brief.
- Speeding up the Order home test.
- The six stale `rack-levels` specs.

## FINAL
