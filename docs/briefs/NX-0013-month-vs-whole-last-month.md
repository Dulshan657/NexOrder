# NX-0013 — "This month" is compared with the whole of last month, on the dashboard and in Nex

```json brief
{
  "id": "NX-0013-month-vs-whole-last-month",
  "base": "ed7ef7456ffce0f3f9ec6c3ce22d9e514cd64610",
  "approved": "2026-11-04 owner",
  "acceptance": [
    { "id": "A1", "check": "resolvePeriod('this_month') compares with the whole previous calendar month (its 1st at 00:00 to the last millisecond of its last day, Sydney), on every day of the month, the 1st included." },
    { "id": "A2", "check": "The Admin Dashboard's this-month comparison (dashboardRange('this_month')) is the same whole previous month, so its arrows and Nex agree." },
    { "id": "A3", "check": "On dev, asked 'what was revenue this month compared to last month', Nex compares with the whole of last month: the golden case admin-revenue-vs-last-month passes.", "manual": "npm run nex:golden:dev -- --only=admin-revenue-vs-last-month after deploy:dev" },
    { "id": "A4", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/period.test.ts", "test": "resolvePeriod > this_month > compares with the whole of last month", "proves": ["A1"] },
    { "file": "__tests__/voice/period.test.ts", "test": "resolvePeriod > this_month > compares with the whole of last month on the 1st", "proves": ["A1"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares this month so far with the whole of last month", "proves": ["A2"] }
  ],
  "allow": []
}
```

## Goal

Owner's call, 2026-11-04. Asked "revenue compared to last month" on 4 November,
Nex compared $0 against the whole of October ($4,225). The dashboard, following
NX-0010, compared against 1–4 October only ($229). The owner wants **all of
November against all of October, in both**. This month so far is set against the
whole of last month, on the dashboard and in Nex.

## Approach

- `lib/period.ts` `inProgressPrevious`: `this_month`'s previous window becomes
  the whole previous calendar month. The header comment says why it differs from
  today and this week.
- The NX-0010 tests that pinned the same point for this month are restated as the
  new rule: `period.test.ts` `this_month`, and `dashboardPeriod.test.ts`. The
  tests for a shorter previous month already expect the whole month and stay.
- `docs/claude/voice-assistant.md` gets one line on what each period is compared with.

## Out of scope

- **Today and this week keep the same-point comparison** (NX-0010). The owner
  named the month only. Say if those should change too, and it is a one-line
  follow-up.
- Last month, the last 30 days and a custom range are unchanged: each is
  compared with the equal-length window before it.
- The comparison's dates are not shown on the dashboard (it shows only % change).

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `resolvePeriod > this_month > compares with the whole of last month` and `… on the 1st` fail on base, pass on tip (check:brief) | Includes 1 March against all of February (28 days) |
| A2 | claimed | `dashboardRange > compares this month so far with the whole of last month` (check:brief) | The dashboard and Nex share `lib/period.ts`, so one change moves both |
| A3 | claimed | Golden run on dev, 2026-11-04, build 8dad50e (this branch plus NX-0011): `admin-revenue-vs-last-month` PASS, "about 0 dollars, compared with about 4,225 dollars for 1 October to 31 October" | |
| A4 | not-claimed | | Not merged. Dev serves a local, unpushed build of this branch combined with NX-0011 (8dad50e), so the new Nex mark stays visible until #28 merges |

### Not claimed

- **Today and this week still compare with the same point** (NX-0010), deliberately: the owner named the month only.
- **The dashboard was not opened in a browser.** Its comparison is pinned by `dashboardRange`'s test, and it shows only % change, no dates.
- **Stacked on #29 (NX-0012).** This PR's diff includes nothing of #29, but it cannot merge before #29 does.
