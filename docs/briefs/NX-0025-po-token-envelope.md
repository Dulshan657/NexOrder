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

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `encryption helper > no IV can make an envelope start with a prefix the database refuses` and `encryption helper > writes the versioned envelope` fail on base by assertion, pass on tip. Against the old code the first fails on the real bug: "an IV starting eyAA gave eyAAAAAAAAAAAAAA:…" | It forces IVs spelling `ey`, `1//` and `OAQABAA`. Base64 cannot spell `ya29.` or `M.C`, which hold a '.', and the fixed start covers them anyway |
| A2 | claimed | `encryption helper > still reads an envelope written before the version prefix`, `rejects malformed envelopes on decrypt` and `decryption fails when ciphertext is tampered` pass on tip | The older form is made by removing `v1:` from a new envelope, which is byte for byte what the old code wrote. No stored old token exists on dev to try |
| A3 | claimed | `known flakes list > names the Order home flake, and no longer excuses the PO Inbox encryption test` fails on base by assertion, passes on tip. The 50-try loop is gone, and `config/knownFlakes.json` no longer lists the file | The list's length check in the same test file goes from 6 to 5 |
| A4 | claimed | On dev, inside a transaction that was rolled back: `v1:eyAAAAAAAAAAAAAA:abcd` accepted. `eyAAAAAAAAAAAAAA:abcd`, `1//abc`, `ya29.abc`, `eyJhbGciOi`, `M.C123` and `OAQABAAabc` all refused by the CHECK. Dev still has 5 accounts and 0 test rows | |
| A5 | claimed | Deployed to dev in order, each exit 0: `poll-inbox` 11:37:12, `retry-email-account` 11:37:21, `disconnect-email-account` 11:37:27, `gmail-oauth-callback` 11:37:33, `outlook-oauth-callback` 11:37:38 UTC. `po-poll-inbox` then succeeded each minute, with the responses recorded in that window all 200 and reading `{"ok":true,"accounts":[]}` | The poller had no account to process, so this shows it boots and answers, not that it decrypted anything. The other four functions were deployed but not called |
| A6 | not-claimed | | Dev serves 56b64c6063df26899f0382ed6fbc30475a736bf3, but that is a throwaway merge so the unmerged demo work stays on dev, and this is before the merge. Not pushed |

### Not claimed

- No real mailbox was connected and no token was refreshed: all five dev mailboxes are signed out and hold no token, and a connect needs a real Google or Microsoft sign-in. So the new format has never been through a real OAuth connect, a token refresh or a poll. That needs the owner to reconnect a mailbox on dev.
- No stored old-format token was decrypted on a server, because none exists on dev or, as far as the registry shows, anywhere the module is on.
- Rolling back past this strands any token written since, because older code cannot read `v1:`. No token exists today, so this has no effect yet. It is recorded in `docs/claude/po-inbox.md`.
- `disconnect-email-account` carries its own Google revoke using the stored token, which was read but not run.
- Amadiya was not touched or queried. It does not have the `po_inbox` module, according to `config/environments.mjs`.
- The `--project` browser suites were not run: this changes no page.
- The deploy-functions script cannot pass `--yes`, so a small script resolving the same target ran the five deploys, with the owner's approval in the brief.
