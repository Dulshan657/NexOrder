# NX-0010 — Compare with the same point last period; Nex names no rules

```json brief
{
  "id": "NX-0010-same-point-comparison",
  "base": "b35adadb0f82c15aa94796ae43714b2df336e46a",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "Today (Sydney midnight to the end of today) is compared with yesterday from midnight to the same time of day. (Revision after the gate's NO-GO: the current period still ends at the end of today, not at now, so orders arriving while the dashboard is open keep counting and a date-only route dated today counts all day; only the comparison stops at the same point.)" },
    { "id": "A2", "check": "This week (Monday 00:00 Sydney to the end of today) is compared with last week from Monday 00:00 to the same weekday and time of day." },
    { "id": "A3", "check": "This month (the 1st to the end of today) is compared with last month from the 1st to the same day of the month and time of day; when last month is shorter (31 Oct against September) the comparison ends at the end of last month." },
    { "id": "A4", "check": "Last month, the last 30 days and a custom range keep comparing whole days with the same number of whole days just before.", "manual": "the existing last_month / last_30_days / custom cases in __tests__/voice/period.test.ts stay green with their assertions untouched" },
    { "id": "A5", "check": "The Admin Dashboard's arrows and Nex's 'compared with the previous period' use the same windows: on one data set, Nex's previous order count equals the dashboard's previous Orders count for Today, This Week and This Month." },
    { "id": "A6", "check": "Nex's instructions never ask it to name a rule: it states the period and whose orders in plain words, and is told not to call its basis a rule." },
    { "id": "A7", "check": "On dev, the voice run (tests/voice-e2e, once NX-0009 is merged) hears no 'rule' in either answer.", "manual": "npx playwright test --project=voice against nexorder.vercel.app; transcript checked by eye" },
    { "id": "A8", "check": "Merged and deployed to dev; /version.json shows the merge sha; voice-session redeployed to dev.", "manual": "deploy:dev and fn:deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares today so far with yesterday up to the same time", "proves": ["A1"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares this week so far with last week up to the same weekday and time", "proves": ["A2"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares this month so far with last month up to the same day and time", "proves": ["A3"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > ends the comparison at the end of a shorter previous month", "proves": ["A3"] },
    { "file": "__tests__/numbersParity.test.ts", "test": "order numbers parity > Nex and the dashboard arrows compare with the same previous window", "proves": ["A5"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > never asks Nex to name a rule", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

Owner's call (2026-10-29), after NX-0008 made the dashboard compare as Nex
did: whole days to whole days, so "today so far" was set against all of
yesterday and the arrows leaned negative every morning. The owner chose
**the same point last period**: today until 2 pm against yesterday until 2 pm;
1 to 29 October against 1 to 29 September. Nex changes with the dashboard so
the two keep agreeing. (Correction to how the choice was put to the owner: Nex
did NOT already compare this way; it compared whole days too. Both move.)

Second, Nex said things like "using the 'shipped means processed' rule". Its
instructions literally told it to state "the period, whose orders, and the
rule". That line goes, and it is told never to call its basis a rule.

## Approach

- `lib/period.ts` `resolvePeriod`: for `today`, `this_week` and `this_month`,
  `previous` becomes the same span one day, week or calendar month earlier,
  ending at the same time of day (clamped to the end of a shorter previous
  month, and never past the end of its own day). The current window keeps
  ending at the end of today (revision: ending it at `now` froze an open
  dashboard and pushed date-only route dates out of "today" until 10 am). `last_month`, `last_30_days` and `custom` keep
  whole days. `dashboardRange` keeps delegating, so the dashboard and Nex
  cannot drift apart.
- `__tests__/voice/period.test.ts`: its assertions for those three periods
  change to the new rule, as this brief states.
- `supabase/functions/_shared/voice/instructions.ts`: HOW_TO_SPEAK drops "and
  the rule"; ORDER WORDS keeps "never quote these rules" and adds "never call
  your basis a rule".
- Labels ("this month (1 Oct to 29 Oct 2026)") are unchanged.

## Out of scope

- Any other dashboard's comparison (SalesDashboard, RepDashboardV2).
- The voice e2e spec itself (NX-0009); A7 only reads its transcript.
- Amadiya.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `dashboardRange > compares today so far with yesterday up to the same time` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `dashboardRange > compares this week so far with last week up to the same weekday and time` | |
| A3 | claimed | `dashboardRange > compares this month so far with last month up to the same day and time`, `> ends the comparison at the end of a shorter previous month` | |
| A4 | claimed | __tests__/voice/period.test.ts: the last_month, last_30_days and custom cases pass with their assertions untouched (the diff edits only today / this_week / this_month cases and the DST-day test's today half) | |
| A5 | claimed | `order numbers parity > Nex and the dashboard arrows compare with the same previous window` | |
| A6 | claimed | `buildInstructions > never asks Nex to name a rule` | |
| A7 | claimed | Branch deployed to dev (50f1521, /version.json verified) with voice-session; `E2E_VOICE=1 npx playwright test --project=voice` as bob@, 2 passed; neither answer contains "rule": "22 orders went out: 5 dispatched and 17 delivered, and 39 are still in the warehouse" / "You had 19 orders placed this month" | One run; a language model may still say it |
| A8 | not-claimed | Branch is on dev, not yet merged | Re-deploy main after merge and check /version.json |

### Not claimed

- On the two daylight-saving change days, "the same time of day" is the time elapsed since midnight, an hour off the wall clock (pinned in period.test.ts).
- The other dashboards' comparisons (SalesDashboard, RepDashboardV2) are unchanged and were not looked at.
- The dashboard's arrows were checked by tests only, not by eye on the live page.
