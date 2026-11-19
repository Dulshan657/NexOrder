# NX-0045 — Clear cached data when the signed-in user changes

```json brief
{
  "id": "NX-0045-clear-cache-on-user-change",
  "base": "7b949947d2b197d126dbb6bf31376bf98c0fbe21",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "When the signed-in user signs out, every cached query (orders, customers, invoices, profiles, …) is dropped at once." },
    { "id": "A2", "check": "When a different user signs in on the same tab, with or without a sign-out between, nothing cached for the previous user survives." },
    { "id": "A3", "check": "A session refresh for the same user (TOKEN_REFRESHED, or SIGNED_IN for the same id) keeps the cache — no mid-shift reload.", "manual": "guard test `AuthProvider > keeps cached data on a token refresh for the same user` — passes on the base by design (the base never clears), so it cannot be a fail-first; it pins that the fix does not over-clear" },
    { "id": "A4", "check": "On dev, signing in as one rep and then another shows the second rep only their own orders, without a page reload.", "manual": "deploy:dev; the owner signs in as two reps in turn and the assistant reads the dashboard's data" }
  ],
  "failFirst": [
    { "file": "__tests__/authClearsCacheOnUserChange.test.tsx", "test": "AuthProvider > drops cached data when the user signs out", "proves": ["A1"] },
    { "file": "__tests__/authClearsCacheOnUserChange.test.tsx", "test": "AuthProvider > drops cached data when a different user signs in", "proves": ["A2"] }
  ],
  "allow": []
}
```

## Goal

Found during the NX-0043 owner walk on dev: after Field Rep Charlie signed out
and Office Rep Emma signed in in the same tab, Emma's dashboard held Charlie's
130 orders. Nothing clears the TanStack Query cache on an auth change, query
keys carry no user, and staleTime is 5 minutes — so the next person on a shared
device (warehouse handheld, counter PC) sees the previous person's data until
a refetch or reload. RLS is correct; the leak is purely client-side. The same
code is on main and on Amadiya.

## Approach

- `hooks/useAuth.ts`: in the existing `onAuthStateChange` listener, remember
  the previous user id; when it was a real user and the new id differs
  (another user, or none), call `queryClient.clear()` synchronously. Nothing
  is awaited, so the listener's no-await rule (CLAUDE.md) holds.
- `__tests__/authClearsCacheOnUserChange.test.tsx`: the two fail-first tests
  and a same-user refresh guard (A3).

## Out of scope

- The dashboard's "All clear while loading" state.
- Any server-side or RLS change (they are correct).
- Releasing to Amadiya (next rel-* tag).

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `AuthProvider > drops cached data when the user signs out` fails on base, passes on tip | |
| A2 | claimed | `AuthProvider > drops cached data when a different user signs in`, plus `… reloads everything as the next user after a sign-out, never keeping what loaded while signed out` | The second test was added after the first dev check: resetting at sign-out refetched with no session and cached the empty staff list, so every order read "Unknown" |
| A3 | claimed | `AuthProvider > keeps cached data on a token refresh for the same user` | Passes on base too — a guard, not a fail-first |
| A4 | claimed | dev `bcfcb7e`: owner signed out as Field Rep Charlie and in as Office Rep Emma in the same tab; the dashboard held 61 orders, all Emma's, none of Charlie's (read from the page) | The page's last full load was ~25s before the check, consistent with the owner's reload before signing out; not independently proven that no reload followed the sign-in |

Full suite: 462 files / 7054 tests pass. `tsc --noEmit`, `lint` clean.

### Not claimed

- Not released to Amadiya: it ships at the next `rel-*` tag. Until then the production site still carries the leak.
- Queries a component holds while signed out are cleared, not refetched; this relies on the signed-in app tree unmounting at sign-out (it does today: the login screen replaces it).
- The cross-tab case (signing in as someone else in another tab) relies on supabase-js emitting the auth event in this tab; not tested.
