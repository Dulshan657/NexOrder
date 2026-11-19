# NX-0045 — Clear cached data when the signed-in user changes

```json brief
{
  "id": "NX-0045-clear-cache-on-user-change",
  "base": "7b949947d2b197d126dbb6bf31376bf98c0fbe21",
  "approved": "2026-11-19 owner",
  "acceptance": [
    { "id": "A1", "check": "When the signed-in user signs out, every cached query (orders, customers, invoices, profiles, …) is dropped at once." },
    { "id": "A2", "check": "When a different user signs in on the same tab, with or without a sign-out between, nothing cached for the previous user survives." },
    { "id": "A3", "check": "A session refresh for the same user (TOKEN_REFRESHED, or SIGNED_IN for the same id) keeps the cache — no mid-shift reload." },
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
