# NX-9999 — probe (do not merge)

```json brief
{ "id": "NX-9999-probe", "base": "b356a7dab4cff9308e0937fdaaaf87d75b689cf7", "approved": "2026-10-14 owner (probe)",
  "acceptance": [ { "id": "A1", "check": "probe: names a test that already passes on main" } ],
  "failFirst": [ { "file": "__tests__/flakeVerdict.test.ts", "test": "classifyFailure (gate flake protocol) > fails only on the tip -> regression, blocking", "proves": ["A1"] } ],
  "allow": [] }
```

## Goal

Prove the required check binds. Close without merging.

## FINAL
