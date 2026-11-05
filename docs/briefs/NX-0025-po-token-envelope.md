# NX-0025 — a PO Inbox token can always be saved

```json brief
{
  "id": "NX-0025-po-token-envelope",
  "base": "4831cdb0239baa098857a7430b36a1cef94f60d9",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "No encrypted token can start with a prefix the database refuses (1//, ya29., ey, M.C, OAQABAA), whatever random bytes it was encrypted with." },
    { "id": "A2", "check": "A token encrypted before this change still decrypts, and tampering or a malformed value still fails." },
    { "id": "A3", "check": "The test no longer depends on chance, and the encryption test is no longer excused as a known flake." },
    { "id": "A4", "check": "The dev database accepts the new format and still refuses a real plaintext token.", "manual": "An insert of each inside BEGIN and ROLLBACK on dev, so nothing is kept." },
    { "id": "A5", "check": "The five functions run on dev: the poller and retry and disconnect first, then the two OAuth callbacks.", "manual": "Deployed to dev with --yes, then po-poll-inbox checked for successful runs after the deploy." },
    { "id": "A6", "check": "Merged and deployed to dev; /version.json shows the sha serving it.", "manual": "deploy:dev verification, keeping the unmerged demo work on dev." }
  ],
  "failFirst": [
    { "file": "__tests__/poInbox.encryption.test.ts", "test": "encryption helper > no IV can make an envelope start with a prefix the database refuses", "proves": ["A1"] },
    { "file": "__tests__/poInbox.encryption.test.ts", "test": "encryption helper > writes the versioned envelope", "proves": ["A1"] },
    { "file": "__tests__/knownFlakesList.test.ts", "test": "known flakes list > names the Order home flake, and no longer excuses the PO Inbox encryption test", "proves": ["A3"] }
  ],
  "allow": []
}
```

## Goal

An encrypted mailbox token starts with random characters, so about 1 in 4,096 starts with `ey`,
which the database refuses as if it were a plaintext token. That connect or token refresh then
fails, and the same chance makes CI fail about 1 run in 80.

## Approach

- `_shared/poInbox/encryption.ts`: new tokens are stored as `v1:{iv}:{ciphertext}`. A fixed start
  can never match a refused prefix. `decryptToken` reads this and the old `{iv}:{ciphertext}`.
- No migration. The database check stays, because it is still worth having.
- `__tests__/poInbox.encryption.test.ts`: the 50-try loop becomes a test that forces IVs which
  encode to each refused prefix, so it cannot pass or fail by luck. The tamper test splits the new
  format. Same assertions or more.
- `config/knownFlakes.json`: the encryption entry goes. `__tests__/knownFlakesList.test.ts` checks
  it is gone, with the same number of assertions.
- Deploy order on dev: `poll-inbox`, `retry-email-account` and `disconnect-email-account`, then
  `gmail-oauth-callback` and `outlook-oauth-callback`, so no reader meets the new format
  unprepared. `--yes` is approved for these five, dev only, for this PR.
- `docs/claude/po-inbox.md` records the format.

## Out of scope

- Key rotation, and any change to stored tokens: old ones stay readable and are not rewritten.
- Any other PO Inbox behaviour.
- Amadiya: it does not have the `po_inbox` module, so nothing is deployed there.

## FINAL
