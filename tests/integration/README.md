# PO Inbox Integration & E2E Tests

The Stream I test suite has three runners. Each requires infrastructure
that the unit-test layer (vitest) does not, so they are documented here
rather than auto-running on `npm test`. Wire them up after the operator
finishes the runbook in `HORECA_Email_PO_Processing/RUNBOOK.md`.

## 1. Supabase-local integration tests (`vitest --integration`)

**Purpose**: exercise the full Edge Function pipeline against a local
Supabase stack with a test fixture corpus from
`tests/fixtures/po-samples/`.

**Pre-requisites**:
- `supabase` CLI installed
- `supabase start` running (Postgres + Storage + Edge Functions)
- `supabase functions serve` running on the local stack
- Test secrets set in `.env.test.local`:
    ```
    OPENAI_API_KEY=sk-test...
    PO_ENCRYPTION_KEY=<base64 32 bytes>
    GMAIL_OAUTH_CLIENT_ID=<test client>
    GMAIL_OAUTH_CLIENT_SECRET=<test client secret>
    OUTLOOK_OAUTH_CLIENT_ID=<test client>
    OUTLOOK_OAUTH_CLIENT_SECRET=<test client secret>
    POLL_INBOX_CRON_TOKEN=<random>
    ```

**Suggested test file**: `tests/integration/po-pipeline.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FIXTURE_DIR = resolve(__dirname, '../fixtures/po-samples/text')

describe('extract-po pipeline', () => {
  for (const file of readdirSync(FIXTURE_DIR)) {
    if (!file.endsWith('.txt')) continue
    it(`processes ${file}`, async () => {
      const body = readFileSync(resolve(FIXTURE_DIR, file), 'utf8')
      // 1. Insert an inbound_messages row via service-role REST
      // 2. Upload the body as original.json to the local Storage bucket
      // 3. POST inboundMessageId to local extract-po
      // 4. Assert pending_pos row materializes with expected status
      // The fixture filename '04-not-a-po-newsletter.txt' must classify
      // as skipped_not_po.
      expect(true).toBe(true)  // implement when local stack is wired
    }, 60_000)
  }
})
```

Add `tests/integration` to a separate vitest project so it doesn't run
on every `npm test`. Suggested config addition:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    workspace: [
      { extends: true, test: { include: ['__tests__/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          include: ['tests/integration/**/*.test.ts'],
          name: 'integration',
          env: { SUPABASE_TEST_URL: 'http://127.0.0.1:54321' },
        },
      },
    ],
  },
})
```

Run with `npx vitest --project integration`.

## 2. Playwright E2E (`npm run test:e2e`)

**Purpose**: exercise the full UI flow — connect a Gmail mailbox,
deliver a PO via test inbox, watch it land in PO Inbox, approve, see
the order in Orders.

**Pre-requisites**:
- Production-like deployment (e.g. preview Vercel) OR full local stack
  running with `npm run dev` + `supabase start` + `supabase functions serve`
- A test Gmail account dedicated to the suite (OAuth refresh token
  baked into `playwright.setup.ts`)
- `@playwright/test` installed: `npm install -D @playwright/test`

**Suggested test file**: `tests/e2e/po-inbox.spec.ts` — see
`po-inbox.spec.skeleton.ts` next to this README for the starting
shape. Includes the four critical journeys:

1. Connect Gmail → see new mailbox listed
2. Drop a sample PO email into the test inbox → assert pending_po
   appears within 90s
3. Approve a pending PO → assert order appears in main orders list
4. Reject a pending PO → assert it's marked rejected and no order
   created

## 3. RLS SQL test suite

**Purpose**: prove that Reps and Customers cannot SELECT from
`email_accounts`, `pending_pos`, `oauth_pending_states`, or
`po_extraction_audit` — even via realtime subscriptions.

**Pre-requisites**:
- `pgTAP` or `pg-prove` installed locally OR the Supabase project's
  built-in `pgtap` extension enabled
- Test users seeded in `supabase/seed.ts` with each of the five roles

**Suggested test file**: `tests/integration/rls.test.sql`. The shape:

```sql
BEGIN;
SELECT plan(N);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "<rep-user-uuid>", "role": "authenticated"}';

SELECT is_empty(
    $$SELECT id FROM email_accounts$$,
    'rep cannot read email_accounts'
);
SELECT is_empty(
    $$SELECT id FROM pending_pos$$,
    'rep cannot read pending_pos'
);
SELECT is_empty(
    $$SELECT id FROM po_extraction_audit$$,
    'rep cannot read po_extraction_audit'
);

ROLLBACK;
```

Run with `pg_prove -d postgres tests/integration/rls.test.sql`.

## Why these aren't auto-wired into `npm test`

The vitest unit suite (currently 300+ tests, all passing) covers every
pure helper and pre-flights the contract surface. Wiring infrastructure
tests into CI requires:
- a long-lived test Supabase project (and the cost of running it)
- secrets management in CI
- agreement on how to handle OAuth-redirect flows in headless browsers
  (probably a Playwright fixture that injects a refresh token directly
  via `supabase.functions.invoke('gmail-oauth-callback', ...)`)

These are real Phase 2 tasks. The skeletons in this directory are the
starting point.
